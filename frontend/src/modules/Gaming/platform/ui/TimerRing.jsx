import React from 'react';

const R = 44;
const CIRC = 2 * Math.PI * R;

export function TimerRing({ progress = 1, size = 96, remaining = null, label = 'Time remaining' }) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  return (
    <svg className="gp-timer-ring" width={size} height={size} viewBox="0 0 100 100" data-testid="timer-ring"
      role="timer" aria-label={remaining == null ? label : `${label}: ${Math.ceil(remaining)} seconds`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(safeProgress * 100)}>
      <title>{remaining == null ? label : `${label}: ${Math.ceil(remaining)} seconds`}</title>
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--gp-surface-border)" strokeWidth="8" />
      <circle
        cx="50" cy="50" r={R} fill="none"
        stroke={safeProgress < 0.25 ? 'var(--gp-danger)' : 'var(--gp-brass)'} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - safeProgress)}
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}
export default TimerRing;
