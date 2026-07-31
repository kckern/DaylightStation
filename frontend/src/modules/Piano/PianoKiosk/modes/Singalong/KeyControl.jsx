// KeyControl.jsx — karaoke key-change stepper for the singalong chrome:
// [−] [Key/+n] [+], discrete taps only (touch rule: no sliders). Owns the
// shift state itself so the host can remount it per song (key={contentId})
// and every track starts in its natural key. The value face doubles as a
// tap-to-reset button and lights up (is-on) whenever the key is shifted.
import { useState, useEffect } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';
import useKeyShift from './useKeyShift.js';
import { clampKeyShift, keyShiftLabel, KEY_SHIFT_MIN, KEY_SHIFT_MAX } from './keyShift.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'karaoke-keyshift' });
  return _logger;
}

export default function KeyControl({ mediaEl, className = '', apiRef }) {
  const [shift, setShift] = useState(0);
  // true = the stretch engine failed for this song; the audio was rerouted
  // dry, so the stepper must grey out rather than pretend to work.
  const engineFailed = useKeyShift(mediaEl, shift);
  // Tap intent is logged here, upstream of the hook — if the audio chain dies
  // silently we still see exactly what the user asked for and when.
  const step = (delta) => {
    const next = clampKeyShift(shift + delta);
    logger().info('keyshift.tap', { from: shift, to: next, hasEl: Boolean(mediaEl) });
    setShift(next);
  };
  const reset = () => {
    logger().info('keyshift.tap', { from: shift, to: 0, reset: true, hasEl: Boolean(mediaEl) });
    setShift(0);
  };
  // Imperative surface for the karaoke keyboard shortcuts (ArrowUp/ArrowDown):
  // the same step/reset the buttons call, so clamping, keyshift.tap logging,
  // and the engine-failed gate behave identically for keys and taps. No dep
  // array on purpose — reassigning every render keeps the closures fresh.
  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = { step, reset, engineFailed };
    return () => { apiRef.current = null; };
  });
  return (
    <div
      className={['piano-keyctl', className].filter(Boolean).join(' ')}
      role="group"
      aria-label="Key change"
      data-testid="key-control"
    >
      <TransportButton
        icon="minus"
        ariaLabel="Lower key"
        className="piano-keyctl__btn"
        disabled={engineFailed || shift <= KEY_SHIFT_MIN}
        onPress={() => step(-1)}
      />
      <button
        type="button"
        className={`piano-keyctl__value${shift !== 0 ? ' is-on' : ''}`}
        aria-label="Reset key"
        disabled={engineFailed}
        onClick={reset}
      >
        {keyShiftLabel(shift)}
      </button>
      <TransportButton
        icon="plus"
        ariaLabel="Raise key"
        className="piano-keyctl__btn"
        disabled={engineFailed || shift >= KEY_SHIFT_MAX}
        onPress={() => step(1)}
      />
    </div>
  );
}
