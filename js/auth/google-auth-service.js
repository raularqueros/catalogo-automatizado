import CONFIG from '../config.js';

const SCRIPT_ID = 'gis-client';
const GIS_URL = 'https://accounts.google.com/gsi/client';

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

    return new Promise((resolve) => {
      try {
        this._tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          scope: CONFIG.GOOGLE_DRIVE_SCOPE,
          callback: (response) => {
            if (response.error) {
              resolve({ success: false, error: response.error, message: response.error_description || 'Error de autenticación con Google.' });
              return;
            }
            this._accessToken = response.access_token;
            resolve({ success: true, token: response.access_token });
          }
        });

        this._tokenClient.requestAccessToken();
      } catch (err) {
        resolve({ success: false, error: 'OAUTH_INIT_FAILED', message: `Error al iniciar OAuth: ${err.message}` });
      }
    });
  }

  disconnect() {
    this._accessToken = null;
    this._tokenClient = null;
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
