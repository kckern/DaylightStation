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
registerEffectHandler('mute', {
  kind: EFFECT_KINDS.AUDIO,
  onEnter({ el }) { el.muted = true; },
  onExit({ el }) { el.muted = false; },
});

registerEffectHandler('bleep', {
  kind: EFFECT_KINDS.AUDIO,
  onEnter({ el, cue, sfx }) { el.muted = true; if (cue.sound) sfx?.play?.(cue.sound); },
  onExit({ el, sfx }) { el.muted = false; sfx?.stop?.(); },
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
registerEffectHandler('full-blur', { kind: EFFECT_KINDS.OVERLAY });   // whole-frame blur/black
registerEffectHandler('title-card', { kind: EFFECT_KINDS.OVERLAY });  // standalone plot/warning card
