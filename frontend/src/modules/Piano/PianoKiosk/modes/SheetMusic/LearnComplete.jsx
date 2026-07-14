import React from 'react';

/**
 * LearnComplete — the end-of-piece card for Learn mode. When the follow tracker
 * reaches the final step, the piece is done: celebrate and offer the next rung
 * ("Polish it" → prove it at tempo) or another pass ("Practice again"). Closes the
 * Learn journey instead of leaving the cursor dead at the last note (audit M5/J6).
 *
 * @param {object} p
 * @param {boolean} p.open
 * @param {() => void} p.onReplay - restart from the top, keep Learn
 * @param {() => void} p.onPolish - move to Polish (carry any practice range)
 */
export default function LearnComplete({ open, onReplay, onPolish }) {
  if (!open) return null;
  return (
    <div className="piano-score-learn-complete" role="dialog" aria-label="Learn complete">
      <div className="piano-score-learn-complete__headline">You played every note 🎉</div>
      <div className="piano-score-learn-complete__actions">
        <button type="button" className="piano-score-btn piano-score-learn-again" onClick={onReplay}>Practice again</button>
        <button type="button" className="piano-score-btn piano-score-learn-polish" onClick={onPolish}>Polish it →</button>
      </div>
    </div>
  );
}
