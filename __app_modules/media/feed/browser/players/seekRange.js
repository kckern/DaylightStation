export function getSeekMax(duration) {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}
