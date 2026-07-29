import { formatPrice } from '../utils.js?v=20260729-final-integration-v1';
import CONFIG from '../config.js?v=20260729-final-integration-v1';

const PRODUCTS_PER_PAGE = 16;

export class CatalogBuilder {
  build(project, products, imageMap, options = {}) {
    const showPrices = options.showPrices !== false;
    const showDescriptions = options.showDescriptions !== false;
    const showCodes = options.showCodes === true;
    const locale = project.locale || CONFIG.DEFAULT_LOCALE;
    const currency = project.currency || CONFIG.DEFAULT_CURRENCY;
    const catalogTitle = options.catalogTitle || project.name || 'Catálogo';

    const container = document.createElement('div');
    container.className = 'catalog-printable';

    const pageCount = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_PAGE));

    for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
      const page = document.createElement('div');
      page.className = 'catalog-print-page';
      if (pageIdx === pageCount - 1) {
        page.classList.add('catalog-print-page--last');
      }

      // Encabezado de página (solo en la primera)
      if (pageIdx === 0) {
        const header = document.createElement('div');
        header.className = 'catalog-page-header';
        const title = document.createElement('h1');
        title.className = 'catalog-page-header__title';
        title.textContent = catalogTitle;
        header.appendChild(title);
        const date = document.createElement('p');
        date.className = 'catalog-page-header__date';
        date.textContent = new Date().toLocaleDateString(locale);
        header.appendChild(date);
        page.appendChild(header);
      }

      const grid = document.createElement('div');
      grid.className = 'catalog-products-grid';

      const start = pageIdx * PRODUCTS_PER_PAGE;
      const end = Math.min(start + PRODUCTS_PER_PAGE, products.length);

      for (let i = start; i < end; i++) {
        const product = products[i];
        const card = document.createElement('article');
        card.className = 'catalog-card';

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'catalog-card__image-wrapper';

        if (product.imageId && imageMap.has(product.imageId)) {
          const imgRecord = imageMap.get(product.imageId);
          const img = document.createElement('img');
          img.className = 'catalog-card__image';
          img.alt = product.name || '';
          img.dataset.imageId = product.imageId;
          imgWrapper.appendChild(img);
        } else {
          imgWrapper.classList.add('catalog-card__image-wrapper--empty');
          const placeholder = document.createElement('span');
          placeholder.className = 'catalog-card__no-image';
          placeholder.textContent = 'Sin imagen';
          imgWrapper.appendChild(placeholder);
        }

        card.appendChild(imgWrapper);

        const body = document.createElement('div');
        body.className = 'catalog-card__body';

        const nameEl = document.createElement('h3');
        nameEl.className = 'catalog-card__name';
        nameEl.textContent = product.name || '';
        body.appendChild(nameEl);

        if (showDescriptions && product.description) {
          const descEl = document.createElement('p');
          descEl.className = 'catalog-card__description';
          descEl.textContent = product.description;
          body.appendChild(descEl);
        }

        if (showPrices && product.price !== undefined && product.price !== null) {
          const priceEl = document.createElement('p');
          priceEl.className = 'catalog-card__price';
          priceEl.textContent = formatPrice(product.price, locale, currency);
          body.appendChild(priceEl);
        }

        if (showCodes && product.sku) {
          const skuEl = document.createElement('p');
          skuEl.className = 'catalog-card__sku';
          skuEl.textContent = product.sku;
          body.appendChild(skuEl);
        }

        card.appendChild(body);
        grid.appendChild(card);
      }

      page.appendChild(grid);
      container.appendChild(page);
    }

    if (products.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'catalog-empty';
      empty.textContent = 'No hay productos activos en este catálogo.';
      container.appendChild(empty);
    }

    return container;
  }
}
