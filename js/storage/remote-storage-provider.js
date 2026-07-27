/**
 * RemoteStorageProvider — Interfaz conceptual para almacenamiento remoto futuro.
 *
 * Esta clase describe el contrato que implementarán proveedores como
 * DriveStorageProvider, FirebaseStorageProvider o SupabaseStorageProvider.
 *
 * No ejecuta operaciones reales. Todas las llamadas lanzan "No implementado".
 *
 * Diferencia con StorageProvider:
 *   - StorageProvider  → almacenamiento operativo local (IndexedDB).
 *   - RemoteStorageProvider → almacenamiento remoto sincronizado.
 *   - Ambos coexisten; SyncManager orquesta la comunicación entre ellos.
 */

export class RemoteStorageProvider {
  async initialize() {
    throw new Error('No implementado. Use un proveedor remoto concreto.');
  }
  async connect() {
    throw new Error('No implementado');
  }
  async disconnect() {
    throw new Error('No implementado');
  }

  isConnected() {
    return false;
  }

  async createRemoteProject(project) {
    throw new Error('No implementado');
  }
  async getRemoteProject(projectId) {
    throw new Error('No implementado');
  }
  async updateRemoteProject(project) {
    throw new Error('No implementado');
  }
  async listRemoteProjects() {
    throw new Error('No implementado');
  }
  async deleteRemoteProject(projectId) {
    throw new Error('No implementado');
  }

  async uploadImage(imageRecord) {
    throw new Error('No implementado');
  }
  async downloadImage(imageId) {
    throw new Error('No implementado');
  }
  async deleteRemoteFile(fileId) {
    throw new Error('No implementado');
  }

  async getSyncStatus() {
    return {
      connected: false,
      provider: null,
      lastSync: null,
      error: null
    };
  }
}
