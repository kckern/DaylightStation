import { shuffleOrder } from '../../../../../lib/Player/playlist.js';

// Pure queue/order logic for the Music jukebox. `order` is a permutation of
// track indices [0..len-1]; `pos` indexes into `order`; the playing track index
// is order[pos]. Reuses the shared Fisher–Yates shuffle from lib/Player.

/** Build a play order over [0..len-1]; shuffled when `shuffle`, else identity. */
export function buildOrder(len, shuffle) {
  if (!(len > 0)) return [];
  if (!shuffle) return Array.from({ length: len }, (_, i) => i);
  return shuffleOrder(len);
}

/** Next position in `order`; wraps to 0 when `repeat`, else -1 past the end. */
export function nextPos(order, pos, repeat) {
  const len = Array.isArray(order) ? order.length : 0;
  if (len === 0) return -1;
  if (pos + 1 < len) return pos + 1;
  return repeat ? 0 : -1;
}

/** Previous position in `order`; wraps to the end when `repeat`, else clamps at 0. */
export function prevPos(order, pos, repeat) {
  const len = Array.isArray(order) ? order.length : 0;
  if (len === 0) return -1;
  if (pos - 1 >= 0) return pos - 1;
  return repeat ? len - 1 : 0;
}
