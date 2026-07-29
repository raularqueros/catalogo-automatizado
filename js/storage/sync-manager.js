import { getTimestamp } from '../utils.js?v=20260729-final-integration-v1';
import CONFIG from '../config.js?v=20260729-final-integration-v1';

/**
 * SyncManager — Coordina IndexedDB (local) con RemoteStorageProvider (Drive).
 *
 * Arquitectura:
 *   UI → Servicios → IndexedDbProvider
 *                        ↕
 *                    SyncManager
 *                        ↕
 *                DriveRemoteProvider
 *
 * IndexedDB es el almacenamiento operativo permanente.
 * Drive es un proveedor remoto sincronizado, no un reemplazo.
 */
export class SyncManager {
  constructor(storageProvider) {
    this._storage = storageProvider;
    this._remoteProvider = null;
  }

  setRemoteProvider(provider) {
    this._remoteProvider = provider;
  }

  async markPending(project) {
    project.syncMetadata.status = 'pending';
    project.syncMetadata.lastLocalUpdate = getTimestamp();
    project.syncMetadata.errorMessage = null;
    await this._storage.updateProject(project);
  }

  async markError(project, message) {
    project.syncMetadata.status = 'error';
    project.syncMetadata.errorMessage = message || 'No se pudo completar el respaldo en Google Drive.';
    await this._storage.updateProject(project);
  }

  async markLocal(project) {
    project.syncMetadata.status = 'local';
    project.syncMetadata.lastLocalUpdate = getTimestamp();
    await this._storage.updateProject(project);
  }

  async getSyncStatus(projectId) {
    const project = await this._storage.getProject(projectId);
    if (!project) return null;
    return {
      status: project.syncMetadata.status,
      cloudProvider: project.syncMetadata.cloudProvider,
      lastLocalUpdate: project.syncMetadata.lastLocalUpdate,
      lastCloudSync: project.syncMetadata.lastCloudSync,
      errorMessage: project.syncMetadata.errorMessage
    };
  }

  async hasPendingChanges(projectId) {
    const project = await this._storage.getProject(projectId);
    if (!project) return false;
    return project.syncMetadata.status === 'pending' || project.syncMetadata.status === 'error';
  }

  getProviderLabel() {
    return this._remoteProvider && this._remoteProvider.isConnected()
      ? 'Google Drive conectado'
      : 'Google Drive a\u00fan no conectado';
  }

  isConnected() {
    return this._remoteProvider ? this._remoteProvider.isConnected() : false;
  }

  /**
   * Construye un snapshot serializable del proyecto para subir a Drive.
   */
  async buildSnapshot(project, products, imageRecords) {
    const imageMetas = imageRecords.map(r => ({
      imageId: r.imageId,
      mimeType: r.mimeType,
      width: r.width,
      height: r.height,
      fileSize: r.fileSize,
      updatedAt: r.updatedAt,
      cloudFileId: r.cloudFileId || null
    }));

    const projectData = {
      projectId: project.projectId,
      name: project.name,
      schemaVersion: project.schemaVersion,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      revision: project.revision,
      currency: project.currency,
      locale: project.locale,
      categories: project.categories,
      visualSettings: project.visualSettings
    };

    return {
      formatVersion: 1,
      exportedAt: getTimestamp(),
      project: projectData,
      products: products.map(p => ({
        id: p.id,
        projectId: p.projectId,
        name: p.name,
        description: p.description,
        price: p.price,
        sku: p.sku,
        category: p.category,
        imageId: p.imageId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        revision: p.revision,
        sortOrder: p.sortOrder,
        active: p.active
      })),
      images: imageMetas
    };
  }

  /**
   * Valida la estructura del manifest descargado de Drive.
   */
  _validateManifest(manifest, expectedProjectId) {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('MANIFEST_INVALID: El archivo descargado no es un JSON válido.');
    }
    if (!manifest.formatVersion || manifest.formatVersion !== 1) {
      throw new Error(`MANIFEST_VERSION: La versión del formato (${manifest.formatVersion || 'desconocido'}) no es compatible.`);
    }
    if (!manifest.project || !manifest.project.projectId) {
      throw new Error('MANIFEST_STRUCTURE: El manifiesto no contiene datos del proyecto.');
    }
    if (manifest.project.projectId !== expectedProjectId) {
      throw new Error(`MANIFEST_PROJECT_MISMATCH: El projectId del manifiesto (${manifest.project.projectId}) no coincide con el esperado (${expectedProjectId}).`);
    }
    if (!Array.isArray(manifest.products)) {
      throw new Error('MANIFEST_STRUCTURE: products no es un array.');
    }
    if (!Array.isArray(manifest.images)) {
      throw new Error('MANIFEST_STRUCTURE: images no es un array.');
    }
    for (const p of manifest.products) {
      if (!p.id || !p.projectId || p.name === undefined || p.price === undefined || p.revision === undefined) {
        throw new Error(`MANIFEST_PRODUCT_INVALID: Producto ${p.id || '?'} tiene campos requeridos faltantes.`);
      }
    }
  }

  /**
   * Evalúa si se puede abrir un proyecto remoto dado el estado local actual.
   */
  async _evaluateLocalConflict(remoteProject) {
    const localProject = await this._storage.getProject(remoteProject.projectId);
    if (!localProject) return { action: 'create', localProject: null };

    if (localProject.syncMetadata.status === 'synced') {
      if (localProject.revision === remoteProject.revision) {
        return { action: 'skip', localProject, reason: 'Versión remota idéntica a la local.' };
      }
      if (remoteProject.revision > localProject.revision) {
        return { action: 'update', localProject, reason: 'La versión de Drive es más reciente.' };
      }
      if (localProject.revision > remoteProject.revision) {
        return { action: 'warn_revert', localProject, reason: 'La versión local es más reciente que la de Drive.' };
      }
    }

    if (localProject.syncMetadata.status === 'pending' || localProject.syncMetadata.status === 'error') {
      return { action: 'warn_pending', localProject, reason: 'Hay cambios locales pendientes que no están en Drive.' };
    }

    return { action: 'update', localProject, reason: 'Versión local existente.' };
  }

  /**
   * Abre un proyecto desde Google Drive y lo convierte en el proyecto activo.
   *
   * Flujo:
   * 1. Descargar y validar manifest
   * 2. Evaluar conflicto con proyecto local
   * 3. Si hay conflicto, resolver con el usuario
   * 4. Descargar todas las imágenes
   * 5. Importar atómicamente
   * 6. Actualizar metadata de proyecto activo
   *
   * @param {object} remoteProject - { projectId, projectFolderId, visibleName, modifiedTime }
   * @param {function} onProgress - Callback para actualizar el estado (mensaje string)
   * @param {function} onResolveConflict - Callback para resolver conflictos. Recibe { action, reason, localProject } y debe devolver la acción: 'replace' | 'cancel'
   */
  async openProjectFromDrive(remoteProject, onProgress, onResolveConflict) {
    if (!this._remoteProvider || !this._remoteProvider.isConnected()) {
      throw new Error('Google Drive no está conectado.');
    }

    if (typeof onProgress !== 'function') onProgress = () => {};

    const projectId = remoteProject.projectId;
    const projectFolderId = remoteProject.projectFolderId;

    // 1. Descargar manifest
    onProgress('Descargando catálogo desde Drive...');
    const { manifest, manifestFileId } = await this._remoteProvider.getRemoteManifest(projectId, projectFolderId);
    this._validateManifest(manifest, projectId);

    // 2. Evaluar conflicto local
    onProgress('Verificando datos locales...');
    const conflict = await this._evaluateLocalConflict(manifest.project);

    if (conflict.action === 'skip') {
      return { project: conflict.localProject, totalProducts: 0, totalImages: 0, skipped: true };
    }

    if (conflict.action === 'warn_pending' || conflict.action === 'warn_revert') {
      if (typeof onResolveConflict === 'function') {
        const choice = await onResolveConflict(conflict);
        if (!choice || choice === 'cancel') {
          throw { conflict: 'cancelled', message: 'Apertura cancelada por el usuario.' };
        }
        if (choice !== 'replace') {
          throw { conflict: 'cancelled', message: 'Apertura cancelada.' };
        }
      } else {
        throw { conflict: 'pending', message: 'Hay cambios locales. Debes elegir si reemplazar o cancelar.' };
      }
    }

    if (conflict.action === 'update') {
      if (typeof onResolveConflict === 'function') {
        const choice = await onResolveConflict({ ...conflict, action: 'update' });
        if (choice === 'cancel') {
          throw { conflict: 'cancelled', message: 'Apertura cancelada.' };
        }
      }
    }

    // 3. Reconstruir proyecto con metadatos remotos
    const now = getTimestamp();
    const project = {
      projectId: manifest.project.projectId,
      name: manifest.project.name || remoteProject.visibleName,
      schemaVersion: manifest.project.schemaVersion || 1,
      createdAt: manifest.project.createdAt || now,
      updatedAt: manifest.project.updatedAt || now,
      revision: manifest.project.revision || 1,
      currency: manifest.project.currency || 'CLP',
      locale: manifest.project.locale || 'es-CL',
      categories: manifest.project.categories || [],
      visualSettings: manifest.project.visualSettings || { primaryColor: null, logoImageId: null },
      syncMetadata: {
        status: 'synced',
        cloudProvider: 'google-drive',
        cloudProjectId: projectFolderId,
        lastLocalUpdate: now,
        lastCloudSync: now,
        deviceId: manifest.project.projectId,
        errorMessage: null
      }
    };

    // 4. Descargar imágenes
    const imageRecords = [];
    const imageMetaMap = {};
    for (const imgMeta of manifest.images || []) {
      imageMetaMap[imgMeta.imageId] = imgMeta;
    }

    for (const product of manifest.products || []) {
      if (!product.imageId) continue;
      if (imageRecords.some(r => r.imageId === product.imageId)) continue;

      const meta = imageMetaMap[product.imageId];
      if (!meta || !meta.cloudFileId) {
        throw new Error(`La imagen ${product.imageId} del producto "${product.name}" no tiene referencia a un archivo en Drive.`);
      }

      onProgress(`Descargando imagen (producto: ${product.name})...`);
      const blob = await this._remoteProvider.downloadFileBlob(meta.cloudFileId);

      if (!blob || blob.size === 0) {
        throw new Error(`La imagen ${product.imageId} se descargó vacía.`);
      }

      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimes.includes(blob.type) && !allowedMimes.includes(meta.mimeType)) {
        throw new Error(`La imagen ${product.imageId} tiene un formato no permitido (${blob.type || meta.mimeType}).`);
      }

      imageRecords.push({
        imageId: meta.imageId,
        projectId: projectId,
        mimeType: meta.mimeType || blob.type || 'image/jpeg',
        width: meta.width || 0,
        height: meta.height || 0,
        fileSize: meta.fileSize || blob.size,
        data: blob,
        createdAt: meta.updatedAt || now,
        updatedAt: meta.updatedAt || now,
        localStatus: 'synced',
        cloudFileId: meta.cloudFileId,
        cloudStatus: 'synced'
      });
    }

    // 5. Recoger IDs locales obsoletos antes de la transacción
    onProgress('Preparando limpieza local...');
    const staleProductIds = [];
    const staleImageIds = [];
    try {
      const localProds = await this._storage.listProducts(projectId);
      for (const lp of localProds) {
        if (!manifest.products.some(rp => rp.id === lp.id)) {
          staleProductIds.push(lp.id);
        }
        if (lp.imageId && !manifest.images.some(ri => ri.imageId === lp.imageId) && !staleImageIds.includes(lp.imageId)) {
          staleImageIds.push(lp.imageId);
        }
      }
      // También considerar imágenes huérfanas (sin producto que las referencie)
      for (const imgMeta of manifest.images || []) {
        if (!imgMeta.imageId) continue;
        const stillReferenced = (manifest.products || []).some(p => p.imageId === imgMeta.imageId);
        if (!stillReferenced && !staleImageIds.includes(imgMeta.imageId)) {
          staleImageIds.push(imgMeta.imageId);
        }
      }
    } catch (_) { /* si falla la lectura, no se estorba la limpieza */ }

    // 6. Importar atómicamente
    onProgress('Guardando proyecto localmente...');
    await this._storage.replaceProjectFromRemoteAtomic({
      project,
      products: manifest.products || [],
      images: imageRecords,
      staleProductIds,
      staleImageIds,
      remoteMetadata: {
        projectFolderId,
        rootFolderId: this._remoteProvider.getFolderIds().rootFolderId || project.syncMetadata?.cloudRootFolderId,
        manifestFileId
      }
    });

    // 6. Registrar proyecto activo
    await this._storage.setMetadata('activeProjectId', projectId);

    return { project, totalProducts: (manifest.products || []).length, totalImages: imageRecords.length };
  }

  /**
   * Ejecuta la sincronización completa del proyecto activo con Drive.
   * 1. Verifica conexión
   * 2. Captura snapshot local
   * 3. Asegura estructura de carpetas
   * 4. Sube imágenes
   * 5. Sube catalogo.json
   * 6. Confirma sync en IndexedDB
   */
  async syncProjectToDrive(project, onProgress) {
    if (!this._remoteProvider || !this._remoteProvider.isConnected()) {
      throw new Error('Google Drive no está conectado.');
    }

    if (typeof onProgress !== 'function') onProgress = () => {};

    const projectId = project.projectId;
    const expectedRevision = project.revision;

    // 1. Capturar snapshot
    onProgress('Preparando datos locales...');
    const products = await this._storage.listProducts(projectId);
    const allImageRecords = [];
    for (const p of products) {
      if (p.imageId) {
        const img = await this._storage.getImage(p.imageId);
        if (img) allImageRecords.push(img);
      }
    }
    const snapshot = await this.buildSnapshot(project, products, allImageRecords);

    // 2. Asegurar estructura de carpetas
    onProgress('Creando estructura en Google Drive...');
    const folders = await this._remoteProvider.ensureFolderStructure(project);

    // 3. Subir imágenes
    const imageMappings = [];
    for (let i = 0; i < allImageRecords.length; i++) {
      const img = allImageRecords[i];
      onProgress(`Subiendo imagen ${i + 1} de ${allImageRecords.length}...`);
      const result = await this._remoteProvider.uploadImage(img, folders.imagesFolderId);
      imageMappings.push({ imageId: img.imageId, cloudFileId: result.fileId });
    }

    // Actualizar snapshot con cloudFileIds
    for (const mapping of imageMappings) {
      const meta = snapshot.images.find(m => m.imageId === mapping.imageId);
      if (meta) meta.cloudFileId = mapping.cloudFileId;
    }

    // 4. Subir catalogo.json
    onProgress('Subiendo catálogo...');
    const manifestResult = await this._remoteProvider.uploadManifest(
      snapshot,
      folders.projectFolderId,
      project.syncMetadata.cloudManifestFileId || null
    );

    // 5. Confirmar sync en IndexedDB
    onProgress('Confirmando sincronización local...');
    const syncedAt = getTimestamp();
    await this._storage.commitCloudSyncResult({
      projectId,
      expectedRevision,
      rootFolderId: folders.rootFolderId,
      projectFolderId: folders.projectFolderId,
      manifestFileId: manifestResult.fileId,
      imageMappings,
      syncedAt
    });

    return { syncedAt, totalImages: allImageRecords.length };
  }
}
