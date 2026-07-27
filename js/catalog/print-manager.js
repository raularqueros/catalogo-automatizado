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

  /**
   * Mueve el catálogo al contenedor exclusivo de impresión,
   * oculta toda la interfaz, ejecuta window.print() y restaura.
   */
  async print(catalogElement) {
    if (this._isPrinting) return;
    this._isPrinting = true;

    const printRoot = document.getElementById('catalog-print-root');
    if (!printRoot) {
      this._isPrinting = false;
      window.print();
      return;
    }

    // Vaciar y poblar el contenedor de impresión
    printRoot.innerHTML = '';
    printRoot.appendChild(catalogElement.cloneNode(true));

    // Ocultar diálogos abiertos que puedan filtrarse
    document.querySelectorAll('.dialog-overlay').forEach(d => d.classList.add('hidden'));

    document.body.classList.add('catalog-printing');

    try {
      window.print();
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
