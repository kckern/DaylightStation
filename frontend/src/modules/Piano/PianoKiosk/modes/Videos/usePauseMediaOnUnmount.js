import { useEffect, useRef } from 'react';

/**
 * Guarantees the media stops when the piano video player leaves the screen.
 * The shared engine's unmount cleanup only pauses shadow-DOM <dash-video>; a
 * native <video> (file-served lecture) is never paused, and a DOM-detached
 * HTMLMediaElement keeps emitting audio. We hold the latest resolved element and
 * pause it on unmount — belt-and-suspenders, element-type agnostic.
 */
export default function usePauseMediaOnUnmount(mediaEl) {
  const ref = useRef(mediaEl);
  useEffect(() => { ref.current = mediaEl; }, [mediaEl]);
  useEffect(() => () => { try { ref.current?.pause?.(); } catch { /* detached/gone */ } }, []);
}
