import { formatPrice, truncateText, escapeHtml } from '../utils.js';

export class ProductList {
  constructor(containerId = 'product-list') {
    this._container = document.getElementById(containerId);
    this._emptyState = document.getElementById('empty-state');
    this._onEdit = null;
    this._onDuplicate = null;
    this._onDelete = null;
    this._onToggleActive = null;
    this._getImage = null;
    this._getCategoryName = null;
    this._blobUrls = [];
  }

  _revokeBlobUrls() {
    this._blobUrls.forEach(url => URL.revokeObjectURL(url));
    this._blobUrls = [];
  }

  onEdit(callback) { this._onEdit = callback; }
  onDuplicate(callback) { this._onDuplicate = callback; }
  onDelete(callback) { this._onDelete = callback; }
  onToggleActive(callback) { this._onToggleActive = callback; }
  setImageLoader(loaderFn) { this._getImage = loaderFn; }
  setCategoryNameGetter(getterFn) { this._getCategoryName = getterFn; }

  async render(products, viewMode = 'cards') {
    if (!this._container) return;

    this._container.classList.remove('product-list--cards', 'product-list--compact', 'product-list--list');
    this._container.classList.add(`product-list--${viewMode}`);

    if (!products || products.length === 0) {
      this._revokeBlobUrls();
      this._container.innerHTML = '';
      this._container.classList.add('product-list--empty');
      if (this._emptyState) this._emptyState.classList.remove('hidden');
      return;
    }

    if (this._emptyState) this._emptyState.classList.add('hidden');
    this._container.classList.remove('product-list--empty');

    const fragment = document.createDocumentFragment();

    for (const product of products) {
      let card;

      if (viewMode === 'compact') {
        card = this._buildCompactCard(product);
      } else if (viewMode === 'list') {
        card = this._buildListRow(product);
      } else {
        card = this._buildCard(product);
      }

      fragment.appendChild(card);
    }

    this._revokeBlobUrls();
    this._container.innerHTML = '';
    this._container.appendChild(fragment);

    for (const product of products) {
      if (product.imageId) this._loadThumbnail(product.imageId);
    }

    this._attachEvents(viewMode);
  }

  _buildCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card' + (product.active === false ? ' product-card--inactive' : '');
    card.dataset.productId = product.id;

    const imgHtml = product.imageId
      ? `<div class="product-card__image-wrapper"><img class="product-card__image" data-image-id="${product.imageId}" alt="${escapeHtml(product.name)}" /></div>`
      : `<div class="product-card__image-wrapper product-card__image-wrapper--empty"><span class="product-card__no-image" aria-hidden="true">\u{1F5BC}\uFE0E</span></div>`;

    const catName = this._getCategoryName ? this._getCategoryName(product.categoryId) : (product.category || '');
    const catHtml = catName ? `<span class="product-card__category">${escapeHtml(catName)}</span>` : '';
    const skuHtml = product.sku ? `<span class="product-card__sku">C\u00f3digo: ${escapeHtml(product.sku)}</span>` : '';
    const descHtml = product.description ? `<p class="product-card__description">${escapeHtml(truncateText(product.description, 100))}</p>` : '';
    const activeLabel = product.active === false ? 'Inactivo' : 'Activo';
    const activeClass = product.active === false ? 'btn--outline' : 'btn--primary';

    card.innerHTML = `${imgHtml}<div class="product-card__body"><h3 class="product-card__name">${escapeHtml(product.name)}</h3><p class="product-card__price">${formatPrice(product.price)}</p>${skuHtml}${catHtml}${descHtml}</div><div class="product-card__actions"><button class="btn btn--small ${activeClass} product-card__toggle-active" data-id="${product.id}" type="button">${activeLabel}</button><button class="btn btn--small btn--outline product-card__edit" data-id="${product.id}" type="button">Editar</button><button class="btn btn--small btn--outline product-card__duplicate" data-id="${product.id}" type="button">Duplicar</button><button class="btn btn--small btn--danger product-card__delete" data-id="${product.id}" type="button">Eliminar</button></div>`;
    return card;
  }

  _buildCompactCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card product-card--compact' + (product.active === false ? ' product-card--inactive' : '');
    card.dataset.productId = product.id;

    const imgHtml = product.imageId
      ? `<div class="product-card__image-wrapper"><img class="product-card__image" data-image-id="${product.imageId}" alt="${escapeHtml(product.name)}" /></div>`
      : `<div class="product-card__image-wrapper product-card__image-wrapper--empty"><span class="product-card__no-image" aria-hidden="true">\u{1F5BC}\uFE0E</span></div>`;

    const catName = this._getCategoryName ? this._getCategoryName(product.categoryId) : (product.category || '');
    const catHtml = catName ? `<span class="product-card__category">${escapeHtml(catName)}</span>` : '';
    const activeLabel = product.active === false ? 'Inactivo' : 'Activo';
    const activeClass = product.active === false ? 'btn--outline' : 'btn--primary';

    card.innerHTML = `${imgHtml}<div class="product-card__body"><h3 class="product-card__name">${escapeHtml(product.name)}</h3><p class="product-card__price">${formatPrice(product.price)}</p>${catHtml}</div><div class="product-card__actions"><button class="btn btn--small ${activeClass} product-card__toggle-active" data-id="${product.id}" type="button">${activeLabel}</button><button class="btn btn--small btn--outline product-card__edit" data-id="${product.id}" type="button">Editar</button><button class="btn btn--small btn--outline product-card__duplicate" data-id="${product.id}" type="button">Duplicar</button><button class="btn btn--small btn--danger product-card__delete" data-id="${product.id}" type="button">Eliminar</button></div>`;
    return card;
  }

  _buildListRow(product) {
    const row = document.createElement('article');
    row.className = 'product-list-row' + (product.active === false ? ' product-list-row--inactive' : '');
    row.dataset.productId = product.id;

    const imgHtml = product.imageId
      ? `<div class="product-list-row__image-wrapper"><img class="product-list-row__image" data-image-id="${product.imageId}" alt="${escapeHtml(product.name)}" /></div>`
      : `<div class="product-list-row__image-wrapper product-list-row__image-wrapper--empty"><span class="product-list-row__no-image" aria-hidden="true">\u{1F5BC}\uFE0E</span></div>`;

    const catName = this._getCategoryName ? this._getCategoryName(product.categoryId) : (product.category || '');
    const activeLabel = product.active === false ? 'Inactivo' : 'Activo';
    const activeClass = product.active === false ? 'btn--outline' : 'btn--primary';

    row.innerHTML = `${imgHtml}<div class="product-list-row__info"><span class="product-list-row__name">${escapeHtml(product.name)}</span>${product.sku ? `<span class="product-list-row__sku">${escapeHtml(product.sku)}</span>` : ''}${catName ? `<span class="product-list-row__category">${escapeHtml(catName)}</span>` : ''}<span class="product-list-row__status">${product.active === false ? 'Inactivo' : 'Activo'}</span></div><span class="product-list-row__price">${formatPrice(product.price)}</span><div class="product-list-row__actions"><button class="btn btn--small ${activeClass} product-card__toggle-active" data-id="${product.id}" type="button">${activeLabel}</button><button class="btn btn--small btn--outline product-card__edit" data-id="${product.id}" type="button">Editar</button><button class="btn btn--small btn--outline product-card__duplicate" data-id="${product.id}" type="button">Duplicar</button><button class="btn btn--small btn--danger product-card__delete" data-id="${product.id}" type="button">Eliminar</button></div>`;
    return row;
  }

  async _loadThumbnail(imageId) {
    const img = this._container.querySelector(`img[data-image-id="${imageId}"]`);
    if (!img || typeof this._getImage !== 'function') return;
    try {
      const record = await this._getImage(imageId);
      if (record && record.data) {
        const url = URL.createObjectURL(record.data);
        this._blobUrls.push(url);
        img.src = url;
        img.parentElement.classList.remove('product-card__image-wrapper--empty', 'product-list-row__image-wrapper--empty');
      }
    } catch (err) {
      console.warn('Error al cargar miniatura:', err);
    }
  }

  _attachEvents() {
    this._container.querySelectorAll('.product-card__edit').forEach(btn => {
      btn.addEventListener('click', () => { if (typeof this._onEdit === 'function') this._onEdit(btn.dataset.id); });
    });
    this._container.querySelectorAll('.product-card__duplicate').forEach(btn => {
      btn.addEventListener('click', () => { if (typeof this._onDuplicate === 'function') this._onDuplicate(btn.dataset.id); });
    });
    this._container.querySelectorAll('.product-card__delete').forEach(btn => {
      btn.addEventListener('click', () => { if (typeof this._onDelete === 'function') this._onDelete(btn.dataset.id); });
    });
    this._container.querySelectorAll('.product-card__toggle-active').forEach(btn => {
      btn.addEventListener('click', () => { if (typeof this._onToggleActive === 'function') this._onToggleActive(btn.dataset.id); });
    });
  }
}
