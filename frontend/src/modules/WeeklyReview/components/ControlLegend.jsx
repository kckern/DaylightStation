import React from 'react';

// Context-sensitive hint bar for the remote/keypad UI. Hidden while a modal is
// open — the modal carries its own choices.
function hintsFor({ level, contextOpen, mediaType, playing, hasNewer }) {
  if (level === 'grid') {
    // Paging is a double-tap at the vertical edges, so it needs saying — it is
    // not something a user discovers by pressing Up once.
    return [
      ['OK', 'Open day'],
      ['↑ ↓ ← →', 'Navigate'],
      ['▲▲', 'Earlier days'],
      ...(hasNewer ? [['▼▼', 'Later days']] : []),
      ['Back', 'Exit'],
    ];
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

export default function ControlLegend({ level, contextOpen, mediaType, playing, modalType, hasNewer }) {
  if (modalType) return null;
  const hints = hintsFor({ level, contextOpen, mediaType, playing, hasNewer });
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
