import { useCallback, useEffect, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'study-loop' });
  return _logger;
}

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
 * Two subtleties this hook owns:
 *  - Its own boundary seek must NOT count as a user seek, or the loop would release
 *    itself on the first repetition. Callers check `isBoundarySeek()` before releasing.
 *  - A resilience remount REPLACES the media element, so a once-bound `timeupdate`
 *    listener would die silently mid-loop. The element is re-resolved on an interval
 *    and the listener re-bound whenever identity changes.
 */
export default function useLoopWindow({ getMediaElement, onSeek }) {
  const [loop, setLoop] = useState(null);
  const loopRef = useRef(null);
  const boundarySeekRef = useRef(false);
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

  useEffect(() => {
    if (!element) return undefined;
    const onTimeUpdate = () => {
      const win = loopRef.current;
      if (!win) return;
      if (element.currentTime >= win.end || element.currentTime < win.start - 1) {
        boundarySeekRef.current = true;
        onSeek?.(win.start);
      }
    };
    element.addEventListener('timeupdate', onTimeUpdate);
    return () => element.removeEventListener('timeupdate', onTimeUpdate);
  }, [element, onSeek]);

  const armLoop = useCallback((direction, seconds, position, duration) => {
    const win = computeLoopWindow(direction, seconds, position, duration);
    if (!win) {
      logger().warn('loop-window-degenerate', { direction, seconds, position, duration });
      return;
    }
    const next = { ...win, direction, seconds };
    loopRef.current = next;
    setLoop(next);
    logger().info('loop-armed', next);
  }, []);

  const releaseLoop = useCallback(() => {
    if (!loopRef.current) return;
    logger().info('loop-released', loopRef.current);
    loopRef.current = null;
    setLoop(null);
  }, []);

  /** True (once) if the most recent seek was the loop's own boundary seek. */
  const isBoundarySeek = useCallback(() => {
    const was = boundarySeekRef.current;
    boundarySeekRef.current = false;
    return was;
  }, []);

  return { loop, armLoop, releaseLoop, isBoundarySeek };
}
