import React, { memo } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';

/**
 * HandsControl — the grand-staff fast path for "who plays which staff": two
 * independent hand TOGGLES (mirrored hand icons) instead of a segmented radio.
 * Left + Right lit = both hands; one lit = that hand alone. Two variants:
 *
 *  variant="hands"  (Learn/Polish): which hands YOU practice. At least one hand
 *                   stays on — turning off the last lit toggle is inert (an
 *                   empty practice selection is meaningless).
 *  variant="mypart" (Listen): which hand you play along with; the kiosk
 *                   performs the rest. Both toggles off = 'none' (kiosk plays
 *                   everything), so the old None option is just the empty state.
 *
 * Presentational; external contract unchanged: value ∈ both|rh|lh|none and
 * onChange receives the same vocabulary. Memoized (value/onChange only) so it
 * doesn't reconcile on step advances.
 *
 * @param {object} p
 * @param {'hands'|'mypart'} p.variant
 * @param {'both'|'rh'|'lh'|'none'} p.value
 * @param {(v:string) => void} p.onChange
 */
const toPair = (value) => ({ lh: value === 'both' || value === 'lh', rh: value === 'both' || value === 'rh' });
const toValue = ({ lh, rh }) => (lh && rh ? 'both' : lh ? 'lh' : rh ? 'rh' : 'none');

const HandsControl = memo(function HandsControl({ variant = 'hands', value, onChange }) {
  const label = variant === 'mypart' ? 'My part' : 'Hands';
  const pair = toPair(value);
  const toggle = (hand) => {
    const next = { ...pair, [hand]: !pair[hand] };
    const v = toValue(next);
    if (v === 'none' && variant === 'hands') return; // floor: one hand stays on
    onChange?.(v);
  };
  return (
    <div className="piano-score-hands" role="group" aria-label={label}>
      <span className="piano-score-hands__label">{label}</span>
      <TransportButton
        icon="hand-left"
        ariaLabel="Left hand"
        on={pair.lh}
        aria-pressed={pair.lh}
        className="piano-score-hands__opt"
        onPress={() => toggle('lh')}
      />
      <TransportButton
        icon="hand-right"
        ariaLabel="Right hand"
        on={pair.rh}
        aria-pressed={pair.rh}
        className="piano-score-hands__opt"
        onPress={() => toggle('rh')}
      />
    </div>
  );
});

export default HandsControl;
