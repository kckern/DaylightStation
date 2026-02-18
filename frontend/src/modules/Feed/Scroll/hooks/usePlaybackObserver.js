import { useState, useEffect, useCallback, useRef } from 'react';
import { feedLog } from '../feedLog.js';

/**
 * Observes playback state from a Player ref.
 * Returns React state (updated ~2x/sec) and a progressElRef for rAF DOM updates.
 *
 * INVARIANT: progressElRef can only be assigned to ONE DOM element at a time.
 * This works because the mini bar and detail view are mutually exclusive in the
 * render tree (mini bar hides when urlSlug is set). If that changes, convert to
 * a multi-element pattern (Set of elements iterated in the rAF loop).
 *
 * @param {React.RefObject} playerRef - ref to Player imperative handle
 * @param {boolean} active - whether to poll (true when activeMedia is set)
 */
export function usePlaybackObserver(playerRef, active) {
  const [state, setState] = useState({ playing: false, currentTime: 0, duration: 0 });
  const progressElRef = useRef(null);
  const rafIdRef = useRef(null);

  // Coarse React state update (~500ms)
  useEffect(() => {
    if (!active) {
      feedLog.player('observer inactive — resetting state');
      setState({ playing: false, currentTime: 0, duration: 0 });
      return;
    }

    feedLog.player('observer active — starting 500ms poll');
    let prevPlaying = null;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) { feedLog.player('poll: playerRef.current is null'); return; }
      const currentTime = p.getCurrentTime?.() || 0;
      const duration = p.getDuration?.() || 0;
      const el = p.getMediaElement?.();
      const playing = el ? !el.paused : false;
      if (playing !== prevPlaying) {
        feedLog.player('state change', { playing, currentTime: currentTime.toFixed(1), duration: duration.toFixed(1) });
        prevPlaying = playing;
      }
      setState({ playing, currentTime, duration });
    }, 500);

    return () => clearInterval(id);
  }, [playerRef, active]);

  // Fine-grained progress bar update (rAF, direct DOM)
  useEffect(() => {
    if (!active) return;

    const tick = () => {
      const p = playerRef.current;
      const el = progressElRef.current;
      if (p && el) {
        const cur = p.getCurrentTime?.() || 0;
        const dur = p.getDuration?.() || 0;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        el.style.width = `${pct}%`;
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [playerRef, active]);

  const [speed, setSpeedState] = useState(1);

  const toggle = useCallback(() => {
    feedLog.player('toggle');
    playerRef.current?.toggle?.();
  }, [playerRef]);

  const seek = useCallback((t) => {
    feedLog.player('seek', { to: t });
    playerRef.current?.seek?.(t);
  }, [playerRef]);

  const setSpeed = useCallback((rate) => {
    feedLog.player('setSpeed', { rate });
    const el = playerRef.current?.getMediaElement?.();
    if (el) el.playbackRate = rate;
    setSpeedState(rate);
  }, [playerRef]);

  return { ...state, toggle, seek, speed, setSpeed, progressElRef };
}
