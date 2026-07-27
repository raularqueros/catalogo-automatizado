import { validateImage } from '../services/image-service.js';

export class ProductForm {
  constructor(productService) {
    this._productService = productService;
    this._editingProduct = null;
    this._editingProductId = null;
    this._expectedRevision = null;
    this._originalImageId = null;
    this._imageAction = 'none';
    this._selectedImageFile = null;
    this._currentImageRecord = null;
    this._currentImageBlob = null;
    this._fileChanged = false;
    this._isSaving = false;

    this._elements = {};
    this._previewUrl = null;
    this._onSaved = null;
    this._onCancelled = null;

    this._init();
  }

  onSave(callback) { this._onSaved = callback; }
  onCancel(callback) { this._onCancelled = callback; }

  _init() {
    this._elements.form = document.getElementById('product-form');
    this._elements.nameInput = document.getElementById('product-name');
    this._elements.priceInput = document.getElementById('product-price');
    this._elements.skuInput = document.getElementById('product-sku');
    this._elements.categorySelect = document.getElementById('product-category-select');
    this._elements.descriptionInput = document.getElementById('product-description');
    this._elements.imageInput = document.getElementById('product-image');
    this._elements.imagePreview = document.getElementById('image-preview');
    this._elements.imagePreviewContainer = document.getElementById('image-preview-container');
    this._elements.removeImageBtn = document.getElementById('remove-image-btn');
    this._elements.changeImageBtn = document.getElementById('change-image-btn');
    this._elements.submitBtn = document.getElementById('submit-product-btn');
    this._elements.cancelBtn = document.getElementById('cancel-btn');
    this._elements.formTitle = document.getElementById('form-title');
    this._elements.nameError = document.getElementById('name-error');
    this._elements.priceError = document.getElementById('price-error');
    this._elements.imageError = document.getElementById('image-error');

    this._elements.form.addEventListener('submit', (e) => this._handleSubmit(e));
    this._elements.cancelBtn.addEventListener('click', () => this._handleCancel());
    this._elements.imageInput.addEventListener('change', () => this._handleImageSelect());
    this._elements.removeImageBtn.addEventListener('click', () => this._handleRemoveImage());
    this._elements.changeImageBtn.addEventListener('click', () => this._elements.imageInput.click());
    this._elements.imagePreviewContainer.addEventListener('click', (e) => {
      if (this._elements.imagePreviewContainer.classList.contains('image-preview--empty')) {
        this._elements.imageInput.click();
      }
    });

    this._elements.priceInput.addEventListener('input', () => {
      this._clearFieldError(this._elements.priceError);
    });
    this._elements.nameInput.addEventListener('input', () => {
      this._clearFieldError(this._elements.nameError);
    });
    this._elements.categorySelect.addEventListener('change', async () => {
      if (this._elements.categorySelect.value === '__new') {
        this._elements.categorySelect.value = this._lastValidCategory || '';
        if (typeof this._onCreateCategory === 'function') {
          const name = prompt('Nombre de la nueva categor\u00eda:');
          if (name && name.trim()) {
            const newCat = await this._onCreateCategory(name.trim());
            if (newCat && this._savedProject) {
              this.refreshCategories(this._savedProject);
              const opt = [...this._elements.categorySelect.options].find(o => o.value === newCat.id);
              if (opt) this._elements.categorySelect.value = newCat.id;
            }
          }
        }
      } else {
        this._lastValidCategory = this._elements.categorySelect.value;
      }
    });
  }

  refreshCategories(project) {
    this._savedProject = project || this._savedProject;
    const proj = this._savedProject;
    const select = this._elements.categorySelect;
    if (!select) { return; }
    const currentVal = select.value;
    select.innerHTML = '<option value="">Sin categor\u00eda</option>';
    if (proj && proj.categories) {
      for (const cat of proj.categories) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
      }
    }
    const createOpt = document.createElement('option');
    createOpt.value = '__new';
    createOpt.textContent = 'Crear nueva categor\u00eda\u2026';
    select.appendChild(createOpt);
    if (currentVal && currentVal !== '__new' && [...select.options].some(o => o.value === currentVal)) {
      select.value = currentVal;
    }
    this._lastValidCategory = select.value;
  }

  setOnCreateCategory(callback) {
    this._onCreateCategory = callback;
  }

  _replaceFileInput() {
    const oldInput = this._elements.imageInput;
    const newInput = oldInput.cloneNode(true);
    oldInput.parentNode.replaceChild(newInput, oldInput);
    this._elements.imageInput = newInput;
    newInput.addEventListener('change', () => this._handleImageSelect());
  }

  async _handleImageSelect() {
    const file = this._elements.imageInput.files[0];
    if (!file) return;

    const validation = validateImage(file);
    if (!validation.valid) {
      this._showFieldError(this._elements.imageError, validation.error);
      this._replaceFileInput();
      return;
    }

    this._clearFieldError(this._elements.imageError);

    const imagePreview = this._elements.imagePreview;
    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
    }

    this._selectedImageFile = file;
    this._previewUrl = URL.createObjectURL(file);
    imagePreview.src = this._previewUrl;
    imagePreview.alt = 'Vista previa de la fotograf\u00eda';
    this._elements.imagePreviewContainer.classList.remove('image-preview--empty');
    this._elements.removeImageBtn.classList.remove('hidden');
    this._elements.changeImageBtn.classList.remove('hidden');
    this._fileChanged = true;
    this._imageAction = 'replace';
  }

  _handleRemoveImage() {
    this._currentImageRecord = null;
    this._currentImageBlob = null;
    this._selectedImageFile = null;
    this._fileChanged = true;
    this._imageAction = 'remove';

    this._replaceFileInput();

    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
      this._previewUrl = null;
    }

    this._elements.imagePreview.src = '';
    this._elements.imagePreview.alt = 'Sin fotograf\u00eda';
    this._elements.imagePreviewContainer.classList.add('image-preview--empty');
    this._elements.removeImageBtn.classList.add('hidden');
    this._elements.changeImageBtn.classList.add('hidden');
    this._clearFieldError(this._elements.imageError);
  }

  async _handleSubmit(e) {
    e.preventDefault();
    if (this._isSaving) return;

    this._clearErrors();

    const data = {
      name: this._elements.nameInput.value,
      price: this._elements.priceInput.value,
      sku: this._elements.skuInput.value,
      categoryId: this._elements.categorySelect.value || null,
      category: '',
      description: this._elements.descriptionInput.value
    };

    const validation = this._validateForm(data);
    if (!validation.valid) return;

    data.price = parseFloat(data.price);

    this._isSaving = true;
    this._setSavingState(true);

    try {
      if (typeof this._onSaved === 'function') {
        await this._onSaved({
          data,
          editingProductId: this._editingProductId,
          expectedRevision: this._expectedRevision,
          imageAction: this._imageAction,
          imageFile: this._selectedImageFile
        });
      }
    } catch (err) {
      console.error('Error al guardar (gestionado por app.js):', err);
    } finally {
      this._isSaving = false;
      this._setSavingState(false);
    }
  }

  _setSavingState(saving) {
    this._elements.submitBtn.disabled = saving;
    this._elements.cancelBtn.disabled = saving;
    this._elements.form.setAttribute('aria-busy', saving ? 'true' : 'false');
    const baseText = this._editingProduct ? 'Guardar cambios' : 'Guardar producto';
    this._elements.submitBtn.textContent = saving ? 'Guardando\u2026' : baseText;
    this._elements.submitBtn.setAttribute('aria-label', saving ? 'Guardando, espere' : baseText);
  }

  _validateForm(data) {
    let valid = true;

    if (!data.name || !data.name.trim()) {
      this._showFieldError(this._elements.nameError, 'El nombre es obligatorio');
      valid = false;
    }

    if (data.price === undefined || data.price === null || data.price === '') {
      this._showFieldError(this._elements.priceError, 'El precio es obligatorio');
      valid = false;
    } else {
      const num = parseFloat(data.price);
      if (isNaN(num) || num < 0) {
        this._showFieldError(this._elements.priceError, 'El precio debe ser un n\u00famero v\u00e1lido igual o superior a cero');
        valid = false;
      }
    }

    return { valid };
  }

  _showFieldError(element, message) {
    if (element) {
      element.textContent = message;
      element.classList.add('field-error--visible');
    }
  }

  _clearFieldError(element) {
    if (element) {
      element.textContent = '';
      element.classList.remove('field-error--visible');
    }
  }

  _clearErrors() {
    this._clearFieldError(this._elements.nameError);
    this._clearFieldError(this._elements.priceError);
    this._clearFieldError(this._elements.imageError);
  }

  _handleCancel() {
    if (this._isSaving) return;
    this.reset();
    if (typeof this._onCancelled === 'function') {
      this._onCancelled();
    }
  }

  reset() {
    if (this._isSaving) return;
    this._elements.form.reset();
    this._clearErrors();
    this._editingProduct = null;
    this._editingProductId = null;
    this._expectedRevision = null;
    this._originalImageId = null;
    this._imageAction = 'none';
    this._selectedImageFile = null;
    this._currentImageBlob = null;
    this._currentImageRecord = null;
    this._fileChanged = false;

    if (this._previewUrl) {
      URL.revokeObjectURL(this._previewUrl);
      this._previewUrl = null;
    }

    this._elements.imagePreview.src = '';
    this._elements.imagePreview.alt = 'Sin fotograf\u00eda';
    this._elements.imagePreviewContainer.classList.add('image-preview--empty');
    this._elements.removeImageBtn.classList.add('hidden');
    this._elements.changeImageBtn.classList.add('hidden');
    this._elements.submitBtn.textContent = 'Guardar producto';
    this._elements.categorySelect.value = '';
    this._elements.formTitle.textContent = 'Nuevo producto';
    this._elements.cancelBtn.classList.add('hidden');

    this._elements.form.removeAttribute('aria-busy');
  }

  async loadForEdit(product) {
    if (this._isSaving) return;
    this._editingProduct = product;
    this._editingProductId = product.id;
    this._expectedRevision = product.revision;
    this._originalImageId = product.imageId;
    this._imageAction = 'keep';
    this._elements.nameInput.value = product.name || '';
    this._elements.priceInput.value = product.price || '';
    this._elements.skuInput.value = product.sku || '';
    this._elements.categorySelect.value = product.categoryId || '';
    this._elements.descriptionInput.value = product.description || '';
    this._elements.submitBtn.textContent = 'Guardar cambios';
    this._elements.formTitle.textContent = 'Editar producto';
    this._elements.cancelBtn.classList.remove('hidden');

    this._fileChanged = false;
    this._selectedImageFile = null;
    this._currentImageBlob = null;
    this._currentImageRecord = null;

    if (product.imageId) {
      try {
        const imageRecord = await this._productService.getImage(product.imageId);
        if (imageRecord && imageRecord.data) {
          this._currentImageRecord = imageRecord;
          this._currentImageBlob = imageRecord.data;

          if (this._previewUrl) URL.revokeObjectURL(this._previewUrl);
          this._previewUrl = URL.createObjectURL(imageRecord.data);
          this._elements.imagePreview.src = this._previewUrl;
          this._elements.imagePreview.alt = 'Fotograf\u00eda actual';
          this._elements.imagePreviewContainer.classList.remove('image-preview--empty');
          this._elements.removeImageBtn.classList.remove('hidden');
          this._elements.changeImageBtn.classList.remove('hidden');
        }
      } catch (err) {
        console.warn('No se pudo cargar la imagen asociada:', err);
      }
    }

    this._clearErrors();
  }
}
