// EmulatorJSInputAdapter — IEmulatorInput for EmulatorJS.
//
// EmulatorJS numbers its controls (buildEjsControls' SEMANTIC_INDEX: b 0,
// y 1, select 2, start 3, up..right 4-7, a 8, x 9, l 10, r 11) and takes input
// through its own API `gameManager.simulateInput(player, index, value)`, the
// call its keyboard, gamepad and on-screen pad handlers make. The engine wraps
// that call as `pressInput(index, value)`; this adapter is the only place that
// knows the index scheme. Each core maps the RetroPad onto its own console
// (e.g. a Genesis core takes RetroPad B/A as its B/C), so a semantic button
// means the same RetroPad position on every system.
import { IEmulatorInput } from '../ports/IEmulatorInput.js';
import { SEMANTIC_INDEX } from '../input/buildEjsControls.js';

export class EmulatorJSInputAdapter extends IEmulatorInput {
  #getEngine;
  #player;
  #held = new Set();

  /**
   * @param {object} deps
   * @param {() => object|null} deps.getEngine  the live EmulatorEngine (pressInput, isStarted)
   * @param {number} [deps.player]              EmulatorJS player slot, 0-3
   */
  constructor({ getEngine, player = 0 }) {
    super();
    this.#getEngine = getEngine;
    this.#player = player;
  }

  #send(button, value) {
    const index = SEMANTIC_INDEX[button];
    if (index === undefined) return false;
    const engine = this.#getEngine?.();
    try { return engine?.pressInput?.(index, value, this.#player) === true; } catch { return false; }
  }

  press(button) {
    const ok = this.#send(button, 1);
    if (ok) this.#held.add(button);
    return ok;
  }

  release(button) {
    this.#held.delete(button);
    return this.#send(button, 0);
  }

  releaseAll() {
    const buttons = [...this.#held];
    buttons.forEach((b) => this.release(b));
    return buttons.length;
  }

  isReady() {
    try { return this.#getEngine?.()?.isStarted?.() === true; } catch { return false; }
  }
}
