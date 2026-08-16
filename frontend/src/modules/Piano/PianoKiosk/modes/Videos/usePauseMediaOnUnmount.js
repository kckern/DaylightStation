import { useEffect, useRef } from 'react';

/**
 * Guarantees the media stops when the piano video player leaves the screen —
 * including media the player is no longer holding.
 *
 * The shared engine's unmount cleanup only pauses shadow-DOM <dash-video>; a
 * native <video> (file-served lecture) is never paused, and a DOM-detached
 * HTMLMediaElement keeps emitting audio with no DOM node, no React tree, and no
 * controls bound to it. That is the "audio playing from nowhere, can't find it,
 * can't stop it" failure.
 *
 * Tracking only the LATEST element is not enough, which is what the earlier
 * versions of this hook did. The engine SWAPS its element mid-playback (stall
 * recovery's soft-reinit, remount, the transient null gap useResolvedMediaEl
 * documents). On a swap the outgoing element is orphaned: still playing, and no
 * longer reachable by anyone. So we pause it at the moment identity changes, and
 * keep every element we have ever been handed so unmount can stop all of them.
 *
 * A transient null is deliberately IGNORED rather than treated as a swap — the
 * resolver re-emits through null and returns the same live element, so pausing
 * on null would stop playback the viewer is still watching.
 *
 * The retained set is bounded by the number of swaps in one mount and released
 * on unmount, so holding strong refs here costs nothing that outlives the
 * player. Iteration is why it is a Set and not a WeakSet.
 *
 * Residual gap, deliberately not papered over: an element created AND replaced
 * entirely between two resolver polls is never handed to this hook, so it cannot
 * be paused here. Closing that needs the engine to own its own teardown rather
 * than consumers pausing elements from outside.
 */
const safePause = (el) => { try { el?.pause?.(); } catch { /* detached/gone */ } };

export default function usePauseMediaOnUnmount(mediaEl) {
  const seen = useRef(null);
  if (seen.current === null) seen.current = new Set();
  const current = useRef(null);

  useEffect(() => {
    if (!mediaEl) return; // transient null gap — the live element is still ours
    const previous = current.current;
    if (previous && previous !== mediaEl) safePause(previous); // stop the orphan
    current.current = mediaEl;
    seen.current.add(mediaEl);
  }, [mediaEl]);

  useEffect(() => () => {
    seen.current.forEach(safePause);
    seen.current.clear();
    current.current = null;
  }, []);
}
