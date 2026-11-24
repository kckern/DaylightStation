import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildNoteTimeline, buildStepTimeline, buildTempoMap } from '../../../../../../../__capabilities/music-notation/browser/scoreTimeline.js';
import { useScoreTransport } from '../../score/useScoreTransport.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';

/** Silence before the first note, so the cursor is on it before it sounds. */
export const DEMO_LEAD_MS = 400;
const NO_NOTES = new Map();

/**
 * The demonstration timeline of a run's own expectation: one `step` per event (the cursor) and the
 * notes as note_on/note_off, shifted so the first onset lands after `DEMO_LEAD_MS`. The expectation's
 * tempo map is already the take's (ScorePassage scales it), so the demonstration plays at the tempo
 * the child is about to play. Pure.
 */
export function demonstrationTimeline(expectation) {
  const events = expectation?.events ?? [];
  if (!events.length) return { timeline: [], totalMs: 0 };
  const map = buildTempoMap(expectation.tempoMap);
  const notes = events.flatMap((event) => (event.notes ?? []).map((note) => ({ ...note,
    onsetQuarter: event.onsetQuarter, durationQuarters: note.durationQuarters ?? event.durationQuarters ?? 1 })));
  const steps = buildStepTimeline(events, map).map((step) => ({ ...step, type: 'step' }));
  const all = [...steps, ...buildNoteTimeline(notes, map)];
  const first = Math.min(...steps.map((step) => step.t));
  const timeline = all.map((event) => ({ ...event, t: event.t - first + DEMO_LEAD_MS }))
    .sort((a, b) => a.t - b.t || (a.type === 'step' ? -1 : b.type === 'step' ? 1 : 0));
  return { timeline, totalMs: timeline.at(-1).t };
}

/**
 * Listen, inside the drill: the passage played to the child on the piano, with the cursor on the
 * event that is sounding and its keys lit, and how far through it is. `active` starts it from the top;
 * `playing` false pauses it where it is; inactive stops it and silences the piano. `onDone` fires once
 * when it reaches the end. It never touches the take: the run ignores the keys while it is active.
 */
export default function useRunDemonstration({ expectation, active, playing = true, onDone }) {
  const { sendNoteAt, sendNoteOffAt, sendPanic } = usePianoMidi();
  const { timeline, totalMs } = useMemo(() => demonstrationTimeline(expectation), [expectation]);
  const [index, setIndex] = useState(-1);
  const [sounding, setSounding] = useState(NO_NOTES);
  const [progress, setProgress] = useState(0);
  const sent = useRef(false);
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  const transport = useScoreTransport({ timeline,
    onSchedule: (event, at) => {
      sent.current = true;
      if (event.type === 'note_on') sendNoteAt?.(event.note, event.velocity ?? 80, at);
      else sendNoteOffAt?.(event.note, at);
    },
    onEvent: (event) => {
      if (event.type === 'step') setIndex(event.index);
      else if (event.type === 'note_on') setSounding((held) => new Map(held).set(event.note, { velocity: 1 }));
      else if (event.type === 'note_off') setSounding((held) => { const next = new Map(held); next.delete(event.note); return next; });
    },
    onDone: () => { setProgress(1); setSounding(NO_NOTES); onDoneRef.current?.(); },
  });
  const silence = useCallback(() => {
    if (!sent.current) return;
    sendPanic?.();
    // MIDI's timestamp queue cannot be recalled; flush it after the lookahead.
    globalThis.setTimeout(() => sendPanic?.(), transport.lookaheadMs + 60);
  }, [sendPanic, transport.lookaheadMs]);
  const { play, pause, stop, seek, getPosition } = transport;
  const live = active && timeline.length > 0;
  useEffect(() => {
    if (!live) return undefined;
    seek(0); setIndex(-1); setSounding(NO_NOTES); setProgress(0);
    return () => { stop(); setIndex(-1); setSounding(NO_NOTES); setProgress(0); silence(); };
  }, [live, seek, stop, silence]);
  useEffect(() => {
    if (!live) return;
    if (playing) play();
    else { pause(); setSounding(NO_NOTES); silence(); }
  }, [live, playing, play, pause, silence]);
  useEffect(() => {
    if (!live || !playing) return undefined;
    const timer = globalThis.setInterval(() => setProgress(Math.min(1, getPosition() / Math.max(1, totalMs))), 100);
    return () => globalThis.clearInterval(timer);
  }, [live, playing, getPosition, totalMs]);
  return { active: live, index, sounding, progress, totalMs };
}
