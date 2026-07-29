import React from 'react';

/**
 * SelectBanner — the on-score guidance shown while ONE loop endpoint is armed
 * (wave-3 F: tap "Mark loop start"/"Mark loop end", then tap the measure). It
 * names the edge being picked and offers Cancel, so an armed tap is never a
 * mystery (audit J5/M3, carried over from the retired two-tap flow).
 *
 * `rejects` is a counter, not a boolean: re-keying on it restarts the shake
 * animation for every rejected tap, so a second miss is as visible as the first.
 * A rejected tap is otherwise silently swallowed, which on a kiosk reads as a
 * dead screen (audit H4a). Only a DEAD MARGIN rejects now — endpoint picking has
 * no near-a-note radius (see measureAtPoint) — so the copy says "inside the
 * music", not "closer to a note".
 *
 * @param {object} p
 * @param {'in'|'out'} [p.edge] - which endpoint is armed; falsy renders nothing
 * @param {number} [p.rejects] - count of taps rejected as outside every system
 * @param {() => void} p.onCancel
 */
export default function SelectBanner({ edge, rejects = 0, onCancel }) {
  if (!edge) return null;
  const text = rejects > 0
    ? 'Tap inside the music'
    : edge === 'in'
      ? 'Tap the measure for the loop start'
      : 'Tap the measure for the loop end';
  return (
    <div
      key={rejects}
      className={`piano-score-select-banner${rejects > 0 ? ' is-reject' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="piano-score-select-banner__text">{text}</span>
      <button type="button" className="piano-score-btn piano-score-select-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}
