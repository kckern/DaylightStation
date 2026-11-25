/**
 * Seek bumps (the fast-forward / rewind keys) scoped to what is playing.
 *
 * A clip item (`segment: {start, end}`: one song cut from a concert) plays
 * inside its recording's clock. Sizing a bump off the recording (duration / 50)
 * jumped ~2 minutes inside a 2-minute song and out the far side into the next
 * piece. With a clip window the bump is sized to the clip and never leaves it;
 * without one, the whole-file rule is unchanged.
 *
 * Pure.
 */

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The item's clip window, or null when it is not a real span. */
export function clipWindow(item) {
  const s = item?.segment;
  if (!s || !isFiniteNumber(s.start) || !isFiniteNumber(s.end) || s.end <= s.start) return null;
  return { start: s.start, end: s.end };
}

/**
 * Seconds per bump: a twelfth of the clip (5–20 s), else a fiftieth of the
 * file (at least 5 s), else 10 s when nothing is known.
 */
export function bumpIncrement(duration, window) {
  if (window) return clamp(Math.round((window.end - window.start) / 12), 5, 20);
  if (isFiniteNumber(duration) && duration > 0) return Math.max(5, Math.floor(duration / 50));
  return 10;
}

/** Where a bump lands: inside the clip window when there is one, else the file. */
export function bumpTarget(current, delta, window, duration) {
  const at = (isFiniteNumber(current) ? current : 0) + delta;
  if (window) return clamp(at, window.start, window.end);
  const hi = isFiniteNumber(duration) && duration > 0 ? duration : Infinity;
  return clamp(at, 0, hi);
}
