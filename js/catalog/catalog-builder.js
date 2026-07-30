import { formatPrice } from '../utils.js?v=20260729-final-integration-v1';
import CONFIG from '../config.js?v=20260729-final-integration-v1';

const PAGE_HEIGHT_MM = 281;
const HEADER_HEIGHT_MM = 18;
const CATEGORY_HEADER_HEIGHT_MM = 8;
const CARD_HEIGHT_2COL = 62;
const CARD_HEIGHT_3COL = 50;
const CARD_HEIGHT_4COL = 42;

export class CatalogBuilder {
  build(project, products, imageMap, options = {}) {
    const columns = options.columns || 3;
    const effectiveColumns = (columns === 4 && products.length <= 3) ? 2 : columns;
    const showPhoto = options.showPhoto !== false;
    const showPrice = options.showPrice !== false;
    const showDescription = options.showDescription === true && effectiveColumns === 2;
    const locale = project.locale || CONFIG.DEFAULT_LOCALE;
    const currency = project.currency || CONFIG.DEFAULT_CURRENCY;
    const catalogTitle = options.catalogTitle || project.name || 'Cat\u00e1logo';
    const companyName = options.companyName || '';

    const grouped = this._groupByCategory(project, products);
    const pages = this._paginate(grouped, effectiveColumns);

    const container = document.createElement('div');
    container.className = 'catalog-printable';

    if (pages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'catalog-empty';
      empty.textContent = 'No hay productos activos en este cat\u00e1logo.';
      container.appendChild(empty);
      return container;
    }

    const totalPages = pages.length;

    for (let pi = 0; pi < totalPages; pi++) {
      const page = document.createElement('div');
      page.className = 'catalog-print-page';

      if (pi === 0) {
        page.appendChild(this._buildHeader(project, catalogTitle, companyName, locale));
      }

      const pageData = pages[pi];

      for (const section of pageData) {
        if (section.type === 'category') {
          page.appendChild(this._buildCategoryHeader(section.name));
        }
        if (section.type === 'cards') {
          const grid = document.createElement('div');
          grid.className = 'catalog-products-grid';
          grid.setAttribute('data-columns', effectiveColumns);
          for (const product of section.items) {
            grid.appendChild(this._buildCard(product, imageMap, showPhoto, showPrice, showDescription, effectiveColumns, locale, currency));
          }
          page.appendChild(grid);
        }
      }

      page.appendChild(this._buildFooter(pi + 1, totalPages));
      container.appendChild(page);
    }

    return container;
  }

  _groupByCategory(project, products) {
    const categories = project.categories || [];
    const map = new Map();
    for (const cat of categories) {
      map.set(cat.id, { name: cat.name, products: [] });
    }
    const uncategorized = [];
    for (const p of products) {
      if (p.categoryId && map.has(p.categoryId)) {
        map.get(p.categoryId).products.push(p);
      } else if (p.category && typeof p.category === 'string' && p.category.trim()) {
        let existing = [...map.values()].find(g => g.name === p.category);
        if (!existing) {
          existing = { name: p.category, products: [] };
          map.set('_cat_' + p.category, existing);
        }
        existing.products.push(p);
      } else {
        uncategorized.push(p);
      }
    }
    const result = [];
    for (const [, group] of map) {
      if (group.products.length > 0) {
        result.push(group);
      }
    }
    if (uncategorized.length > 0) {
      result.push({ name: '', products: uncategorized });
    }
    return result;
  }

  _paginate(groups, columns) {
    const pages = [];
    const maxRows = Math.floor((PAGE_HEIGHT_MM - HEADER_HEIGHT_MM - CATEGORY_HEADER_HEIGHT_MM) / (columns === 2 ? CARD_HEIGHT_2COL : columns === 3 ? CARD_HEIGHT_3COL : CARD_HEIGHT_4COL));
    const maxPerPage = maxRows * columns;

    let pageCards = [];
    let pageCatHeader = '';

    const flush = () => {
      if (pageCards.length > 0 || pageCatHeader) {
        const data = [];
        if (pageCatHeader) data.push({ type: 'category', name: pageCatHeader });
        if (pageCards.length > 0) data.push({ type: 'cards', items: [...pageCards] });
        pages.push(data);
        pageCards = [];
        pageCatHeader = '';
      }
    };

    const rowsLeft = () => Math.floor((maxPerPage - pageCards.length) / columns);

    for (const group of groups) {
      const catName = group.name && group.name.trim();
      let remaining = [...group.products];

      while (remaining.length > 0) {
        const space = maxPerPage - pageCards.length;

        if (space === 0) {
          flush();
          if (catName) pageCatHeader = catName;
          continue;
        }

        if (catName && !pageCatHeader && pageCards.length === 0) {
          pageCatHeader = catName;
        }

        const spaceRows = Math.floor(space / columns);
        const takeRows = Math.min(spaceRows, Math.floor(remaining.length / columns));
        const take = takeRows > 0 ? takeRows * columns : remaining.length;

        if (take === 0) {
          flush();
          continue;
        }

        pageCards.push(...remaining.splice(0, take));

        if (pageCards.length >= maxPerPage) {
          flush();
        }
      }
    }

    flush();
    return pages;
  }

  _buildHeader(project, catalogTitle, companyName, locale) {
    const header = document.createElement('div');
    header.className = 'catalog-page-header';

    if (companyName) {
      const company = document.createElement('div');
      company.className = 'catalog-page-header__company';
      company.textContent = companyName;
      header.appendChild(company);
    }

    const title = document.createElement('h1');
    title.className = 'catalog-page-header__title';
    title.textContent = catalogTitle;
    header.appendChild(title);

    const date = document.createElement('div');
    date.className = 'catalog-page-header__date';
    date.textContent = new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    header.appendChild(date);

    return header;
  }

  _buildCategoryHeader(name) {
    const cat = document.createElement('div');
    cat.className = 'catalog-category-header';
    const h2 = document.createElement('h2');
    h2.className = 'catalog-category-header__title';
    h2.textContent = name;
    cat.appendChild(h2);
    return cat;
  }

  _buildCard(product, imageMap, showPhoto, showPrice, showDescription, columns, locale, currency) {
    const card = document.createElement('article');
    card.className = 'catalog-card';

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'catalog-card__image-wrapper';

    if (product.imageId && imageMap.has(product.imageId)) {
      const img = document.createElement('img');
      img.className = 'catalog-card__image';
      img.alt = product.name || '';
      img.dataset.imageId = product.imageId;
      imgWrapper.appendChild(img);
    } else {
      imgWrapper.classList.add('catalog-card__image-wrapper--empty');
      const placeholder = document.createElement('div');
      placeholder.className = 'catalog-card__no-image';
      placeholder.setAttribute('aria-hidden', 'true');
      imgWrapper.appendChild(placeholder);
    }

    card.appendChild(imgWrapper);

    const body = document.createElement('div');
    body.className = 'catalog-card__body';

    const nameEl = document.createElement('h3');
    nameEl.className = 'catalog-card__name';
    nameEl.textContent = product.name || '';
    body.appendChild(nameEl);

    if (showPrice && product.price !== undefined && product.price !== null) {
      const priceEl = document.createElement('p');
      priceEl.className = 'catalog-card__price';
      priceEl.textContent = formatPrice(product.price, locale, currency);
      body.appendChild(priceEl);
    }

    if (showDescription && product.description) {
      const descEl = document.createElement('p');
      descEl.className = 'catalog-card__description';
      descEl.textContent = product.description;
      body.appendChild(descEl);
    }

    card.appendChild(body);
    return card;
  }

  _buildFooter(pageNum, totalPages) {
    const footer = document.createElement('div');
    footer.className = 'catalog-page-footer';
    footer.textContent = `P\u00e1gina ${pageNum} de ${totalPages}`;
    return footer;
  }

  static safeFileName(projectName) {
    const base = (projectName || 'catalogo').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').substring(0, 60).replace(/^-+|-+$/g, '');
    const date = new Date().toISOString().slice(0, 10);
    return `catalogo-${base}-${date}.pdf`;
  }
}
