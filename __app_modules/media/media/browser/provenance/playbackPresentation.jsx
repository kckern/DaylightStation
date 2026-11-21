/**
 * The Media app's video presentation: the content filter's chrome, timed
 * around the provenance intro. The intro itself (the streaming-service scene)
 * is supplied to the Player through `useMediaVideoIntro`; the Player gates on
 * it and passes its stage back here as `introStage`.
 *
 * The filter's opening bumper waits while the intro is up and until the lines
 * have met and the field has dissolved (`linkedMs + dissolveMs` into playback), so the two never cover each
 * other. With no intro (`off` or no stage) the bumper behaves as before.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import { useEffect, useState } from 'react';
import { useMediaVideoPresentation } from '../content-filter/videoPresentation.jsx';
import { useProvenanceIntro } from './useProvenanceIntro.jsx';
import { SCENE_TIMING } from './useSceneTimeline.js';

const INTRO_UP = new Set(['waiting', 'covering', 'holding']);

/**
 * True while the intro covers the opening, and briefly after the film starts.
 * Synchronous on the first `playing` render: the hold is on until a timer
 * releases it, so the bumper cannot slip in before that timer is even set.
 */
export function useBumperHeld(introStage, linkedMs = SCENE_TIMING.linkedMs + SCENE_TIMING.dissolveMs) {
  const playing = introStage === 'playing';
  const [released, setReleased] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => setReleased(true), linkedMs);
    return () => { clearTimeout(t); setReleased(false); };
  }, [playing, linkedMs]);
  return INTRO_UP.has(introStage) || (playing && !released);
}

export function useMediaPlaybackPresentation({ media, isPlex, getMediaEl, introStage }) {
  const bumperHeld = useBumperHeld(introStage);
  return useMediaVideoPresentation({ media, isPlex, getMediaEl, bumperHeld });
}

export const useMediaVideoIntro = useProvenanceIntro;
