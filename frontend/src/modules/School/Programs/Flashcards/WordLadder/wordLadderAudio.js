import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import { wordLadderLog } from './wordLadderLog.js';

/** Play one clip at the panel's master volume. Resolves true when it ended, false otherwise. */
export function playClip(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    const el = new Audio(url);
    const unbind = bindMediaToMaster(el);
    const finish = (ok) => { unbind?.(); resolve(ok); };
    el.onended = () => finish(true);
    el.onerror = () => finish(false);
    const result = el.play();
    if (result?.catch) result.catch((error) => { wordLadderLog.audioBlocked({ url, error: error?.message }); finish(false); });
  });
}

/** The learner's take, then the native audio — one after the other. */
export async function playSequence(urls) {
  for (const url of urls) {
    await playClip(url);
  }
}
