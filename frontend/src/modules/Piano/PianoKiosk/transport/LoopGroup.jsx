// LoopGroup.jsx
import React from 'react';
import TransportButton from './TransportButton.jsx';

/**
 * LoopGroup — the shared A–B loop cluster (wave-3 F), extracted from the video
 * chrome: in/out marks plant endpoints; toggle cycles the region; trash clears.
 * Two families separated by the section-end divider. Presentational — every
 * semantic (what "mark" means: playhead seconds in video, armed-tap measures in
 * Learn) lives in the parent.
 */
export default function LoopGroup({
  inSet = false, outSet = false, inLabel, outLabel,
  armingIn = false, armingOut = false,
  loopOn = false, canToggle = false, canClear = false, disabled = false,
  onMarkIn, onMarkOut, onToggle, onClear, className = '',
}) {
  return (
    <div className={`piano-loop-group${inSet || outSet ? ' has-marks' : ''}${className ? ` ${className}` : ''}`}>
      <TransportButton icon="loop-in" label={inLabel} ariaLabel="Mark loop start" className={`piano-loop-group__btn${armingIn ? ' is-arming' : ''}`} disabled={disabled} onPress={onMarkIn} />
      <TransportButton icon="loop-out" label={outLabel} ariaLabel="Mark loop end" className={`piano-loop-group__btn is-section-end${armingOut ? ' is-arming' : ''}`} disabled={disabled} onPress={onMarkOut} />
      <TransportButton icon="loop-toggle" ariaLabel="Toggle loop" on={loopOn} aria-pressed={loopOn} className="piano-loop-group__btn piano-loop-group__btn--loop-toggle" disabled={disabled || !canToggle} onPress={onToggle} />
      <TransportButton icon="clear-loop" ariaLabel="Clear loop" className="piano-loop-group__btn piano-loop-group__btn--clear-loop" disabled={disabled || !canClear} onPress={onClear} />
    </div>
  );
}
