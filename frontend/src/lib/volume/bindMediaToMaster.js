import { getEffectiveMaster, getMasterMuted, subscribeMaster } from './ScreenVolumeContext.js';

/**
 * Make a raw HTMLMediaElement obey the screen's software master volume.
 *
 * Anything created with `new Audio()` outside the Player plays at the
 * element's default gain of 1, which on a wall panel means full volume no
 * matter what the volume keys say. The Sentence Ladder shipped that way:
 * the buttons stepped the master and the sentence kept coming out at 100%.
 *
 * Sets the gain now and follows every later step. Returns the unsubscribe;
 * call it when the element is thrown away.
 *
 * @param {HTMLMediaElement} el
 * @param {number} [local=1] the element's own level, multiplied by the master
 */
export function bindMediaToMaster(el, local = 1) {
  if (!el) return () => {};
  const apply = () => {
    const level = Math.max(0, Math.min(1, getEffectiveMaster() * local));
    try {
      el.volume = level;
      el.muted = getMasterMuted() || level === 0;
    } catch { /* a detached element can refuse; nothing to do */ }
  };
  apply();
  return subscribeMaster(apply);
}

export default bindMediaToMaster;
