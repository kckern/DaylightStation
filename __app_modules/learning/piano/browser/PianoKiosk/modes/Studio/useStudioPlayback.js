import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { takeDuration } from './studioRecording.js';

/**
 * useStudioPlayback — a transport for a recorded take.
 *
 * Fires the take's note_on/note_off events on a wall-clock timeline via
 * pressNote/releaseNote (so it sounds on the piano AND drives the shared
 * activeNotes/noteHistory that the staff, waterfall, and keyboard render from).
 * Unlike a one-shot scheduleNotes() it is fully transport-controlled: play,
 * pause, restart, seek/scrub, and variable speed — with held notes correctly
 * reconstructed when you jump into the middle, and nothing left hanging.
 *
 * Position is exposed as a ref (positionRef) updated every frame so the scrubber
 * can animate smoothly without re-rendering the visualizer each frame.
 *
 * @param {{events: Array, pressNote: Function, releaseNote: Function}} p
 */
export function useStudioPlayback({ events, pressNote, releaseNote }) {
  const sorted = useMemo(
    () => [...(events || [])].sort((a, b) => (a.t ?? 0) - (b.t ?? 0)),
    [events],
  );
  const durationMs = useMemo(() => takeDuration(sorted), [sorted]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeedState] = useState(1);

  const positionRef = useRef(0);   // current playhead (ms)
  const basePosRef = useRef(0);    // playhead at the last (re)start
  const startWallRef = useRef(0);  // performance.now() at the last (re)start
  const firedIdxRef = useRef(0);   // next event index to fire
  const activeRef = useRef(new Set()); // notes currently sounded (for cleanup)
  const speedRef = useRef(1);
  const rafRef = useRef(null);

  const releaseAll = useCallback(() => {
    activeRef.current.forEach((n) => { try { releaseNote(n); } catch { /* ignore */ } });
    activeRef.current.clear();
  }, [releaseNote]);

  // Reset state to `target`, reconstructing which notes are held there; only
  // actually sound them when `sound` (i.e. we're playing through the seek).
  const primeTo = useCallback((target, sound) => {
    releaseAll();
    let idx = 0;
    const held = new Map();
    while (idx < sorted.length && (sorted[idx].t ?? 0) <= target) {
      const e = sorted[idx];
      if (e.type === 'note_on' && (e.velocity ?? 0) > 0) held.set(e.note, e.velocity);
      else held.delete(e.note);
      idx += 1;
    }
    firedIdxRef.current = idx;
    positionRef.current = target;
    basePosRef.current = target;
    if (sound) held.forEach((vel, note) => { pressNote(note, vel); activeRef.current.add(note); });
    return held;
  }, [sorted, releaseAll, pressNote]);

  const tick = useCallback(() => {
    const elapsed = basePosRef.current + (performance.now() - startWallRef.current) * speedRef.current;
    positionRef.current = Math.min(elapsed, durationMs);
    while (firedIdxRef.current < sorted.length && (sorted[firedIdxRef.current].t ?? 0) <= elapsed) {
      const e = sorted[firedIdxRef.current];
      if (e.type === 'note_on' && (e.velocity ?? 0) > 0) { pressNote(e.note, e.velocity); activeRef.current.add(e.note); }
      else { releaseNote(e.note); activeRef.current.delete(e.note); }
      firedIdxRef.current += 1;
    }
    if (elapsed >= durationMs) {
      positionRef.current = durationMs;
      releaseAll();
      setIsPlaying(false);
      setEnded(true);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [sorted, durationMs, pressNote, releaseNote, releaseAll]);

  const play = useCallback(() => {
    if (!sorted.length) return;
    const from = (ended || positionRef.current >= durationMs) ? 0 : positionRef.current;
    primeTo(from, true);
    setEnded(false);
    startWallRef.current = performance.now();
    setIsPlaying(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [sorted, ended, durationMs, primeTo, tick]);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    basePosRef.current = positionRef.current;
    releaseAll();
    setIsPlaying(false);
  }, [releaseAll]);

  const toggle = useCallback(() => { if (isPlaying) pause(); else play(); }, [isPlaying, play, pause]);

  const seek = useCallback((ms) => {
    const target = Math.max(0, Math.min(ms, durationMs));
    primeTo(target, isPlaying);
    setEnded(target >= durationMs && durationMs > 0);
    if (isPlaying) startWallRef.current = performance.now();
  }, [durationMs, primeTo, isPlaying]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    releaseAll();
    positionRef.current = 0;
    basePosRef.current = 0;
    firedIdxRef.current = 0;
    setEnded(false);
    setIsPlaying(false);
  }, [releaseAll]);

  const setSpeed = useCallback((s) => {
    if (isPlaying) { basePosRef.current = positionRef.current; startWallRef.current = performance.now(); }
    speedRef.current = s;
    setSpeedState(s);
  }, [isPlaying]);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); releaseAll(); }, [releaseAll]);

  return { isPlaying, ended, durationMs, positionRef, speed, play, pause, toggle, stop, seek, setSpeed };
}

export default useStudioPlayback;
