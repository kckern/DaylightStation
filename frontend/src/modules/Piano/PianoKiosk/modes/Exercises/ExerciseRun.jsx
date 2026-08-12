import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';
import { createDrillRun, applyDrillPress, drillProgress } from '../../../performance/drillRun.js';
import { matchHeldSet } from '../../../performance/heldSet.js';
import { noteName } from './exerciseQuery.js';
import './Exercises.scss';

/**
 * Plays one exercise instance.
 *
 * Which runner is used is the instance's own answer, not this view's: material
 * declared `ordering: strict` advances note by note through the drill runner,
 * and material declared `any` is a held set matched all at once. That is the
 * same split the performance service already draws between drillRun and
 * heldSet — the bank just names which side an item is on.
 */
/** drillProgress counts notes, not onsets; a chord event holds several. */
function eventIndexOf(instance, step) {
  let seen = 0;
  for (const [index, event] of instance.events.entries()) {
    seen += event.notes.length;
    if (step < seen) return index;
  }
  return instance.events.length;
}

/** One span per event, so the follow cursor lands on each onset in turn. */
function buildRun(instance) {
  return createDrillRun(
    instance.events.map((event, index) => ({
      id: `event-${index}`,
      expectedMidi: event.notes.map((n) => n.midi),
    })),
  );
}

export default function ExerciseRun({ instanceId, onExit }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-exercise-run' }), []);
  const { activeNotes } = usePianoMidiNotes();
  const { connected } = usePianoMidi();
  const [instance, setInstance] = useState(undefined); // undefined = loading
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [wrong, setWrong] = useState(0);
  const runRef = useRef(null);

  useEffect(() => {
    if (!instanceId) { setInstance(null); return undefined; }
    let alive = true;
    // The seed id IS its path in the bank, at whatever depth — `chords/triads`
    // or `drills/hanon/001` — so it goes through whole.
    const [seedId, axes] = instanceId.split('@');
    const query = axes ? `?${axes.split(',').join('&')}` : '';
    DaylightAPI(`api/v1/piano/bank/${seedId}/instance${query}`)
      .then((data) => { if (alive) setInstance(data); })
      .catch((error) => { if (alive) { setInstance(null); logger.warn('piano.exercise-load-failed', { instanceId, error: error.message }); } });
    return () => { alive = false; };
  }, [instanceId, logger]);

  // Reset the run whenever the material changes.
  useEffect(() => {
    if (!instance?.events) return;
    runRef.current = instance.ordering === 'strict' ? buildRun(instance) : null;
    setProgress(0);
    setDone(false);
    setWrong(0);
  }, [instance]);

  const held = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);
  const heldKey = held.join(',');

  // Held-set material is judged on what is down right now; ordered material
  // advances on each press. Both report into the same graders downstream.
  useEffect(() => {
    if (!instance || done || instance.ordering !== 'any') return;
    const midis = instance.events[0].notes.map((n) => n.midi);
    const target = {
      root: ((Math.min(...midis) % 12) + 12) % 12,
      pitchClasses: new Set(midis.map((m) => ((m % 12) + 12) % 12)),
    };
    // The bank says whether inversions count; heldSet defaults to rejecting them.
    const verdict = matchHeldSet(activeNotes, target, { bassMustBeRoot: instance.voicing !== 'inversions_ok' });
    if (verdict === 'correct') {
      setDone(true);
      logger.info('piano.exercise-complete', { id: instance.id, ordering: 'any', wrong });
    } else if (verdict === 'wrong') {
      setWrong((n) => n + 1);
    }
  }, [activeNotes, done, heldKey, instance, logger, wrong]);

  const onPress = useCallback((midi) => {
    const run = runRef.current;
    if (!run || done) return;
    const { run: next, event } = applyDrillPress(run, midi);
    runRef.current = next;
    if (event?.type === 'wrong') setWrong((n) => n + 1);
    setProgress(drillProgress(next));
    if (event?.type === 'complete') {
      setDone(true);
      logger.info('piano.exercise-complete', { id: instance?.id, ordering: 'strict', wrong });
    }
  }, [done, instance, logger, wrong]);

  // Ordered material needs note-on edges, not the held set.
  const restart = useCallback(() => {
    setProgress(0);
    setDone(false);
    setWrong(0);
    runRef.current = instance?.ordering === 'strict' ? buildRun(instance) : null;
  }, [instance]);

  const previous = useRef([]);
  useEffect(() => {
    if (!instance || instance.ordering !== 'strict') { previous.current = held; return; }
    for (const midi of held) if (!previous.current.includes(midi)) onPress(midi);
    previous.current = held;
  }, [held, heldKey, instance, onPress]);

  if (instance === undefined) return <SkeletonStage />;
  if (!instance) return <PianoEmpty title="Exercise not found" hint="It may have been renamed." />;

  const expected = instance.events.flatMap((e) => e.notes.map((n) => n.midi));
  const targetNotes = new Map(
    (instance.ordering === 'strict'
      ? instance.events[eventIndexOf(instance, progress)]?.notes.map((n) => n.midi) ?? []
      : instance.events[0].notes.map((n) => n.midi)
    ).map((midi) => [midi, { velocity: 1 }]),
  );

  return (
    <section className="piano-exercise-run">
      <header className="piano-exercise-run__head">
        <button type="button" className="piano-exercise-run__back" onClick={onExit}>← Exercises</button>
        <h1 className="piano-exercise-run__title">{instance.title}</h1>
        <span className="piano-exercise-run__staff">{instance.staff}</span>
      </header>

      <ol className="piano-exercise-run__notes">
        {instance.events.map((event, index) => (
          <li
            key={`${index}-${event.notes.map((n) => n.midi).join('-')}`}
            className={[
              'piano-exercise-run__note',
              instance.ordering === 'strict' && index < eventIndexOf(instance, progress) && 'piano-exercise-run__note--done',
              instance.ordering === 'strict' && index === eventIndexOf(instance, progress) && !done && 'piano-exercise-run__note--next',
            ].filter(Boolean).join(' ')}
          >
            {event.notes.map((n) => noteName(n.midi)).join(' ')}
          </li>
        ))}
      </ol>

      <p className="piano-exercise-run__status" role="status">
        {done
          ? (wrong === 0 ? 'Clean run.' : `Done — ${wrong} wrong note${wrong === 1 ? '' : 's'}.`)
          : connected
            ? (instance.ordering === 'any' ? 'Play all the notes together.' : 'Play the notes in order.')
            : 'Waiting for the piano…'}
      </p>

      {done && (
        <button type="button" className="piano-exercise-run__again" onClick={restart}>
          Again
        </button>
      )}

      <footer className="piano-exercise-run__keys">
        <PianoKeyboard
          activeNotes={activeNotes}
          targetNotes={targetNotes}
          dimTarget
          startNote={Math.max(21, Math.min(...expected) - 5)}
          endNote={Math.min(108, Math.max(...expected) + 5)}
        />
      </footer>
    </section>
  );
}
