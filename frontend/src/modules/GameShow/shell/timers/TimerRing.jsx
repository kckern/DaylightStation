import React from 'react';

const R = 44;
const CIRC = 2 * Math.PI * R;

export function TimerRing({ progress = 1, size = 96 }) {
  return (
    <svg className="gs-timer-ring" width={size} height={size} viewBox="0 0 100 100" data-testid="timer-ring">
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
      <circle
        cx="50" cy="50" r={R} fill="none"
        stroke={progress < 0.25 ? '#ff6b6b' : '#ffd54a'} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)}
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}
export default TimerRing;
