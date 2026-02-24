// frontend/src/screen-framework/input/adapters/GamepadAdapter.js

const BUTTON_MAP = {
  0:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // A
  1:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // B
  2:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // X
  3:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // Y
  4:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // LB
  5:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // RB
  8:  { key: 'Escape',     action: 'escape',   payload: {},                        repeats: false }, // Select
  9:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // Start
  12: { key: 'ArrowUp',    action: 'navigate',  payload: { direction: 'up' },      repeats: true },
  13: { key: 'ArrowDown',  action: 'navigate',  payload: { direction: 'down' },    repeats: true },
  14: { key: 'ArrowLeft',  action: 'navigate',  payload: { direction: 'left' },    repeats: true },
  15: { key: 'ArrowRight', action: 'navigate',  payload: { direction: 'right' },   repeats: true },
};

const STICK_DEADZONE = 0.5;
const REPEAT_INITIAL_MS = 400;
const REPEAT_INTERVAL_MS = 120;

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
    this._prevButtons = {};
    this._prevStick = {};
    this._repeatTimers = {};
    this._onConnected = null;
    this._onDisconnected = null;
  }

  attach() {
    this._onConnected = () => this._startPolling();
    this._onDisconnected = (e) => this._handleDisconnect(e);

    window.addEventListener('gamepadconnected', this._onConnected);
    window.addEventListener('gamepaddisconnected', this._onDisconnected);

    // If a gamepad is already connected, start polling immediately
    if (this._findGamepad()) {
      this._startPolling();
    }
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
  }

  _findGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.preferredIndex !== null && gamepads[this.preferredIndex]) {
      return gamepads[this.preferredIndex];
    }
    for (const gp of gamepads) {
      if (gp) return gp;
    }
    return null;
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
    this._clearAllRepeats();
    this._prevButtons = {};
    this._prevStick = {};

    // If we still have another gamepad, keep polling; otherwise stop
    if (!this._findGamepad()) {
      this._stopPolling();
    }
  }

  _pollGamepad() {
    const gp = this._findGamepad();
    if (!gp) return;

    // --- Buttons ---
    for (const [indexStr, mapping] of Object.entries(BUTTON_MAP)) {
      const idx = Number(indexStr);
      const pressed = gp.buttons[idx] && gp.buttons[idx].pressed;
      const wasPressed = !!this._prevButtons[idx];

      if (pressed && !wasPressed) {
        this._emit(mapping);
        if (mapping.repeats) {
          this._startRepeat(idx, mapping);
        }
      } else if (!pressed && wasPressed) {
        this._stopRepeat(idx);
      }

      this._prevButtons[idx] = pressed;
    }

    // --- Left analog stick ---
    for (const dir of STICK_DIRECTIONS) {
      const value = gp.axes[dir.axis] || 0;
      const active = dir.threshold < 0 ? value < dir.threshold : value > dir.threshold;
      const stickKey = `stick_${dir.key}`;
      const wasActive = !!this._prevStick[stickKey];

      if (active && !wasActive) {
        this._emit(dir);
        this._startRepeat(stickKey, dir);
      } else if (!active && wasActive) {
        this._stopRepeat(stickKey);
      }

      this._prevStick[stickKey] = active;
    }
  }

  _emit(mapping) {
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
