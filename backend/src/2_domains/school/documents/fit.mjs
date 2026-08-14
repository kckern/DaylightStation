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
 * @param {'flow'|'one-page'|'fill'|'prefer-one-page'} args.policy
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

  if (policy === 'prefer-one-page') {
    // The household rule this policy exists to satisfy has two halves: "we
    // can only use two pages if we have an exceptionally long number of
    // questions" (try hard to land on one page) AND "within each page there
    // should be right sizing" (the density that DOES get chosen must not be
    // wastefully loose). `one-page`'s hard-fail already nails the first half
    // for documents that must never spill; this policy is for the ones that
    // may, so it borrows one-page's own "prefer whichever attempt already
    // fits in one page" search...
    const fitting = attempts.find((attempt) => attempt.pageCount === 1);
    if (fitting) return { attempt: fitting };

    // ...but when NOTHING fits in one page, `one-page` would reject the
    // render outright (FIT_OVERSET) — the one behavior this policy exists to
    // avoid, because refusing to print a genuinely long lesson is a worse
    // failure than spilling it across two pages. So it falls through to a
    // spill instead. Critically, the spill still honors the SECOND half of
    // the household rule: it spills using the COMPACT attempt (denser, more
    // right-sized), not the loosely-spaced `normal` attempt `flow` would
    // have used — a two-page compact render is closer to "right sizing"
    // than a two-page normal one would be, even though neither reaches one
    // page. `attempts` is guaranteed to contain a compact entry whenever
    // normal didn't fit (see RenderPrintDocument's fit loop, which measures
    // compact for exactly this policy under that same condition); the
    // `?? normalAttempt` fallback only matters for a caller (e.g. this
    // file's own unit tests) that measured normal alone.
    const compactAttempt = attempts.find((attempt) => attempt.density === 'compact');
    const spilled = compactAttempt ?? normalAttempt;

    // BALANCED SPILL (household rule: "we're not just having a dangling
    // question number 10 at the end" — equal vertical fill across pages, not
    // equal question COUNT) is real, but it is deliberately NOT decided here.
    // This function's whole contract (see the header note) is "judge already-
    // measured attempts, never opine on how rendering should use one" — `fill`
    // is the one existing exception, and only because `growLastPage` there is
    // unconditional on the policy alone (every `fill` render always grows,
    // full stop). Balancing a `prefer-one-page` spill is NOT unconditional on
    // the policy alone: it only makes sense when a spill actually happened
    // (`pageCount > 1` on the attempt this function is about to return), and
    // "does the chosen attempt still overflow one page" is exactly the kind
    // of post-hoc, render-shaped question `fit.mjs` is not supposed to be
    // asking — it would mean this "pure decision table" (see every other
    // branch's plain `{ attempt }` returns) starts inspecting its own output
    // to decide whether to mutate it, for a policy-specific special case.
    // `RenderPrintDocument.mjs` (the use case explicitly licensed to reason
    // about rendering — see this file's own header) derives `balance` and
    // the spill-only half of `growLastPage` itself from the same two facts
    // this function already exposes for free: `document.fit.policy` and
    // `chosen.pageCount`. Returning the spilled attempt untouched here also
    // keeps this branch symmetric with the two outcomes above it (fits at
    // normal / fits at compact) — none of them decorate the attempt either.
    return { attempt: spilled };
  }

  throw new Error(`resolveFitPlan: unknown fit.policy '${policy}'`);
}
