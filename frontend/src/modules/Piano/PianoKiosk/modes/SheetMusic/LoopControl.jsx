import React, { useState, memo } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';
import LoopSheet from '../../transport/LoopSheet.jsx';

/**
 * LoopControl — the loop trigger chip (audit L1/L2). The trigger reads "Loop"
 * (inactive) or "Loop m9–m16" (active) with a one-tap clear beside it; the
 * picker itself is the shared LoopSheet. Presentational; the parent owns
 * focus/selection state. Memoized on its props.
 */
const LoopControl = memo(function LoopControl({ active = false, scopeLabel = '', sections = [], onPickSection, onStartSelect, onClearFocus, onNudge }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="piano-score-loop-wrap">
      <TransportButton
        label={active ? `Loop ${scopeLabel}` : 'Loop'}
        icon="chevron-down"
        ariaLabel="Loop"
        on={active}
        className="piano-score-loop-trigger"
        onPress={() => setOpen(true)}
      />
      {active && (
        <TransportButton icon="close" ariaLabel="Clear loop" emphasis="quiet" onPress={() => onClearFocus?.()} />
      )}
      <LoopSheet
        open={open}
        onClose={() => setOpen(false)}
        active={active}
        sections={sections}
        onPickSection={onPickSection}
        onStartSelect={onStartSelect}
        onClearFocus={onClearFocus}
        onNudge={onNudge}
      />
    </div>
  );
});

export default LoopControl;
