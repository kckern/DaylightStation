import React from 'react';

// Context-sensitive hint bar for the remote/keypad UI. Hidden while a modal is
// open — the modal carries its own choices.
function hintsFor({ level, contextOpen, mediaType, playing }) {
  if (level === 'grid') {
    return [['OK', 'Open day'], ['↑ ↓ ← →', 'Navigate'], ['Back', 'Exit']];
  }
  if (contextOpen) {
    return [['↓ / Back', 'Close details']];
  }
  if (playing) {
    return [['OK', 'Mute / Unmute'], ['Back', 'Stop']];
  }
  if (mediaType === 'video') {
    return [['OK', 'Play'], ['← →', 'Browse'], ['↓', 'Details'], ['Back', 'Back to week']];
  }
  // photo or empty day
  return [['← →', 'Browse'], ['↓', 'Details'], ['Back', 'Back to week']];
}

export default function ControlLegend({ level, contextOpen, mediaType, playing, modalType }) {
  if (modalType) return null;
  const hints = hintsFor({ level, contextOpen, mediaType, playing });
  return (
    <div className="weekly-review-legend" role="note" aria-label="Controls">
      {hints.map(([key, label], i) => (
        <span className="legend-hint" key={i}>
          <span className="legend-key">{key}</span>
          <span className="legend-label">{label}</span>
        </span>
      ))}
    </div>
  );
}
