import { useState, useRef, useCallback, useEffect } from 'react';

const isNote = (ev) => ev.type === 'note_on' || ev.type === 'note_off';

/**
 * useScoreTransport — two-plane playback over a flat, time-sorted event list
 * [{t, ...}] (ms from piece start), anchored to performance.now().
 *
 * AUDIO PLANE: note events ({type:'note_on'|'note_off'}) are handed to
 * `onSchedule(ev, dueWallMs, leadMs)` up to `lookaheadMs` BEFORE they are due,
 * so the consumer can send them with Web-MIDI timestamps. Once handed off, the
 * browser's MIDI service dispatches them on time regardless of main-thread
 * jank (2026-07-06 decoupling audit T1/T2).
 *
 * VISUAL PLANE: every event (steps AND notes) fires through `onEvent(ev,
 * dueWallMs)` at musical due time — late is fine, that's just a late frame.
 *
 * The driver is a coarse setInterval — NEVER requestAnimationFrame, which is
 * the OS-throttled clock on the kiosk tablet. A late tick only eats lookahead
 * margin; it cannot delay already-scheduled audio.
 *
 * Pause/seek rewind the schedule index to the fire index so resume re-schedules
 * pending notes with fresh timestamps. Already-dispatched future sends cannot
 * be recalled — the CONSUMER must flush (silence now + panic after the
 * lookahead window; see ScorePlayer's silenceScheduled).
 *
 * Seeking from INSIDE onEvent is supported (the focus-loop wrap): the fire loop
 * detects the anchor change and continues from the new position. onDone fires
 * only after the transport has fully reset itself (timer cleared, playing
 * false), so the callback may synchronously seek() + play() to restart.
 */
export function useScoreTransport({
  timeline, onEvent, onFire, onSchedule, onDone,
  lookaheadMs = 400, tickMs = 100,
}) {
  const [playing, setPlaying] = useState(false);
  const timelineRef = useRef(timeline); timelineRef.current = timeline || [];
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  const onFireRef = useRef(onFire); onFireRef.current = onFire;
  const onScheduleRef = useRef(onSchedule); onScheduleRef.current = onSchedule;
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  const intervalRef = useRef(null);
  const anchorRef = useRef(0);   // wall time corresponding to position 0
  const posRef = useRef(0);      // position while paused (ms)
  const fireIdxRef = useRef(0);  // next event to FIRE (visual, at due time)
  const schedIdxRef = useRef(0); // next event to consider for audio scheduling
  const lastPosRef = useRef(0);  // position at previous tick (tick-gap jitter)

  const clearTimer = () => { if (intervalRef.current != null) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  const tick = useCallback(() => {
    const tl = timelineRef.current;
    const pos = performance.now() - anchorRef.current;
    const gapMs = pos - lastPosRef.current;
    lastPosRef.current = pos;

    // Audio plane: hand note events to the MIDI service ahead of time.
    if (onScheduleRef.current) {
      const horizon = pos + lookaheadMs;
      while (schedIdxRef.current < tl.length && tl[schedIdxRef.current].t <= horizon) {
        const ev = tl[schedIdxRef.current];
        if (isNote(ev)) onScheduleRef.current(ev, anchorRef.current + ev.t, ev.t - pos);
        schedIdxRef.current += 1;
      }
    }

    // Visual plane: fire everything due now. A callback may SEEK mid-loop (the
    // focus-loop wrap re-seeks to its in-point from inside onEvent) — seek moves
    // the anchor AND fireIdx, so detect it and restart from the fresh position
    // instead of marching on with the stale one (which would re-fire the wrapped
    // span forever within this tick).
    let posNow = pos;
    while (fireIdxRef.current < tl.length && tl[fireIdxRef.current].t <= posNow) {
      const ev = tl[fireIdxRef.current];
      const anchorBefore = anchorRef.current;
      onFireRef.current?.(ev, posNow - ev.t, gapMs);
      onEventRef.current?.(ev, anchorBefore + ev.t);
      if (anchorRef.current !== anchorBefore) { // callback seeked — index already repositioned
        posNow = performance.now() - anchorRef.current;
        continue;
      }
      fireIdxRef.current += 1;
    }

    if (fireIdxRef.current >= tl.length) {
      clearTimer();
      posRef.current = 0; fireIdxRef.current = 0; schedIdxRef.current = 0;
      setPlaying(false);
      onDoneRef.current?.();
    }
  }, [lookaheadMs]);

  const play = useCallback(() => {
    if (!timelineRef.current.length) return;
    anchorRef.current = performance.now() - posRef.current;
    lastPosRef.current = posRef.current;
    clearTimer();
    setPlaying(true);
    intervalRef.current = setInterval(tick, tickMs);
    tick(); // immediate: schedule the first window + fire anything already due
  }, [tick, tickMs]);

  const pause = useCallback(() => {
    clearTimer();
    posRef.current = performance.now() - anchorRef.current;
    schedIdxRef.current = fireIdxRef.current; // resume re-schedules from the cursor
    setPlaying(false);
  }, []);

  /** Reposition (works while playing or paused). Event at exactly `ms` will fire. */
  const seek = useCallback((ms) => {
    const pos = Math.max(0, ms);
    posRef.current = pos;
    const tl = timelineRef.current;
    const i = tl.findIndex((e) => e.t >= pos);
    fireIdxRef.current = i < 0 ? tl.length : i;
    schedIdxRef.current = fireIdxRef.current;
    anchorRef.current = performance.now() - pos;
    lastPosRef.current = pos; // the next tick's gapMs measures from here, not the pre-seek position
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    posRef.current = 0; fireIdxRef.current = 0; schedIdxRef.current = 0;
    setPlaying(false);
  }, []);

  useEffect(() => () => clearTimer(), []);
  return { playing, play, pause, seek, stop, lookaheadMs };
}

export default useScoreTransport;
