import { formatPrice, truncateText, escapeHtml } from '../utils.js?v=20260729-final-integration-v1';

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
    const isMobile = window.innerWidth <= 767;
    const isTablet = window.innerWidth >= 768 && window.innerWidth < 1024;

    for (const product of products) {
      let card;

      if (viewMode === 'compact') {
        card = (isMobile || isTablet) ? this._buildMobileCompactCard(product) : this._buildCompactCard(product);
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
    this._attachMenuEvents();
  }

  _buildCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card' + (product.active === false ? ' product-card--inactive' : '');
    card.dataset.productId = product.id;

    const imgHtml = product.imageId
      ? `<div class="product-card__image-wrapper"><img class="product-card__image" data-image-id="${product.imageId}" alt="${escapeHtml(product.name)}" /></div>`
      : `<div class="product-card__image-wrapper product-card__image-wrapper--empty"><span class="product-card__no-image" aria-hidden="true"></span></div>`;

    const catName = this._getCategoryName ? this._getCategoryName(product.categoryId) : (product.category || '');
    const catHtml = catName ? `<span class="product-card__category">${escapeHtml(catName)}</span>` : '';
    const skuHtml = product.sku ? `<span class="product-card__sku">C\u00f3digo: ${escapeHtml(product.sku)}</span>` : '';
    const descHtml = product.description ? `<p class="product-card__description">${escapeHtml(truncateText(product.description, 100))}</p>` : '';
    const activeLabel = product.active === false ? 'Inactivo' : 'Activo';
    const toggleLabel = product.active === false ? 'Activar' : 'Inactivar';
    const statusHtml = `<span class="product-card__status product-card__status--${product.active === false ? 'inactive' : 'active'}">${activeLabel}</span>`;

    card.innerHTML = `${imgHtml}<div class="product-card__body"><h3 class="product-card__name">${escapeHtml(product.name)}</h3><p class="product-card__price">${formatPrice(product.price)}</p>${skuHtml}${catHtml}${statusHtml}${descHtml}</div><div class="product-card__actions"><button class="btn btn--small btn--outline product-card__toggle-active" data-id="${product.id}" type="button">${toggleLabel}</button><button class="btn btn--small btn--outline product-card__edit" data-id="${product.id}" type="button">Editar</button><button class="btn btn--small btn--outline product-card__duplicate" data-id="${product.id}" type="button">Duplicar</button><button class="btn btn--small btn--danger product-card__delete" data-id="${product.id}" type="button">Eliminar</button></div>`;
    return card;
  }

  _buildCompactCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card product-card--compact' + (product.active === false ? ' product-card--inactive' : '');
    card.dataset.productId = product.id;

    const imgHtml = product.imageId
      ? `<div class="product-card__image-wrapper"><img class="product-card__image" data-image-id="${product.imageId}" alt="${escapeHtml(product.name)}" /></div>`
      : `<div class="product-card__image-wrapper product-card__image-wrapper--empty"><span class="product-card__no-image" aria-hidden="true"></span></div>`;

    const catName = this._getCategoryName ? this._getCategoryName(product.categoryId) : (product.category || '');
    const catHtml = catName ? `<span class="product-card__category">${escapeHtml(catName)}</span>` : '';
    const activeLabel = product.active === false ? 'Inactivo' : 'Activo';
    const toggleLabel = product.active === false ? 'Activar' : 'Inactivar';
    const statusHtml = `<span class="product-card__status product-card__status--${product.active === false ? 'inactive' : 'active'}">${activeLabel}</span>`;
    const priceHtml = `<span class="product-card__price">${formatPrice(product.price)}</span>`;

    card.innerHTML = `${imgHtml}<div class="product-card__body"><div class="product-card__info"><h3 class="product-card__name">${escapeHtml(product.name)}</h3><div class="product-card__meta-row">${priceHtml}${catHtml}${statusHtml}</div></div></div><div class="product-card__actions"><button class="btn btn--small btn--outline product-card__toggle-active" data-id="${product.id}" type="button">${toggleLabel}</button><button class="btn btn--small btn--outline product-card__edit" data-id="${product.id}" type="button">Editar</button><button class="btn btn--small btn--outline product-card__duplicate" data-id="${product.id}" type="button">Duplicar</button><button class="btn btn--small btn--danger product-card__delete" data-id="${product.id}" type="button">Eliminar</button></div>`;
    return card;
  }

  _buildMobileCompactCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card product-card--mobile product-card--compact' + (product.active === false ? ' product-card--inactive' : '');
    card.dataset.productId = product.id;

    const imgHtml = product.imageId
      ? `<div class="product-card__image-wrapper"><img class="product-card__image" data-image-id="${product.imageId}" alt="${escapeHtml(product.name)}" /></div>`
      : `<div class="product-card__image-wrapper product-card__image-wrapper--empty"><span class="product-card__no-image" aria-hidden="true"></span></div>`;

    const catName = this._getCategoryName ? this._getCategoryName(product.categoryId) : (product.category || '');
    const activeLabel = product.active === false ? 'Inactivo' : 'Activo';
    const metaParts = [];
    if (catName) metaParts.push(escapeHtml(catName));
    metaParts.push(activeLabel);
    const metaHtml = `<span class="product-card__meta">${metaParts.join(' \u00b7 ')}</span>`;

    const nameEscaped = escapeHtml(product.name);
    const priceFormatted = formatPrice(product.price);
    const toggleLabel = product.active === false ? 'Activar' : 'Inactivar';

    card.innerHTML = `${imgHtml}<div class="product-card__body"><h3 class="product-card__name">${nameEscaped}</h3><div class="product-card__price">${priceFormatted}</div>${metaHtml}</div><div class="product-card__menu"><button class="product-card__menu-btn" type="button" aria-label="Acciones de ${nameEscaped}" aria-expanded="false">\u22EE</button><div class="product-card__menu-dropdown"><button class="product-card__menu-item" type="button" data-action="edit">Editar</button><button class="product-card__menu-item" type="button" data-action="duplicate">Duplicar</button><button class="product-card__menu-item" type="button" data-action="toggle">${toggleLabel}</button><button class="product-card__menu-item product-card__menu-item--danger" type="button" data-action="delete">Eliminar</button></div></div>`;

    return card;
  }

  _buildListRow(product) {
    const row = document.createElement('article');
    row.className = 'product-list-row' + (product.active === false ? ' product-list-row--inactive' : '');
    row.dataset.productId = product.id;

    const imgHtml = product.imageId
      ? `<div class="product-list-row__image-wrapper"><img class="product-list-row__image" data-image-id="${product.imageId}" alt="${escapeHtml(product.name)}" /></div>`
      : `<div class="product-list-row__image-wrapper product-list-row__image-wrapper--empty"><span class="product-list-row__no-image" aria-hidden="true"></span></div>`;

    const catName = this._getCategoryName ? this._getCategoryName(product.categoryId) : (product.category || '');
    const activeLabel = product.active === false ? 'Inactivo' : 'Activo';
    const toggleLabel = product.active === false ? 'Activar' : 'Inactivar';

    row.innerHTML = `${imgHtml}<div class="product-list-row__info"><span class="product-list-row__name">${escapeHtml(product.name)}</span>${product.sku ? `<span class="product-list-row__sku">${escapeHtml(product.sku)}</span>` : ''}${catName ? `<span class="product-list-row__category">${escapeHtml(catName)}</span>` : ''}<span class="product-list-row__status">${activeLabel}</span></div><span class="product-list-row__price">${formatPrice(product.price)}</span><div class="product-list-row__actions"><button class="btn btn--small btn--outline product-card__toggle-active" data-id="${product.id}" type="button">${toggleLabel}</button><button class="btn btn--small btn--outline product-card__edit" data-id="${product.id}" type="button">Editar</button><button class="btn btn--small btn--outline product-card__duplicate" data-id="${product.id}" type="button">Duplicar</button><button class="btn btn--small btn--danger product-card__delete" data-id="${product.id}" type="button">Eliminar</button></div>`;
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

  _attachMenuEvents() {
    // Menu toggle buttons
    this._container.querySelectorAll('.product-card__menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const dropdown = btn.nextElementSibling;
        if (!dropdown || !dropdown.classList.contains('product-card__menu-dropdown')) return;
        const isOpen = dropdown.classList.contains('product-card__menu-dropdown--open');

        this._container.querySelectorAll('.product-card__menu-dropdown--open').forEach(d => {
          if (d !== dropdown) {
            d.classList.remove('product-card__menu-dropdown--open');
            if (d.previousElementSibling) d.previousElementSibling.setAttribute('aria-expanded', 'false');
          }
        });

        const opening = !isOpen;
        dropdown.classList.toggle('product-card__menu-dropdown--open', opening);
        btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) {
          const firstItem = dropdown.querySelector('.product-card__menu-item');
          if (firstItem) firstItem.focus();
        }
      });
    });

    // Menu items
    this._container.querySelectorAll('.product-card__menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        const card = item.closest('.product-card');
        if (!card) return;
        const id = card.dataset.productId;

        const dropdown = item.closest('.product-card__menu-dropdown');
        if (dropdown) {
          dropdown.classList.remove('product-card__menu-dropdown--open');
          if (dropdown.previousElementSibling) dropdown.previousElementSibling.setAttribute('aria-expanded', 'false');
        }

        if (action === 'edit' && typeof this._onEdit === 'function') this._onEdit(id);
        else if (action === 'duplicate' && typeof this._onDuplicate === 'function') this._onDuplicate(id);
        else if (action === 'toggle' && typeof this._onToggleActive === 'function') this._onToggleActive(id);
        else if (action === 'delete' && typeof this._onDelete === 'function') this._onDelete(id);
      });
    });

    // Document-level handlers (attached once)
    if (!this._menuEscapeHandler) {
      this._menuEscapeHandler = (e) => {
        if (e.key === 'Escape') {
          const openDropdown = this._container ? this._container.querySelector('.product-card__menu-dropdown--open') : null;
          if (openDropdown) {
            openDropdown.classList.remove('product-card__menu-dropdown--open');
            if (openDropdown.previousElementSibling) {
              openDropdown.previousElementSibling.setAttribute('aria-expanded', 'false');
              openDropdown.previousElementSibling.focus();
            }
          }
        }
      };
      document.addEventListener('keydown', this._menuEscapeHandler);
    }

    if (!this._menuOutsideHandler) {
      this._menuOutsideHandler = (e) => {
        const openDropdown = this._container ? this._container.querySelector('.product-card__menu-dropdown--open') : null;
        if (!openDropdown) return;
        if (!openDropdown.contains(e.target) && !openDropdown.previousElementSibling.contains(e.target)) {
          openDropdown.classList.remove('product-card__menu-dropdown--open');
          if (openDropdown.previousElementSibling) openDropdown.previousElementSibling.setAttribute('aria-expanded', 'false');
        }
      };
      document.addEventListener('click', this._menuOutsideHandler);
    }
  }
}
