/**
 * Per-measure scoring math for Sheet Music "Polish" mode.
 *
 * Grades a single measure red/yellow/green from note-accuracy and timing.
 * Pure, DOM-free.
 */

const DEFAULTS = {
  timingToleranceMs: 80,
  thresholds: { green: 0.9, yellow: 0.6 },
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * @param {{ expected?: number[], hits?: {note:number, driftMs:number}[] }} measure
 * @param {{ timingToleranceMs?: number, thresholds?: {green?:number, yellow?:number} }} cfg
 * @returns {{ noteScore:number, timingScore:number, combined:number, grade:'green'|'yellow'|'red', silent:boolean }}
 */
export function gradeMeasure(measure, cfg) {
  const expected = Array.isArray(measure?.expected) ? measure.expected : [];
  const hits = Array.isArray(measure?.hits) ? measure.hits : [];

  const tol = Number.isFinite(cfg?.timingToleranceMs)
    ? cfg.timingToleranceMs
    : DEFAULTS.timingToleranceMs;
  const greenThreshold = Number.isFinite(cfg?.thresholds?.green)
    ? cfg.thresholds.green
    : DEFAULTS.thresholds.green;
  const yellowThreshold = Number.isFinite(cfg?.thresholds?.yellow)
    ? cfg.thresholds.yellow
    : DEFAULTS.thresholds.yellow;

  const expectedSet = new Set(expected);

  // noteScore: distinct expected midis present in hits / expected.length
  let noteScore;
  if (expected.length === 0) {
    noteScore = 1; // rest bar — nothing to play is not a failure
  } else {
    const hitNotes = new Set(hits.map((h) => h?.note));
    let matched = 0;
    for (const midi of expectedSet) {
      if (hitNotes.has(midi)) matched += 1;
    }
    noteScore = matched / expectedSet.size;
  }

  // timingScore: mean over matched hits of a tolerance-graded drift score.
  const matchedHits = hits.filter((h) => expectedSet.has(h?.note));
  let timingScore;
  if (matchedHits.length === 0) {
    timingScore = expected.length === 0 ? 1 : 0;
  } else {
    const sum = matchedHits.reduce((acc, h) => {
      const drift = Math.abs(Number(h?.driftMs) || 0);
      const s = clamp(1 - Math.max(0, drift - tol) / (tol * 4), 0, 1);
      return acc + s;
    }, 0);
    timingScore = sum / matchedHits.length;
  }

  // combined: notes dominate, timing refines. Rest bar → perfect.
  const combined = expected.length === 0
    ? 1
    : noteScore * (0.6 + 0.4 * timingScore);

  let grade;
  if (combined >= greenThreshold) grade = 'green';
  else if (combined >= yellowThreshold) grade = 'yellow';
  else grade = 'red';

  const silent = expected.length > 0 && hits.length === 0;

  return { noteScore, timingScore, combined, grade, silent };
}
