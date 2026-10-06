// frontend/src/modules/Player/lib/musicBehindPolicy.js
//
// When music behind a slideshow (RQ-PLAY-12) must end. One rule for both
// surfaces (this device and a screen), so a slideshow that gives way to a
// video never leaves two soundtracks playing:
//   - photos on screen            → stay (Keep is chosen while they still show)
//   - something with its own sound → stop, whatever the person chose
//   - nothing on screen            → stop, unless the person chose Keep
//     (a load between two items is not "nothing")
import { isSlideshowItem } from '@shared-contracts/media/playerFeatures.mjs';

const TRANSIENT = new Set(['playing', 'paused', 'buffering', 'loading', 'stalled']);

/** @returns {'stay'|'stop'} */
export function musicBehindVerdict({ item = null, state = null, keep = false } = {}) {
  if (item) return isSlideshowItem(item) ? 'stay' : 'stop';
  if (TRANSIENT.has(state)) return 'stay';
  return keep ? 'stay' : 'stop';
}
