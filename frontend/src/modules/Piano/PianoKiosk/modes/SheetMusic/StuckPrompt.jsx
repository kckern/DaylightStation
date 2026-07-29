import React from 'react';

/**
 * StuckPrompt — the on-score offer that appears when Learn has been waiting on
 * the same step for a while. Learn's all-notes rule deadlocks on multi-note steps
 * until every active-staff note is struck; the way out is to practise one hand at
 * a time, but that control lives in the transport bar and the field logs show it
 * has NEVER been used (zero score.hands events in three days — audit H3).
 * Discovery of a bar control must not be the gate on Learn being usable, so the
 * offer comes to the user, on the score, at the moment it is relevant.
 *
 * @param {object} p
 * @param {boolean} p.open
 * @param {(value: 'rh'|'lh') => void} p.onPick
 * @param {() => void} p.onDismiss
 */
export default function StuckPrompt({ open, onPick, onDismiss }) {
  if (!open) return null;
  return (
    <div className="piano-score-stuck" role="status" aria-live="polite">
      <span className="piano-score-stuck__text">Stuck? Try one hand.</span>
      <button type="button" className="piano-score-btn" onClick={() => onPick('rh')}>Right hand</button>
      <button type="button" className="piano-score-btn" onClick={() => onPick('lh')}>Left hand</button>
      <button type="button" className="piano-score-btn piano-score-stuck__dismiss" onClick={onDismiss}>Keep both</button>
    </div>
  );
}
