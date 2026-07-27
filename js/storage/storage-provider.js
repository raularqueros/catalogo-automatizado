/**
 * StorageProvider — Contrato para almacenamiento local operativo.
 *
 * Implementado por IndexedDbProvider.
 * Para almacenamiento remoto, ver RemoteStorageProvider.
 */
export class StorageProvider {
  async initialize() { throw new Error('No implementado'); }
  async createProject(project) { throw new Error('No implementado'); }
  async getProject(projectId) { throw new Error('No implementado'); }
  async updateProject(project) { throw new Error('No implementado'); }
  async listProjects() { throw new Error('No implementado'); }
  async deleteProject(projectId) { throw new Error('No implementado'); }
  async createProduct(product) { throw new Error('No implementado'); }
  async getProduct(productId) { throw new Error('No implementado'); }
  async listProducts(projectId) { throw new Error('No implementado'); }
  async updateProduct(product) { throw new Error('No implementado'); }
  async deleteProduct(productId) { throw new Error('No implementado'); }
  async saveImage(imageRecord) { throw new Error('No implementado'); }
  async getImage(imageId) { throw new Error('No implementado'); }
  async deleteImage(imageId) { throw new Error('No implementado'); }
  async exportProjectData(projectId) { throw new Error('No implementado'); }

  // ─── Métodos atómicos multi-store ───
  async createProductAtomic(product, imageRecord, projectId) { throw new Error('No implementado'); }
  async updateProductAtomic(options) { throw new Error('No implementado'); }
  async duplicateProductAtomic(newProduct, newImageRecord, projectId) { throw new Error('No implementado'); }
  async deleteProductAtomic(productId, projectId) { throw new Error('No implementado'); }
}
