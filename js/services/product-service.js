import { createProduct, cloneProductData } from '../models/product-schema.js';
import { getTimestamp, generateId } from '../utils.js';

export class ProductService {
  constructor(storageProvider) {
    this._storage = storageProvider;
  }

  async createProduct(projectId, data, imageRecord) {
    const errors = this.validate(data);
    if (errors.length > 0) throw new Error(errors.join('. '));

    const product = createProduct(projectId, {
      name: data.name.trim(),
      description: data.description ? data.description.trim() : '',
      price: data.price,
      sku: data.sku ? data.sku.trim() : '',
      category: data.category ? data.category.trim() : '',
      categoryId: data.categoryId || null,
      imageId: imageRecord ? imageRecord.imageId : null
    });

    const result = await this._storage.createProductAtomic(product, imageRecord, projectId);
    return result.product;
  }

  async updateProduct(productId, expectedRevision, projectId, productData, imageAction, newImageRecord) {
    const errors = this.validate(productData);
    if (errors.length > 0) throw new Error(errors.join('. '));

    const result = await this._storage.updateProductAtomic({
      projectId,
      productId,
      expectedRevision,
      productData: {
        name: productData.name.trim(),
        description: productData.description ? productData.description.trim() : '',
        price: productData.price,
        sku: productData.sku ? productData.sku.trim() : '',
        category: productData.category ? productData.category.trim() : '',
        categoryId: productData.categoryId || null
      },
      imageAction,
      newImageRecord
    });

    return result.product;
  }

  async toggleProductActive(productId, projectId) {
    const product = await this._storage.getProduct(productId);
    if (!product) throw new Error('Producto no encontrado.');
    product.active = !product.active;
    product.revision += 1;
    product.updatedAt = getTimestamp();
    const result = await this._storage.updateProductAtomic({
      projectId,
      productId,
      expectedRevision: product.revision - 1,
      productData: {
        name: product.name,
        description: product.description,
        price: product.price,
        sku: product.sku,
        category: product.category,
        categoryId: product.categoryId
      },
      imageAction: 'keep',
      newImageRecord: null
    });
    return result.product;
  }

  async duplicateProduct(originalProduct, originalBlob) {
    const cloneData = cloneProductData(originalProduct);
    let newImageRecord = null;

    if (originalProduct.imageId && originalBlob && originalBlob.data) {
      newImageRecord = {
        imageId: crypto.randomUUID ? crypto.randomUUID() : 'dup-' + Date.now(),
        projectId: originalProduct.projectId,
        mimeType: originalBlob.mimeType || 'image/jpeg',
        width: originalBlob.width || 0,
        height: originalBlob.height || 0,
        fileSize: originalBlob.data.size || 0,
        data: originalBlob.data,
        createdAt: getTimestamp(),
        updatedAt: getTimestamp(),
        localStatus: 'optimized',
        cloudFileId: null,
        cloudStatus: 'local'
      };
    }

    const newProduct = createProduct(originalProduct.projectId, {
      name: cloneData.name,
      description: cloneData.description,
      price: cloneData.price,
      sku: cloneData.sku,
      category: cloneData.category,
      categoryId: cloneData.categoryId,
      imageId: newImageRecord ? newImageRecord.imageId : null
    });

    const result = await this._storage.duplicateProductAtomic(newProduct, newImageRecord, originalProduct.projectId);
    return result.product;
  }

  async deleteProduct(productId) {
    const product = await this._storage.getProduct(productId);
    if (!product) throw new Error('Producto no encontrado.');
    await this._storage.deleteProductAtomic(productId, product.projectId);
    return product;
  }

  // ─── Categorías ───

  _normalizeName(name) {
    return name.trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  async createCategory(project, name) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('El nombre de la categor\u00eda no puede estar vac\u00edo.');
    const normalized = this._normalizeName(trimmed);
    const existing = project.categories.find(c => this._normalizeName(c.name) === normalized);
    if (existing) return existing;
    const now = getTimestamp();
    const cat = { id: generateId(), name: trimmed, createdAt: now, updatedAt: now };
    project.categories.push(cat);
    project.revision += 1;
    project.updatedAt = now;
    project.syncMetadata.status = 'pending';
    project.syncMetadata.lastLocalUpdate = now;
    await this._storage.updateProject(project);
    return cat;
  }

  async renameCategory(project, categoryId, newName) {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('El nombre de la categor\u00eda no puede estar vac\u00edo.');
    const cat = project.categories.find(c => c.id === categoryId);
    if (!cat) throw new Error('Categor\u00eda no encontrada.');
    const normalized = this._normalizeName(trimmed);
    const normalizedCurrent = this._normalizeName(cat.name);
    if (normalized === normalizedCurrent) return cat;
    const duplicate = project.categories.find(c => c.id !== categoryId && this._normalizeName(c.name) === normalized);
    if (duplicate) throw new Error('Ya existe una categor\u00eda con ese nombre.');
    const now = getTimestamp();
    cat.name = trimmed;
    cat.updatedAt = now;
    project.revision += 1;
    project.updatedAt = now;
    project.syncMetadata.status = 'pending';
    project.syncMetadata.lastLocalUpdate = now;
    await this._storage.updateProject(project);
    return cat;
  }

  async deleteCategory(project, categoryId) {
    const cat = project.categories.find(c => c.id === categoryId);
    if (!cat) throw new Error('Categoría no encontrada.');
    const now = getTimestamp();
    const affectedProducts = await this._storage.listProducts(project.projectId);
    const toUnset = affectedProducts.filter(p => p.categoryId === categoryId);

    project.categories = project.categories.filter(c => c.id !== categoryId);
    project.revision += 1;
    project.updatedAt = now;
    project.syncMetadata.status = 'pending';
    project.syncMetadata.lastLocalUpdate = now;

    await this._storage.updateProject(project);

    for (const p of toUnset) {
      p.categoryId = null;
      p.updatedAt = now;
      await this._storage.updateProduct(p);
    }

    return { deletedCategoryName: cat.name, affectedCount: toUnset.length };
  }

  getCategoryName(project, categoryId) {
    if (!categoryId) return '';
    const cat = project.categories.find(c => c.id === categoryId);
    return cat ? cat.name : '';
  }

  // ─── Migración ───

  async migrateCategories(project) {
    const products = await this._storage.listProducts(project.projectId);
    let changed = false;
    for (const p of products) {
      if (p.category && !p.categoryId) {
        const trimmed = p.category.trim();
        let cat = project.categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
        if (!cat) {
          const now = getTimestamp();
          cat = { id: generateId(), name: trimmed, createdAt: now, updatedAt: now };
          project.categories.push(cat);
        }
        p.categoryId = cat.id;
        await this._storage.updateProduct(p);
        changed = true;
      }
    }
    if (changed) {
      const now = getTimestamp();
      project.updatedAt = now;
      await this._storage.updateProject(project);
    }
  }

  // ─── Búsqueda y helpers ───

  filterProducts(products, { search, categoryId, activeFilter, sortBy }) {
    let result = [...products];

    if (search && search.trim()) {
      const q = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      result = result.filter(p => {
        const name = (p.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const sku = (p.sku || '').toLowerCase();
        const desc = (p.description || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const cat = (p.category || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return name.includes(q) || sku.includes(q) || desc.includes(q) || cat.includes(q);
      });
    }

    if (categoryId === '__none') {
      result = result.filter(p => !p.categoryId);
    } else if (categoryId) {
      result = result.filter(p => p.categoryId === categoryId);
    }

    if (activeFilter === 'active') {
      result = result.filter(p => p.active !== false);
    } else if (activeFilter === 'inactive') {
      result = result.filter(p => p.active === false);
    }

    if (sortBy === 'oldest') {
      result.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    } else if (sortBy === 'name_asc') {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'name_desc') {
      result.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    } else if (sortBy === 'price_asc') {
      result.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sortBy === 'price_desc') {
      result.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else {
      result.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    }

    return result;
  }

  async getProduct(productId) {
    return this._storage.getProduct(productId);
  }

  async listProducts(projectId) {
    return this._storage.listProducts(projectId);
  }

  async getImage(imageId) {
    if (!imageId) return null;
    return this._storage.getImage(imageId);
  }

  async saveImage(imageRecord) {
    return this._storage.saveImage(imageRecord);
  }

  async deleteImage(imageId) {
    return this._storage.deleteImage(imageId);
  }

  validate(data) {
    const errors = [];
    if (!data.name || !data.name.trim()) errors.push('El nombre es obligatorio');
    if (data.price === undefined || data.price === null || data.price === '') {
      errors.push('El precio es obligatorio');
    } else if (typeof data.price === 'number' && data.price < 0) {
      errors.push('El precio debe ser igual o superior a cero');
    } else if (typeof data.price === 'string') {
      const num = parseFloat(data.price);
      if (isNaN(num) || num < 0) errors.push('El precio debe ser un número válido igual o superior a cero');
    }
    return errors;
  }
}
