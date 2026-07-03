import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * useScoreTransport — non-looping playback over a flat, time-sorted event list
 * [{t, ...}] (ms from piece start). rAF + performance.now() anchor, mirroring
 * the proven loop/Studio transports: every tick fires all events whose t has
 * passed, so lateness never accumulates (audit A2). Pause stores the exact
 * position; play resumes from it; seek(ms) repositions (audit A5).
 *
 * Consumers do the real work in onEvent (cursor step, MIDI out) — the
 * transport itself is domain-blind.
 */
export function useScoreTransport({ timeline, onEvent, onDone }) {
  const [playing, setPlaying] = useState(false);
  const timelineRef = useRef(timeline); timelineRef.current = timeline || [];
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  const rafRef = useRef(null);
  const anchorRef = useRef(0); // wall time corresponding to position 0
  const posRef = useRef(0);    // position while paused (ms)
  const idxRef = useRef(0);    // next unfired event

  const tick = useCallback(() => {
    const tl = timelineRef.current;
    const pos = performance.now() - anchorRef.current;
    while (idxRef.current < tl.length && tl[idxRef.current].t <= pos) {
      onEventRef.current?.(tl[idxRef.current]);
      idxRef.current += 1;
    }
    if (idxRef.current >= tl.length) {
      posRef.current = 0; idxRef.current = 0;
      setPlaying(false);
      onDoneRef.current?.();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(() => {
    if (!timelineRef.current.length) return;
    anchorRef.current = performance.now() - posRef.current;
    cancelAnimationFrame(rafRef.current);
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    posRef.current = performance.now() - anchorRef.current;
    setPlaying(false);
  }, []);

  /** Reposition (works while playing or paused). Event at exactly `ms` will fire. */
  const seek = useCallback((ms) => {
    const pos = Math.max(0, ms);
    posRef.current = pos;
    const tl = timelineRef.current;
    const i = tl.findIndex((e) => e.t >= pos);
    idxRef.current = i < 0 ? tl.length : i;
    anchorRef.current = performance.now() - pos;
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    posRef.current = 0; idxRef.current = 0;
    setPlaying(false);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  return { playing, play, pause, seek, stop };
}

export default useScoreTransport;
