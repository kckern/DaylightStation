// KeyControl.jsx — karaoke key-change stepper for the singalong chrome:
// [−] [Key/+n] [+], discrete taps only (touch rule: no sliders). Owns the
// shift state itself so the host can remount it per song (key={contentId})
// and every track starts in its natural key. The value face doubles as a
// tap-to-reset button and lights up (is-on) whenever the key is shifted.
import { useState } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';
import useKeyShift from './useKeyShift.js';
import { clampKeyShift, keyShiftLabel, KEY_SHIFT_MIN, KEY_SHIFT_MAX } from './keyShift.js';

export default function KeyControl({ mediaEl, className = '' }) {
  const [shift, setShift] = useState(0);
  useKeyShift(mediaEl, shift);
  const step = (delta) => setShift((v) => clampKeyShift(v + delta));
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
        disabled={shift <= KEY_SHIFT_MIN}
        onPress={() => step(-1)}
      />
      <button
        type="button"
        className={`piano-keyctl__value${shift !== 0 ? ' is-on' : ''}`}
        aria-label="Reset key"
        onClick={() => setShift(0)}
      >
        {keyShiftLabel(shift)}
      </button>
      <TransportButton
        icon="plus"
        ariaLabel="Raise key"
        className="piano-keyctl__btn"
        disabled={shift >= KEY_SHIFT_MAX}
        onPress={() => step(1)}
      />
    </div>
  );
}
