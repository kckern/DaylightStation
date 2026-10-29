// skipGovernor — a held or mashed skip button must not fly through a lesson.
//
// 2026-10-28: while a lesson video was stalled a child pressed +30 s every
// 200–300 ms. Each press seeked from the PENDING target (currentTime already
// reads the seek target), so nine presses jumped 4.5 minutes and the saved
// lesson position went with them. Deliberate double-taps are real ("+60"), so
// presses are not debounced — instead one BURST (presses less than
// SKIP_BURST_GAP_MS apart) may move forward at most SKIP_BURST_MAX_FORWARD_SEC
// in total. Backward skips are never limited: they lose nothing.
export const SKIP_BURST_GAP_MS = 700;
export const SKIP_BURST_MAX_FORWARD_SEC = 60;

export function createSkipGovernor({ now = () => Date.now(), gapMs = SKIP_BURST_GAP_MS, maxForwardSec = SKIP_BURST_MAX_FORWARD_SEC } = {}) {
  let lastAt = -Infinity;
  let burstForward = 0;
  return {
    /** @returns {number} the delta to apply (0 = drop the press) */
    admit(delta) {
      const t = now();
      if (t - lastAt >= gapMs) burstForward = 0;
      lastAt = t;
      if (!(delta > 0)) return delta;
      const allowed = Math.max(0, Math.min(delta, maxForwardSec - burstForward));
      burstForward += allowed;
      return allowed;
    },
  };
}

/** Target for a skip; a sequential lesson never skips past what was watched. */
export function skipTarget({ current, delta, duration, isSequential, furthestWatched }) {
  const cur = Number.isFinite(current) ? current : 0;
  let max = duration > 0 ? duration : cur + Math.abs(delta);
  if (isSequential && delta > 0 && Number.isFinite(furthestWatched)) max = Math.min(max, Math.max(cur, furthestWatched));
  return Math.max(0, Math.min(max, cur + delta));
}
