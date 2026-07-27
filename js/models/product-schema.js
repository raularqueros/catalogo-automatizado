import { generateId, getTimestamp } from '../utils.js';

export function createProduct(projectId, data = {}) {
  const now = getTimestamp();
  return {
    id: generateId(),
    projectId,
    name: data.name || '',
    description: data.description || '',
    price: typeof data.price === 'number' ? data.price : 0,
    sku: data.sku || '',
    category: data.category || '',
    categoryId: data.categoryId || null,
    imageId: data.imageId || null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    sortOrder: Date.now(),
    active: true
  };
}

export function cloneProductData(original) {
  return {
    name: `${original.name} Copia`,
    description: original.description || '',
    price: original.price,
    sku: original.sku || '',
    category: original.category || '',
    categoryId: original.categoryId || null
  };
}
