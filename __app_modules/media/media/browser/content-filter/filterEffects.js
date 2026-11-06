/**
 * Content-filter EFFECT REGISTRY.
 *
 * Each filter effect (mute, bleep, skip, blur, censor-bar, title-card, …) is a
 * registered handler classified by `kind`:
 *   - transport: acts on the transport/timeline (seek). onActive fires every tick.
 *   - audio:     acts on the media element's audio. onEnter/onExit bracket the range.
 *   - overlay:   contributes a React overlay (rendered by <FilterOverlay>); no imperative fns.
 *
 * Adding a new effect = registerEffectHandler(name, handler). The hook and overlay
 * dispatch purely by name, so no other file changes. Handlers receive a context:
 *   { el, transport, cue, sfx, mem }
 * where `mem` is a per-hook scratch object handlers can use to stash prior state
 * (e.g. duck saving the pre-duck volume).
 */

export const EFFECT_KINDS = { TRANSPORT: 'transport', AUDIO: 'audio', OVERLAY: 'overlay' };

/** Seek this far past a skip cue's end so the same cue doesn't re-trigger. */
export const SKIP_EPSILON = 0.05;

const registry = new Map();

/** Register (or replace) an effect handler. */
export function registerEffectHandler(name, handler) {
  registry.set(name, { name, ...handler });
  return registry.get(name);
}

/** @returns {object|null} the handler, or null if unknown. */
export function getEffectHandler(name) {
  return registry.get(name) || null;
}

export function listEffectHandlers() {
  return [...registry.values()];
}

// ---- built-in handlers -----------------------------------------------------

// Transport
registerEffectHandler('skip', {
  kind: EFFECT_KINDS.TRANSPORT,
  onActive({ transport, cue }) { transport?.seek?.(cue.out + SKIP_EPSILON); },
});

// Audio
// Padded word cues can overlap (a cue's lead pad starts before the previous cue's
// trail pad ends), and exits run before enters each tick. So silencing is a hold
// count in `mem`, not a per-cue toggle: only the last entered cue's exit unmutes,
// and only the last sound holder's exit stops the bleep / named sound.
function holdMute(el, mem) { mem.muteHolds = (mem.muteHolds || 0) + 1; el.muted = true; }
function releaseMute(el, mem) {
  mem.muteHolds = Math.max(0, (mem.muteHolds || 0) - 1);
  if (mem.muteHolds === 0) el.muted = false;
}
function holdSound(mem) { mem.soundHolds = (mem.soundHolds || 0) + 1; }
function releaseSound(sfx, mem) {
  mem.soundHolds = Math.max(0, (mem.soundHolds || 0) - 1);
  if (mem.soundHolds === 0) sfx?.stop?.();
}

registerEffectHandler('mute', {
  kind: EFFECT_KINDS.AUDIO,
  onEnter({ el, mem }) { holdMute(el, mem); },
  onExit({ el, mem }) { releaseMute(el, mem); },
});

registerEffectHandler('bleep', {
  kind: EFFECT_KINDS.AUDIO,
  // The video is muted first, so if the tone cannot sound the word is still silenced.
  // The sound follows the set's volume, so a quiet TV doesn't get a full-level bleep.
  onEnter({ el, cue, sfx, mem }) {
    holdMute(el, mem);
    holdSound(mem);
    const opts = { volume: el.volume };
    if (cue.sound) sfx?.play?.(cue.sound, opts);
    else sfx?.tone?.(opts);
  },
  onExit({ el, sfx, mem }) { releaseMute(el, mem); releaseSound(sfx, mem); },
});

registerEffectHandler('duck', {
  kind: EFFECT_KINDS.AUDIO,
  onEnter({ el, cue, mem }) {
    mem.prevVolume = el.volume;
    el.volume = typeof cue.level === 'number' ? cue.level : 0.3;
  },
  onExit({ el, mem }) { el.volume = typeof mem.prevVolume === 'number' ? mem.prevVolume : 1; },
});

// Overlays (declarative — rendered by <FilterOverlay> keyed on effect name)
registerEffectHandler('blur', { kind: EFFECT_KINDS.OVERLAY });        // regional blur (rect)
registerEffectHandler('censor-bar', { kind: EFFECT_KINDS.OVERLAY });  // solid bar (rect)
registerEffectHandler('pixelate', { kind: EFFECT_KINDS.OVERLAY });    // pixelate (rect)
registerEffectHandler('full-blur', { kind: EFFECT_KINDS.OVERLAY });   // whole-frame blur/black (audio keeps playing)
registerEffectHandler('blackout', { kind: EFFECT_KINDS.OVERLAY });    // a scene's picture fully black, sound plays (scenes only)
// Standalone plot/warning card — visual overlay + OPTIONAL narration audio while shown.
registerEffectHandler('title-card', {
  kind: EFFECT_KINDS.OVERLAY,
  onEnter({ cue, sfx, mem }) { if (cue.sound) { holdSound(mem); sfx?.play?.(cue.sound); } },
  onExit({ cue, sfx, mem }) { if (cue.sound) releaseSound(sfx, mem); },
});
// skip-card is kept as one cue by the resolver (no skip + title-card expansion) and
// driven directly by useContentFilter's skip-card lifecycle (seek to `out`, pause
// behind the card, resume after holdSec). Registered so it's a recognized effect
// name (profiles may map a category to it).
registerEffectHandler('skip-card', { kind: EFFECT_KINDS.TRANSPORT });
