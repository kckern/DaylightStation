import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'study-loop' });
  return _logger;
}

// Absorbs float jitter and normal decode drift near the boundary. Also the margin used
// to distinguish "the user scrubbed before the window" from ordinary rounding noise at
// win.start.
const BOUNDARY_TOLERANCE_SEC = 1;

/**
 * Computes a loop window anchored to the paused position.
 *
 * There is deliberately no endpoint marking: the paused position is one edge, and the
 * caller picks which side and how long. Backward means "I just watched that, run it
 * again"; forward means "run what comes next".
 *
 * @returns {{start: number, end: number}|null} null for degenerate/unknown windows
 */
export function computeLoopWindow(direction, seconds, position, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(position) || !Number.isFinite(seconds) || seconds <= 0) return null;
  const p = Math.min(Math.max(position, 0), duration);
  const start = direction === 'back' ? Math.max(0, p - seconds) : p;
  const end = direction === 'back' ? p : Math.min(duration, p + seconds);
  if (end - start <= 0) return null;
  return { start, end };
}

/**
 * Repeats a fixed window until released.
 *
 * Subtleties this hook owns:
 *  - Its own boundary seek (reaching `win.end`, jumping back to `win.start`) must NOT
 *    count as a user seek, or the loop would release itself on the first repetition.
 *    This hook does NOT expose a flag for callers to check - a "was the last seek
 *    mine" flag is sticky and un-correlated (nothing marks it consumed between the
 *    loop's own re-seeks), so a caller reading it after the fact can observe a stale
 *    `true` left over from a previous repetition and wrongly skip releasing on a real
 *    user seek. Instead the boundary re-seek calls `onSeek` directly and bypasses
 *    whatever seek wrapper the caller uses for user-initiated seeks entirely - by
 *    construction, anything that reaches the caller's user-seek wrapper IS a user seek,
 *    with no flag or timing window required.
 *  - The two directions of leaving the window mean different things and are handled
 *    differently. Reaching `win.end` is the loop's own edge - re-seek and keep looping.
 *    Falling below `win.start` (beyond tolerance) is a deliberate user scrub backward out
 *    of the window - our own boundary seek always lands exactly on `win.start`, so
 *    anything further back can only be a manual escape. Release, don't re-seek, and don't
 *    mark it as our own seek - dragging the user back in would hijack the escape.
 *  - A freshly-armed loop starts with `currentTime` already sitting exactly at the edge it
 *    was armed from (a backward loop's `end` equals the pause position passed to
 *    `armLoop`). Without a latch, the very next `timeupdate` tick would immediately trip
 *    the "reached end" check with zero playthrough. The check is skipped on ticks where
 *    `currentTime` hasn't moved from the arm-time snapshot yet; once it moves at all, the
 *    latch opens for the rest of this armed session.
 *  - A forward loop clamped at `duration` (see `computeLoopWindow`) never sees a
 *    `timeupdate` past `win.end` - the media fires `ended` and stops instead. `ended` is
 *    handled the same as reaching the boundary, and since `ended` leaves the element
 *    paused, the loop also resumes playback.
 *  - A resilience remount REPLACES the media element, so a once-bound `timeupdate`
 *    listener would die silently mid-loop. The element is re-resolved on an interval
 *    and the listener re-bound whenever identity changes.
 *  - A loop belongs to ONE item. Advancing the queue swaps the played item but not this
 *    hook instance or its `loopRef`, and the live `timeupdate` listener would then drag
 *    the NEW item back into the OLD item's window — resume positions are routinely
 *    non-zero, so the window is usually reachable, and the next item may be an ordinary
 *    workout with no visible loop control to release it with. `itemKey` releases the loop
 *    when the played item changes.
 *
 * @param {string|number|null} [options.itemKey] stable identity of the played item
 *   (contentId/id). MUST be a primitive: object identity changes on unrelated re-renders
 *   and would release an armed loop mid-loop.
 * @param {Function} [options.onPlay] starts playback. Arming a window is a "run this now"
 *   gesture, so `armLoop` calls this — the loop is chosen while paused and must not sit
 *   there waiting for a separate play tap.
 */
export default function useLoopWindow({ getMediaElement, onSeek, itemKey = null, onPlay }) {
  const [loop, setLoop] = useState(null);
  const loopRef = useRef(null);
  const armPositionRef = useRef(null);
  const hasEnteredRef = useRef(false);
  const [element, setElement] = useState(null);

  // Track element replacement (resilience remounts swap it out from under us).
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      const next = getMediaElement?.() || null;
      if (!cancelled) setElement((prev) => (prev === next ? prev : next));
    };
    sync();
    const id = setInterval(sync, 500);
    return () => { cancelled = true; clearInterval(id); };
  }, [getMediaElement]);

  const releaseLoop = useCallback(() => {
    if (!loopRef.current) return;
    logger().info('loop-released', loopRef.current);
    loopRef.current = null;
    setLoop(null);
  }, []);

  // Release on item change. Keyed off the PRIMITIVE `itemKey`, and compared against the
  // last key we acted on rather than relying on effect-run count, so an unrelated
  // re-render (or a parent handing back an equal-but-new object) cannot mis-fire and
  // release a loop the viewer is still using. Seeded with the initial key so the mount
  // run is a no-op.
  const lastItemKeyRef = useRef(itemKey);
  useEffect(() => {
    if (lastItemKeyRef.current === itemKey) return;
    lastItemKeyRef.current = itemKey;
    releaseLoop();
  }, [itemKey, releaseLoop]);

  useEffect(() => {
    if (!element) return undefined;

    const onTimeUpdate = () => {
      const win = loopRef.current;
      if (!win) return;
      const t = element.currentTime;

      if (!hasEnteredRef.current) {
        if (t === armPositionRef.current) return;
        hasEnteredRef.current = true;
      }

      if (t >= win.end) {
        onSeek?.(win.start);
        return;
      }

      if (t < win.start - BOUNDARY_TOLERANCE_SEC) {
        releaseLoop();
      }
    };

    const onEnded = () => {
      const win = loopRef.current;
      if (!win) return;
      onSeek?.(win.start);
      // play() returns a promise that can reject (autoplay policy, interrupted-by-pause,
      // element torn down mid-call). Swallow it - matches FitnessPlayer.jsx:616's
      // mediaElement.play().catch(() => {}) convention - so it never surfaces as an
      // unhandled rejection.
      element.play?.()?.catch?.(() => {});
    };

    element.addEventListener('timeupdate', onTimeUpdate);
    element.addEventListener('ended', onEnded);
    return () => {
      element.removeEventListener('timeupdate', onTimeUpdate);
      element.removeEventListener('ended', onEnded);
    };
  }, [element, onSeek, releaseLoop]);

  const armLoop = useCallback((direction, seconds, position, duration) => {
    const win = computeLoopWindow(direction, seconds, position, duration);
    if (!win) {
      logger().warn('loop-window-degenerate', { direction, seconds, position, duration });
      return;
    }
    const next = { ...win, direction, seconds };
    loopRef.current = next;
    armPositionRef.current = position;
    hasEnteredRef.current = false;
    setLoop(next);
    logger().info('loop-armed', next);
    // Arming starts playback — the window was picked while paused and the design is that
    // it then repeats hands-free. `onPlay` may return undefined (usePlayerController's
    // `play` does) or a promise that rejects (autoplay policy, element torn down
    // mid-call); the optional-chained catch covers both, matching the `onEnded` guard
    // above.
    onPlay?.()?.catch?.(() => {});
  }, [onPlay]);

  // Stable identity across renders: callers (FitnessPlayer's handleUserSeek) depend on
  // this object's identity in their own useCallback deps, so a fresh literal here would
  // cascade into every downstream memoized seek handler re-creating on every render.
  return useMemo(() => ({ loop, armLoop, releaseLoop }), [loop, armLoop, releaseLoop]);
}
