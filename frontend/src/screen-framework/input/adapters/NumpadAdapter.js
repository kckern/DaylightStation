// frontend/src/screen-framework/input/adapters/NumpadAdapter.js
import { DaylightAPI } from '../../../lib/api.mjs';
import { translateAction, translateSecondary } from '../actionMap.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'NumpadAdapter' });
  return _logger;
}

export class NumpadAdapter {
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
        logger().warn('numpad.keymap-fetch-failed', { keyboardId: this.keyboardId, error: err.message });
        this.keymap = {};
      }
    }

    logger().info('numpad.attach', { keyboardId: this.keyboardId, keymapSize: this.keymap ? Object.keys(this.keymap).length : 0 });

    this.handler = (event) => {
      if (!this.keymap) return;
      // Try event.key first ("4"), then last char of event.code ("Digit4" → "4")
      const entry = this.keymap[event.key]
        || this.keymap[event.code?.replace(/^(Digit|Numpad)/, '')]
        || null;
      if (!entry) return;

      const result = translateAction(entry.function, entry.params);
      if (result) {
        // Attach parsed secondary to playback actions for idle fallback
        if (entry.secondary && result.action === 'media:playback') {
          const sec = translateSecondary(entry.secondary);
          if (sec) result.payload.secondary = sec;
        }
        logger().debug('numpad.key', { key: event.key, action: result.action });
        this.actionBus.emit(result.action, result.payload);
        return;
      }

      if (entry.secondary) {
        const fallback = translateSecondary(entry.secondary);
        if (fallback) {
          logger().debug('numpad.key', { key: event.key, action: fallback.action, source: 'secondary' });
          this.actionBus.emit(fallback.action, fallback.payload);
        }
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
    logger().debug('numpad.destroy', {});
  }
}
