export class StorageStatus {
  constructor(elementId = 'storage-status') {
    this._element = document.getElementById(elementId);
  }

  async update(project) {
    if (!this._element || !project) return;

    const sync = project.syncMetadata;
    const parts = [];
    let className = 'storage-status--local';

    if (sync.status === 'syncing') {
      parts.push('Guardando\u2026');
      className = 'storage-status--syncing';
    } else if (sync.status === 'error') {
      parts.push('Error al guardar');
      className = 'storage-status--error';
    } else {
      parts.push('Guardado localmente');
      if (sync.status === 'pending') {
        parts.push('Cambios pendientes');
        className = 'storage-status--pending';
      }
    }

    if (sync.cloudProvider === 'google-drive' && sync.status === 'synced') {
      const lastSync = sync.lastCloudSync ? new Date(sync.lastCloudSync).toLocaleString() : '';
      parts.push('Sincronizado con Google Drive');
      className = 'storage-status--synced';
      if (lastSync) {
        this._element.textContent = parts.join(' \u00b7 ');
        this._element.title = `\u00daltima sincronizaci\u00f3n: ${lastSync}`;
      } else {
        this._element.textContent = parts.join(' \u00b7 ');
      }
    } else if (sync.cloudProvider === 'google-drive' && sync.status === 'pending') {
      parts.push('Google Drive: cambios pendientes');
      this._element.textContent = parts.join(' \u00b7 ');
    } else {
      parts.push('Google Drive a\u00fan no conectado');
      this._element.textContent = parts.join(' \u00b7 ');
    }

    this._element.className = `storage-status ${className}`;
  }

  showSaving() {
    if (!this._element) return;
    this._element.textContent = 'Guardando\u2026';
    this._element.className = 'storage-status storage-status--syncing';
  }

  showDriveProgress(message) {
    if (!this._element) return;
    this._element.textContent = message || 'Guardando en Google Drive\u2026';
    this._element.className = 'storage-status storage-status--syncing';
  }
}
