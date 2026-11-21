// IEmulatorInput — port: drive the running game's controller by semantic
// RetroPad button, whatever emulator runs it.
//
// Buttons are the vendor-free RetroPad names in RETROPAD_BUTTONS. A press
// holds the button until its release; releaseAll lets go of everything this
// input pressed (focus loss, pause, unmount). isReady says whether the game
// can take input now. Implementations live in ../adapters/ (EmulatorJS:
// EmulatorJSInputAdapter).

/** The semantic RetroPad buttons an IEmulatorInput accepts. */
export const RETROPAD_BUTTONS = Object.freeze([
  'up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select',
]);

/** @interface IEmulatorInput */
export class IEmulatorInput {
  /** @param {string} button a RETROPAD_BUTTONS name @returns {boolean} delivered */
  press(button) { throw new Error('IEmulatorInput.press must be implemented'); }

  /** @param {string} button @returns {boolean} delivered */
  release(button) { throw new Error('IEmulatorInput.release must be implemented'); }

  /** Let go of every button this input holds. @returns {number} buttons released */
  releaseAll() { throw new Error('IEmulatorInput.releaseAll must be implemented'); }

  /** @returns {boolean} the game can take input now */
  isReady() { throw new Error('IEmulatorInput.isReady must be implemented'); }
}

export function isEmulatorInput(obj) {
  return !!obj &&
    typeof obj.press === 'function' &&
    typeof obj.release === 'function' &&
    typeof obj.releaseAll === 'function' &&
    typeof obj.isReady === 'function';
}
