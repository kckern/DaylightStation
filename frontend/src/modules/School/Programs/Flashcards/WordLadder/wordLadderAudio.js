import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import { wordLadderLog } from './wordLadderLog.js';

/**
 * Start one clip at the panel's master volume. `done` resolves true when it
 * ended, false otherwise (error, blocked, or stopped); `stop()` halts it.
 */
export function startClip(url) {
  if (!url) return { done: Promise.resolve(false), stop: () => {} };
  const el = new Audio(url);
  const unbind = bindMediaToMaster(el);
  let finish;
  const done = new Promise((resolve) => {
    let settled = false;
    finish = (ok) => { if (settled) return; settled = true; unbind?.(); resolve(ok); };
  });
  el.onended = () => finish(true);
  el.onerror = () => finish(false);
  const result = el.play();
  if (result?.catch) result.catch((error) => { wordLadderLog.audioBlocked({ url, error: error?.message }); finish(false); });
  return { done, stop: () => { el.pause(); finish(false); } };
}

/** Play one clip at the panel's master volume. Resolves true when it ended, false otherwise. */
export function playClip(url) {
  return startClip(url).done;
}

/** The learner's take, then the native audio — one after the other. */
export async function playSequence(urls) {
  for (const url of urls) {
    await playClip(url);
  }
}
