// The cycle the rate button steps through. Pure + tiny so it's trivially testable
// and shared between the Player (which owns the rate) and tests.
export const PLAYBACK_RATES = [1, 1.5, 2];

/**
 * @param {number|null|undefined} current
 * @returns {number} the next rate in the cycle (unknown/absent → first step, 1.5)
 */
export function nextPlaybackRate(current) {
  const idx = PLAYBACK_RATES.indexOf(current);
  // Unknown/absent (idx === -1) is treated as the 1× slot, so the next is 1.5.
  const base = idx === -1 ? 0 : idx;
  return PLAYBACK_RATES[(base + 1) % PLAYBACK_RATES.length];
}
