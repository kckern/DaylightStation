import { useCallback, useEffect, useRef, useState } from 'react';
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
 *    Callers check `isBoundarySeek()` before releasing.
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
 */
export default function useLoopWindow({ getMediaElement, onSeek }) {
  const [loop, setLoop] = useState(null);
  const loopRef = useRef(null);
  const boundarySeekRef = useRef(false);
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
        boundarySeekRef.current = true;
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
      boundarySeekRef.current = true;
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
  }, []);

  /** True (once) if the most recent seek was the loop's own boundary seek. */
  const isBoundarySeek = useCallback(() => {
    const was = boundarySeekRef.current;
    boundarySeekRef.current = false;
    return was;
  }, []);

  return { loop, armLoop, releaseLoop, isBoundarySeek };
}
