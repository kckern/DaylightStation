import React from 'react';
import './InputActivityLED.scss';

/**
 * InputActivityLED — a subtle dual "LED" on the emulator chrome that makes the
 * gamepad signal path visible at a glance:
 *
 *   ● browser  — flickers when navigator.getGamepads() reports input
 *   ● emulator — flickers when the running core actually consumed input
 *
 * Both lit together = the pad is driving the game. Browser lit while emulator
 * stays dark = input reaches the page but NOT the emulation (a corrupted
 * EmulatorJS re-init, a dead handler). Decorative + non-interactive.
 *
 * @param {object} props
 * @param {boolean} props.browserActive
 * @param {boolean} props.emulatorActive
 */
export function InputActivityLED({ browserActive = false, emulatorActive = false }) {
  return (
    <div
      className="emulator-input-led"
      role="status"
      aria-label="Gamepad input activity"
      data-browser={browserActive ? 'on' : 'off'}
      data-emulator={emulatorActive ? 'on' : 'off'}
    >
      <span
        className={`emulator-input-led__dot is-browser${browserActive ? ' is-active' : ''}`}
        title="Gamepad input seen by the browser"
      />
      <span
        className={`emulator-input-led__dot is-emulator${emulatorActive ? ' is-active' : ''}`}
        title="Input consumed by the emulator"
      />
    </div>
  );
}

export default InputActivityLED;
