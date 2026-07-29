const CONFIG = Object.freeze({
  APP_NAME: 'Cat\u00e1logo Automatizado',
  SCHEMA_VERSION: 1,
  DATABASE_NAME: 'CatalogoAutomatizadoDB',
  DATABASE_VERSION: 2,
  DEFAULT_PROJECT_NAME: 'Mi primer cat\u00e1logo',
  DEFAULT_CURRENCY: 'CLP',
  DEFAULT_LOCALE: 'es-CL',
  MAX_SOURCE_IMAGE_SIZE: 25 * 1024 * 1024,
  MAX_IMAGE_DIMENSION: 1600,
  IMAGE_QUALITY: 0.82,
  MIN_IMAGE_QUALITY: 0.68,
  IMAGE_TARGET_SIZE: Math.round(1.2 * 1024 * 1024),
  IMAGE_QUALITY_STEP: 0.05,
  MAX_IMAGE_DIMENSION_REDUCTIONS: 4,
  FUTURE_DRIVE_ROOT_FOLDER: 'Cat\u00e1logo Automatizado',

  // Google Drive (configurar en Google Cloud Console)
  GOOGLE_CLIENT_ID: '885890204455-pkp0tdkuj3lpurqrjacs0019ac8t6adf.apps.googleusercontent.com',
  GOOGLE_DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file',
  DRIVE_API_BASE_URL: 'https://www.googleapis.com/drive/v3',
  DRIVE_UPLOAD_BASE_URL: 'https://www.googleapis.com/upload/drive/v3',
  DRIVE_ROOT_FOLDER_NAME: 'Cat\u00e1logo Automatizado'
});

export default CONFIG;
