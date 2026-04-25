// frontend/src/screen-framework/input/adapters/GamepadAdapter.js
import getLogger from '../../../lib/logging/Logger.js';
import { getActiveGamepads } from '../gamepadFiltering.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'GamepadAdapter' });
  return _logger;
}

// Button indices follow W3C Standard Gamepad mapping. The 8Bitdo SN30 Pro
// reports `mapping: ""` (non-standard) on Shield TV but empirically uses
// Standard indices for A (0) and the d-pad (12-15) — verified via
// gamepad.button-pressed logs. See plan: gamepad-input-reliability.
const BUTTON_MAP = {
  // Face buttons all confirm (arcade-style any-button-selects).
  0:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // A
  1:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // B
  2:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // X
  3:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // Y
  // Back: L1 + R2 + Select. Enter: R1 + L2 + Start.
  4:  { key: 'Escape',     action: 'escape',   payload: {},                        repeats: false }, // L1 — back
  5:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // R1
  6:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // L2
  7:  { key: 'Escape',     action: 'escape',   payload: {},                        repeats: false }, // R2 — back
  8:  { key: 'Escape',     action: 'escape',   payload: {},                        repeats: false }, // Select — back
  9:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // Start
  12: { key: 'ArrowUp',    action: 'navigate',  payload: { direction: 'up' },      repeats: true },
  13: { key: 'ArrowDown',  action: 'navigate',  payload: { direction: 'down' },    repeats: true },
  14: { key: 'ArrowLeft',  action: 'navigate',  payload: { direction: 'left' },    repeats: true },
  15: { key: 'ArrowRight', action: 'navigate',  payload: { direction: 'right' },   repeats: true },
};

const STICK_DEADZONE = 0.5;
const REPEAT_INITIAL_MS = 400;
const REPEAT_INTERVAL_MS = 120;

// When the same gamepad id reports the same button transition within this
// window we treat it as a phantom enumeration of one device, not two real
// users pressing the same button. Two distinct users can't realistically
// hit the same button simultaneously inside ~50ms.
const SAME_ID_DUPLICATE_WINDOW_MS = 50;

const STICK_DIRECTIONS = [
  { axis: 0, threshold: -STICK_DEADZONE, key: 'ArrowLeft',  action: 'navigate', payload: { direction: 'left' } },
  { axis: 0, threshold:  STICK_DEADZONE, key: 'ArrowRight', action: 'navigate', payload: { direction: 'right' } },
  { axis: 1, threshold: -STICK_DEADZONE, key: 'ArrowUp',    action: 'navigate', payload: { direction: 'up' } },
  { axis: 1, threshold:  STICK_DEADZONE, key: 'ArrowDown',  action: 'navigate', payload: { direction: 'down' } },
];

export class GamepadAdapter {
  constructor(actionBus, { gamepadIndex = null } = {}) {
    this.actionBus = actionBus;
    this.preferredIndex = gamepadIndex;
    this._rafId = null;
    // All per-gamepad state keyed by gp.index (unique across navigator slots).
    // _seeded[idx] = true once we've recorded the initial button state for
    // that gamepad — held buttons at observation time do NOT register as
    // fresh presses.
    this._prevButtons = {};   // { [gpIndex]: { [btnIdx|`unmapped_${i}`]: bool } }
    this._prevStick = {};     // { [gpIndex]: { [stickKey]: bool } }
    this._seeded = {};        // { [gpIndex]: true }
    // Repeat timers keyed by `${gpIndex}__${key}` so two controllers' holds
    // don't trample each other.
    this._repeatTimers = {};
    // Suppresses phantom-enumeration double-fires: a press from the same id
    // within the dedupe window is dropped. Keyed by `${gpId}__${key}`.
    this._lastFireById = {};
    this._onConnected = null;
    this._onDisconnected = null;
  }

  attach() {
    this._onConnected = (e) => {
      const gp = e.gamepad;
      logger().info('gamepad.connected', {
        index: gp.index, id: gp.id, buttons: gp.buttons.length, axes: gp.axes.length, mapping: gp.mapping,
      });
      this._startPolling();
    };
    this._onDisconnected = (e) => {
      logger().info('gamepad.disconnected', { index: e.gamepad.index, id: e.gamepad.id });
      this._handleDisconnect(e);
    };

    window.addEventListener('gamepadconnected', this._onConnected);
    window.addEventListener('gamepaddisconnected', this._onDisconnected);

    // If any gamepad is already connected, start polling immediately
    const existing = getActiveGamepads();
    if (existing.length > 0) {
      for (const gp of existing) {
        logger().info('gamepad.already-connected', {
          index: gp.index, id: gp.id, buttons: gp.buttons.length, axes: gp.axes.length, mapping: gp.mapping,
        });
      }
      this._startPolling();
    }
    logger().debug('gamepad.attach', { preferredIndex: this.preferredIndex });
  }

  destroy() {
    if (this._onConnected) {
      window.removeEventListener('gamepadconnected', this._onConnected);
      this._onConnected = null;
    }
    if (this._onDisconnected) {
      window.removeEventListener('gamepaddisconnected', this._onDisconnected);
      this._onDisconnected = null;
    }
    this._stopPolling();
    this._clearAllRepeats();
    this._prevButtons = {};
    this._prevStick = {};
    this._seeded = {};
    this._lastFireById = {};
  }

  _hasAnyGamepad() {
    return getActiveGamepads().length > 0;
  }

  _startPolling() {
    if (this._rafId !== null) return;
    const poll = () => {
      this._pollGamepad();
      this._rafId = requestAnimationFrame(poll);
    };
    this._rafId = requestAnimationFrame(poll);
  }

  _stopPolling() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _handleDisconnect(e) {
    // Drop state for the disconnected gamepad only — leave others' state intact.
    const idx = e?.gamepad?.index;
    if (idx != null) {
      delete this._prevButtons[idx];
      delete this._prevStick[idx];
      delete this._seeded[idx];
      // Stop any repeats this gamepad owned.
      for (const key of Object.keys(this._repeatTimers)) {
        if (key.startsWith(`${idx}__`)) this._stopRepeat(key);
      }
    }
    if (!this._hasAnyGamepad()) {
      this._clearAllRepeats();
      this._stopPolling();
    }
  }

  _pollGamepad() {
    const gamepads = getActiveGamepads();
    for (const gp of gamepads) {
      this._pollOne(gp);
    }
  }

  _pollOne(gp) {
    const gpIdx = gp.index;

    // Seed from live state on first observation: any held button at mount
    // does NOT register as a fresh press until released and pressed again.
    if (!this._seeded[gpIdx]) {
      const seedButtons = {};
      for (let i = 0; i < gp.buttons.length; i++) {
        seedButtons[i] = !!gp.buttons[i]?.pressed;
        seedButtons[`unmapped_${i}`] = !!gp.buttons[i]?.pressed;
      }
      this._prevButtons[gpIdx] = seedButtons;
      const seedStick = {};
      for (const dir of STICK_DIRECTIONS) {
        const value = gp.axes[dir.axis] || 0;
        const active = dir.threshold < 0 ? value < dir.threshold : value > dir.threshold;
        seedStick[`stick_${dir.key}`] = active;
      }
      this._prevStick[gpIdx] = seedStick;
      this._seeded[gpIdx] = true;
      return; // skip edge detection for this frame
    }

    const prev = this._prevButtons[gpIdx];
    const prevStick = this._prevStick[gpIdx];

    // --- Mapped buttons ---
    for (const [indexStr, mapping] of Object.entries(BUTTON_MAP)) {
      const idx = Number(indexStr);
      const pressed = gp.buttons[idx] && gp.buttons[idx].pressed;
      const wasPressed = !!prev[idx];
      const repeatKey = `${gpIdx}__btn${idx}`;

      if (pressed && !wasPressed) {
        if (this._claimFire(gp.id, `btn${idx}`)) {
          this._emit(mapping, idx);
          if (mapping.repeats) this._startRepeat(repeatKey, mapping);
        }
      } else if (!pressed && wasPressed) {
        this._stopRepeat(repeatKey);
      }

      prev[idx] = pressed;
    }

    // --- Unmapped buttons (log for diagnostics) ---
    for (let idx = 0; idx < gp.buttons.length; idx++) {
      if (BUTTON_MAP[idx]) continue; // already handled
      const pressed = gp.buttons[idx] && gp.buttons[idx].pressed;
      const key = `unmapped_${idx}`;
      const wasPressed = !!prev[key];
      if (pressed && !wasPressed && this._claimFire(gp.id, key)) {
        logger().debug('gamepad.button-pressed', {
          buttonIndex: idx, mapped: false, gamepadId: gp.id,
        });
      }
      prev[key] = pressed;
    }

    // --- Left analog stick ---
    for (const dir of STICK_DIRECTIONS) {
      const value = gp.axes[dir.axis] || 0;
      const active = dir.threshold < 0 ? value < dir.threshold : value > dir.threshold;
      const stickKey = `stick_${dir.key}`;
      const wasActive = !!prevStick[stickKey];
      const repeatKey = `${gpIdx}__${stickKey}`;

      if (active && !wasActive) {
        if (this._claimFire(gp.id, stickKey)) {
          this._emit(dir);
          this._startRepeat(repeatKey, dir);
        }
      } else if (!active && wasActive) {
        this._stopRepeat(repeatKey);
      }

      prevStick[stickKey] = active;
    }
  }

  /**
   * Phantom-enumeration suppression: returns true if this (id, key) hasn't
   * fired within the dedupe window. The same physical 8Bitdo enumerated at
   * two indices on Shield TV mirrors button state — both indices observe
   * the press in the same frame and would fire twice without this guard.
   */
  _claimFire(gamepadId, key) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const fireKey = `${gamepadId}__${key}`;
    const lastFire = this._lastFireById[fireKey] || 0;
    if (now - lastFire < SAME_ID_DUPLICATE_WINDOW_MS) return false;
    this._lastFireById[fireKey] = now;
    return true;
  }

  _emit(mapping, buttonIndex) {
    if (buttonIndex != null) {
      logger().debug('gamepad.button-pressed', {
        buttonIndex, mapped: true, key: mapping.key, action: mapping.action,
      });
    }

    // Emit to ActionBus for useScreenAction consumers
    this.actionBus.emit(mapping.action, mapping.payload);

    // Dispatch synthetic KeyboardEvent for direct keydown listeners (Menu.jsx, ArcadeSelector.jsx)
    const event = new KeyboardEvent('keydown', {
      key: mapping.key,
      bubbles: true,
      cancelable: true,
    });
    event.__gamepadSynthetic = true;
    window.dispatchEvent(event);
  }

  _startRepeat(id, mapping) {
    this._stopRepeat(id);
    this._repeatTimers[id] = setTimeout(() => {
      this._repeatTimers[id] = setInterval(() => {
        this._emit(mapping);
      }, REPEAT_INTERVAL_MS);
    }, REPEAT_INITIAL_MS);
  }

  _stopRepeat(id) {
    if (this._repeatTimers[id] != null) {
      clearTimeout(this._repeatTimers[id]);
      clearInterval(this._repeatTimers[id]);
      delete this._repeatTimers[id];
    }
  }

  _clearAllRepeats() {
    for (const id of Object.keys(this._repeatTimers)) {
      this._stopRepeat(id);
    }
  }
}
