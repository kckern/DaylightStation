import { getEffectiveMaster } from '@/lib/volume/ScreenVolumeContext.js';

/**
 * Play a sound effect by URL. No-op (silent) when the URL is null/empty so
 * unconfigured sounds simply don't play — config drives whether a sound exists.
 * Never throws (browser autoplay policies can reject playback). The effect is
 * scaled by the screen master volume so it honors the global control.
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
    const local = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    let master = 1;
    try { master = getEffectiveMaster(); } catch { master = 1; }
    audio.volume = Math.max(0, Math.min(1, local * (Number.isFinite(master) ? master : 1)));
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* attempted; ignore */ }
  return true;
}

export default playSound;
