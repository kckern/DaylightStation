import React, { useState, memo } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';
import LoopSheet from '../../transport/LoopSheet.jsx';

/**
 * LoopControl — the loop trigger (wave-2 redesign: direct toggle). The main
 * button is a `repeat`-icon toggle: tapping it with NO range armed starts the
 * on-score two-tap selection (`onStartSelect`); tapping it with a range armed
 * flips looping on/off in place (`onToggleEnabled`) WITHOUT clearing the
 * range or opening anything — so a user can silence the loop, keep playing
 * past its boundary, then flip it back on without re-picking. `active` still
 * means "a range exists"; `enabled` means "looping is currently on". A
 * separate quiet chevron ("Loop options") opens the shared LoopSheet for
 * sections / re-selecting / nudging endpoints; the one-tap clear stays.
 * Presentational; the parent owns focus/selection state. Memoized on its
 * props.
 */
const LoopControl = memo(function LoopControl({
  active = false, enabled = true, scopeLabel = '', sections = [],
  onPickSection, onStartSelect, onClearFocus, onNudge, onToggleEnabled,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="piano-score-loop-wrap">
      <TransportButton
        icon="repeat"
        label={active ? scopeLabel : undefined}
        ariaLabel="Loop"
        on={active && enabled}
        aria-pressed={active && enabled}
        className="piano-score-loop-trigger"
        onPress={() => (active ? onToggleEnabled?.() : onStartSelect?.())}
      />
      <TransportButton icon="chevron-down" ariaLabel="Loop options" emphasis="quiet" onPress={() => setOpen(true)} />
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
