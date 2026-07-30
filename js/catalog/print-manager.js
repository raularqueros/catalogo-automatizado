import { CatalogBuilder } from './catalog-builder.js?v=20260729-final-integration-v1';

export class PrintManager {
  constructor() {
    this._blobUrls = [];
    this._isPrinting = false;
  }

  async loadImages(imageMap, container) {
    this._revokeAll();

    const images = container.querySelectorAll('img[data-image-id]');
    const loadPromises = [];

    for (const img of images) {
      const imageId = img.dataset.imageId;
      const record = imageMap.get(imageId);
      if (!record || !record.data) {
        img.alt = 'Imagen no disponible';
        continue;
      }

      const url = URL.createObjectURL(record.data);
      this._blobUrls.push(url);
      img.src = url;

      const promise = new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
          resolve();
          return;
        }
        img.onload = () => resolve();
        img.onerror = () => { img.alt = 'Error'; resolve(); };
      });
      loadPromises.push(promise);
    }

    if (loadPromises.length > 0) {
      await Promise.all(loadPromises);
    }
  }

  async print(catalogElement) {
    if (this._isPrinting) return;
    this._isPrinting = true;

    const printRoot = document.getElementById('catalog-print-root');
    if (!printRoot) {
      this._isPrinting = false;
      return;
    }

    printRoot.innerHTML = '';
    printRoot.appendChild(catalogElement);

    document.querySelectorAll('.dialog-overlay, .editor-overlay').forEach(d => d.classList.add('hidden'));

    document.body.classList.add('catalog-printing');

    try {
      await new Promise(resolve => {
        const afterPrint = () => {
          window.removeEventListener('afterprint', afterPrint);
          resolve();
        };
        window.addEventListener('afterprint', afterPrint);
        window.print();
        setTimeout(() => {
          window.removeEventListener('afterprint', afterPrint);
          resolve();
        }, 2000);
      });
    } finally {
      document.body.classList.remove('catalog-printing');
      printRoot.innerHTML = '';
      this._isPrinting = false;
    }
  }

  _revokeAll() {
    for (const url of this._blobUrls) {
      URL.revokeObjectURL(url);
    }
    this._blobUrls = [];
  }

  destroy() {
    this._revokeAll();
  }
}
