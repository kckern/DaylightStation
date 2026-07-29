import React from 'react';

/**
 * SelectBanner — the on-score guidance shown during the guided measure-selection
 * flow (Loop → Select measures…). Tells the user exactly what to tap next and
 * offers Cancel, so the two-tap flow is never a mystery (audit J5/M3).
 *
 * `rejects` is a counter, not a boolean: re-keying on it restarts the shake
 * animation for every rejected tap, so a second miss is as visible as the first.
 * A tap that lands too far from any note is otherwise silently swallowed, which
 * on a kiosk reads as a dead screen (audit H4a).
 *
 * @param {object} p
 * @param {'first'|'last'} p.stage
 * @param {number} [p.rejects] - count of taps rejected as too far from a note
 * @param {() => void} p.onCancel
 */
export default function SelectBanner({ stage, rejects = 0, onCancel }) {
  if (!stage) return null;
  const text = rejects > 0
    ? 'Tap closer to a note'
    : stage === 'first'
      ? 'Tap the FIRST measure of your loop'
      : 'Now tap the LAST measure';
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
