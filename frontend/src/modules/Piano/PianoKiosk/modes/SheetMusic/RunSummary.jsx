import React from 'react';
import { tallyGrades } from './gradeTally.js';

const OVERALL_LABEL = { green: 'Nicely done', yellow: 'Getting there', red: 'Keep at it' };
// tallyGrades reports overall: null when nothing was graded. Say so plainly —
// praising a run the user never played teaches them the feedback is noise.
const NOTHING_LABEL = 'Nothing to grade yet';

// Tempo tiers (wave-3 H). The HEADLINE names the tier in words; the STRIP labels
// its cells by the tempo band that produces them — deliberately different
// vocabularies, because the two would otherwise read as the same claim twice and
// the percent band is what the user actually just picked on the tempo ladder.
const TIER_PHRASE = { slow: 'slow', medium: 'medium', full: 'full speed', overclocked: 'overclocked' };
const MIXED_PHRASE = 'mixed tempo'; // a mid-run tempo change: no tier, no best
const TIER_CELLS = [
  { tier: 'slow', label: '< 80%' },
  { tier: 'medium', label: '80-99%' },
  { tier: 'full', label: '100%' },
  { tier: 'overclocked', label: '> 100%' },
];
// Which hands the strip is scoped to. Bests are per-bucket (wave-3 C): a
// right-hand 84 is not a both-hands 84, so the panel must say which it shows.
const BUCKET_LABEL = { both: 'both hands', rh: 'right hand', lh: 'left hand' };
const NO_BEST = '—'; // em dash — this tier has never been run

/**
 * RunSummary — end-of-run report for Sheet Music "Polish" mode. Pure/presentational:
 * after the evaluator auto-stops (N silent measures) the parent opens this panel with
 * the per-measure grades. Shows a per-measure R/Y/G strip, green/yellow/red counts,
 * an overall grade, and Replay (reset the run) / Close buttons.
 *
 * Wave-3 H adds the tempo-tier layer: this run's numeric score with the tier it was
 * played at (or "mixed tempo" when a mid-run tempo change voided it), plus the four
 * tier bests for the hands bucket the run was played with. The panel NEVER writes —
 * the parent decides whether a run earned a best (only a completion does).
 *
 * @param {object} p
 * @param {boolean} p.open
 * @param {Object<number,{grade:'green'|'yellow'|'red'}>} [p.grades]
 * @param {Array<{index:number}>} [p.measures]
 * @param {Function} p.onClose
 * @param {Function} p.onReplay
 * @param {number|null} [p.runScore] - this run's score, already displayScore'd
 *   (overclocked extra credit applied) — null when nothing gradeable was played.
 * @param {'slow'|'medium'|'full'|'overclocked'|null} [p.tier] - tier at run START
 * @param {Object<string, number|null>|null} [p.tierBests] - bests for THIS bucket;
 *   omit (null) to render no strip at all.
 * @param {boolean} [p.mixedTempo] - the tempo moved mid-run: this run belongs to no tier
 * @param {string} [p.bucket] - hands bucket the strip is scoped to
 */
export default function RunSummary({
  open, grades = {}, measures = [], onClose, onReplay, drillable = false, onDrill,
  runScore = null, tier = null, tierBests = null, mixedTempo = false, bucket = 'both',
}) {
  if (!open) return null;

  const counts = tallyGrades(grades);
  const overall = counts.overall;

  return (
    <div className="piano-score-run-summary" role="dialog" aria-label="Run summary">
      {runScore != null && (
        <div className="piano-score-run-score">
          <span className="piano-score-run-score__value tabular-nums">{runScore}</span>
          {' · '}
          <span className={`piano-score-run-score__tier${mixedTempo ? ' piano-score-run-score__tier--mixed' : ''}`}>
            {mixedTempo ? MIXED_PHRASE : (TIER_PHRASE[tier] || TIER_PHRASE.full)}
          </span>
        </div>
      )}

      <div className={`piano-score-run-overall piano-score-run-overall--${overall || 'none'}`}>
        {overall ? OVERALL_LABEL[overall] : NOTHING_LABEL}
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

      {tierBests && (
        <div className="piano-score-run-tiers" aria-label="Tempo-tier bests">
          <div className="piano-score-run-tiers__caption">{`Best · ${BUCKET_LABEL[bucket] || bucket}`}</div>
          <div className="piano-score-run-tiers__cells">
            {TIER_CELLS.map(({ tier: t, label }) => {
              const best = tierBests[t];
              const current = !mixedTempo && t === tier;
              return (
                <div key={t} className={`piano-score-run-tier${current ? ' piano-score-run-tier--current' : ''}`}>
                  <span className="piano-score-run-tier__label">{label}</span>
                  <span className="piano-score-run-tier__value tabular-nums">
                    {Number.isFinite(best) ? best : NO_BEST}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="piano-score-run-actions">
        {drillable && (
          <button type="button" className="piano-score-btn piano-score-run-drill" onClick={onDrill}>Drill worst section</button>
        )}
        <button type="button" className="piano-score-btn piano-score-run-replay" onClick={onReplay}>Replay</button>
        <button type="button" className="piano-score-btn piano-score-run-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
