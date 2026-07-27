export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function formatPrice(amount, locale = 'es-CL', currency = 'CLP') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  }).format(amount);
}

export function truncateText(text, maxLength = 80) {
  if (!text || text.length <= maxLength) return text || '';
  return text.substring(0, maxLength).trimEnd() + '\u2026';
}

export function getTimestamp() {
  return new Date().toISOString();
}

export function getDeviceId() {
  let deviceId = localStorage.getItem('_cat_deviceId');
  if (!deviceId) {
    deviceId = generateId();
    localStorage.setItem('_cat_deviceId', deviceId);
  }
  return deviceId;
}

export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
