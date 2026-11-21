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

/** True while the intro covers the opening, and briefly after the film starts. */
export function useBumperHeld(introStage, linkedMs = SCENE_TIMING.linkedMs + SCENE_TIMING.dissolveMs) {
  const playing = introStage === 'playing';
  const [linking, setLinking] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    setLinking(true);
    const t = setTimeout(() => setLinking(false), linkedMs);
    return () => { clearTimeout(t); setLinking(false); };
  }, [playing, linkedMs]);
  return INTRO_UP.has(introStage) || (playing && linking);
}

export function useMediaPlaybackPresentation({ media, isPlex, getMediaEl, introStage }) {
  const bumperHeld = useBumperHeld(introStage);
  return useMediaVideoPresentation({ media, isPlex, getMediaEl, bumperHeld });
}

export const useMediaVideoIntro = useProvenanceIntro;
