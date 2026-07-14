import React from 'react';

/**
 * SelectBanner — the on-score guidance shown during the guided measure-selection
 * flow (Practice → Select measures…). Tells the user exactly what to tap next and
 * offers Cancel, so the two-tap flow is never a mystery (audit J5/M3).
 *
 * @param {object} p
 * @param {'first'|'last'} p.stage
 * @param {() => void} p.onCancel
 */
export default function SelectBanner({ stage, onCancel }) {
  if (!stage) return null;
  const text = stage === 'first'
    ? 'Tap the FIRST measure of your practice range'
    : 'Now tap the LAST measure';
  return (
    <div className="piano-score-select-banner" role="status" aria-live="polite">
      <span className="piano-score-select-banner__text">{text}</span>
      <button type="button" className="piano-score-btn piano-score-select-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}
