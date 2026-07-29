import { StorageProvider } from './storage-provider.js';
import CONFIG from '../config.js';
import { getTimestamp } from '../utils.js';

export class IndexedDbProvider extends StorageProvider {
  constructor() {
    super();
    this._db = null;
  }

  async _openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.DATABASE_NAME, CONFIG.DATABASE_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;

        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'projectId' });
        }

        if (!db.objectStoreNames.contains('products')) {
          const store = db.createObjectStore('products', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }

        if (oldVersion < 2 && db.objectStoreNames.contains('products')) {
          const store = event.currentTarget.transaction.objectStore('products');
          if (!store.indexNames.contains('imageId')) {
            store.createIndex('imageId', 'imageId', { unique: false });
          }
        }

        if (!db.objectStoreNames.contains('images')) {
          const store = db.createObjectStore('images', { keyPath: 'imageId' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }

        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        this._db.onversionchange = () => { this._db.close(); };
        this._db.onclose = () => { this._db = null; };
        resolve(this._db);
      };

      request.onerror = (event) => {
        reject(new Error(`Error al abrir la base de datos: ${event.target.error?.message || 'Error desconocido'}`));
      };

      request.onblocked = () => {
        reject(new Error('La base de datos está bloqueada. Cierre otras pestañas abiertas.'));
      };
    });
  }

  async _getDb() {
    if (!this._db) await this._openDb();
    return this._db;
  }

  // ─── Operaciones de una sola tabla ───

  async initialize() {
    await this._getDb();
    return this;
  }

  async createProject(project) {
    return this._writeOne('projects', (store) => { store.add(project); return project; });
  }

  async getProject(projectId) {
    return this._readOne('projects', (store) => store.get(projectId));
  }

  async updateProject(project) {
    return this._writeOne('projects', (store) => { store.put(project); return project; });
  }

  async listProjects() {
    return this._readOne('projects', (store) => store.getAll());
  }

  async deleteProject(projectId) {
    return this._writeOne('projects', (store) => { store.delete(projectId); });
  }

  async createProduct(product) {
    return this._writeOne('products', (store) => { store.add(product); return product; });
  }

  async getProduct(productId) {
    return this._readOne('products', (store) => store.get(productId));
  }

  async listProducts(projectId) {
    const products = await this._readOne('products', (store) => {
      const index = store.index('projectId');
      return this._req(index.getAll(projectId));
    });
    const list = products || [];
    list.sort((a, b) => {
      if (a.updatedAt > b.updatedAt) return -1;
      if (a.updatedAt < b.updatedAt) return 1;
      return 0;
    });
    return list;
  }

  async updateProduct(product) {
    return this._writeOne('products', (store) => { store.put(product); return product; });
  }

  async deleteProduct(productId) {
    return this._writeOne('products', (store) => { store.delete(productId); });
  }

  async saveImage(imageRecord) {
    return this._writeOne('images', (store) => { store.put(imageRecord); return imageRecord; });
  }

  async getImage(imageId) {
    return this._readOne('images', (store) => store.get(imageId));
  }

  async deleteImage(imageId) {
    return this._writeOne('images', (store) => { store.delete(imageId); });
  }

  async getMetadata(key) {
    const result = await this._readOne('metadata', (store) => store.get(key));
    return result ? result.value : null;
  }

  async setMetadata(key, value) {
    return this._writeOne('metadata', (store) => { store.put({ key, value }); });
  }

  async exportProjectData(projectId) {
    const project = await this.getProject(projectId);
    const products = await this.listProducts(projectId);
    return { project, products };
  }

  // ─── Helpers internos ───

  _readOne(storeName, cb) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(storeName, 'readonly');
        const result = cb(t.objectStore(storeName));
        const promise = (result instanceof Promise) ? result : this._req(result);
        let settled = false;
        promise.then(r => { if (!settled) { settled = true; resolve(r); } })
               .catch(e => { if (!settled) { settled = true; reject(e); } });
        t.onerror = (e) => { if (!settled) { settled = true; reject(new Error(`Error en lectura: ${e.target.error?.message || 'desconocido'}`)); } };
      } catch (err) { reject(err); }
    });
  }

  _writeOne(storeName, cb) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(storeName, 'readwrite');
        let result;
        try { result = cb(t.objectStore(storeName)); } catch (err) { reject(err); return; }
        t.oncomplete = () => resolve(result);
        t.onerror = (e) => reject(new Error(`Error en escritura: ${e.target.error?.message || 'desconocido'}`));
        t.onabort = (e) => reject(new Error(`Operación abortada: ${e.target.error?.message || 'desconocido'}`));
      } catch (err) { reject(err); }
    });
  }

  _req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Error en operación de base de datos'));
    });
  }

  // ─── Métodos atómicos multi-store ───

  /**
   * Crea producto, imagen (opcional) y actualiza proyecto.
   * Toda la operación en una sola transacción.
   */
  async createProductAtomic(product, imageRecord, projectId) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(['products', 'images', 'projects'], 'readwrite');
        let updatedProject;

        const projReq = t.objectStore('projects').get(projectId);
        projReq.onsuccess = () => {
          const project = projReq.result;
          if (!project) { t.abort(); reject(new Error('Proyecto no encontrado')); return; }
          _bumpProject(project);
          t.objectStore('projects').put(project);
          updatedProject = project;
        };

        if (imageRecord) t.objectStore('images').put(imageRecord);
        t.objectStore('products').add(product);

        t.oncomplete = () => resolve({ product, project: updatedProject });
        t.onerror = (e) => reject(new Error(`Error al crear: ${e.target.error?.message || 'desconocido'}`));
        t.onabort = (e) => reject(new Error(`Creación abortada: ${e.target.error?.message || 'desconocido'}`));
      } catch (err) { reject(err); }
    });
  }

  /**
   * Actualiza producto con control optimista de revisión y limpieza atómica de imagen.
   *
   * Opciones:
   *   projectId, productId, expectedRevision, productData,
   *   imageAction ('keep'|'replace'|'remove'), newImageRecord
   */
  async updateProductAtomic(options) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(['products', 'images', 'projects'], 'readwrite');

        const prodReq = t.objectStore('products').get(options.productId);
        let storedProduct;
        let storedProject;

        prodReq.onsuccess = () => {
          storedProduct = prodReq.result;
          if (!storedProduct) { t.abort(); reject(_staleError('PRODUCT_NOT_FOUND', 'Este producto ya no existe.')); return; }
          if (storedProduct.revision !== options.expectedRevision) {
            t.abort(); reject(_staleError('STALE_PRODUCT_REVISION', 'Este producto cambió después de que comenzaste a editarlo. Tus cambios no se guardaron. Vuelve a abrir el producto para trabajar con la versión más reciente.'));
            return;
          }

          const projReq = t.objectStore('projects').get(options.projectId);
          projReq.onsuccess = () => {
            storedProject = projReq.result;
            if (!storedProject) { t.abort(); reject(new Error('Proyecto no encontrado')); return; }

            const oldImageId = storedProduct.imageId;

            // Aplicar cambios al producto
            const d = options.productData;
            storedProduct.name = d.name.trim();
            storedProduct.description = d.description ? d.description.trim() : '';
            storedProduct.price = d.price;
            storedProduct.sku = d.sku ? d.sku.trim() : '';
            storedProduct.category = d.category ? d.category.trim() : '';
            storedProduct.categoryId = d.categoryId || null;
            storedProduct.revision += 1;
            storedProduct.updatedAt = getTimestamp();

            // Manejar acción de imagen
            if (options.imageAction === 'replace' && options.newImageRecord) {
              storedProduct.imageId = options.newImageRecord.imageId;
              t.objectStore('images').put(options.newImageRecord);
            } else if (options.imageAction === 'remove') {
              storedProduct.imageId = null;
            }

            t.objectStore('products').put(storedProduct);

            // Limpiar imagen anterior si ya no se usa
            if (oldImageId && (options.imageAction === 'replace' || options.imageAction === 'remove')) {
              const idx = t.objectStore('products').index('imageId');
              const countReq = idx.count(oldImageId);
              countReq.onsuccess = () => {
                if (countReq.result === 0) {
                  t.objectStore('images').delete(oldImageId);
                }
              };
            }

            // Actualizar proyecto
            _bumpProject(storedProject);
            t.objectStore('projects').put(storedProject);
          };
        };

        t.oncomplete = () => resolve({ product: storedProduct, project: storedProject });
        t.onerror = (e) => reject(new Error(`Error al actualizar: ${e.target.error?.message || 'desconocido'}`));
        t.onabort = (e) => {
          const errMsg = e.target.error?.message || 'desconocido';
          reject(new Error(`Actualización abortada: ${errMsg}`));
        };
      } catch (err) { reject(err); }
    });
  }

  /**
   * Duplica producto con su imagen copia (nuevo imageId).
   */
  async duplicateProductAtomic(newProduct, newImageRecord, projectId) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(['products', 'images', 'projects'], 'readwrite');
        let updatedProject;

        const projReq = t.objectStore('projects').get(projectId);
        projReq.onsuccess = () => {
          const project = projReq.result;
          if (!project) { t.abort(); reject(new Error('Proyecto no encontrado')); return; }
          _bumpProject(project);
          t.objectStore('projects').put(project);
          updatedProject = project;
        };

        if (newImageRecord) t.objectStore('images').put(newImageRecord);
        t.objectStore('products').add(newProduct);

        t.oncomplete = () => resolve({ product: newProduct, project: updatedProject });
        t.onerror = (e) => reject(new Error(`Error al duplicar: ${e.target.error?.message || 'desconocido'}`));
        t.onabort = (e) => reject(new Error(`Duplicación abortada: ${e.target.error?.message || 'desconocido'}`));
      } catch (err) { reject(err); }
    });
  }

  /**
   * Confirma el resultado de una sincronización con Drive.
   * Actualiza syncMetadata del proyecto y cloudFileId de imágenes en una sola transacción.
   * Si la revisión del proyecto cambió durante la subida, aborta.
   */
  async commitCloudSyncResult({ projectId, expectedRevision, rootFolderId, projectFolderId, manifestFileId, imageMappings, syncedAt }) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(['projects', 'images'], 'readwrite');

        const projReq = t.objectStore('projects').get(projectId);
        projReq.onsuccess = () => {
          const project = projReq.result;
          if (!project) { t.abort(); reject(new Error('Proyecto no encontrado')); return; }
          if (project.revision !== expectedRevision) {
            t.abort(); reject(new Error(
              `La revisión del proyecto cambió durante la subida (esperada: ${expectedRevision}, actual: ${project.revision}). No se marcó como sincronizado. Vuelve a intentar.`
            ));
            return;
          }
          project.syncMetadata.status = 'synced';
          project.syncMetadata.cloudProvider = 'google-drive';
          project.syncMetadata.cloudProjectId = projectFolderId;
          project.syncMetadata.cloudRootFolderId = rootFolderId;
          project.syncMetadata.cloudManifestFileId = manifestFileId;
          project.syncMetadata.lastCloudSync = syncedAt;
          project.syncMetadata.errorMessage = null;
          t.objectStore('projects').put(project);
        };

        if (imageMappings && imageMappings.length > 0) {
          for (const mapping of imageMappings) {
            const imgReq = t.objectStore('images').get(mapping.imageId);
            imgReq.onsuccess = () => {
              const record = imgReq.result;
              if (record) {
                record.cloudFileId = mapping.cloudFileId;
                record.cloudStatus = 'synced';
                t.objectStore('images').put(record);
              }
            };
          }
        }

        t.oncomplete = () => resolve();
        t.onerror = (e) => reject(new Error(`Error al confirmar sync: ${e.target.error?.message || 'desconocido'}`));
        t.onabort = (e) => reject(new Error(`Sync abortado: ${e.target.error?.message || 'desconocido'}`));
      } catch (err) { reject(err); }
    });
  }

  /**
   * Reemplaza los datos de un proyecto con los descargados de Drive.
   * Usa put() (no add()) para evitar ConstraintError en claves existentes.
   * Elimina solo los registros locales cuyos IDs no están en el conjunto remoto.
   * Todo en una sola transacción. Si falla, se revierte al estado anterior.
   */
  async replaceProjectFromRemoteAtomic(options) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(['products', 'images', 'projects'], 'readwrite');
        const projectId = options.project.projectId;
        const remoteProductIds = new Set((options.products || []).map(p => p.id));
        const remoteImageIds = new Set((options.images || []).map(i => i.imageId));

        // Validar duplicados en el propio manifest
        if (remoteProductIds.size !== (options.products || []).length) {
          t.abort();
          reject(new Error('El manifiesto remoto contiene productos con IDs duplicados.'));
          return;
        }
        if (remoteImageIds.size !== (options.images || []).length) {
          t.abort();
          reject(new Error('El manifiesto remoto contiene imágenes con IDs duplicados.'));
          return;
        }

        // 1. Eliminar productos locales obsoletos (IDs que ya no están en el remoto)
        const staleProductIds = options.staleProductIds || [];
        const staleImageIds = options.staleImageIds || [];

        for (const pid of staleProductIds) {
          t.objectStore('products').delete(pid);
        }

        // 2. Eliminar imágenes locales obsoletas
        for (const iid of staleImageIds) {
          t.objectStore('images').delete(iid);
        }

        // 3. Insertar o reemplazar imágenes mediante put()
        if (options.images && options.images.length > 0) {
          for (const img of options.images) {
            t.objectStore('images').put(img);
          }
        }

        // 4. Insertar o reemplazar productos mediante put()
        if (options.products && options.products.length > 0) {
          for (const prod of options.products) {
            t.objectStore('products').put(prod);
          }
        }

        // 5. Configurar metadata de sincronización y guardar proyecto
        const project = { ...options.project };
        const rm = options.remoteMetadata || {};
        project.syncMetadata = {
          status: 'synced',
          cloudProvider: 'google-drive',
          cloudProjectId: rm.projectFolderId || project.syncMetadata?.cloudProjectId || null,
          cloudRootFolderId: rm.rootFolderId || project.syncMetadata?.cloudRootFolderId || null,
          cloudManifestFileId: rm.manifestFileId || project.syncMetadata?.cloudManifestFileId || null,
          lastLocalUpdate: getTimestamp(),
          lastCloudSync: getTimestamp(),
          deviceId: project.syncMetadata?.deviceId || '',
          errorMessage: null
        };
        t.objectStore('projects').put(project);

        t.oncomplete = () => resolve(project);
        t.onerror = (e) => {
          const err = e.target.error;
          let msg = `Error al importar proyecto: ${err?.message || 'desconocido'}`;
          if (err && err.name === 'ConstraintError') {
            const storeName = err.target?.source?.name || '?';
            console.error('ConstraintError en replaceProjectFromRemoteAtomic:', {
              store: storeName,
              message: err.message,
              operation: 'put (importación desde Drive)'
            });
            msg = 'No fue posible reemplazar la copia local porque existen registros duplicados. La versión local no fue modificada.';
          }
          reject(new Error(msg));
        };
        t.onabort = (e) => reject(new Error(`Importación abortada: ${e.target.error?.message || 'desconocido'}`));
      } catch (err) { reject(err); }
    });
  }

  /**
   * Elimina producto, su imagen si ya no se usa, y actualiza proyecto.
   * Lee producto y proyecto dentro de la misma transacción.
   * Usa el índice imageId para contar referencias restantes.
   */
  async deleteProductAtomic(productId, projectId) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await this._getDb();
        const t = db.transaction(['products', 'images', 'projects'], 'readwrite');

        let capturedImageId;

        const prodReq = t.objectStore('products').get(productId);
        prodReq.onsuccess = () => {
          const product = prodReq.result;
          if (!product) { t.abort(); reject(new Error('Producto no encontrado')); return; }
          capturedImageId = product.imageId;

          t.objectStore('products').delete(productId);

          if (capturedImageId) {
            const imgIdx = t.objectStore('products').index('imageId');
            const countReq = imgIdx.count(capturedImageId);
            countReq.onsuccess = () => {
              if (countReq.result === 0) {
                t.objectStore('images').delete(capturedImageId);
              }
            };
          }

          const projReq = t.objectStore('projects').get(projectId);
          projReq.onsuccess = () => {
            const project = projReq.result;
            if (!project) { t.abort(); reject(new Error('Proyecto no encontrado')); return; }
            _bumpProject(project);
            t.objectStore('projects').put(project);
          };
        };

        t.oncomplete = () => resolve({ deletedImageId: capturedImageId });
        t.onerror = (e) => reject(new Error(`Error al eliminar: ${e.target.error?.message || 'desconocido'}`));
        t.onabort = (e) => reject(new Error(`Eliminación abortada: ${e.target.error?.message || 'desconocido'}`));
      } catch (err) { reject(err); }
    });
  }
}

// ─── Funciones helpers fuera de la clase ───

function _bumpProject(project) {
  project.revision += 1;
  project.updatedAt = getTimestamp();
  project.syncMetadata.status = 'pending';
  project.syncMetadata.lastLocalUpdate = getTimestamp();
}

function _staleError(code, message) {
  const err = new Error(message);
  err.name = 'ConflictError';
  err.code = code;
  return err;
}
