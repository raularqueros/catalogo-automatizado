import CONFIG from '../config.js';
import { getTimestamp } from '../utils.js';

export class DriveRemoteProvider {
  constructor() {
    this._accessToken = null;
    this._rootFolderId = null;
    this._projectFolderId = null;
    this._imagesFolderId = null;
    this._manifestFileId = null;
  }

  setAccessToken(token) {
    this._accessToken = token;
  }

  clearAccessToken() {
    this._accessToken = null;
    this._rootFolderId = null;
    this._projectFolderId = null;
    this._imagesFolderId = null;
    this._manifestFileId = null;
  }

  isConnected() {
    return !!this._accessToken;
  }

  _headers() {
    return {
      Authorization: `Bearer ${this._accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  async _fetch(url, options = {}) {
    const resp = await fetch(url, {
      ...options,
      headers: { ...this._headers(), ...options.headers }
    });

    if (resp.status === 401) {
      throw new DriveError('DRIVE_SESSION_EXPIRED', 'La sesión de Google Drive expiró. Vuelve a conectar.');
    }
    if (resp.status === 403) {
      throw new DriveError('DRIVE_FORBIDDEN', 'Permiso denegado. Verifica los permisos de la aplicación en Google.');
    }
    if (resp.status === 429) {
      throw new DriveError('DRIVE_RATE_LIMIT', 'Límite temporal de Google. Intenta de nuevo en unos minutos.');
    }
    if (resp.status >= 500) {
      throw new DriveError('DRIVE_SERVER_ERROR', 'Error temporal de Google Drive. Intenta de nuevo.');
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new DriveError('DRIVE_ERROR', `Error de Drive (${resp.status}): ${body}`);
    }

    return resp;
  }

  async _findOne(query, fields = 'id, name, appProperties') {
    const encoded = encodeURIComponent(query);
    const url = `${CONFIG.DRIVE_API_BASE_URL}/files?q=${encoded}&fields=files(${fields})&pageSize=10`;
    const resp = await this._fetch(url);
    const data = await resp.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
  }

  async _ensureFolder(name, parentId, appProps) {
    const queryParts = [
      `mimeType='application/vnd.google-apps.folder'`,
      `trashed=false`,
      ...Object.entries(appProps).map(([k, v]) => `appProperties has { key='${this._esc(k)}' and value='${this._esc(v)}' }`)
    ];
    if (parentId) queryParts.push(`'${parentId}' in parents`);

    const existing = await this._findOne(queryParts.join(' and '));
    if (existing) return existing;

    const meta = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: appProps
    };
    if (parentId) meta.parents = [parentId];

    const resp = await this._fetch(`${CONFIG.DRIVE_API_BASE_URL}/files`, {
      method: 'POST',
      body: JSON.stringify(meta)
    });
    return resp.json();
  }

  _esc(val) {
    return String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /**
   * Crea o recupera la estructura de carpetas en Drive.
   */
  async ensureFolderStructure(project) {
    const props = (type, pid) => {
      const p = { catalogApp: 'catalogo-automatizado', catalogType: type };
      if (pid) p.projectId = pid;
      return p;
    };

    const root = await this._ensureFolder(CONFIG.DRIVE_ROOT_FOLDER_NAME, null, props('root'));
    this._rootFolderId = root.id;

    const projectsFolder = await this._ensureFolder('Proyectos', root.id, props('projectsRoot'));
    const projectFolder = await this._ensureFolder(project.name, projectsFolder.id, props('project', project.projectId));
    this._projectFolderId = projectFolder.id;

    const imagesFolder = await this._ensureFolder('imagenes', projectFolder.id, props('images', project.projectId));
    this._imagesFolderId = imagesFolder.id;

    // exports folder (reserved for future catalog exports)
    await this._ensureFolder('exportaciones', projectFolder.id, props('exports', project.projectId));

    return { rootFolderId: root.id, projectFolderId: projectFolder.id, imagesFolderId: imagesFolder.id };
  }

  /**
   * Sube o actualiza una imagen individual en Drive.
   */
  async uploadImage(imageRecord, imagesFolderId) {
    const ext = this._extensionForMime(imageRecord.mimeType || 'image/jpeg');
    const fileName = `${imageRecord.imageId}${ext}`;

    const appProps = {
      catalogApp: 'catalogo-automatizado',
      catalogType: 'image',
      projectId: imageRecord.projectId,
      imageId: imageRecord.imageId
    };

    let fileId = imageRecord.cloudFileId || null;

    if (!fileId) {
      const existing = await this._findOne(
        `trashed=false and appProperties has { key='catalogApp' and value='catalogo-automatizado' } and appProperties has { key='imageId' and value='${this._esc(imageRecord.imageId)}' }`,
        'id'
      );
      if (existing) fileId = existing.id;
    }

    if (fileId) {
      const meta = { appProperties: appProps };
      const metaBoundary = 'meta_boundary';
      const blobBoundary = 'blob_boundary';
      const body = this._multipartBody(meta, imageRecord.data, metaBoundary, blobBoundary);
      const url = `${CONFIG.DRIVE_UPLOAD_BASE_URL}/files/${fileId}?uploadType=multipart`;
      const resp = await this._fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': `multipart/related; boundary=${metaBoundary}` },
        body
      });
      const result = await resp.json();
      return { fileId: result.id, updated: true };
    } else {
      const meta = { name: fileName, parents: [imagesFolderId], appProperties: appProps };
      const metaBoundary = 'meta_boundary';
      const blobBoundary = 'blob_boundary';
      const body = this._multipartBody(meta, imageRecord.data, metaBoundary, blobBoundary);
      const url = `${CONFIG.DRIVE_UPLOAD_BASE_URL}/files?uploadType=multipart`;
      const resp = await this._fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${metaBoundary}` },
        body
      });
      const result = await resp.json();
      return { fileId: result.id, updated: false };
    }
  }

  /**
   * Sube o actualiza catalogo.json.
   */
  async uploadManifest(snapshot, projectFolderId) {
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json; charset=UTF-8' });

    const appProps = {
      catalogApp: 'catalogo-automatizado',
      catalogType: 'manifest',
      projectId: snapshot.project.projectId
    };

    let fileId = this._manifestFileId || null;
    if (!fileId) {
      const existing = await this._findOne(
        `trashed=false and appProperties has { key='catalogApp' and value='catalogo-automatizado' } and appProperties has { key='catalogType' and value='manifest' } and appProperties has { key='projectId' and value='${this._esc(snapshot.project.projectId)}' }`,
        'id'
      );
      if (existing) fileId = existing.id;
    }

    const meta = { name: 'catalogo.json', appProperties: appProps };
    if (!fileId) meta.parents = [projectFolderId];

    const boundary = 'manifest_boundary';
    const parts = [];
    parts.push(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`);
    parts.push(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n`);
    parts.push(`--${boundary}--`);
    const body = parts.join('');

    const method = fileId ? 'PATCH' : 'POST';
    const url = fileId
      ? `${CONFIG.DRIVE_UPLOAD_BASE_URL}/files/${fileId}?uploadType=multipart`
      : `${CONFIG.DRIVE_UPLOAD_BASE_URL}/files?uploadType=multipart`;

    const resp = await this._fetch(url, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const result = await resp.json();
    this._manifestFileId = result.id;
    return { fileId: result.id, updated: !!fileId };
  }

  /**
   * Construye cuerpo multipart/related para subir metadatos + blob.
   */
  _multipartBody(metadata, blob, metaBoundary, blobBoundary) {
    const metaJson = JSON.stringify(metadata);
    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(metaJson);

    const metaPart = new Blob([
      `--${metaBoundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      metaBytes,
      '\r\n'
    ]);

    const blobPart = new Blob([
      `--${metaBoundary}\r\n`,
      `Content-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      '\r\n'
    ]);

    const footer = new Blob([`--${metaBoundary}--`]);

    return new Blob([metaPart, blobPart, footer]);
  }

  _extensionForMime(mimeType) {
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    return '.jpg';
  }

  getFolderIds() {
    return {
      rootFolderId: this._rootFolderId,
      projectFolderId: this._projectFolderId,
      imagesFolderId: this._imagesFolderId,
      manifestFileId: this._manifestFileId
    };
  }

  getProjectFolderId() {
    return this._projectFolderId;
  }

  /**
   * Lista todos los proyectos remotos desde Drive.
   * Busca carpetas con catalogType='project' en la raíz.
   */
  async listRemoteProjects() {
    const baseQuery = `trashed=false and appProperties has { key='catalogApp' and value='catalogo-automatizado' } and appProperties has { key='catalogType' and value='project' } and mimeType='application/vnd.google-apps.folder'`;
    const encoded = encodeURIComponent(baseQuery);
    const fields = 'files(id, name, createdTime, modifiedTime, appProperties)';
    const url = `${CONFIG.DRIVE_API_BASE_URL}/files?q=${encoded}&fields=${fields}&pageSize=50`;
    const resp = await this._fetch(url);
    const data = await resp.json();
    const files = data.files || [];
    return files.map(f => ({
      projectId: f.appProperties?.projectId || '',
      projectFolderId: f.id,
      visibleName: f.name,
      modifiedTime: f.modifiedTime
    }));
  }

  /**
   * Descarga el manifest (catalogo.json) de un proyecto remoto.
   * Busca por appProperties y descarga el contenido.
   */
  async getRemoteManifest(projectId, projectFolderId) {
    const queryParts = [
      `trashed=false`,
      `appProperties has { key='catalogApp' and value='catalogo-automatizado' }`,
      `appProperties has { key='catalogType' and value='manifest' }`,
      `appProperties has { key='projectId' and value='${this._esc(projectId)}' }`
    ];
    if (projectFolderId) queryParts.push(`'${projectFolderId}' in parents`);

    const encoded = encodeURIComponent(queryParts.join(' and '));
    const url = `${CONFIG.DRIVE_API_BASE_URL}/files?q=${encoded}&fields=files(id)`;
    const resp = await this._fetch(url);
    const data = await resp.json();
    const files = data.files || [];

    if (files.length === 0) {
      throw new DriveError('MANIFEST_NOT_FOUND', `No se encontró catalogo.json para el proyecto ${projectId}.`);
    }

    const fileId = files[0].id;

    const dlResp = await this._fetch(
      `${CONFIG.DRIVE_API_BASE_URL}/files/${fileId}?alt=media`,
      { headers: { 'Content-Type': null } }
    );
    const text = await dlResp.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new DriveError('INVALID_MANIFEST_JSON', 'El archivo catalogo.json remoto está corrupto y no se puede leer.');
    }
    return { manifest: parsed, manifestFileId: fileId };
  }

  /**
   * Descarga un archivo de Drive como Blob.
   */
  async downloadFileBlob(fileId) {
    const resp = await this._fetch(
      `${CONFIG.DRIVE_API_BASE_URL}/files/${fileId}?alt=media`,
      { headers: { 'Content-Type': null } }
    );
    return resp.blob();
  }

  _recursiveFind(query, fields) {
    return this._findOne(query, fields);
  }
}

export class DriveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DriveError';
    this.code = code;
  }
}
