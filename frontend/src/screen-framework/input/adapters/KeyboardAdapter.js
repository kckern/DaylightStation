import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'KeyboardAdapter' });
  return _logger;
}

const KEY_MAP = {
  ArrowUp:    { action: 'navigate', payload: { direction: 'up' } },
  ArrowDown:  { action: 'navigate', payload: { direction: 'down' } },
  ArrowLeft:  { action: 'navigate', payload: { direction: 'left' } },
  ArrowRight: { action: 'navigate', payload: { direction: 'right' } },
  Enter:      { action: 'select',   payload: {} },
  Escape:     { action: 'escape',   payload: {} },
};

export class KeyboardAdapter {
  constructor(actionBus) {
    this.actionBus = actionBus;
    this.handler = null;
  }

  attach() {
    logger().info('keyboard.attach', {});
    this.handler = (event) => {
      if (event.__gamepadSynthetic) return;
      const mapped = KEY_MAP[event.key];
      if (mapped) {
        logger().debug('keyboard.key', { key: event.key, action: mapped.action });
        this.actionBus.emit(mapped.action, mapped.payload);
      } else {
        logger().debug('keyboard.unmapped', { key: event.key });
      }
    };
    window.addEventListener('keydown', this.handler);
  }

  destroy() {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
    logger().debug('keyboard.destroy', {});
  }
}
