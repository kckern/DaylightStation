// frontend/src/screen-framework/input/adapters/NumpadAdapter.js
import { DaylightAPI } from '../../../lib/api.mjs';
import { translateAction, translateSecondary } from '../actionMap.js';

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
        console.warn(`NumpadAdapter: failed to fetch keymap for "${this.keyboardId}"`, err);
        this.keymap = {};
      }
    }

    this.handler = (event) => {
      if (!this.keymap) return;
      const entry = this.keymap[event.key];
      if (!entry) return;

      const result = translateAction(entry.function, entry.params);
      if (result) {
        this.actionBus.emit(result.action, result.payload);
        return;
      }

      if (entry.secondary) {
        const fallback = translateSecondary(entry.secondary);
        if (fallback) {
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
  }
}
