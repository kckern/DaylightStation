/**
 * Fit policy decision (spec §7 "Layout manager and fit").
 *
 * Pure: this module makes no measurement. It is handed already-measured
 * `attempts` — one summary per density the caller tried — and picks which one
 * satisfies the document's `fit.policy`. Two things stay OUTSIDE this file on
 * purpose:
 *   - Measurement (rendering: `measureBlocks` + `placeFragments`) — a domain
 *     module must not know how to lay out a page, only how to judge the
 *     result.
 *   - The loop that actually RUNS measurement at each density and feeds this
 *     function its `attempts` — that orchestration is Task 8's use case
 *     (`3_applications`), which is allowed to call rendering.
 *
 * An attempt: `{ density: 'normal'|'compact', pageCount, oversetPt }`.
 * `oversetPt` is the amount by which content exceeds the last page at that
 * density (0 when it fits).
 */

/**
 * @param {Object} args
 * @param {'flow'|'one-page'|'fill'} args.policy
 * @param {Array<{density: string, pageCount: number, oversetPt: number}>} args.attempts
 *   Ordered measured summaries, one per density tried.
 * @returns {{attempt: Object} | {error: {code: 'FIT_OVERSET', oversetPt: number}}}
 */
export function resolveFitPlan({ policy, attempts }) {
  const normalAttempt = attempts.find((attempt) => attempt.density === 'normal') ?? attempts[0];

  if (policy === 'flow') {
    return { attempt: normalAttempt };
  }

  if (policy === 'fill') {
    // Fit policy `fill` (spec §7) is the ONLY policy that inverts
    // `placeFragments`'s deliberate last-page growth exclusion — this flag is
    // what the rendering use case forwards as `placeFragments`'s
    // `growLastPage` option.
    return { attempt: { ...normalAttempt, growLastPage: true } };
  }

  if (policy === 'one-page') {
    const fitting = attempts.find((attempt) => attempt.pageCount === 1);
    if (fitting) return { attempt: fitting };

    // Still overset at every density tried: report the amount at COMPACT
    // density specifically (not whichever attempt happens to be last), so
    // the AI trim loop always chases the same, smallest target.
    const compactAttempt = attempts.find((attempt) => attempt.density === 'compact') ?? attempts[attempts.length - 1];
    return { error: { code: 'FIT_OVERSET', oversetPt: compactAttempt.oversetPt } };
  }

  throw new Error(`resolveFitPlan: unknown fit.policy '${policy}'`);
}
