import { IndexedDbProvider } from './js/storage/indexeddb-provider.js?v=20260729-final-integration-v1';
import { SyncManager } from './js/storage/sync-manager.js?v=20260729-final-integration-v1';
import { DriveRemoteProvider } from './js/storage/drive-remote-provider.js?v=20260729-final-integration-v1';
import { GoogleAuthService } from './js/auth/google-auth-service.js?v=20260729-final-integration-v1';
import { ProductService } from './js/services/product-service.js?v=20260729-final-integration-v1';
import { NotificationService } from './js/services/notification-service.js?v=20260729-final-integration-v1';
import { ProductForm } from './js/ui/product-form.js?v=20260729-final-integration-v1';
import { ProductList } from './js/ui/product-list.js?v=20260729-final-integration-v1';
import { StorageStatus } from './js/ui/storage-status.js?v=20260729-final-integration-v1';
import { createProject } from './js/models/project-schema.js?v=20260729-final-integration-v1';
import {
  validateImage,
  optimizeImage,
  createImageRecord,
  ensureImageStorageCapacity
} from './js/services/image-service.js?v=20260729-final-integration-v1';
import { escapeHtml } from './js/utils.js?v=20260729-final-integration-v1';
import { CatalogBuilder } from './js/catalog/catalog-builder.js?v=20260729-final-integration-v1';
import { PrintManager } from './js/catalog/print-manager.js?v=20260729-final-integration-v1';

class App {
  constructor() {
    this._project = null;
    this._storage = new IndexedDbProvider();
    this._sync = new SyncManager(this._storage);
    this._drive = new DriveRemoteProvider();
    this._auth = new GoogleAuthService();
    this._productService = null;
    this._notifications = new NotificationService();
    this._form = null;
    this._list = null;
    this._status = new StorageStatus();
    this._lockedProducts = new Set();
    this._isDriveSyncing = false;
    this._isAuthConnecting = false;
    this._isAuthRestoring = false;
    this._beforeUnloadListening = false;
    this._boundBeforeUnload = (event) => this._handleBeforeUnload(event);
    this._startupActionInProgress = false;
    this._startupUIInitialized = false;
    this._uiInitialized = false;
    this._appReady = false;
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
      this._setupStartupUI();
      await this._storage.initialize();
      const hasActiveProject = await this._loadOrCreateProject();
      if (hasActiveProject) {
        await this._enterApplication();
      } else {
        this._showStartupScreen();
      }
    } catch (err) {
      console.error('Error al iniciar la aplicaci\u00f3n:', err);
      this._notifications.error('Error al iniciar la aplicaci\u00f3n. Revise la consola para m\u00e1s detalles.');
      this._showStartupScreen('No se pudo acceder al almacenamiento local. Intenta recargar la aplicaci\u00f3n.');
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
    const projects = (await this._storage.listProjects()).filter(project =>
      project && typeof project.projectId === 'string' && project.projectId.trim()
    );
    if (projects.length === 0) {
      this._project = null;
      return false;
    }

    const activeId = await this._storage.getMetadata('activeProjectId');
    const activeProject = activeId
      ? projects.find(project => project.projectId === activeId)
      : null;

    if (activeProject) {
      this._project = activeProject;
      return true;
    }

    projects.sort((a, b) => {
      const dateA = a.updatedAt || a.createdAt || '';
      const dateB = b.updatedAt || b.createdAt || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return a.projectId.localeCompare(b.projectId);
    });
    this._project = projects[0];
    await this._storage.setMetadata('activeProjectId', this._project.projectId);
    return true;
  }

  _setupStartupUI() {
    if (this._startupUIInitialized) return;
    this._startupUIInitialized = true;

    const createChoice = document.getElementById('startup-create-choice');
    const driveChoice = document.getElementById('startup-drive-choice');
    const createForm = document.getElementById('startup-create-form');
    const choiceActions = document.getElementById('startup-choice-actions');
    const backBtn = document.getElementById('startup-create-back');
    const nameInput = document.getElementById('startup-project-name');

    createChoice.addEventListener('click', () => {
      if (this._startupActionInProgress) return;
      choiceActions.classList.add('hidden');
      createForm.classList.remove('hidden');
      document.getElementById('startup-project-name-error').classList.remove('field-error--visible');
      requestAnimationFrame(() => {
        nameInput.focus();
        nameInput.select();
      });
    });

    backBtn.addEventListener('click', () => {
      if (this._startupActionInProgress) return;
      createForm.classList.add('hidden');
      choiceActions.classList.remove('hidden');
      requestAnimationFrame(() => createChoice.focus());
    });

    createForm.addEventListener('submit', event => {
      event.preventDefault();
      this._handleCreateLocalProject();
    });

    nameInput.addEventListener('input', () => {
      const errorEl = document.getElementById('startup-project-name-error');
      errorEl.textContent = '';
      errorEl.classList.remove('field-error--visible');
      nameInput.removeAttribute('aria-invalid');
    });
    nameInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this._handleCreateLocalProject();
    });

    driveChoice.addEventListener('click', () => this._handleStartupOpenDrive());
  }

  _showStartupScreen(message = '') {
    this._appReady = false;
    document.getElementById('app-header').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('startup-screen').classList.remove('hidden');
    document.getElementById('startup-status').textContent = message;
    const skipLink = document.getElementById('skip-link');
    skipLink.href = '#startup-title';
    skipLink.textContent = 'Saltar a las opciones de inicio';
    requestAnimationFrame(() => document.getElementById('startup-create-choice').focus());
  }

  _setStartupBusy(isBusy, message = '') {
    const screen = document.getElementById('startup-screen');
    screen.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    document.getElementById('startup-status').textContent = message;
    [
      'startup-create-choice',
      'startup-drive-choice',
      'startup-project-name',
      'startup-create-back',
      'startup-create-submit'
    ].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.disabled = isBusy;
    });
  }

  async _handleCreateLocalProject() {
    if (this._startupActionInProgress) return;

    const nameInput = document.getElementById('startup-project-name');
    const errorEl = document.getElementById('startup-project-name-error');
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Escribe un nombre para el cat\u00e1logo.';
      errorEl.classList.add('field-error--visible');
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }

    this._startupActionInProgress = true;
    this._setStartupBusy(true, 'Creando tu cat\u00e1logo\u2026');
    try {
      const project = createProject(name);
      await this._storage.createProjectAndSetActive(project);
      this._project = project;
      await this._enterApplication();
      this._notifications.success(`Cat\u00e1logo "${project.name}" creado localmente.`);
    } catch (err) {
      this._notifications.error('No se pudo crear el cat\u00e1logo local. Intenta nuevamente.');
      this._setStartupBusy(false, 'No se pudo crear el cat\u00e1logo. Revisa el almacenamiento del navegador e intenta nuevamente.');
    } finally {
      this._startupActionInProgress = false;
      if (!this._appReady) this._setStartupBusy(false, document.getElementById('startup-status').textContent);
    }
  }

  async _handleStartupOpenDrive() {
    if (this._startupActionInProgress || this._isDriveSyncing) return;
    this._startupActionInProgress = true;
    this._setStartupBusy(true, this._drive.isConnected() ? 'Buscando proyectos en Drive\u2026' : 'Conectando con Google Drive\u2026');
    try {
      if (!this._drive.isConnected()) {
        const connected = await this._connectDrive();
        if (!connected) {
          this._setStartupBusy(false, 'La conexi\u00f3n no se complet\u00f3. Puedes intentarlo nuevamente o crear un cat\u00e1logo local.');
          return;
        }
      }
      this._setStartupBusy(true, 'Buscando proyectos en Drive\u2026');
      await this._handleOpenFromDrive();
    } finally {
      this._startupActionInProgress = false;
      if (!this._appReady) {
        this._setStartupBusy(false, document.getElementById('startup-status').textContent);
      }
    }
  }

  _initializeProjectServices() {
    if (this._productService) return;
    this._productService = new ProductService(this._storage);
    this._form = new ProductForm(this._productService);
    this._list = new ProductList();
  }

  async _ensureLocalProjectBackupState() {
    if (this._project?.syncMetadata?.status !== 'local') return;
    const products = await this._productService.listProducts(this._project.projectId);
    const hasRelevantContent = products.length > 0
      || (this._project.categories || []).length > 0
      || !!this._project.visualSettings?.logoImageId
      || !!this._project.visualSettings?.primaryColor;
    if (!hasRelevantContent) return;

    await this._sync.markPending(this._project);
    this._project = await this._storage.getProject(this._project.projectId);
  }

  async _enterApplication() {
    if (!this._project || !this._project.projectId) {
      throw new Error('No hay un proyecto activo v\u00e1lido.');
    }

    this._initializeProjectServices();
    await this._productService.migrateCategories(this._project);
    await this._ensureLocalProjectBackupState();
    this._form.refreshCategories(this._project);
    document.getElementById('project-name').textContent = this._project.name;
    this._setupUI();
    this._refreshFilterCategories();
    this._setActiveSection('products');
    await this._refreshProducts();
    this._updateUIForDriveState();
    this._status.update(this._project, this._drive.isConnected());
    this._syncBeforeUnloadGuard();

    this._appReady = true;
    this._setStartupBusy(false, '');
    document.getElementById('startup-screen').classList.add('hidden');
    document.getElementById('app-header').classList.remove('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    const skipLink = document.getElementById('skip-link');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Saltar al contenido principal';
    requestAnimationFrame(() => document.getElementById('new-product-btn').focus());
    this._restoreDriveConnection();
  }

  _setupUI() {
    if (this._uiInitialized) return;
    this._uiInitialized = true;
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
    document.getElementById('products-drive-btn').addEventListener('click', () => this._handleProductsDriveClick());

    // Debounced resize handler for responsive renderer transitions
    let resizeTimer;
    const getRenderRange = () => {
      if (window.innerWidth <= 767) return 'mobile';
      if (window.innerWidth < 1024) return 'tablet';
      return 'desktop';
    };
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const wasMobile = this._isMobile;
        const previousRange = this._renderRange;
        this._isMobile = window.innerWidth <= 767;
        this._renderRange = getRenderRange();
        if (wasMobile !== this._isMobile) {
          this._viewMode = this._loadViewMode();
          this._updateViewButtons();
        }
        if (previousRange !== this._renderRange) {
          this._refreshProducts();
        }
      }, 200);
    });
    this._isMobile = window.innerWidth <= 767;
    this._renderRange = getRenderRange();

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

  _hasUnbackedDriveChanges() {
    const status = this._project?.syncMetadata?.status;
    return status === 'pending' || status === 'error';
  }

  _handleBeforeUnload(event) {
    if (!this._hasUnbackedDriveChanges()) return;
    event.preventDefault();
    event.returnValue = '';
    return '';
  }

  _syncBeforeUnloadGuard() {
    const shouldListen = this._hasUnbackedDriveChanges();
    if (shouldListen && !this._beforeUnloadListening) {
      window.addEventListener('beforeunload', this._boundBeforeUnload);
      this._beforeUnloadListening = true;
    } else if (!shouldListen && this._beforeUnloadListening) {
      window.removeEventListener('beforeunload', this._boundBeforeUnload);
      this._beforeUnloadListening = false;
    }
  }

  async _restoreDriveConnection() {
    if (
      this._isAuthRestoring
      || this._isAuthConnecting
      || this._drive.isConnected()
      || !this._auth.wasPreviouslyAuthorized()
    ) return false;

    this._isAuthRestoring = true;
    this._updateUIForDriveState();
    try {
      const result = await this._auth.restoreConnection();
      if (!result.success) return false;
      this._drive.setAccessToken(result.token);
      return true;
    } finally {
      this._isAuthRestoring = false;
      this._updateUIForDriveState();
      if (this._project) this._status.update(this._project, this._drive.isConnected());
    }
  }

  async _handleProductsDriveClick() {
    if (
      this._isDriveSyncing
      || this._isAuthConnecting
      || this._isAuthRestoring
      || !this._hasUnbackedDriveChanges()
    ) return;

    if (!this._drive.isConnected()) {
      const connected = await this._connectDrive();
      if (!connected) return;
    }
    await this._handleSaveToDrive();
  }

  async _connectDrive() {
    if (this._isAuthConnecting) return false;
    this._isAuthConnecting = true;
    this._updateProductsDriveButton();
    const connectBtn = document.getElementById('connect-drive-btn');
    if (connectBtn) connectBtn.disabled = true;
    try {
      const result = await this._auth.connect();
      if (!result.success) {
        if (result.error !== 'access_denied') {
          this._notifications.error(result.message);
        }
        return false;
      }

      this._drive.setAccessToken(result.token);
      this._updateUIForDriveState();
      if (this._project) this._status.update(this._project, this._drive.isConnected());
      this._updateProjectSection();
      this._notifications.success('Google Drive conectado correctamente.');
      return true;
    } catch (err) {
      console.error('Error al conectar Drive:', err);
      this._notifications.error(`Error al conectar: ${err.message}`);
      return false;
    } finally {
      this._isAuthConnecting = false;
      if (connectBtn) connectBtn.disabled = false;
      this._updateProductsDriveButton();
    }
  }

  async _handleConnectDrive() {
    const connected = await this._connectDrive();
    if (connected && this._hasUnbackedDriveChanges()) {
      await this._handleSaveToDrive();
    }
  }

  _handleDisconnectDrive() {
    this._auth.disconnect({ forgetAuthorization: true });
    this._drive.clearAccessToken();
    this._updateUIForDriveState();
    if (this._project) this._status.update(this._project, this._drive.isConnected());
    this._updateProjectSection();
    this._notifications.info('Google Drive desconectado.');
  }

  _updateUIForDriveState() {
    const connected = this._drive.isConnected();
    const hasPending = this._hasUnbackedDriveChanges();
    const isError = this._project?.syncMetadata?.status === 'error';
    const isBusy = this._isDriveSyncing || this._isAuthConnecting || this._isAuthRestoring;
    const connectBtn = document.getElementById('connect-drive-btn');
    const connectLabel = document.getElementById('connect-drive-label');
    const saveBtn = document.getElementById('save-drive-btn');
    const saveLabel = document.getElementById('save-drive-label');
    const openBtn = document.getElementById('open-drive-btn');
    const disconnectBtn = document.getElementById('disconnect-drive-btn');
    if (connectBtn) connectBtn.classList.toggle('hidden', connected);
    if (connectBtn) connectBtn.disabled = isBusy;
    if (connectLabel) connectLabel.textContent = hasPending ? 'Conectar y guardar' : 'Conectar Google Drive';
    if (saveBtn) {
      saveBtn.classList.toggle('hidden', !connected);
      saveBtn.disabled = isBusy || !hasPending;
      saveBtn.setAttribute('aria-busy', this._isDriveSyncing ? 'true' : 'false');
    }
    if (saveLabel && !this._isDriveSyncing) {
      saveLabel.textContent = isError ? 'Reintentar' : (hasPending ? 'Guardar en Drive' : 'Drive');
    }
    if (openBtn) openBtn.classList.toggle('hidden', !connected);
    if (openBtn) openBtn.disabled = isBusy;
    if (disconnectBtn) disconnectBtn.classList.toggle('hidden', !connected);
    if (disconnectBtn) disconnectBtn.disabled = isBusy;
    this._updateProductsDriveButton();
    this._updateProjectSection();
  }

  _updateProductsDriveButton() {
    const button = document.getElementById('products-drive-btn');
    const badge = document.getElementById('products-drive-badge');
    const label = button?.querySelector('.drive-status-btn__label');
    if (!button || !badge || !label) return;

    const connected = this._drive.isConnected();
    const hasPending = this._hasUnbackedDriveChanges();
    const isError = this._project?.syncMetadata?.status === 'error';
    const authBusy = this._isAuthConnecting || this._isAuthRestoring;
    const saving = this._isDriveSyncing;
    button.classList.toggle('drive-status-btn--connected', connected && !hasPending && !authBusy && !saving);
    button.classList.toggle('drive-status-btn--disconnected', !connected && !isError && !authBusy && !saving);
    button.classList.toggle('drive-status-btn--pending', hasPending && !isError && !authBusy && !saving);
    button.classList.toggle('drive-status-btn--error', isError && !authBusy && !saving);
    button.classList.toggle('drive-status-btn--loading', authBusy || saving);
    button.setAttribute('aria-busy', authBusy || saving ? 'true' : 'false');

    if (saving) {
      label.textContent = 'Guardando\u2026';
      badge.textContent = '\u2026';
      button.disabled = true;
      button.setAttribute('aria-label', 'Guardando cambios en Google Drive');
      button.title = 'Guardando cambios en Google Drive';
    } else if (authBusy) {
      label.textContent = 'Conectando\u2026';
      badge.textContent = '\u2026';
      button.disabled = true;
      button.setAttribute('aria-label', 'Conectando con Google Drive');
      button.title = 'Conectando con Google Drive';
    } else if (isError) {
      label.textContent = 'Reintentar';
      badge.textContent = '!';
      button.disabled = false;
      button.setAttribute('aria-label', 'Reintentar respaldo en Google Drive');
      button.title = 'Los cambios están guardados localmente. Reintentar respaldo en Google Drive';
    } else if (hasPending && connected) {
      label.textContent = 'Guardar en Drive';
      badge.textContent = '\u2191';
      button.disabled = false;
      button.setAttribute('aria-label', 'Guardar cambios pendientes en Google Drive');
      button.title = 'Cambios guardados en este dispositivo. Falta respaldarlos en Google Drive';
    } else if (hasPending) {
      label.textContent = 'Conectar y guardar';
      badge.textContent = '\u00d7';
      button.disabled = false;
      button.setAttribute('aria-label', 'Conectar Google Drive y guardar cambios pendientes');
      button.title = 'Cambios guardados en este dispositivo. Conecta para respaldarlos en Google Drive';
    } else if (connected) {
      label.textContent = 'Drive';
      badge.textContent = '\u2713';
      button.disabled = true;
      button.setAttribute('aria-label', 'Todos los cambios están respaldados en Google Drive');
      button.title = 'Todos los cambios están respaldados en Google Drive';
    } else {
      label.textContent = 'Drive';
      badge.textContent = '\u00d7';
      button.disabled = true;
      button.setAttribute('aria-label', 'Drive desconectado. Sin cambios pendientes de respaldo');
      button.title = 'Drive desconectado. La conexión puede gestionarse desde Proyecto';
    }
  }

  _updateProjectSection() {
    const pname = document.getElementById('project-section-name');
    const localEl = document.getElementById('project-local-status');
    const driveEl = document.getElementById('project-drive-status');
    const lastSync = document.getElementById('project-last-sync');
    if (pname) pname.textContent = this._project ? this._project.name : '';
    if (localEl && this._project) {
      const s = this._project.syncMetadata.status;
      if (s === 'pending' || s === 'error') {
        localEl.textContent = 'Guardado localmente \u00b7 Respaldo en Drive pendiente';
      } else {
        localEl.textContent = 'Guardado localmente';
      }
    }
    if (driveEl) {
      if (this._hasUnbackedDriveChanges()) {
        driveEl.textContent = this._drive.isConnected()
          ? 'Conectado \u00b7 Falta respaldar cambios'
          : 'Desconectado \u00b7 Falta respaldar cambios';
      } else if (this._project?.syncMetadata?.status === 'synced') {
        driveEl.textContent = this._drive.isConnected()
          ? 'Conectado \u00b7 Todos los cambios respaldados'
          : 'Desconectado \u00b7 Último respaldo conservado';
      } else {
        driveEl.textContent = this._drive.isConnected() ? 'Conectado' : 'Sin respaldo remoto';
      }
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
    if (this._isDriveSyncing || !this._hasUnbackedDriveChanges()) return false;
    if (!this._drive.isConnected()) return false;

    this._isDriveSyncing = true;
    const saveLabel = document.getElementById('save-drive-label');
    saveLabel.textContent = 'Guardando en Drive\u2026';
    this._updateUIForDriveState();
    try {
      await this._sync.syncProjectToDrive(this._project, (msg) => this._status.showDriveProgress(msg));
      await this._updateProjectAndStatus();
      this._notifications.success('Cambios respaldados en Google Drive.');
      return true;
    } catch (err) {
      console.error('Error al guardar en Drive:', err);
      if (err.code === 'DRIVE_SESSION_EXPIRED') { this._auth.clearAccessToken(); this._drive.clearAccessToken(); this._updateUIForDriveState(); this._updateProjectSection(); this._notifications.error('La sesi\u00f3n de Google Drive expir\u00f3. Vuelve a conectar.'); }
      else if (err.code === 'DRIVE_FORBIDDEN') { this._notifications.error('Permiso denegado.'); }
      else if (err.code === 'DRIVE_RATE_LIMIT') { this._notifications.error('L\u00edmite temporal de Google.'); }
      else if (err.message && err.message.includes('revisi\u00f3n del proyecto cambi\u00f3')) { this._notifications.error('Hubo cambios locales durante la subida. Vuelve a intentar.'); }
      else { this._notifications.error(`Error al guardar en Drive: ${err.message}`); }
      try {
        const latestProject = await this._storage.getProject(this._project.projectId);
        if (latestProject) {
          await this._sync.markError(latestProject, err.message);
          this._project = latestProject;
        }
        await this._updateProjectAndStatus();
      } catch (_) {}
      return false;
    } finally {
      this._isDriveSyncing = false;
      this._updateUIForDriveState();
    }
  }

  async _handleOpenFromDrive() {
    if (!this._drive.isConnected()) { this._notifications.error('Conecta Google Drive primero.'); return; }
    if (this._isDriveSyncing) { this._notifications.info('Ya hay una operaci\u00f3n en curso.'); return; }
    const dialog = document.getElementById('drive-open-dialog');
    const listEl = document.getElementById('drive-projects-list');
    const loadingEl = document.getElementById('drive-projects-loading');
    const emptyEl = document.getElementById('drive-projects-empty');
    const errorEl = document.getElementById('drive-projects-error');
    const confirmBtn = document.getElementById('drive-open-confirm-btn');
    const cancelBtn = document.getElementById('drive-open-cancel-btn');
    const previousFocus = document.activeElement;
    if (this._driveDialogAbort) this._driveDialogAbort.abort();
    this._driveDialogAbort = new AbortController();
    const { signal } = this._driveDialogAbort;
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
    const closeDialog = () => {
      dialog.classList.add('hidden');
      dialog.setAttribute('aria-hidden', 'true');
      this._driveDialogAbort.abort();
      this._driveDialogAbort = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
    const onCancel = () => closeDialog();
    const onConfirm = async () => { if (!selectedProject) return; closeDialog(); await this._handleImportFromDrive(selectedProject); };
    cancelBtn.addEventListener('click', onCancel, { signal });
    confirmBtn.addEventListener('click', onConfirm, { signal });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog();
    }, { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDialog();
    }, { signal });

    dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false');
    showLoading(); cancelBtn.focus();
    try {
      remoteProjects = await this._drive.listRemoteProjects();
      remoteProjects.length === 0 ? showEmpty() : showList(remoteProjects);
      if (!this._appReady) {
        document.getElementById('startup-status').textContent = remoteProjects.length === 0
          ? 'No se encontraron proyectos en Drive. Puedes cerrar el di\u00e1logo y crear uno local.'
          : 'Selecciona el cat\u00e1logo que quieres abrir.';
      }
    } catch (err) {
      if (err.code === 'DRIVE_SESSION_EXPIRED') { this._auth.disconnect(); this._drive.clearAccessToken(); this._updateUIForDriveState(); showError('La sesi\u00f3n de Google Drive expir\u00f3.'); }
      else { showError(`Error al buscar proyectos: ${err.message}`); }
      this._notifications.error(`Error al buscar proyectos en Drive: ${err.message}`);
      if (!this._appReady) document.getElementById('startup-status').textContent = 'No se pudieron cargar los proyectos de Drive. Puedes cerrar este di\u00e1logo e intentarlo nuevamente.';
      confirmBtn.classList.add('hidden');
    }
  }

  async _handleImportFromDrive(remoteProject) {
    this._status.showDriveProgress('Abriendo proyecto desde Drive...');
    if (!this._appReady) document.getElementById('startup-status').textContent = 'Abriendo proyecto desde Drive\u2026';
    this._isDriveSyncing = true;
    try {
      const result = await this._sync.openProjectFromDrive(remoteProject,
        (msg) => {
          this._status.showDriveProgress(msg);
          if (!this._appReady) document.getElementById('startup-status').textContent = msg;
        },
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
      if (!this._appReady) {
        await this._enterApplication();
      } else {
        document.getElementById('project-name').textContent = this._project.name;
        await this._refreshProducts();
        await this._updateProjectAndStatus();
      }
      this._notifications.success(`Proyecto "${result.project.name}" abierto desde Google Drive (${result.totalProducts} productos, ${result.totalImages} im\u00e1genes).`);
      return true;
    } catch (err) {
      if (err.conflict === 'skip') { this._notifications.info(err.message); }
      else if (err.conflict === 'cancelled' || err.conflict === 'pending') { this._notifications.info(err.message || 'Apertura cancelada.'); }
      else {
        console.error('Error al abrir desde Drive:', err);
        if (err.code === 'DRIVE_SESSION_EXPIRED') { this._auth.disconnect(); this._drive.clearAccessToken(); this._updateUIForDriveState(); this._notifications.error('La sesi\u00f3n de Google Drive expir\u00f3.'); }
        else { this._notifications.error(`Error al abrir: ${err.message}`); }
      }
      if (this._project && this._appReady) {
        try { await this._updateProjectAndStatus(); } catch (_) {}
      }
      if (!this._appReady) document.getElementById('startup-status').textContent = 'No se abri\u00f3 ning\u00fan proyecto. Puedes intentarlo nuevamente o crear uno local.';
      return false;
    } finally {
      this._isDriveSyncing = false;
    }
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

  async _handleSave({ data, editingProductId, expectedRevision, imageAction, imageFile, onProgress }) {
    this._status.showSaving();
    try {
      if (data.categoryId) {
        const cat = this._project.categories.find(c => c.id === data.categoryId);
        if (cat) data.category = cat.name;
      } else { data.category = ''; }

      let imageRecord = null;
      if (imageAction === 'replace') {
        if (typeof onProgress === 'function') onProgress('Optimizando imagen\u2026');
        if (!imageFile) {
          const missingError = new Error('Selecciona una imagen antes de guardar.');
          missingError.name = 'ImageProcessingError';
          missingError.code = 'IMAGE_FILE_MISSING';
          throw missingError;
        }
        const validation = validateImage(imageFile);
        if (!validation.valid) {
          const validationError = new Error(validation.error);
          validationError.name = 'ImageProcessingError';
          validationError.code = validation.code;
          throw validationError;
        }
        const optimized = await optimizeImage(imageFile);
        if (typeof onProgress === 'function') onProgress('Verificando espacio\u2026');
        await ensureImageStorageCapacity(optimized.blob.size);
        imageRecord = createImageRecord(this._project.projectId, optimized.blob, optimized.mimeType, optimized.width, optimized.height, optimized.optimizedSize);
      }

      if (typeof onProgress === 'function') onProgress('Guardando producto\u2026');
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
      else if (err.name === 'QuotaExceededError' || err.code === 'STORAGE_QUOTA_EXCEEDED') {
        this._notifications.error('No hay espacio local suficiente. La imagen y el producto anterior se conservaron sin cambios.');
      }
      else this._notifications.error(`Error: ${err.message}`);
      try { await this._updateProjectAndStatus(); } catch (_) { this._status.update(this._project, this._drive.isConnected()); }
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
    const previousFocus = document.activeElement;
    if (this._categoriesDialogAbort) this._categoriesDialogAbort.abort();
    this._categoriesDialogAbort = new AbortController();
    const { signal } = this._categoriesDialogAbort;

    const closeDialog = () => {
      dialog.classList.add('hidden');
      dialog.setAttribute('aria-hidden', 'true');
      this._categoriesDialogAbort.abort();
      this._categoriesDialogAbort = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    };

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

    addBtn.addEventListener('click', addCategory, { signal });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCategory(); }, { signal });
    closeBtn.addEventListener('click', closeDialog, { signal });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog();
    }, { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDialog();
    }, { signal });

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
      badge.textContent = String(count);
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
    const html = '<option value="">Todas las categor\u00edas</option><option value="__none">Sin categor\u00eda</option>';
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
    const previousFocus = document.activeElement;
    if (this._catalogConfigAbort) this._catalogConfigAbort.abort();
    this._catalogConfigAbort = new AbortController();
    const { signal } = this._catalogConfigAbort;
    titleInput.value = this._project ? this._project.name : '';
    dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false'); titleInput.focus();

    const close = () => {
      dialog.classList.add('hidden');
      dialog.setAttribute('aria-hidden', 'true');
      this._catalogConfigAbort.abort();
      this._catalogConfigAbort = null;
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
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
    cancelBtn.addEventListener('click', onClose, { signal });
    previewBtn.addEventListener('click', onPreview, { signal });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close();
    }, { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    }, { signal });
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
      this._status.update(this._project, this._drive.isConnected());
      this._updateUIForDriveState();
      this._syncBeforeUnloadGuard();
      this._form.refreshCategories(this._project);
      this._refreshFilterCategories();
    }
  }
}

const app = new App();
app.start().catch(err => { console.error('Error fatal:', err); });
