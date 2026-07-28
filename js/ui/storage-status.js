export class StorageStatus {
  constructor(elementId = 'storage-status') {
    this._element = document.getElementById(elementId);
  }

  async update(project) {
    if (!this._element || !project) return;

    const sync = project.syncMetadata;
    let className = 'storage-status--local';
    let shortText = '';
    let fullParts = [];

    if (sync.status === 'syncing') {
      shortText = 'Guardando\u2026';
      fullParts.push('Guardando\u2026');
      className = 'storage-status--syncing';
    } else if (sync.status === 'error') {
      shortText = 'Error';
      fullParts.push('Error al guardar');
      className = 'storage-status--error';
    } else {
      fullParts.push('Guardado localmente');
      if (sync.status === 'pending') {
        shortText = 'Cambios pendientes';
        fullParts.push('Cambios pendientes');
        className = 'storage-status--pending';
      } else {
        shortText = 'Guardado local';
      }
    }

    if (sync.cloudProvider === 'google-drive' && sync.status === 'synced') {
      shortText = 'Sincronizado';
      fullParts.push('Sincronizado con Google Drive');
      const lastSync = sync.lastCloudSync ? new Date(sync.lastCloudSync).toLocaleString() : '';
      className = 'storage-status--synced';
      this._element.textContent = shortText;
      this._element.title = fullParts.join(' \u00b7 ') + (lastSync ? `\n\u00daltima sincronizaci\u00f3n: ${lastSync}` : '');
    } else if (sync.cloudProvider === 'google-drive' && sync.status === 'pending') {
      shortText = 'Drive pendiente';
      fullParts.push('Google Drive: cambios pendientes');
      this._element.textContent = shortText;
      this._element.title = fullParts.join(' \u00b7 ');
    } else if (!sync.cloudProvider || sync.cloudProvider !== 'google-drive') {
      fullParts.push('Google Drive a\u00fan no conectado');
      this._element.textContent = shortText;
      this._element.title = fullParts.join(' \u00b7 ');
    } else {
      this._element.textContent = shortText;
      this._element.title = fullParts.join(' \u00b7 ');
    }

    this._element.className = `storage-status ${className}`;
    this._element.setAttribute('aria-label', this._element.title || shortText);
  }

  showSaving() {
    if (!this._element) return;
    this._element.textContent = 'Guardando\u2026';
    this._element.title = 'Guardando\u2026';
    this._element.setAttribute('aria-label', 'Guardando\u2026');
    this._element.className = 'storage-status storage-status--syncing';
  }

  showDriveProgress(message) {
    if (!this._element) return;
    const detail = message || 'Guardando en Drive\u2026';
    this._element.textContent = 'Guardando\u2026';
    this._element.title = detail;
    this._element.setAttribute('aria-label', detail);
    this._element.className = 'storage-status storage-status--syncing';
  }
}
