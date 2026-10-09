/**
 * Fraction [0,1] elapsed from a tick timestamp toward the next tick. Saturates at 1
 * when a tick is overdue, so an interpolated value freezes at the latest data
 * instead of mid-glide. Pure — feed performance.now() from the caller.
 */
export function tickFraction(nowMs, tickAtMs, tickMs) {
  if (!(tickMs > 0)) return 1;
  const f = (nowMs - tickAtMs) / tickMs;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export default tickFraction;
