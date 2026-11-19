import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildNoteTimeline, buildTempoMap, scaleTimeline } from '../../../../../../../__capabilities/music-notation/browser/scoreTimeline.js';
import { useScoreTransport } from '../../score/useScoreTransport.js';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import ScorePassage from '../Exercises/ScorePassage.jsx';

/** Demonstration is playback only. It never installs an assessment. */
export default function LearnListen({ score, task, tempoMap, passageName = '', onDone }) {
  const [expectation, setExpectation] = useState(null);
  const { sendNoteAt, sendNoteOffAt, sendPanic } = usePianoMidi();
  const started = useRef(false);
  const played = useRef(false);
  const timeline = useMemo(() => {
    const events = expectation?.events ?? [];
    const origin = events[0]?.onsetQuarter ?? 0;
    const notes = events.flatMap((event) => event.notes.map((note) => ({ ...note,
      onsetQuarter: event.onsetQuarter, durationQuarters: note.durationQuarters ?? event.durationQuarters })));
    const map = buildTempoMap(expectation?.tempoMap?.length ? expectation.tempoMap : tempoMap);
    const full = buildNoteTimeline(notes, map);
    const first = full[0]?.t ?? origin;
    return scaleTimeline(full.map((event) => ({ ...event, t: event.t - first })), 100 / (task.tempoPercent ?? 100));
  }, [expectation, task.tempoPercent, tempoMap]);
  const transport = useScoreTransport({ timeline,
    onSchedule: (event, at) => { played.current = true;
      if (event.type === 'note_on') sendNoteAt?.(event.note, event.velocity ?? 80, at);
      else sendNoteOffAt?.(event.note, at);
    }, onDone,
  });
  const onExpectation = useCallback((value) => setExpectation(value), []);
  useEffect(() => {
    if (!started.current && timeline.length) { started.current = true; transport.play(); }
  }, [timeline, transport.play]);
  useEffect(() => () => {
    if (!played.current) return;
    sendPanic?.();
    // MIDI's timestamp queue cannot be recalled; flush it after the lookahead.
    setTimeout(() => sendPanic?.(), 460);
  }, [sendPanic]);
  // The drill surface's chrome, with one control: the demonstration is not a take.
  return <section className="piano-learn-lab piano-learn-lab--coach piano-learn-listen" role="dialog" aria-modal="true" aria-label="Passage demonstration">
    <header className="piano-learn-lab__toolbar">
      <div className="piano-learn-lab__identity"><strong>{passageName}</strong></div>
      <div className="piano-learn-lab__task"><strong>Listen</strong></div>
      <div className="piano-learn-lab__run-controls" role="group" aria-label="Practice controls">
        <button type="button" onClick={onDone}>Stop listening</button>
      </div>
    </header>
    <div className="piano-learn-listen__stage piano-exercise-run__score"><ScorePassage musicXml={score.musicXml} sourceId={score.id} rangeIndices={task.range} activeParts={task.parts}
      onExpectation={onExpectation} keepWholePassage onUnrunnable={onDone} /></div>
  </section>;
}
