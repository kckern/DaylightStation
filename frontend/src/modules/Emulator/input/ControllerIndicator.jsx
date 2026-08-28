import React from 'react';
import { faultLabel, ariaLabelFor } from './controllerIndicatorLabels.js';
import './ControllerIndicator.scss';

/**
 * ControllerIndicator — the top-right hardware-style indicator for controller health.
 *
 * REPLACES InputActivityLED, whose two dots both showed *activity* (browser saw
 * input / core consumed input). That pair was redundant whenever things worked and
 * signalled failure only by a dot FAILING to light — an absence, which is close to
 * invisible. On 2026-08-15 input was dead for an entire evening with the indicator
 * dutifully showing the fault the whole time.
 *
 * Semantics now match what a person actually expects, and failure APPEARS:
 *
 *   no-pad    ○ no pad          · keyboard works
 *   ok        ● connected       ●҉ activity
 *   healing   ◐ reconnecting…
 *   fault     ▲ INPUT NOT REACHING GAME   [Fix]
 *
 * The browser-vs-core differential that caught the original bug is preserved — it
 * now drives the fault state rather than being rendered as two agreeing dots.
 *
 * @param {object} props
 * @param {'ok'|'no-pad'|'healing'|'fault'} props.state supervisor state
 * @param {string|null} [props.fault] fault kind, when state === 'fault'
 * @param {boolean} [props.connected] a pad is present
 * @param {boolean} [props.activity] the core consumed input just now
 * @param {() => void} [props.onFix] invoked by the Fix action
 */
export function ControllerIndicator({
  state = 'ok',
  fault = null,
  connected = false,
  activity = false,
  onFix,
}) {
  const isFault = state === 'fault';
  const isHealing = state === 'healing';

  return (
    <div
      className={`emulator-controller-ind is-${state}`}
      role="status"
      aria-live={isFault ? 'assertive' : 'off'}
      aria-label={ariaLabelFor(state, fault)}
      data-state={state}
      data-fault={fault || ''}
    >
      {isFault ? (
        <>
          <span className="emulator-controller-ind__glyph" aria-hidden="true">▲</span>
          <span className="emulator-controller-ind__label">{faultLabel(fault)}</span>
          {onFix && (
            <button
              type="button"
              className="emulator-controller-ind__fix"
              // Touch kiosk: pointerDown for immediate response (see FitnessApp note).
              onPointerDown={(e) => { e.preventDefault(); onFix(); }}
            >
              Fix
            </button>
          )}
        </>
      ) : isHealing ? (
        <>
          <span className="emulator-controller-ind__glyph is-spin" aria-hidden="true">◐</span>
          <span className="emulator-controller-ind__label">Reconnecting…</span>
        </>
      ) : (
        <>
          <span
            className={`emulator-controller-ind__dot is-link${connected ? ' is-on' : ''}`}
            title={connected ? 'Controller connected' : 'No controller — keyboard works'}
          />
          <span
            className={`emulator-controller-ind__dot is-activity${activity ? ' is-on' : ''}`}
            title="Input reaching the game"
          />
          {!connected && <span className="emulator-controller-ind__hint">keyboard</span>}
        </>
      )}
    </div>
  );
}

export default ControllerIndicator;
