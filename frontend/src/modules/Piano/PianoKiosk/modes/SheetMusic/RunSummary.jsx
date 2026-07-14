import React from 'react';
import { tallyGrades } from './gradeTally.js';

const OVERALL_LABEL = { green: 'Nicely done', yellow: 'Getting there', red: 'Keep at it' };

/**
 * RunSummary — end-of-run report for Sheet Music "Polish" mode. Pure/presentational:
 * after the evaluator auto-stops (N silent measures) the parent opens this panel with
 * the per-measure grades. Shows a per-measure R/Y/G strip, green/yellow/red counts,
 * an overall grade, and Replay (reset the run) / Close buttons.
 *
 * @param {object} p
 * @param {boolean} p.open
 * @param {Object<number,{grade:'green'|'yellow'|'red'}>} [p.grades]
 * @param {Array<{index:number}>} [p.measures]
 * @param {Function} p.onClose
 * @param {Function} p.onReplay
 */
export default function RunSummary({ open, grades = {}, measures = [], onClose, onReplay }) {
  if (!open) return null;

  const counts = tallyGrades(grades);
  const overall = counts.overall;

  return (
    <div className="piano-score-run-summary" role="dialog" aria-label="Run summary">
      <div className={`piano-score-run-overall piano-score-run-overall--${overall}`}>
        {OVERALL_LABEL[overall]}
      </div>

      <div className="piano-score-run-strip" aria-hidden="true">
        {measures.map((m) => {
          const g = grades[m.index]?.grade;
          return (
            <span
              key={m.index}
              className={`piano-score-run-chip${g ? ` piano-score-run-chip--${g}` : ' piano-score-run-chip--none'}`}
            />
          );
        })}
      </div>

      <div className="piano-score-run-counts">
        <span className="piano-score-run-count piano-score-run-count--green" aria-label="Green measures">{counts.green}</span>
        <span className="piano-score-run-count piano-score-run-count--yellow" aria-label="Yellow measures">{counts.yellow}</span>
        <span className="piano-score-run-count piano-score-run-count--red" aria-label="Red measures">{counts.red}</span>
      </div>

      <div className="piano-score-run-actions">
        <button type="button" className="piano-score-btn piano-score-run-replay" onClick={onReplay}>Replay</button>
        <button type="button" className="piano-score-btn piano-score-run-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
