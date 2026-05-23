/**
 * Pure decision function for the soft-stall verdict.
 *
 * The 2026-05-23 fitness session (`fs_20260523132554`) had 53 of 58
 * `playback.stalled` warns resolve within 10ms (median 3ms) — false
 * positives caused by `timeupdate` being throttled past `softMs` during
 * heavy event-loop load while `mediaEl.currentTime` was advancing
 * normally. The verdict consults `currentTime` directly so a starved
 * `timeupdate` cannot trip the soft stall.
 *
 * Returns one of:
 *  - `{ verdict: 'within-window', stallDurationMs: null }` — `lastProgressTs`
 *    has not aged past `softMs`; soft timer should reschedule.
 *  - `{ verdict: 'progressing',   stallDurationMs: null }` — timer gap is
 *    past `softMs` BUT `currentTime` advanced past `progressEpsilon`. Caller
 *    should fast-forward `lastProgressTs = now` and reschedule (no stall).
 *  - `{ verdict: 'stalled',       stallDurationMs: <gap> }` — timer gap is
 *    past `softMs` AND `currentTime` has not advanced. Caller should declare
 *    the stall.
 *
 * Bug ref: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §1
 */
export function decideStallVerdict({
  now,
  lastProgressTs,
  softMs,
  currentTime,
  lastObservedCurrentTime,
  progressEpsilon = 0.05
}) {
  if (!Number.isFinite(lastProgressTs) || lastProgressTs <= 0) {
    return { verdict: 'within-window', stallDurationMs: null };
  }
  const gap = now - lastProgressTs;
  if (gap < softMs) {
    return { verdict: 'within-window', stallDurationMs: null };
  }
  // Timer gap exceeded — check currentTime as second opinion.
  if (Number.isFinite(currentTime) && Number.isFinite(lastObservedCurrentTime)) {
    // Tolerate IEEE-754 round-off so `delta == progressEpsilon` reads as
    // progressing (e.g. 100.05 - 100.0 evaluates to 0.04999999…). The
    // tolerance is far below 1 microsecond — well under any real frame.
    const delta = currentTime - lastObservedCurrentTime;
    const floatSlack = Number.EPSILON * 1024;
    if (delta + floatSlack >= progressEpsilon) {
      return { verdict: 'progressing', stallDurationMs: null };
    }
  }
  return { verdict: 'stalled', stallDurationMs: gap };
}
