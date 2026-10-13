/** Cumulative end fractions per chord, or null when durations are unusable. */
export function cumulativeBounds(durations, count) {
  if (!Array.isArray(durations) || durations.length !== count) return null;
  const total = durations.reduce((sum, duration) => sum + (duration > 0 ? duration : 0), 0);
  if (!(total > 0)) return null;
  const bounds = [];
  let elapsed = 0;
  for (const duration of durations) {
    elapsed += Math.max(0, duration);
    bounds.push(elapsed / total);
  }
  return bounds;
}
