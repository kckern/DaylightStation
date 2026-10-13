// abLoop.js
// Pure A–B loop boundary logic. Given the current playhead and the A/B marks,
// returns the time to seek to (loop back to A) or null for no-op. Only the end
// boundary loops; an unset or invalid range (b <= a) never seeks.
export function resolveLoopSeek(current, a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= a) return null;
  if (Number.isFinite(current) && current >= b) return a;
  return null;
}
