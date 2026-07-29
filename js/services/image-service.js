import CONFIG from '../config.js';
import { generateId, getTimestamp } from '../utils.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const HEIC_TYPES = ['image/heic', 'image/heif'];
const STORAGE_OVERHEAD_BYTES = 256 * 1024;
const TRANSPARENT_DIRECT_MAX_SIZE = 4 * 1024 * 1024;
const TRANSPARENT_DIRECT_MAX_LONG_EDGE = 2400;
const TRANSPARENT_WEBP_INITIAL_QUALITY = 0.90;
const TRANSPARENT_WEBP_MIN_QUALITY = 0.78;
const TRANSPARENT_WEBP_QUALITY_STEP = 0.04;
const TRANSPARENT_OPTIMIZATION_ERROR =
  'No pudimos optimizar esta imagen. Prueba con una imagen de menor tamaño.';

export function validateImage(file) {
  if (!file) {
    return { valid: false, code: 'IMAGE_FILE_MISSING', error: 'No se seleccion\u00f3 ning\u00fan archivo.' };
  }
  const fileName = (file.name || '').toLowerCase();
  if (HEIC_TYPES.includes(file.type) || /\.(heic|heif)$/.test(fileName)) {
    return {
      valid: false,
      code: 'IMAGE_HEIC_UNSUPPORTED',
      error: 'HEIC/HEIF no es compatible. Convierte la imagen a JPEG, PNG o WebP antes de subirla.'
    };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    const type = file.type || 'desconocido';
    return {
      valid: false,
      code: 'IMAGE_TYPE_UNSUPPORTED',
      error: `Formato no permitido: ${type}. Use JPEG, PNG o WebP.`
    };
  }
  if (file.size > CONFIG.MAX_SOURCE_IMAGE_SIZE) {
    const maxMB = CONFIG.MAX_SOURCE_IMAGE_SIZE / (1024 * 1024);
    return {
      valid: false,
      code: 'IMAGE_SOURCE_TOO_LARGE',
      error: `La imagen supera el tama\u00f1o m\u00e1ximo de ${maxMB} MB.`
    };
  }
  return { valid: true, code: null, error: null };
}

export async function optimizeImage(file) {
  const validation = validateImage(file);
  if (!validation.valid) throw _imageError(validation.code, validation.error);

  let decoded = null;
  let canvas = null;

  try {
    decoded = await _decodeImage(file);
    const initialSize = _fitWithin(decoded.width, decoded.height, CONFIG.MAX_IMAGE_DIMENSION);
    canvas = document.createElement('canvas');

    let width = initialSize.width;
    let height = initialSize.height;
    let bestResult = null;
    let attempts = 0;

    _drawToCanvas(canvas, decoded.source, width, height);
    if (_hasTransparency(canvas)) {
      return await _optimizeTransparentImage(file, canvas, decoded, initialSize);
    }

    for (let dimensionAttempt = 0; dimensionAttempt <= CONFIG.MAX_IMAGE_DIMENSION_REDUCTIONS; dimensionAttempt += 1) {
      if (dimensionAttempt > 0) {
        _drawToCanvas(canvas, decoded.source, width, height);
      }
      let smallestAtCurrentDimensions = null;

      for (const quality of _qualitySteps()) {
        const blob = await _encodeCanvas(canvas, 'image/webp', quality);
        attempts += 1;
        if (blob.type !== 'image/webp') {
          throw _imageError(
            'IMAGE_WEBP_UNSUPPORTED',
            'Este navegador no pudo generar la imagen en formato WebP.'
          );
        }
        const candidate = { blob, width, height, quality };
        bestResult = _smallerResult(bestResult, blob, width, height, quality);
        smallestAtCurrentDimensions = _smallerResult(
          smallestAtCurrentDimensions,
          blob,
          width,
          height,
          quality
        );

        if (blob.size <= CONFIG.IMAGE_TARGET_SIZE) {
          return _optimizationResult(
            file,
            _preferOriginalWhenLighter(file, decoded, candidate),
            attempts
          );
        }
      }

      if (dimensionAttempt === CONFIG.MAX_IMAGE_DIMENSION_REDUCTIONS) break;

      const reduction = _dimensionReduction(
        smallestAtCurrentDimensions?.blob.size || bestResult.blob.size
      );
      const nextWidth = Math.max(1, Math.floor(width * reduction));
      const nextHeight = Math.max(1, Math.floor(height * reduction));
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
    }

    if (!bestResult) {
      throw _imageError('IMAGE_ENCODE_FAILED', 'No se pudo generar la imagen optimizada.');
    }
    return _optimizationResult(
      file,
      _preferOriginalWhenLighter(file, decoded, bestResult),
      attempts
    );
  } catch (err) {
    if (err && err.code) throw err;
    throw _imageError(
      'IMAGE_PROCESSING_FAILED',
      `No se pudo procesar la imagen. El archivo podría estar corrupto. ${err?.message || ''}`.trim()
    );
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    if (decoded) decoded.cleanup();
  }
}

async function _optimizeTransparentImage(file, canvas, decoded, initialSize) {
  const originalLongEdge = Math.max(decoded.width, decoded.height);

  if (
    file.type === 'image/png'
    && file.size <= TRANSPARENT_DIRECT_MAX_SIZE
    && originalLongEdge <= TRANSPARENT_DIRECT_MAX_LONG_EDGE
  ) {
    return _optimizationResult(file, {
      blob: file,
      width: decoded.width,
      height: decoded.height,
      quality: undefined
    }, 0);
  }

  let attempts = 0;
  const candidates = [];
  const pngBlob = await _encodeCanvas(canvas, 'image/png');
  attempts += 1;
  if (pngBlob.type === 'image/png') {
    candidates.push({
      blob: pngBlob,
      width: initialSize.width,
      height: initialSize.height,
      quality: undefined
    });
  }

  for (const quality of _transparentWebpQualitySteps()) {
    const webpBlob = await _encodeCanvas(canvas, 'image/webp', quality);
    attempts += 1;
    if (webpBlob.type === 'image/webp') {
      candidates.push({
        blob: webpBlob,
        width: initialSize.width,
        height: initialSize.height,
        quality
      });
    }
  }

  const bestCandidate = candidates.reduce((best, candidate) => (
    !best || candidate.blob.size < best.blob.size ? candidate : best
  ), null);
  const mustReduceExtremeDimensions =
    originalLongEdge > TRANSPARENT_DIRECT_MAX_LONG_EDGE;

  if (
    !bestCandidate
    || (!mustReduceExtremeDimensions && bestCandidate.blob.size >= file.size)
  ) {
    throw _imageError(
      'IMAGE_TRANSPARENT_OPTIMIZATION_FAILED',
      TRANSPARENT_OPTIMIZATION_ERROR
    );
  }

  return _optimizationResult(file, bestCandidate, attempts);
}

export async function ensureImageStorageCapacity(blobSize) {
  if (
    typeof navigator === 'undefined'
    || !navigator.storage
    || typeof navigator.storage.estimate !== 'function'
  ) {
    return { checked: false };
  }

  let estimate;
  try {
    estimate = await navigator.storage.estimate();
  } catch (_) {
    return { checked: false };
  }

  if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) {
    return { checked: false };
  }

  const available = Math.max(0, estimate.quota - estimate.usage);
  const required = blobSize + Math.max(STORAGE_OVERHEAD_BYTES, Math.ceil(blobSize * 0.1));
  if (available < required) {
    throw _quotaError();
  }
  return { checked: true, available, required };
}

async function _decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (!bitmap.width || !bitmap.height) throw new Error('Dimensiones inválidas.');
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close()
      };
    } catch (_) {
      // Algunos navegadores no aceptan imageOrientation; el fallback también
      // respeta la orientación EXIF al decodificar mediante HTMLImageElement.
    }
  }

  if (typeof Image === 'undefined') {
    throw _imageError('IMAGE_DECODE_FAILED', 'Este navegador no pudo decodificar la imagen.');
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const releaseUrl = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };

    image.onload = () => {
      if (settled) return;
      settled = true;
      releaseUrl();
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        reject(_imageError('IMAGE_DECODE_FAILED', 'La imagen no tiene dimensiones válidas.'));
        return;
      }
      resolve({
        source: image,
        width,
        height,
        cleanup: () => {
          image.onload = null;
          image.onerror = null;
          image.src = '';
        }
      });
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      releaseUrl();
      reject(_imageError(
        'IMAGE_DECODE_FAILED',
        'No se pudo abrir la imagen. El archivo podría estar corrupto.'
      ));
    };
    image.src = objectUrl;
  });
}

function _fitWithin(width, height, maxDimension) {
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

function _drawToCanvas(canvas, source, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw _imageError('IMAGE_CANVAS_UNAVAILABLE', 'No se pudo preparar la imagen.');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
}

function _encodeCanvas(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(_imageError('IMAGE_ENCODE_FAILED', 'No se pudo generar la imagen optimizada.'));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

function _qualitySteps() {
  const qualities = [];
  for (
    let quality = CONFIG.IMAGE_QUALITY;
    quality >= CONFIG.MIN_IMAGE_QUALITY - 0.001;
    quality -= CONFIG.IMAGE_QUALITY_STEP
  ) {
    qualities.push(Number(Math.max(CONFIG.MIN_IMAGE_QUALITY, quality).toFixed(2)));
  }
  if (qualities[qualities.length - 1] !== CONFIG.MIN_IMAGE_QUALITY) {
    qualities.push(CONFIG.MIN_IMAGE_QUALITY);
  }
  return qualities;
}

function _dimensionReduction(blobSize) {
  const targetRatio = Math.sqrt(CONFIG.IMAGE_TARGET_SIZE / Math.max(1, blobSize)) * 0.95;
  return Math.max(0.72, Math.min(0.88, targetRatio));
}

function _transparentWebpQualitySteps() {
  const qualities = [];
  for (
    let quality = TRANSPARENT_WEBP_INITIAL_QUALITY;
    quality >= TRANSPARENT_WEBP_MIN_QUALITY - 0.001;
    quality -= TRANSPARENT_WEBP_QUALITY_STEP
  ) {
    qualities.push(Number(Math.max(TRANSPARENT_WEBP_MIN_QUALITY, quality).toFixed(2)));
  }
  return qualities;
}

function _smallerResult(current, blob, width, height, quality) {
  if (!current || blob.size < current.blob.size) {
    return { blob, width, height, quality };
  }
  return current;
}

function _preferOriginalWhenLighter(file, decoded, processed) {
  const originalDimensionsAreSafe =
    Math.max(decoded.width, decoded.height) <= CONFIG.MAX_IMAGE_DIMENSION;
  if (originalDimensionsAreSafe && file.size <= processed.blob.size) {
    return {
      blob: file,
      width: decoded.width,
      height: decoded.height,
      quality: undefined
    };
  }
  return processed;
}

function _optimizationResult(file, result, attempts) {
  return {
    blob: result.blob,
    mimeType: result.blob.type,
    width: result.width,
    height: result.height,
    originalSize: file.size,
    optimizedSize: result.blob.size,
    quality: result.quality,
    attempts
  };
}

function _hasTransparency(canvas) {
  try {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch (err) {
    console.warn('No se pudo analizar la transparencia, se asume opaca:', err);
    return false;
  }
}

export function createImageRecord(projectId, blob, mimeType, width, height, fileSize) {
  return {
    imageId: generateId(),
    projectId,
    mimeType,
    width,
    height,
    fileSize,
    data: blob,
    createdAt: getTimestamp(),
    updatedAt: getTimestamp(),
    localStatus: 'optimized',
    cloudFileId: null,
    cloudStatus: 'local'
  };
}

function _imageError(code, message) {
  const error = new Error(message);
  error.name = 'ImageProcessingError';
  error.code = code;
  return error;
}

function _quotaError() {
  const error = new Error(
    'No hay espacio local suficiente para guardar esta imagen. Libera espacio del navegador e inténtalo nuevamente.'
  );
  error.name = 'QuotaExceededError';
  error.code = 'STORAGE_QUOTA_EXCEEDED';
  return error;
}
