import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { buildLoopCycle } from '@shared-music/loopScheduler.mjs';

/**
 * useLoopTransport — looping multitrack playback for the loop library.
 *
 * Builds one merged, phase-aligned cycle from the active layers (buildLoopCycle)
 * and fires it on a requestAnimationFrame wall-clock, looping forever until
 * stopped. Notes go through pressNote/releaseNote so they sound AND drive the
 * shared activeNotes the on-screen keyboard renders from — the loop visibly
 * plays the keys while the user jams on top.
 *
 * Mirrors the proven Studio transport (modes/Studio/useStudioPlayback.js) but
 * looped and multi-layer. v1 plays all layers through the default voice; per-
 * layer voices (one MIDI channel each) are a follow-up.
 *
 * @param {{layers:Array, bpm:number, pressNote:Function, releaseNote:Function}} p
 */
export function useLoopTransport({ layers, bpm = 120, pressNote, releaseNote }) {
  const cycle = useMemo(() => buildLoopCycle(layers || [], { bpm }), [layers, bpm]);
  const [isPlaying, setIsPlaying] = useState(false);

  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  const rafRef = useRef(null);
  const startWallRef = useRef(0);
  const firedIdxRef = useRef(0);
  const activeRef = useRef(new Set());

  let _logger;
  const logger = () => {
    if (!_logger) _logger = getLogger().child({ component: 'piano-loop-transport' });
    return _logger;
  };

  const releaseAll = useCallback(() => {
    activeRef.current.forEach((n) => { try { releaseNote(n); } catch { /* ignore */ } });
    activeRef.current.clear();
  }, [releaseNote]);

  const positionRef = useRef(0);

  const tick = useCallback(() => {
    const { events, lengthMs } = cycleRef.current;
    const elapsed = performance.now() - startWallRef.current;
    // Update normalized 0..1 loop position (no React state — avoids render storm).
    positionRef.current = lengthMs ? (elapsed % lengthMs) / lengthMs : 0;
    while (firedIdxRef.current < events.length && events[firedIdxRef.current].t <= elapsed) {
      const e = events[firedIdxRef.current];
      if (e.type === 'note_on' && (e.velocity ?? 0) > 0) { pressNote(e.note, e.velocity); activeRef.current.add(e.note); }
      else { releaseNote(e.note); activeRef.current.delete(e.note); }
      firedIdxRef.current += 1;
    }
    if (elapsed >= lengthMs) { // loop: release stragglers, restart from the top
      releaseAll();
      firedIdxRef.current = 0;
      startWallRef.current = performance.now();
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [pressNote, releaseNote, releaseAll]);

  const play = useCallback(() => {
    if (!cycleRef.current.events.length) return;
    firedIdxRef.current = 0;
    startWallRef.current = performance.now();
    setIsPlaying(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    logger().info('loop-transport.play', { layers: (layers || []).length, lengthMs: Math.round(cycleRef.current.lengthMs) });
  }, [tick, layers]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    releaseAll();
    firedIdxRef.current = 0;
    setIsPlaying(false);
    logger().info('loop-transport.stop', {});
  }, [releaseAll]);

  const toggle = useCallback(() => { if (isPlaying) stop(); else play(); }, [isPlaying, play, stop]);

  // When the layer stack (or tempo) changes mid-play, restart the cycle cleanly
  // so added/removed layers take effect on the next beat-zero.
  useEffect(() => {
    if (!isPlaying) return;
    releaseAll();
    firedIdxRef.current = 0;
    startWallRef.current = performance.now();
  }, [cycle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); releaseAll(); }, [releaseAll]);

  return { isPlaying, play, stop, toggle, lengthMs: cycle.lengthMs, positionRef, loopNotesRef: activeRef };
}

export default useLoopTransport;
