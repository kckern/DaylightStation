/**
 * Sound-effect playback for the side-scroller game.
 *
 * Sounds come from the theme (`theme.sounds`), keyed by game event
 * (jump/duck/hit/dodge/levelup/gameover/start). Every path defaults to null —
 * a null/missing path is a silent no-op, so the game is silent until real
 * assets are configured. See the theme design doc.
 *
 * Autoplay note: the Piano kiosk already runs an AudioContext (synth voices),
 * but HTMLAudioElement.play() is gated separately; play() rejection is swallowed
 * and logged rather than thrown.
 */
import { useMemo } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';

function defaultCreateAudio(src) {
  const el = new Audio();
  el.src = src;
  el.preload = 'auto';
  return el;
}

/**
 * Build an SFX player from a `{ name: path|null }` map. Preloads one audio
 * element per non-null path; play(name) clones it so rapid re-triggers overlap.
 * Returns { play(name) -> boolean } where the boolean is "attempted playback".
 */
export function createSfxPlayer(sounds = {}, { createAudio = defaultCreateAudio, logger } = {}) {
  const log = logger ?? getChildLogger({ component: 'side-scroller-sfx' });
  const elements = {};
  for (const [name, path] of Object.entries(sounds)) {
    if (path) elements[name] = createAudio(path);
  }

  function play(name) {
    const base = elements[name];
    if (!base) return false; // null path or unknown name → silent no-op
    const el = typeof base.cloneNode === 'function' ? base.cloneNode() : base;
    el.currentTime = 0;
    try {
      const result = el.play();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => log.warn('side-scroller.sfx-blocked', { name, error: err?.message }));
      }
    } catch (err) {
      log.warn('side-scroller.sfx-blocked', { name, error: err?.message });
    }
    return true;
  }

  return { play };
}

/** React hook: memoize an SFX player for the resolved theme sounds. */
export function useSideScrollerSfx(sounds) {
  return useMemo(() => createSfxPlayer(sounds), [sounds]);
}
