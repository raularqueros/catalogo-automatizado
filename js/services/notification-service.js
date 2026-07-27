export class NotificationService {
  constructor(containerId = 'notification-container') {
    this._container = null;
    this._containerId = containerId;
  }

  initialize() {
    let container = document.getElementById(this._containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = this._containerId;
      container.className = 'notification-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    this._container = container;
  }

  show(message, type = 'info', duration = 4000) {
    if (!this._container) return;

    const notification = document.createElement('div');
    notification.className = `notification notification--${type}`;
    notification.textContent = message;
    notification.setAttribute('role', 'alert');

    this._container.appendChild(notification);

    requestAnimationFrame(() => {
      notification.classList.add('notification--visible');
    });

    if (duration > 0) {
      setTimeout(() => {
        this._dismiss(notification);
      }, duration);
    }
  }

  success(message) {
    this.show(message, 'success');
  }

  error(message) {
    this.show(message, 'error', 6000);
  }

  info(message) {
    this.show(message, 'info');
  }

  _dismiss(notification) {
    notification.classList.remove('notification--visible');
    notification.addEventListener('transitionend', () => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, { once: true });
  }
}
