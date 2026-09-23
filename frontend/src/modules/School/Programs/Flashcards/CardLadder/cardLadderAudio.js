import { bindMediaToMaster } from '../../../../../lib/volume/bindMediaToMaster.js';
import { cardLadderLog } from './cardLadderLog.js';
import { currentInput } from './inputVia.js';

/**
 * ONE AUDIO LANE. Every card-ladder clip goes through `startClip`, and
 * starting a clip stops whichever one is already playing — a tapped Hear-it
 * never talks over an autoplayed word, and a take played back on one item
 * never carries into the next. `stopAudio()` empties the lane (the program
 * calls it on unmount).
 *
 * `audio.played` (spec §8) is logged from HERE, and only from here — the one
 * place that knows how a clip actually finished: `{clip, trigger, input?,
 * outcome}`. `clip` is the caller's own label for what the clip was
 * (`'term'`, `'gloss'`, `'take'`, …); `trigger` is `'auto'` (an autoplay —
 * the caller says so with `{trigger: 'auto'}`) or, when the caller does not
 * say, `'key'`/`'touch'` from the input that asked for it (`inputVia.js`,
 * with the exact key as `input`), else `'auto'`; `outcome` is `'ended'` |
 * `'error'` | `'blocked'` (the latter two log at warn). A clip cut off early —
 * `stop()` called explicitly, or superseded by a newer clip — is neither a
 * success nor a failure the spec has a name for, so it logs nothing.
 */
let current = null;

/** Stop whatever the lane is playing. */
export function stopAudio() {
  current?.stop();
  current = null;
}

/**
 * Start one clip at the panel's master volume. `done` resolves the outcome —
 * `'ended'` | `'error'` | `'blocked'` | `null` (stopped early, no reportable
 * outcome) — never throws; `stop()` halts it. `stopped` reads true once it
 * was halted (by `stop()` or by a newer clip).
 */
function triggerFor(explicit) {
  if (explicit) return { trigger: explicit };
  const input = currentInput();
  if (!input) return { trigger: 'auto' };
  return { trigger: input === 'touch' ? 'touch' : 'key', input };
}

export function startClip(url, kind = null, { trigger = null } = {}) {
  stopAudio();
  const how = triggerFor(trigger);
  if (!url) return { done: Promise.resolve(null), stop: () => {}, get stopped() { return false; } };
  const el = new Audio(url);
  const unbind = bindMediaToMaster(el);
  let finish;
  let stopped = false;
  const done = new Promise((resolve) => {
    let settled = false;
    finish = (outcome) => {
      if (settled) return;
      settled = true;
      unbind?.();
      if (current === handle) current = null;
      if (outcome) cardLadderLog.audioPlayed({ clip: kind, ...how, outcome });
      resolve(outcome);
    };
  });
  const handle = {
    done,
    stop: () => { stopped = true; el.pause(); finish(null); },
    get stopped() { return stopped; },
  };
  current = handle;
  el.onended = () => finish('ended');
  el.onerror = () => finish('error');
  const result = el.play();
  if (result?.catch) result.catch(() => finish('blocked'));
  return handle;
}

/** Play one clip at the panel's master volume. Resolves the outcome string (see `startClip`). */
export function playClip(url, kind = null, opts = {}) {
  return startClip(url, kind, opts).done;
}

/**
 * The learner's take, then the native audio — one after the other. A clip
 * stopped by a newer one ends the sequence. Each entry is either a plain url
 * (kind `null`) or `{url, kind}`.
 */
export async function playSequence(clips, opts = {}) {
  for (const entry of clips) {
    const { url, kind = null } = typeof entry === 'string' ? { url: entry } : entry;
    const clip = startClip(url, kind, opts);
    await clip.done;
    if (clip.stopped) return;
  }
}
