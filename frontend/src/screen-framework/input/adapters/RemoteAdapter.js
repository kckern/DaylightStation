// frontend/src/screen-framework/input/adapters/RemoteAdapter.js
import { DaylightAPI } from '../../../lib/api.mjs';
import { translateAction, translateSecondary } from '../actionMap.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'RemoteAdapter' });
  return _logger;
}

const NAV_KEYS = {
  ArrowUp:    { action: 'navigate', payload: { direction: 'up' } },
  ArrowDown:  { action: 'navigate', payload: { direction: 'down' } },
  ArrowLeft:  { action: 'navigate', payload: { direction: 'left' } },
  ArrowRight: { action: 'navigate', payload: { direction: 'right' } },
  Enter:      { action: 'select',   payload: {} },
  Escape:     { action: 'escape',   payload: {} },
};

export class RemoteAdapter {
  constructor(actionBus, { keyboardId, fetchFn } = {}) {
    this.actionBus = actionBus;
    this.keyboardId = keyboardId;
    this.fetchFn = fetchFn || DaylightAPI;
    this.keymap = null;
    this.handler = null;
  }

  async attach() {
    if (this.keyboardId) {
      try {
        this.keymap = await this.fetchFn(`/api/v1/home/keyboard/${this.keyboardId}`);
      } catch (err) {
        logger().warn('remote.keymap-fetch-failed', { keyboardId: this.keyboardId, error: err.message });
        this.keymap = {};
      }
    }

    logger().info('remote.attach', { keyboardId: this.keyboardId, keymapSize: this.keymap ? Object.keys(this.keymap).length : 0 });

    this.handler = (event) => {
      // Keymap entries take priority
      if (this.keymap) {
        const entry = this.keymap[event.key];
        if (entry) {
          const result = translateAction(entry.function, entry.params);
          if (result) {
            logger().debug('remote.key', { key: event.key, action: result.action, source: 'keymap' });
            this.actionBus.emit(result.action, result.payload);
            return;
          }
          if (entry.secondary) {
            const fallback = translateSecondary(entry.secondary);
            if (fallback) {
              logger().debug('remote.key', { key: event.key, action: fallback.action, source: 'secondary' });
              this.actionBus.emit(fallback.action, fallback.payload);
              return;
            }
          }
        }
      }

      // Fall through to built-in navigation keys
      const nav = NAV_KEYS[event.key];
      if (nav) {
        logger().debug('remote.key', { key: event.key, action: nav.action, source: 'nav' });
        this.actionBus.emit(nav.action, nav.payload);
      }
    };
    window.addEventListener('keydown', this.handler);
  }

  destroy() {
    if (this.handler) {
      window.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
    this.keymap = null;
    logger().debug('remote.destroy', {});
  }
}
