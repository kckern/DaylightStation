import {
  createAssessmentSession,
  gradeAssessmentSpan,
} from '../../../performance/assessmentSession.js';

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
  const targets = (Array.isArray(measure?.targets) ? measure.targets : [])
    .map((target, index) => ({ id: target.id ?? index, measureIndex: 0, ...target }));
  const unmatched = (Array.isArray(measure?.unmatched) ? measure.unmatched : [])
    .map((event) => ({ measureIndex: 0, ...event }));
  const session = createAssessmentSession({ matcher: 'timed', expectation: { targets } });
  session.run = { targets, unmatched };
  return {
    ...gradeAssessmentSpan(session, 0, {
      timingToleranceMs: Number.isFinite(cfg?.timingToleranceMs) ? cfg.timingToleranceMs : DEFAULTS.timingToleranceMs,
      timingWindowMs: Number.isFinite(cfg?.timingWindowMs) ? cfg.timingWindowMs : DEFAULTS.timingWindowMs,
      thresholds: { ...DEFAULTS.thresholds, ...(cfg?.thresholds || {}) },
      weights: cfg?.weights,
    }),
    policyVersion: POLICY_VERSION,
  };
}

export default { gradePerformanceMeasure, POLICY_VERSION };
