import { gradeBand, gradeOrderedPerformance, timingQualityFromDrift } from '../../../performance/grading.js';

/**
 * Per-measure scoring for Sheet Music "Polish" mode.
 *
 * The maths now comes from the shared performance service rather than from a
 * second implementation living here. Polish was the last surface grading itself:
 * it computed the same dimensions under different names (`noteScore` for pitch
 * accuracy, a drift curve for timing) and combined them multiplicatively, so a
 * polish score and a drill score could not be compared even though both claimed
 * to mean "how well did that go".
 *
 * This is a grading-policy change, not a refactor — the numbers move. Scores are
 * stamped with POLICY_VERSION so a record written under the old maths stays
 * distinguishable from one written under this.
 *
 * What stays local is the shape of the input (measures carry targets, drifts and
 * unmatched notes) and polish's forgiving timing tolerance, which is expressed
 * as parameters to the shared curve rather than as a private formula.
 *
 * Pure, DOM-free.
 */

export const POLICY_VERSION = 'polish-shared-grading-v1';

const DEFAULTS = {
  timingToleranceMs: 80,
  // Beyond the tolerance, quality falls to zero across this span. Polish is
  // deliberately gentler than beat-relative grading: a bar being learned should
  // not read red for being a little late.
  timingWindowMs: 320,
  thresholds: { green: 0.9, yellow: 0.6 },
};

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

  const toleranceMs = Number.isFinite(cfg?.timingToleranceMs) ? cfg.timingToleranceMs : DEFAULTS.timingToleranceMs;
  const windowMs = Number.isFinite(cfg?.timingWindowMs) ? cfg.timingWindowMs : DEFAULTS.timingWindowMs;
  const thresholds = { ...DEFAULTS.thresholds, ...(cfg?.thresholds || {}) };

  const rest = expectedCount === 0;
  // A bar of rests is passed by staying silent through it, which no accuracy
  // model expresses — so it is answered before the graders are asked.
  if (rest) {
    const clean = wrongCount === 0;
    return {
      noteScore: clean ? 1 : 0,
      timingScore: clean ? 1 : 0,
      combined: clean ? 1 : 0,
      grade: gradeBand(clean ? 1 : 0, thresholds),
      silent: false,
      rest: true,
      expectedCount: 0,
      matchedCount: 0,
      wrongCount,
      policyVersion: POLICY_VERSION,
    };
  }

  const graded = gradeOrderedPerformance({
    expectedCount,
    wrongNotes: wrongCount,
    // A timed score can be played straight past, so notes go unstruck here in a
    // way a drill cannot manage.
    missedNotes: Math.max(0, expectedCount - matchedCount),
    timingQualities: matchedDrifts
      .map((drift) => timingQualityFromDrift(drift, { toleranceMs, windowMs }))
      .filter((value) => value !== null),
    paced: true,
    weights: cfg?.weights,
  });

  return {
    // The old field names are kept: they are what the overlay and the practice
    // record already read, and renaming them would be a second change riding on
    // this one.
    noteScore: graded.pitchAccuracy,
    timingScore: graded.timingAccuracy ?? 0,
    combined: graded.score,
    grade: gradeBand(graded.score, thresholds),
    silent: matchedCount === 0 && wrongCount === 0,
    rest: false,
    expectedCount,
    matchedCount,
    wrongCount,
    continuity: graded.continuity,
    policyVersion: POLICY_VERSION,
  };
}

export default { gradePerformanceMeasure, POLICY_VERSION };
