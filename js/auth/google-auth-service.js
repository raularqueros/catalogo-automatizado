import CONFIG from '../config.js';

const SCRIPT_ID = 'gis-client';
const GIS_URL = 'https://accounts.google.com/gsi/client';
const AUTHORIZATION_MARKER_KEY = 'catalogo_drive_previously_authorized';
const SILENT_RESTORE_TIMEOUT_MS = 10000;
const INTERACTIVE_AUTH_TIMEOUT_MS = 120000;

export class GoogleAuthService {
  constructor() {
    this._tokenClient = null;
    this._accessToken = null;
    this._scriptLoaded = false;
    this._initialized = false;
  }

  /**
   * Carga el script GIS si todavía no está disponible.
   * No inicializa el cliente hasta que se llame a connect().
   */
  async initialize() {
    if (this._initialized) return;
    await this._loadScript();
    this._initialized = true;
  }

  _loadScript() {
    if (this._scriptLoaded) return Promise.resolve();
    if (typeof google !== 'undefined' && google.accounts) {
      this._scriptLoaded = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = GIS_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        this._scriptLoaded = true;
        resolve();
      };
      script.onerror = () => {
        reject(new Error('No se pudo cargar Google Identity Services. Verifica tu conexión a internet.'));
      };
      document.head.appendChild(script);
    });
  }

  _isClientIdConfigured() {
    return CONFIG.GOOGLE_CLIENT_ID
      && CONFIG.GOOGLE_CLIENT_ID !== 'REEMPLAZAR_CON_CLIENT_ID.apps.googleusercontent.com';
  }

  _rememberAuthorization() {
    try {
      localStorage.setItem(AUTHORIZATION_MARKER_KEY, '1');
    } catch (_) {}
  }

  _forgetAuthorization() {
    try {
      localStorage.removeItem(AUTHORIZATION_MARKER_KEY);
    } catch (_) {}
  }

  wasPreviouslyAuthorized() {
    try {
      return localStorage.getItem(AUTHORIZATION_MARKER_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  _requestToken(prompt, timeoutMs = 0) {
    return new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(result);
      };

      try {
        this._tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          scope: CONFIG.GOOGLE_DRIVE_SCOPE,
          callback: (response) => {
            if (response.error) {
              finish({
                success: false,
                error: response.error,
                message: response.error_description || 'Error de autenticación con Google.'
              });
              return;
            }
            this._accessToken = response.access_token;
            this._rememberAuthorization();
            finish({ success: true, token: response.access_token });
          },
          error_callback: (response) => {
            finish({
              success: false,
              error: response?.type || 'OAUTH_WINDOW_ERROR',
              message: 'No se pudo completar la conexión con Google.'
            });
          }
        });

        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => {
            finish({
              success: false,
              error: prompt === 'none' ? 'SILENT_RESTORE_TIMEOUT' : 'OAUTH_TIMEOUT',
              message: prompt === 'none'
                ? 'No se pudo restaurar la conexión en segundo plano.'
                : 'La conexión con Google tardó demasiado. Intenta nuevamente.'
            });
          }, timeoutMs);
        }
        this._tokenClient.requestAccessToken(prompt === undefined ? undefined : { prompt });
      } catch (err) {
        finish({
          success: false,
          error: 'OAUTH_INIT_FAILED',
          message: `Error al iniciar OAuth: ${err.message}`
        });
      }
    });
  }

  /**
   * Inicia el flujo OAuth. Debe llamarse desde un clic del usuario.
   * Retorna { success, token, error }
   */
  async connect() {
    if (!this._isClientIdConfigured()) {
      return { success: false, error: 'GOOGLE_CLIENT_NOT_CONFIGURED', message: 'Google Drive no está configurado. Configura GOOGLE_CLIENT_ID en js/config.js.' };
    }

    try {
      await this.initialize();
    } catch (err) {
      return { success: false, error: 'GIS_LOAD_FAILED', message: err.message };
    }

    return this._requestToken(undefined, INTERACTIVE_AUTH_TIMEOUT_MS);
  }

  async restoreConnection() {
    if (!this.wasPreviouslyAuthorized()) {
      return { success: false, error: 'NO_PREVIOUS_AUTHORIZATION' };
    }
    if (!this._isClientIdConfigured()) {
      return { success: false, error: 'GOOGLE_CLIENT_NOT_CONFIGURED' };
    }

    try {
      await this.initialize();
    } catch (err) {
      return { success: false, error: 'GIS_LOAD_FAILED', message: err.message };
    }

    return this._requestToken('none', SILENT_RESTORE_TIMEOUT_MS);
  }

  disconnect({ forgetAuthorization = false } = {}) {
    this._accessToken = null;
    this._tokenClient = null;
    if (forgetAuthorization) this._forgetAuthorization();
  }

  isConnected() {
    return !!this._accessToken;
  }

  getAccessToken() {
    return this._accessToken;
  }

  clearAccessToken() {
    this._accessToken = null;
  }
}
