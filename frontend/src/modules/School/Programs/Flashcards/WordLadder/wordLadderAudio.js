import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import { wordLadderLog } from './wordLadderLog.js';

/**
 * ONE AUDIO LANE. Every word-ladder clip goes through `startClip`, and
 * starting a clip stops whichever one is already playing — a tapped Hear-it
 * never talks over an autoplayed word, and a take played back on one item
 * never carries into the next. `stopAudio()` empties the lane (the program
 * calls it on unmount).
 */
let current = null;

/** Stop whatever the lane is playing. */
export function stopAudio() {
  current?.stop();
  current = null;
}

/**
 * Start one clip at the panel's master volume. `done` resolves true when it
 * ended, false otherwise (error, blocked, or stopped); `stop()` halts it.
 * `stopped` reads true once it was halted (by `stop()` or by a newer clip).
 */
export function startClip(url) {
  stopAudio();
  if (!url) return { done: Promise.resolve(false), stop: () => {}, get stopped() { return false; } };
  const el = new Audio(url);
  const unbind = bindMediaToMaster(el);
  let finish;
  let stopped = false;
  const done = new Promise((resolve) => {
    let settled = false;
    finish = (ok) => {
      if (settled) return;
      settled = true;
      unbind?.();
      if (current === handle) current = null;
      resolve(ok);
    };
  });
  const handle = {
    done,
    stop: () => { stopped = true; el.pause(); finish(false); },
    get stopped() { return stopped; },
  };
  current = handle;
  el.onended = () => finish(true);
  el.onerror = () => finish(false);
  const result = el.play();
  if (result?.catch) result.catch((error) => { wordLadderLog.audioBlocked({ url, error: error?.message }); finish(false); });
  return handle;
}

/** Play one clip at the panel's master volume. Resolves true when it ended, false otherwise. */
export function playClip(url) {
  return startClip(url).done;
}

/** The learner's take, then the native audio — one after the other. A clip stopped by a newer one ends the sequence. */
export async function playSequence(urls) {
  for (const url of urls) {
    const clip = startClip(url);
    await clip.done;
    if (clip.stopped) return;
  }
}
