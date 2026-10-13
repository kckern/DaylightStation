/**
 * Play a sound effect by URL. No-op (silent) when the URL is null/empty so
 * unconfigured sounds simply don't play — config drives whether a sound exists.
 * Never throws (browser autoplay policies can reject playback). Pass `volume`
 * (0–1) already scaled by the caller's master volume.
 *
 * @param {string|null|undefined} url
 * @param {{ volume?: number }} [opts]
 * @returns {boolean} true if playback was attempted
 */
export function playSound(url, { volume = 1 } = {}) {
  if (!url || typeof url !== 'string') return false;
  if (typeof Audio === 'undefined') return false;
  let audio;
  try {
    audio = new Audio(url);
  } catch {
    return false;
  }
  // Playback itself may reject (autoplay policy, or unimplemented under jsdom) —
  // that's fine; the effect was attempted. Swallow the error and report attempted.
  try {
    audio.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* attempted; ignore */ }
  return true;
}

export default playSound;
