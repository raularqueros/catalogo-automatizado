import CONFIG from '../config.js';
import { generateId, getTimestamp } from '../utils.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImage(file) {
  if (!file) {
    return { valid: false, error: 'No se seleccion\u00f3 ning\u00fan archivo.' };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    const type = file.type || 'desconocido';
    return { valid: false, error: `Formato no permitido: ${type}. Use JPEG, PNG o WebP.` };
  }
  if (file.size > CONFIG.MAX_SOURCE_IMAGE_SIZE) {
    const maxMB = CONFIG.MAX_SOURCE_IMAGE_SIZE / (1024 * 1024);
    return { valid: false, error: `La imagen supera el tama\u00f1o m\u00e1ximo de ${maxMB} MB.` };
  }
  return { valid: true, error: null };
}

export function optimizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let { width, height } = img;
        const maxDim = CONFIG.MAX_IMAGE_DIMENSION;

        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const supportsWebP = canvas.toDataURL('image/webp').startsWith('data:image/webp');
        const hasAlpha = _hasTransparency(canvas);

        let mimeType;
        if (hasAlpha) {
          mimeType = 'image/png';
        } else if (supportsWebP) {
          mimeType = 'image/webp';
        } else {
          mimeType = 'image/jpeg';
        }

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Error al generar la imagen optimizada.'));
            return;
          }
          resolve({
            blob,
            mimeType,
            width,
            height,
            originalSize: file.size,
            optimizedSize: blob.size
          });
        }, mimeType, CONFIG.IMAGE_QUALITY);
      } catch (err) {
        reject(new Error(`Error durante la optimizaci\u00f3n: ${err.message}`));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo cargar la imagen. El archivo podr\u00eda estar corrupto.'));
    };

    img.src = url;
  });
}

/**
 * Escanea el canal alfa del canvas en busca de transparencia.
 * Usa muestreo progresivo con salida temprana: analiza el primer píxel
 * y, si es opaco, continúa con el resto usando un stride adaptativo.
 * Esto evita escanear píxeles innecesariamente en imágenes sin transparencia.
 */
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
