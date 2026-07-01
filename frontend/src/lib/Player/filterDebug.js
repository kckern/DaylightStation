/**
 * filterDebug — pure helpers for the content-filter debug HUD
 * (see docs/_wip/plans/2026-06-30-content-filter-layer-design.md §6).
 *
 * These compute, from the resolved `effectiveCues` (already sorted by `in`) plus
 * the current playhead time, what the HUD should show and where the ◀/▶ go-to
 * buttons should seek. No DOM, no React — fully unit-testable.
 */

/** Seek this far BEFORE a cue's in-point so you watch it arm→fire, not start mid-skip. */
export const DEFAULT_LEAD_SEC = 1.5;

/** The cue firing at time t (first whose [in,out) contains t), or null. */
export function activeCueAt(cues, t) {
  if (!cues) return null;
  for (const c of cues) {
    if (t >= c.in && t < c.out) return c;
  }
  return null;
}

/** The earliest cue starting strictly after t (skips one you're inside/at), or null. */
export function nextCueAfter(cues, t) {
  if (!cues) return null;
  for (const c of cues) {
    if (c.in > t) return c;
  }
  return null;
}

/**
 * The previous cue to jump back to: the last cue whose in-point is before
 * (t - lead). Using the lead-adjusted threshold means that after a ◀ jump lands
 * you at (cue.in - lead), a second ◀ walks to the cue before it rather than
 * re-snapping to the same lead-in.
 */
export function prevCueBefore(cues, t, lead = DEFAULT_LEAD_SEC) {
  if (!cues) return null;
  const threshold = t - lead;
  let found = null;
  for (const c of cues) {
    if (c.in < threshold) found = c; // cues sorted by in → last match is the closest
    else break;
  }
  return found;
}

/**
 * A landing time `lead` seconds before `cueIn` that is NOT inside any cue's
 * firing window — so a go-to always drops you at a clean point where you can
 * watch the filter arm, never mid-fire. If `cueIn - lead` happens to fall inside
 * an earlier (overlapping) cue, back up to before that one too (bounded).
 */
function nonFiringLeadIn(cues, cueIn, lead) {
  let target = Math.max(0, cueIn - lead);
  for (let guard = 0; guard < (cues?.length || 0); guard++) {
    const overlapping = activeCueAt(cues, target);
    if (!overlapping || target === 0) break;
    target = Math.max(0, overlapping.in - lead);
  }
  return target;
}

/**
 * Compute a go-to seek for a direction. The target is always a NON-firing point
 * ~`lead` seconds before the cue's in-point (see nonFiringLeadIn).
 * @param {Array} cues sorted effective cues
 * @param {number} t current playhead seconds
 * @param {'next'|'prev'} direction
 * @param {number} [lead] seconds to land before the cue in-point
 * @returns {{cue: object, targetTime: number}|null} null when no cue that way.
 */
export function computeGoto(cues, t, direction, lead = DEFAULT_LEAD_SEC) {
  const cue = direction === 'prev' ? prevCueBefore(cues, t, lead) : nextCueAfter(cues, t);
  if (!cue) return null;
  return { cue, targetTime: nonFiringLeadIn(cues, cue.in, lead) };
}

/**
 * Full HUD state for time t: the focused cue (the one firing, else the next armed),
 * whether it's firing, the countdown to it when armed, its 1-based position in the
 * EDL, and whether prev/next go-tos are available.
 * `countdownSec` counts down to the next cue while ARMED; `firingLeftSec` counts
 * down the remaining firing window while a cue is active. Exactly one is non-null
 * (or both null past the last cue).
 * @returns {{focus: object|null, firing: boolean, countdownSec: number|null,
 *            firingLeftSec: number|null, index: number, total: number,
 *            canPrev: boolean, canNext: boolean}}
 */
export function debugCueState(cues, t, lead = DEFAULT_LEAD_SEC) {
  const list = cues || [];
  const total = list.length;
  const active = activeCueAt(list, t);
  const upcoming = active ? null : nextCueAfter(list, t);
  const focus = active || upcoming;
  const index = focus ? list.indexOf(focus) + 1 : 0;
  return {
    focus,
    firing: !!active,
    countdownSec: active || !upcoming ? null : Math.max(0, upcoming.in - t),
    firingLeftSec: active ? Math.max(0, active.out - t) : null,
    index,
    total,
    canPrev: !!prevCueBefore(list, t, lead),
    canNext: !!nextCueAfter(list, t),
  };
}
