import { MIN_VISIBLE_TICKS } from "../../lib/chartConstants.js";

/**
 * The session's tick-axis length. Computed once per pane by buildSessionAxis
 * (sessionTimeline.js) and shared by the chart, the lanes and TimelineOverlay.
 */
export function computeEffectiveTicks(sessionData, getSeries, roster) {
  // No early return for an empty roster: the session's own tick_count still
  // sets the axis (it used to fall back to the 30-tick minimum and clamp every
  // mark onto the right edge).
  let globalMaxIndex = 0;
  for (const entry of roster || []) {
    const userId = entry.id || entry.profileId;
    const hrSeries = getSeries(userId, 'heart_rate', { clone: false });
    const maxIdx = hrSeries.reduce((max, v, i) => (Number.isFinite(v) && v > 0 ? i : max), 0);
    if (maxIdx > globalMaxIndex) globalMaxIndex = maxIdx;
  }
  // `tick_count` is the session's own axis length, and it counts for EVERY
  // session, not just groups. Deriving the axis from the last HR sample alone
  // makes it end where RECORDING stopped rather than where the session did: a
  // 94-minute workout whose browser stopped logging at minute 42 drew a
  // 42-minute axis, and every media marker after that clamped onto the right
  // edge in a heap. Where the two agree — the ordinary case — this changes
  // nothing.
  return Math.max(
    MIN_VISIBLE_TICKS,
    globalMaxIndex + 1,
    Number(sessionData?.timeline?.tick_count) || 0
  );
}
