/**
 * When a partial watch counts as finished, defined once for both sides of the wire.
 *
 * "90% means done" assumes the last tenth is credits or a cooldown. That holds
 * for a 30-minute class and fails for a 5-hour racing longplay, where the last
 * tenth is half an hour of real content (2026-10-20: Sonic & Sega All Stars
 * Racing was marked watched at 94% with 17 minutes, a whole cup, still to ride,
 * and its Plex resume point was wiped).
 *
 * So a percentage alone never finishes an item: what is left must also be
 * short. Anything up to 100 minutes is unaffected (10% of it is at most 10
 * minutes); past that the bar rises with length — 91.7% of two hours, 94.4% of
 * three. A natural end always counts and is the caller's to pass separately.
 */

/** Share of the item that must have played. */
export const COMPLETION_PERCENT = 90;

/** Most of the item that may still be unplayed, in seconds. */
export const COMPLETION_MAX_REMAINING_SEC = 10 * 60;

/**
 * Whether a partial watch counts as finished.
 *
 * With no usable duration the remaining time is unknowable, so only the
 * percentage is checked — the rule this replaces, and no worse than it.
 *
 * @param {{ percent?: number, playhead?: number, duration?: number }} progress
 *   percent 0-100; playhead and duration in seconds
 * @param {{ minPercent?: number, maxRemainingSec?: number }} [opts]
 * @returns {boolean}
 */
export function isWatchComplete(
  { percent, playhead, duration } = {},
  { minPercent = COMPLETION_PERCENT, maxRemainingSec = COMPLETION_MAX_REMAINING_SEC } = {},
) {
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct < minPercent) return false;
  const total = Number(duration);
  const at = Number(playhead);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(at)) return true;
  return total - at <= maxRemainingSec;
}
