import { IndexedDbProvider } from './js/storage/indexeddb-provider.js';
import { SyncManager } from './js/storage/sync-manager.js';
import { DriveRemoteProvider } from './js/storage/drive-remote-provider.js';
import { GoogleAuthService } from './js/auth/google-auth-service.js';
import { ProductService } from './js/services/product-service.js';
import { NotificationService } from './js/services/notification-service.js';
import { ProductForm } from './js/ui/product-form.js';
import { ProductList } from './js/ui/product-list.js';
import { StorageStatus } from './js/ui/storage-status.js';
import { createProject } from './js/models/project-schema.js';
import { validateImage, optimizeImage, createImageRecord } from './js/services/image-service.js';
import { escapeHtml } from './js/utils.js';
import { CatalogBuilder } from './js/catalog/catalog-builder.js';
import { PrintManager } from './js/catalog/print-manager.js';

class App {
  constructor() {
    this._project = null;
    this._storage = new IndexedDbProvider();
    this._sync = new SyncManager(this._storage);
    this._drive = new DriveRemoteProvider();
    this._auth = new GoogleAuthService();
    this._productService = new ProductService(this._storage);
    this._notifications = new NotificationService();
    this._form = new ProductForm(this._productService);
    this._list = new ProductList();
    this._status = new StorageStatus();
    this._lockedProducts = new Set();
    this._isDriveSyncing = false;
    this._catalogBuilder = new CatalogBuilder();
    this._printManager = new PrintManager();
    this._viewMode = this._loadViewMode();
    this._activeSection = 'products';
    this._editorOpen = false;
    this._lastFocusedElement = null;
  }

  _loadViewMode() {
    try {
      const stored = localStorage.getItem('catalogo_product_view');
      if (stored === 'cards' || stored === 'compact' || stored === 'list') {
        if (window.innerWidth <= 767 && stored !== 'compact') return 'compact';
        return stored;
      }
    } catch (_) {}
    return window.innerWidth <= 767 ? 'compact' : 'cards';
  }

  _saveViewMode(mode) {
    try { localStorage.setItem('catalogo_product_view', mode); } catch (_) {}
  }

  _updateViewButtons() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      const mode = btn.dataset.view;
      btn.setAttribute('aria-pressed', mode === this._viewMode ? 'true' : 'false');
      btn.classList.toggle('btn--primary', mode === this._viewMode);
      btn.classList.toggle('btn--outline', mode !== this._viewMode);
    });
  }

  async start() {
    try {
      this._notifications.initialize();
      this._sync.setRemoteProvider(this._drive);
      await this._storage.initialize();
      await this._loadOrCreateProject();
      this._setupUI();
      this._setActiveSection('products');
      await this._refreshProducts();
      this._updateUIForDriveState();
      this._status.update(this._project);
    } catch (err) {
      console.error('Error al iniciar la aplicaci\u00f3n:', err);
      this._notifications.error('Error al iniciar la aplicaci\u00f3n. Revise la consola para m\u00e1s detalles.');
    }
  }

  // ─── Navegaci\u00f3n ───

  _setActiveSection(sectionName) {
    if (!['products', 'catalog', 'project'].includes(sectionName)) return;
    this._activeSection = sectionName;
    document.querySelectorAll('.app-section').forEach(s => s.classList.add('hidden'));
    const section = document.getElementById(`section-${sectionName}`);
    if (section) section.classList.remove('hidden');

    document.querySelectorAll('.header-nav__btn').forEach(btn => {
      const isActive = btn.dataset.section === sectionName;
      btn.classList.toggle('header-nav__btn--active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (sectionName === 'catalog') this._updateCatalogSummary();
    if (sectionName === 'project') this._updateProjectSection();
  }

  _openProductEditor(mode, product = null) {
    if (this._isDriveSyncing) return;
    this._lastFocusedElement = document.activeElement;
    if (mode === 'edit' && product) {
      this._form.loadForEdit(product);
    } else {
      this._form.reset();
    }
    const overlay = document.getElementById('product-editor-overlay');
    const panel = document.getElementById('product-editor');
    overlay.classList.remove('hidden');
    panel.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    panel.setAttribute('aria-hidden', 'false');
    this._editorOpen = true;
    document.getElementById('product-name').focus();
  }

  _closeProductEditor() {
    if (this._editorOpen && !this._form.isSaving()) {
      document.getElementById('product-editor-overlay').classList.add('hidden');
      document.getElementById('product-editor').classList.add('hidden');
      document.getElementById('product-editor-overlay').setAttribute('aria-hidden', 'true');
      document.getElementById('product-editor').setAttribute('aria-hidden', 'true');
      this._editorOpen = false;
      this._form.reset();
      if (this._lastFocusedElement) {
        this._lastFocusedElement.focus();
        this._lastFocusedElement = null;
      }
    }
  }

  async _loadOrCreateProject() {
    const projects = await this._storage.listProjects();
    if (projects && projects.length > 0) {
      this._project = projects[0];
      document.getElementById('project-name').textContent = this._project.name;
      await this._productService.migrateCategories(this._project);
      this._form.refreshCategories(this._project);
    } else {
      this._project = createProject();
      await this._storage.createProject(this._project);
      await this._sync.markLocal(this._project);
      document.getElementById('project-name').textContent = this._project.name;
    }
  }

  _setupUI() {
    // Nav tabs
    document.querySelectorAll('.header-nav__btn').forEach(btn => {
      btn.addEventListener('click', () => this._setActiveSection(btn.dataset.section));
    });

    // Product editor buttons
    const newProductBtn = document.getElementById('new-product-btn');
    const emptyAddBtn = document.getElementById('empty-add-btn');
    newProductBtn.addEventListener('click', () => this._openProductEditor('create'));
    if (emptyAddBtn) emptyAddBtn.addEventListener('click', () => this._openProductEditor('create'));
    document.getElementById('editor-close-btn').addEventListener('click', () => this._closeProductEditor());
    document.getElementById('cancel-btn').addEventListener('click', () => this._closeProductEditor());
    document.getElementById('product-editor-overlay').addEventListener('click', () => this._closeProductEditor());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._editorOpen && !document.querySelector('.dialog-overlay:not(.hidden)')) {
        this._closeProductEditor();
      }
    });

    // Catalog config button
    document.getElementById('catalog-config-btn').addEventListener('click', () => this._handleCatalogConfig());

    // Drive buttons
    document.getElementById('connect-drive-btn').addEventListener('click', () => this._handleConnectDrive());
    document.getElementById('save-drive-btn').addEventListener('click', () => this._handleSaveToDrive());
    document.getElementById('open-drive-btn').addEventListener('click', () => this._handleOpenFromDrive());
    document.getElementById('disconnect-drive-btn').addEventListener('click', () => this._handleDisconnectDrive());

    // Debounced resize handler for mobile/desktop transitions
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const wasMobile = this._isMobile;
        this._isMobile = window.innerWidth <= 767;
        if (wasMobile !== this._isMobile) {
          this._viewMode = this._loadViewMode();
          this._updateViewButtons();
          this._refreshProducts();
        }
      }, 200);
    });
    this._isMobile = window.innerWidth <= 767;

    this._form.onSave((payload) => this._handleSave(payload));
    this._form.onSaveSuccess(() => this._closeProductEditor());

    this._list.onEdit((id) => this._handleEdit(id));
    this._list.onDuplicate((id) => this._handleDuplicate(id));
    this._list.onDelete((id) => this._handleDelete(id));
    this._list.onToggleActive((id) => this._handleToggleActive(id));
    this._list.setImageLoader((imageId) => this._productService.getImage(imageId));
    this._list.setCategoryNameGetter((catId) => this._productService.getCategoryName(this._project, catId));

    this._form.setOnCreateCategory(async (name) => {
      try {
        const cat = await this._productService.createCategory(this._project, name);
        await this._updateProjectAndStatus();
        return cat;
      } catch (err) {
        this._notifications.error(err.message);
        return null;
      }
    });

    // Toolbar events
    document.getElementById('search-input').addEventListener('input', () => this._refreshProducts());
    document.getElementById('filter-category').addEventListener('change', () => this._refreshProducts());
    document.getElementById('filter-status').addEventListener('change', () => this._refreshProducts());
    document.getElementById('sort-by').addEventListener('change', () => this._refreshProducts());
    document.getElementById('manage-categories-btn').addEventListener('click', () => this._handleManageCategories());

    // Mobile filter events
    document.getElementById('filter-category-mobile').addEventListener('change', () => {
      const v = document.getElementById('filter-category-mobile').value;
      const desk = document.getElementById('filter-category');
      if (desk.value !== v) { desk.value = v; this._refreshProducts(); }
      this._updateFiltersBadge();
    });
    document.getElementById('filter-status-mobile').addEventListener('change', () => {
      const v = document.getElementById('filter-status-mobile').value;
      const desk = document.getElementById('filter-status');
      if (desk.value !== v) { desk.value = v; this._refreshProducts(); }
      this._updateFiltersBadge();
    });
    document.getElementById('manage-categories-btn-mobile').addEventListener('click', () => this._handleManageCategories());

    // Filters toggle
    const filtersToggle = document.getElementById('filters-toggle');
    const filtersPanel = document.getElementById('filters-panel');
    filtersToggle.addEventListener('click', () => {
      const expanded = filtersToggle.getAttribute('aria-expanded') === 'true';
      filtersToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      filtersToggle.title = expanded ? 'Abrir panel de filtros' : 'Cerrar panel de filtros';
      filtersPanel.classList.toggle('filters-panel--open');
      filtersPanel.hidden = expanded;
    });

    // Close filters panel on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && filtersPanel.classList.contains('filters-panel--open')) {
        filtersPanel.classList.remove('filters-panel--open');
        filtersPanel.hidden = true;
        filtersToggle.setAttribute('aria-expanded', 'false');
        filtersToggle.title = 'Abrir panel de filtros';
        filtersToggle.focus();
      }
    });

    // Close filters panel on outside click
    document.addEventListener('click', (e) => {
      if (!filtersPanel.classList.contains('filters-panel--open')) return;
      if (!filtersPanel.contains(e.target) && e.target !== filtersToggle && !filtersToggle.contains(e.target)) {
        filtersPanel.classList.remove('filters-panel--open');
        filtersPanel.hidden = true;
        filtersToggle.setAttribute('aria-expanded', 'false');
        filtersToggle.title = 'Abrir panel de filtros';
      }
    });

    // Mobile new product button
    document.getElementById('mobile-new-product-btn').addEventListener('click', () => this._openProductEditor('create'));

    // View buttons (both desktop and panel)
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.view;
        if (mode === this._viewMode) return;
        this._viewMode = mode;
        this._saveViewMode(mode);
        this._updateViewButtons();
        this._refreshProducts();
      });
    });
    this._updateViewButtons();
  }

  _handleConnectDrive() {
    (async () => {
      try {
        const result = await this._auth.connect();
        if (result.success) {
          this._drive.setAccessToken(result.token);
          this._updateUIForDriveState();
          this._status.update(this._project);
          this._updateProjectSection();
          this._notifications.success('Google Drive conectado correctamente.');
        } else if (result.error !== 'access_denied') {
          this._notifications.error(result.message);
        }
      } catch (err) {
        console.error('Error al conectar Drive:', err);
        this._notifications.error(`Error al conectar: ${err.message}`);
      }
    })();
  }

  _handleDisconnectDrive() {
    this._auth.disconnect();
    this._drive.clearAccessToken();
    this._updateUIForDriveState();
    this._status.update(this._project);
    this._updateProjectSection();
    this._notifications.info('Google Drive desconectado.');
  }

  _updateUIForDriveState() {
    const connected = this._drive.isConnected();
    const connectBtn = document.getElementById('connect-drive-btn');
    const saveBtn = document.getElementById('save-drive-btn');
    const openBtn = document.getElementById('open-drive-btn');
    const disconnectBtn = document.getElementById('disconnect-drive-btn');
    if (connectBtn) connectBtn.classList.toggle('hidden', connected);
    if (saveBtn) saveBtn.classList.toggle('hidden', !connected);
    if (openBtn) openBtn.classList.toggle('hidden', !connected);
    if (disconnectBtn) disconnectBtn.classList.toggle('hidden', !connected);
  }

  _updateProjectSection() {
    const pname = document.getElementById('project-section-name');
    const localEl = document.getElementById('project-local-status');
    const driveEl = document.getElementById('project-drive-status');
    const lastSync = document.getElementById('project-last-sync');
    if (pname) pname.textContent = this._project ? this._project.name : '';
    if (localEl && this._project) {
      const s = this._project.syncMetadata.status;
      if (s === 'synced') localEl.textContent = 'Sincronizado';
      else if (s === 'pending') localEl.textContent = 'Guardado localmente \u00b7 Cambios pendientes';
      else localEl.textContent = 'Guardado localmente';
    }
    if (driveEl) {
      driveEl.textContent = this._drive.isConnected() ? 'Conectado' : 'Google Drive a\u00fan no conectado';
    }
    if (lastSync) {
      if (this._project && this._project.syncMetadata.lastCloudSync) {
        lastSync.textContent = '\u00daltima sincronizaci\u00f3n: ' + new Date(this._project.syncMetadata.lastCloudSync).toLocaleString();
      } else {
        lastSync.textContent = '';
      }
    }
  }

  _updateCatalogSummary() {
    (async () => {
      try {
        const all = await this._productService.listProducts(this._project.projectId);
        const active = all.filter(p => p.active !== false).length;
        const cats = this._project.categories ? this._project.categories.length : 0;
        document.getElementById('catalog-summary-products').textContent = 'Productos totales: ' + all.length;
        document.getElementById('catalog-summary-active').textContent = 'Productos activos: ' + active;
        document.getElementById('catalog-summary-categories').textContent = 'Categor\u00edas: ' + cats;
      } catch (_) {}
    })();
  }

  async _handleSaveToDrive() {
    if (this._isDriveSyncing) return;
    this._isDriveSyncing = true;
    const saveBtn = document.getElementById('save-drive-btn');
    const openBtn = document.getElementById('open-drive-btn');
    const disconnectBtn = document.getElementById('disconnect-drive-btn');
    saveBtn.disabled = true; openBtn.disabled = true; disconnectBtn.disabled = true;
    saveBtn.textContent = 'Guardando en Drive\u2026';
    try {
      await this._sync.syncProjectToDrive(this._project, (msg) => this._status.showDriveProgress(msg));
      await this._updateProjectAndStatus();
      this._notifications.success('Proyecto guardado en Google Drive.');
    } catch (err) {
      console.error('Error al guardar en Drive:', err);
      if (err.code === 'DRIVE_SESSION_EXPIRED') { this._auth.disconnect(); this._drive.clearAccessToken(); this._updateUIForDriveState(); this._updateProjectSection(); this._notifications.error('La sesi\u00f3n de Google Drive expir\u00f3. Vuelve a conectar.'); }
      else if (err.code === 'DRIVE_FORBIDDEN') { this._notifications.error('Permiso denegado.'); }
      else if (err.code === 'DRIVE_RATE_LIMIT') { this._notifications.error('L\u00edmite temporal de Google.'); }
      else if (err.message && err.message.includes('revisi\u00f3n del proyecto cambi\u00f3')) { this._notifications.error('Hubo cambios locales durante la subida. Vuelve a intentar.'); }
      else { this._notifications.error(`Error al guardar en Drive: ${err.message}`); }
      try { await this._updateProjectAndStatus(); } catch (_) {}
    } finally {
      this._isDriveSyncing = false;
      saveBtn.disabled = false; saveBtn.textContent = 'Guardar en Drive';
      openBtn.disabled = false; disconnectBtn.disabled = false;
    }
  }

  async _handleOpenFromDrive() {
    if (!this._drive.isConnected()) { this._notifications.error('Conecta Google Drive primero.'); return; }
    const dialog = document.getElementById('drive-open-dialog');
    const listEl = document.getElementById('drive-projects-list');
    const loadingEl = document.getElementById('drive-projects-loading');
    const emptyEl = document.getElementById('drive-projects-empty');
    const errorEl = document.getElementById('drive-projects-error');
    const confirmBtn = document.getElementById('drive-open-confirm-btn');
    const cancelBtn = document.getElementById('drive-open-cancel-btn');
    let selectedProject = null;
    let remoteProjects = [];

    function showLoading() { loadingEl.classList.remove('hidden'); listEl.classList.add('hidden'); emptyEl.classList.add('hidden'); errorEl.classList.add('hidden'); confirmBtn.classList.add('hidden'); }
    function showEmpty() { loadingEl.classList.add('hidden'); listEl.classList.add('hidden'); emptyEl.classList.remove('hidden'); errorEl.classList.add('hidden'); confirmBtn.classList.add('hidden'); }
    function showError(msg) { loadingEl.classList.add('hidden'); listEl.classList.add('hidden'); emptyEl.classList.add('hidden'); errorEl.classList.remove('hidden'); errorEl.textContent = msg; confirmBtn.classList.add('hidden'); }
    function showList(projects) {
      loadingEl.classList.add('hidden'); listEl.classList.remove('hidden'); emptyEl.classList.add('hidden'); errorEl.classList.add('hidden');
      confirmBtn.classList.remove('hidden'); listEl.innerHTML = ''; selectedProject = null; confirmBtn.disabled = true;
      for (const p of projects) {
        const displayName = (p.visibleName && p.visibleName.trim()) ? p.visibleName.trim() : 'Proyecto sin nombre';
        let dateStr = ''; try { if (p.modifiedTime) dateStr = new Date(p.modifiedTime).toLocaleDateString(); } catch (_) {}
        const li = document.createElement('li'); li.className = 'drive-project-item'; li.setAttribute('role', 'option');
        li.innerHTML = `<span class="drive-project-item__name">${escapeHtml(displayName)}</span><span class="drive-project-item__date">${escapeHtml(dateStr)}</span>`;
        li.addEventListener('click', () => { listEl.querySelectorAll('.drive-project-item').forEach(el => el.classList.remove('drive-project-item--selected')); li.classList.add('drive-project-item--selected'); selectedProject = p; confirmBtn.disabled = false; });
        listEl.appendChild(li);
      }
    }
    function closeDialog() { dialog.classList.add('hidden'); dialog.setAttribute('aria-hidden', 'true'); }
    const onCancel = () => closeDialog();
    const onConfirm = async () => { if (!selectedProject) return; closeDialog(); await this._handleImportFromDrive(selectedProject); };
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);

    dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false');
    showLoading(); cancelBtn.focus();
    try {
      remoteProjects = await this._drive.listRemoteProjects();
      remoteProjects.length === 0 ? showEmpty() : showList(remoteProjects);
    } catch (err) {
      console.error('Error al listar proyectos:', err);
      if (err.code === 'DRIVE_SESSION_EXPIRED') { this._auth.disconnect(); this._drive.clearAccessToken(); this._updateUIForDriveState(); showError('La sesi\u00f3n de Google Drive expir\u00f3.'); }
      else { showError(`Error al buscar proyectos: ${err.message}`); }
      confirmBtn.classList.add('hidden');
    }
  }

  async _handleImportFromDrive(remoteProject) {
    this._status.showDriveProgress('Abriendo proyecto desde Drive...');
    this._isDriveSyncing = true;
    try {
      const result = await this._sync.openProjectFromDrive(remoteProject,
        (msg) => this._status.showDriveProgress(msg),
        async (conflict) => new Promise((resolve) => {
          let question;
          if (conflict.reason && conflict.reason.includes('pendientes')) {
            question = `Hay cambios locales pendientes en "${conflict.localProject?.name || 'este proyecto'}" que no est\u00e1n en Drive.\n\n\u00bfDeseas reemplazar la copia local con la versi\u00f3n de Drive? Los cambios locales se perder\u00e1n.`;
          } else if (conflict.reason && conflict.reason.includes('m\u00e1s reciente')) {
            question = `\u00bfDeseas abrir la versi\u00f3n de Drive de "${conflict.localProject?.name || 'este proyecto'}"? Tu copia local ser\u00e1 reemplazada.`;
          } else {
            question = `\u00bfReemplazar la copia local con la versi\u00f3n de Drive de "${conflict.localProject?.name || 'este proyecto'}"?`;
          }
          resolve(confirm(question) ? 'replace' : 'cancel');
        })
      );
      this._project = await this._storage.getProject(remoteProject.projectId);
      document.getElementById('project-name').textContent = this._project.name;
      await this._refreshProducts();
      await this._updateProjectAndStatus();
      this._notifications.success(`Proyecto "${result.project.name}" abierto desde Google Drive (${result.totalProducts} productos, ${result.totalImages} im\u00e1genes).`);
    } catch (err) {
      if (err.conflict === 'skip') { this._notifications.info(err.message); }
      else if (err.conflict === 'cancelled' || err.conflict === 'pending') { this._notifications.info(err.message || 'Apertura cancelada.'); }
      else {
        console.error('Error al abrir desde Drive:', err);
        if (err.code === 'DRIVE_SESSION_EXPIRED') { this._auth.disconnect(); this._drive.clearAccessToken(); this._updateUIForDriveState(); this._notifications.error('La sesi\u00f3n de Google Drive expir\u00f3.'); }
        else { this._notifications.error(`Error al abrir: ${err.message}`); }
      }
      try { await this._updateProjectAndStatus(); } catch (_) {}
    } finally { this._isDriveSyncing = false; }
  }

  async _handleEdit(productId) {
    if (this._lockedProducts.has(productId)) { this._notifications.info('Procesando...'); return; }
    this._lockedProducts.add(productId);
    try {
      const product = await this._productService.getProduct(productId);
      if (!product) { this._notifications.error('Producto no encontrado.'); return; }
      this._openProductEditor('edit', product);
    } catch (err) { console.error(err); this._notifications.error('Error al cargar.'); }
    finally { this._lockedProducts.delete(productId); }
  }

  async _handleDuplicate(productId) {
    if (this._lockedProducts.has(productId)) { this._notifications.info('Procesando...'); return; }
    this._lockedProducts.add(productId);
    try {
      const original = await this._productService.getProduct(productId);
      if (!original) { this._notifications.error('Producto no encontrado.'); return; }
      let originalBlob = null;
      if (original.imageId) originalBlob = await this._productService.getImage(original.imageId);
      await this._productService.duplicateProduct(original, originalBlob);
      await this._refreshProducts();
      await this._updateProjectAndStatus();
      this._notifications.success('Producto duplicado.');
    } catch (err) { console.error(err); this._notifications.error(`Error: ${err.message}`); }
    finally { this._lockedProducts.delete(productId); }
  }

  async _handleDelete(productId) {
    if (this._lockedProducts.has(productId)) { this._notifications.info('Procesando...'); return; }
    this._lockedProducts.add(productId);
    try {
      const product = await this._productService.getProduct(productId);
      if (!product) { this._notifications.error('Producto no encontrado.'); return; }
      if (!confirm(`\u00bfEliminar "${product.name}"?`)) return;
      await this._productService.deleteProduct(productId);
      await this._refreshProducts();
      await this._updateProjectAndStatus();
      this._notifications.success('Producto eliminado.');
    } catch (err) { console.error(err); this._notifications.error(`Error: ${err.message}`); }
    finally { this._lockedProducts.delete(productId); }
  }

  // ─── Product save ───

  async _handleSave({ data, editingProductId, expectedRevision, imageAction, imageFile }) {
    this._status.showSaving();
    try {
      if (data.categoryId) {
        const cat = this._project.categories.find(c => c.id === data.categoryId);
        if (cat) data.category = cat.name;
      } else { data.category = ''; }

      let imageRecord = null;
      if (imageAction === 'replace') {
        if (!imageFile) throw new Error('IMAGE_FILE_MISSING');
        const validation = validateImage(imageFile);
        if (!validation.valid) throw new Error(validation.error);
        const optimized = await optimizeImage(imageFile);
        imageRecord = createImageRecord(this._project.projectId, optimized.blob, optimized.mimeType, optimized.width, optimized.height, optimized.optimizedSize);
      }

      if (editingProductId && expectedRevision !== null) {
        await this._productService.updateProduct(editingProductId, expectedRevision, this._project.projectId, data, imageAction, imageRecord);
        this._notifications.success('Producto actualizado.');
      } else {
        await this._productService.createProduct(this._project.projectId, data, imageRecord);
        this._notifications.success('Producto creado.');
      }
      try { await this._refreshProducts(); await this._updateProjectAndStatus(); } catch (e) { console.warn(e); }
    } catch (err) {
      console.error('Error al guardar:', err);
      if (err.name === 'ConflictError') this._notifications.error('Este producto cambi\u00f3...');
      else if (err.code === 'PRODUCT_NOT_FOUND') this._notifications.error('Este producto ya no existe.');
      else this._notifications.error(`Error: ${err.message}`);
      try { await this._updateProjectAndStatus(); } catch (_) { this._status.update(this._project); }
      throw err;
    }
  }

  async _handleToggleActive(productId) {
    if (this._lockedProducts.has(productId)) { this._notifications.info('Procesando...'); return; }
    this._lockedProducts.add(productId);
    try { await this._productService.toggleProductActive(productId, this._project.projectId); await this._refreshProducts(); await this._updateProjectAndStatus(); }
    catch (err) { console.error(err); this._notifications.error(`Error: ${err.message}`); }
    finally { this._lockedProducts.delete(productId); }
  }

  async _handleManageCategories() {
    const dialog = document.getElementById('categories-dialog');
    const list = document.getElementById('categories-list');
    const input = document.getElementById('new-category-input');
    const addBtn = document.getElementById('add-category-btn');
    const closeBtn = document.getElementById('categories-close-btn');

    const renderCategories = () => {
      list.innerHTML = '';
      for (const cat of (this._project.categories || [])) {
        const li = document.createElement('li'); li.className = 'categories-list__item';
        const nameSpan = document.createElement('span'); nameSpan.className = 'categories-list__name'; nameSpan.textContent = cat.name; li.appendChild(nameSpan);
        const renameBtn = document.createElement('button'); renameBtn.className = 'btn btn--small btn--outline'; renameBtn.textContent = 'Renombrar';
        renameBtn.addEventListener('click', async () => {
          const newName = prompt('Nuevo nombre:', cat.name);
          if (newName && newName.trim() && newName.trim() !== cat.name) {
            try { await this._productService.renameCategory(this._project, cat.id, newName.trim()); await this._refreshProducts(); await this._updateProjectAndStatus(); this._form.refreshCategories(this._project); this._refreshFilterCategories(); renderCategories(); }
            catch (err) { this._notifications.error(err.message); }
          }
        });
        li.appendChild(renameBtn);
        const deleteBtn = document.createElement('button'); deleteBtn.className = 'btn btn--small btn--danger'; deleteBtn.textContent = 'Eliminar';
        deleteBtn.addEventListener('click', async () => {
          const count = await this._categoryProductCount(cat.id);
          const msg = count > 0 ? `La categor\u00eda tiene ${count} producto(s). \u00bfEliminar?` : `\u00bfEliminar "${cat.name}"?`;
          if (!confirm(msg)) return;
          try { await this._productService.deleteCategory(this._project, cat.id); await this._refreshProducts(); await this._updateProjectAndStatus(); this._form.refreshCategories(this._project); this._refreshFilterCategories(); renderCategories(); }
          catch (err) { this._notifications.error(err.message); }
        });
        li.appendChild(deleteBtn);
        list.appendChild(li);
      }
    };

    const addCategory = async () => {
      const name = input.value.trim();
      if (!name) return;
      try { await this._productService.createCategory(this._project, name); await this._updateProjectAndStatus(); this._form.refreshCategories(this._project); this._refreshFilterCategories(); input.value = ''; renderCategories(); }
      catch (err) { this._notifications.error(err.message); }
    };

    addBtn.addEventListener('click', addCategory);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCategory(); });
    closeBtn.addEventListener('click', () => { dialog.classList.add('hidden'); dialog.setAttribute('aria-hidden', 'true'); });

    renderCategories();
    dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false'); input.focus();
  }

  async _categoryProductCount(categoryId) {
    const products = await this._productService.listProducts(this._project.projectId);
    return products.filter(p => p.categoryId === categoryId).length;
  }

  _updateFiltersBadge() {
    const badge = document.getElementById('filters-badge');
    let count = 0;
    const cat = document.getElementById('filter-category').value;
    const status = document.getElementById('filter-status').value;
    if (cat && cat !== '__none') count++;
    if (status && status !== 'all') count++;
    if (count > 0) {
      badge.textContent = '\u00b7 ' + count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  _refreshFilterCategories() {
    const sets = [
      document.getElementById('filter-category'),
      document.getElementById('filter-category-mobile')
    ];
    const val = document.getElementById('filter-category').value;
    const html = '<option value="">Todas</option><option value="__none">Sin categor\u00eda</option>';
    for (const sel of sets) {
      if (!sel) continue;
      sel.innerHTML = html;
      if (this._project && this._project.categories) {
        for (const cat of this._project.categories) {
          const opt = document.createElement('option'); opt.value = cat.id; opt.textContent = cat.name; sel.appendChild(opt);
        }
      }
      sel.value = val;
    }
  }

  async _refreshProducts() {
    try {
      // Sync mobile filter values from desktop
      const catMobile = document.getElementById('filter-category-mobile');
      const statusMobile = document.getElementById('filter-status-mobile');
      if (catMobile) catMobile.value = document.getElementById('filter-category').value;
      if (statusMobile) statusMobile.value = document.getElementById('filter-status').value;

      const all = await this._productService.listProducts(this._project.projectId);
      const search = document.getElementById('search-input').value;
      const categoryId = document.getElementById('filter-category').value;
      const activeFilter = document.getElementById('filter-status').value;
      const sortBy = document.getElementById('sort-by').value;
      const filtered = this._productService.filterProducts(all, { search, categoryId, activeFilter, sortBy });
      document.getElementById('result-count').textContent = `${filtered.length} de ${all.length} productos`;
      await this._list.render(filtered, this._viewMode);
      this._updateFiltersBadge();
    } catch (err) { console.error('Error al actualizar listado:', err); }
  }

  // ─── Cat\u00e1logo ───

  _handleCatalogConfig() {
    const dialog = document.getElementById('catalog-config-dialog');
    const titleInput = document.getElementById('catalog-title');
    const previewBtn = document.getElementById('catalog-preview-btn');
    const cancelBtn = document.getElementById('catalog-config-cancel-btn');
    titleInput.value = this._project ? this._project.name : '';
    dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false'); titleInput.focus();

    const close = () => {
      dialog.classList.add('hidden');
      dialog.setAttribute('aria-hidden', 'true');
      previewBtn.removeEventListener('click', onPreview);
      cancelBtn.removeEventListener('click', onClose);
    };
    const onClose = () => close();
    const onPreview = async () => {
      const opts = {
        showPrices: document.getElementById('catalog-show-prices').checked,
        showDescriptions: document.getElementById('catalog-show-descriptions').checked,
        showCodes: document.getElementById('catalog-show-codes').checked,
        catalogTitle: document.getElementById('catalog-title').value,
        companyName: document.getElementById('catalog-company').value
      };
      close();
      await this._handleCatalogPreview(opts);
    };
    cancelBtn.addEventListener('click', onClose);
    previewBtn.addEventListener('click', onPreview);
  }

  async _handleCatalogPreview(options) {
    try {
      const products = await this._productService.listProducts(this._project.projectId);
      const activeProducts = products.filter(p => p.active !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      if (activeProducts.length === 0) { this._notifications.info('Agrega al menos un producto activo.'); return; }
      const imageMap = new Map();
      for (const p of activeProducts) { if (p.imageId && !imageMap.has(p.imageId)) { const record = await this._productService.getImage(p.imageId); if (record) imageMap.set(p.imageId, record); } }
      const previewDialog = document.getElementById('catalog-preview-dialog');
      const content = document.getElementById('catalog-preview-content');
      const exportBtn = document.getElementById('catalog-export-btn');
      const backBtn = document.getElementById('catalog-preview-back-btn');
      const catalogEl = this._catalogBuilder.build(this._project, activeProducts, imageMap, options);
      content.innerHTML = ''; content.appendChild(catalogEl);
      previewDialog.classList.remove('hidden'); previewDialog.setAttribute('aria-hidden', 'false');
      await this._printManager.loadImages(imageMap, catalogEl);

      const closePreview = () => {
        previewDialog.classList.add('hidden');
        previewDialog.setAttribute('aria-hidden', 'true');
        content.innerHTML = '';
        this._printManager.destroy();
        exportBtn.removeEventListener('click', onExport);
        backBtn.removeEventListener('click', onBack);
      };
      const onBack = () => closePreview();

      const onExport = async () => {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Preparando PDF\u2026';
        exportBtn.setAttribute('aria-busy', 'true');
        try {
          this._printManager._revokeAll();
          await this._printManager.loadImages(imageMap, catalogEl);
          await this._printManager.print(catalogEl);
        } catch (err) {
          console.error('Error al exportar:', err);
        } finally {
          exportBtn.disabled = false;
          exportBtn.textContent = 'Exportar PDF';
          exportBtn.removeAttribute('aria-busy');
        }
      };

      exportBtn.addEventListener('click', onExport);
      backBtn.addEventListener('click', onBack);
    } catch (err) {
      console.error('Error al generar vista previa:', err);
      this._notifications.error('Error al generar la vista previa.');
    }
  }

  async _updateProjectAndStatus() {
    this._project = await this._storage.getProject(this._project.projectId);
    if (this._project) {
      this._status.update(this._project);
      this._form.refreshCategories(this._project);
      this._refreshFilterCategories();
      if (this._activeSection === 'project') this._updateProjectSection();
    }
  }
}

const app = new App();
app.start().catch(err => { console.error('Error fatal:', err); });
