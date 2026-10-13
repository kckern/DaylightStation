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
 * Bug ref: __docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §1
 */
export function decideStallVerdict({
  now,
  lastProgressTs,
  softMs,
  currentTime,
  lastObservedCurrentTime,
  videoFrames = null,
  lastObservedVideoFrames = null,
  progressEpsilon = 0.05
}) {
  if (!Number.isFinite(lastProgressTs) || lastProgressTs <= 0) {
    return { verdict: 'within-window', stallDurationMs: null };
  }
  const gap = now - lastProgressTs;
  if (gap < softMs) {
    return { verdict: 'within-window', stallDurationMs: null };
  }
  // Decoder frame counter first: `currentTime` is refreshed by a main-thread
  // task — the same thread whose starvation freezes `timeupdate` — so the two
  // signals fail together and can't corroborate each other (2026-07-09 session
  // fs 20260709060200: 41/41 stalls were this). totalVideoFrames advances off
  // the main thread; if frames moved, the media is alive regardless of what
  // the clock reads. A backward jump means the element was swapped — not progress.
  if (Number.isFinite(videoFrames) && Number.isFinite(lastObservedVideoFrames)
    && videoFrames > lastObservedVideoFrames) {
    return { verdict: 'progressing', stallDurationMs: null };
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

/**
 * Read the decoder's cumulative frame count from a media element, or null when
 * the element is audio-only / the API is unsupported. Callers feed this into
 * `decideStallVerdict` as the starvation-immune liveness signal.
 */
export function readVideoFrames(mediaEl) {
  try {
    const q = mediaEl?.getVideoPlaybackQuality?.();
    return q && Number.isFinite(q.totalVideoFrames) ? q.totalVideoFrames : null;
  } catch (_) {
    return null;
  }
}
