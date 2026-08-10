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
 * Grade one measure from resolved performance targets. Repeated attacks remain
 * distinct, chord pitches are counted individually, and unmatched notes reduce
 * accuracy instead of disappearing from the result.
 */
export function gradePerformanceMeasure(measure, cfg) {
  const targets = Array.isArray(measure?.targets) ? measure.targets : [];
  const unmatched = Array.isArray(measure?.unmatched) ? measure.unmatched : [];
  const expectedCount = targets.reduce((sum, target) => sum + (target.pitches?.length || 0), 0);
  const matchedDrifts = targets.flatMap((target) => target.drifts || []);
  const matchedCount = matchedDrifts.length;
  const wrongCount = unmatched.length;
  const tol = Number.isFinite(cfg?.timingToleranceMs)
    ? cfg.timingToleranceMs
    : DEFAULTS.timingToleranceMs;
  const greenThreshold = Number.isFinite(cfg?.thresholds?.green)
    ? cfg.thresholds.green
    : DEFAULTS.thresholds.green;
  const yellowThreshold = Number.isFinite(cfg?.thresholds?.yellow)
    ? cfg.thresholds.yellow
    : DEFAULTS.thresholds.yellow;

  const rest = expectedCount === 0;
  const noteScore = rest
    ? (wrongCount ? 0 : 1)
    : clamp(matchedCount / (expectedCount + wrongCount), 0, 1);
  const timingScore = matchedDrifts.length
    ? matchedDrifts.reduce((sum, driftMs) => {
      const drift = Math.abs(Number(driftMs) || 0);
      return sum + clamp(1 - Math.max(0, drift - tol) / (tol * 4), 0, 1);
    }, 0) / matchedDrifts.length
    : (rest && !wrongCount ? 1 : 0);
  const combined = rest && !wrongCount ? 1 : noteScore * (0.6 + 0.4 * timingScore);
  const grade = combined >= greenThreshold ? 'green' : combined >= yellowThreshold ? 'yellow' : 'red';
  const silent = expectedCount > 0 && matchedCount === 0 && wrongCount === 0;

  return {
    noteScore,
    timingScore,
    combined,
    grade,
    silent,
    rest,
    expectedCount,
    matchedCount,
    wrongCount,
  };
}
