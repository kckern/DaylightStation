import React from 'react';

/**
 * "Session has a recap video" marker — a filled play-triangle chip pinned to the
 * poster corner. Purely informational (pointer-events: none in SCSS); the row
 * click still selects the session. Sized to read at TV distance (2-4m).
 * @param {{ size?: number }} props
 */
export default function RecapChip({ size = 26 }) {
  return (
    <div className="session-row__recap-chip" title="Has recap video" aria-label="Has recap video">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none">
        <path d="M5 3.5v9l7-4.5-7-4.5z" fill="#fff" />
      </svg>
    </div>
  );
}
