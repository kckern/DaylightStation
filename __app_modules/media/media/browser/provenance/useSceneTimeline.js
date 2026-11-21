/**
 * useSceneTimeline — the provenance scene's phase, driven by the Player's intro stage.
 *
 * The Player owns the gate (covering/holding until the hold is over and the
 * video is ready); this hook only draws the scene's own choreography:
 *   covering | holding -> linking   (lines creep in)
 *   playing (entered)  -> linked    (lines meet), then docked, leaving, done
 *   anything else      -> null      (no scene)
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { useEffect, useState } from 'react';

export const SCENE_TIMING = Object.freeze({
  linkMinMs: 5000,  // the scene holds for a random time in this range
  linkMaxMs: 10000, //   (the Player holds longer if the video is still loading)
  linkedMs: 700,    // lines meet; the scene starts to clear
  dissolveMs: 900,  // field dissolves and the logo moves to the corner (matches the SCSS transitions)
  dockMs: 4000,     // logo in the corner
  leaveMs: 900,     // corner logo fades
});

/** A hold length in [min, max] ms. `random` is injectable for tests. */
export function pickLinkMs(timing = SCENE_TIMING, random = Math.random) {
  const min = timing.linkMinMs, max = Math.max(min, timing.linkMaxMs);
  return Math.round(min + random() * (max - min));
}

export function useSceneTimeline(stage, timing = SCENE_TIMING) {
  const playing = stage === 'playing';
  const [after, setAfter] = useState('linked');

  useEffect(() => {
    if (!playing) return undefined;
    const timers = [];
    const at = (ms, next) => timers.push(setTimeout(() => setAfter(next), ms));
    at(timing.linkedMs, 'docked');
    at(timing.linkedMs + timing.dockMs, 'leaving');
    at(timing.linkedMs + timing.dockMs + timing.leaveMs, 'done');
    return () => { timers.forEach(clearTimeout); setAfter('linked'); };
  }, [playing, timing]);

  if (stage === 'covering' || stage === 'holding') return 'linking';
  if (playing) return after;
  return null;
}
