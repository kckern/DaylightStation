import React, { memo } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';

/**
 * HandsControl — grand-staff "active hands" toggles (wave-3 A: ONE semantic in
 * every mode — Listen performs the active hands, Learn/Polish practice them).
 * At least one hand stays on: an empty selection is meaningless everywhere.
 * value ∈ both|rh|lh. Memoized so it doesn't reconcile on step advances.
 */
const toPair = (value) => ({ lh: value === 'both' || value === 'lh', rh: value === 'both' || value === 'rh' });
const toValue = ({ lh, rh }) => (lh && rh ? 'both' : lh ? 'lh' : 'rh');

const HandsControl = memo(function HandsControl({ value, onChange }) {
  const pair = toPair(value);
  const toggle = (hand) => {
    const next = { ...pair, [hand]: !pair[hand] };
    if (!next.lh && !next.rh) return; // floor: one hand stays on
    onChange?.(toValue(next));
  };
  return (
    <div className="piano-score-hands" role="group" aria-label="Hands">
      <TransportButton icon="hand-left" ariaLabel="Left hand" on={pair.lh} aria-pressed={pair.lh} className="piano-score-hands__opt" onPress={() => toggle('lh')} />
      <TransportButton icon="hand-right" ariaLabel="Right hand" on={pair.rh} aria-pressed={pair.rh} className="piano-score-hands__opt" onPress={() => toggle('rh')} />
    </div>
  );
});

export default HandsControl;
