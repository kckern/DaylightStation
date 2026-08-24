import React from 'react';

const R = 44;
const CIRC = 2 * Math.PI * R;

export function TimerRing({ progress = 1, size = 96 }) {
  return (
    <svg className="gp-timer-ring" width={size} height={size} viewBox="0 0 100 100" data-testid="timer-ring">
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--gp-surface-border)" strokeWidth="8" />
      <circle
        cx="50" cy="50" r={R} fill="none"
        stroke={progress < 0.25 ? 'var(--gp-danger)' : 'var(--gp-brass)'} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)}
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}
export default TimerRing;
