import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';
import {
  assessmentProgress,
  createAssessmentAttempt,
  createAssessmentRuntime,
} from '../../../performance/assessmentSession.js';
import {
  buildPianoAttemptEvidence,
  pianoAssessmentTelemetry,
  pianoAttemptClient,
  pianoPersistenceOutcome,
} from '../../../performance/attemptEvidence.js';
import ExerciseNotation from './ExerciseNotation.jsx';
import { pianoLearningApi } from './pianoLearningApi.js';
import { prepareExerciseAssessment } from './assessment.js';
import { resolveExerciseRunAccess } from './authorization.js';
import { useMetronomeClick } from '../SheetMusic/useMetronomeClick.js';
import './Exercises.scss';

const EMPTY_SNAPSHOT = Object.freeze({ status: 'prepared', result: null, musicalInput: false });

function makeId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export default function ExerciseRun({ instanceId, intent = 'practice', practiceMode = 'free', programId = null, stepId = null, requirementOverride = null, onExit, onPassed }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-exercise-run' }), []);
  const { currentUser } = usePianoUser();
  const { activeNotes } = usePianoMidiNotes();
  const { connected } = usePianoMidi();
  const [instance, setInstance] = useState(undefined);
  const [requirement, setRequirement] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [lastWrong, setLastWrong] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const previousNotesRef = useRef([]);
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;
  const persistedRef = useRef(false);
  const runtimeRef = useRef(null);
  const access = resolveExerciseRunAccess(intent, currentUser);
  const { challenge } = access;
  const selectedMode = challenge ? requirement?.mode : practiceMode;

  useEffect(() => {
    let alive = true;
    setInstance(undefined);
    Promise.all([
      pianoLearningApi.instance(instanceId),
      programId ? pianoLearningApi.program(programId) : Promise.resolve({ ok: false, data: null }),
    ]).then(([instanceResponse, programResponse]) => {
      if (!alive) return;
      if (!instanceResponse.ok) { setInstance(null); return; }
      const loaded = instanceResponse.data;
      const step = programResponse.ok ? programResponse.data.steps?.find((entry) => entry.id === stepId) : null;
      setInstance(loaded);
      setRequirement(requirementOverride ?? step?.requirement ?? null);
    });
    return () => { alive = false; };
  }, [instanceId, programId, requirementOverride, stepId]);

  const buildAttempt = useCallback(() => {
    if (!access.allowed || !instance || (challenge && !requirement)) return null;
    const mode = selectedMode;
    const prepared = prepareExerciseAssessment({
      instance, mode, purpose: challenge ? 'challenge' : 'practice', requirement: challenge ? requirement : null,
    });
    return createAssessmentAttempt({ ...prepared, policy: { matchWindowMs: 220, missWindowMs: 420, timingToleranceMs: 80, timingWindowMs: 320 } });
  }, [access.allowed, challenge, instance, requirement, selectedMode]);

  const installRuntime = useCallback(() => {
    const attempt = buildAttempt();
    if (!attempt) return;
    runtimeRef.current?.dispose();
    const next = createAssessmentRuntime({
      attempt,
      createAttempt: buildAttempt,
      now: () => Date.now(),
      tickMs: 50,
      onEvent: (event) => setLastWrong(event?.type === 'wrong'),
    });
    runtimeRef.current = next;
    previousNotesRef.current = [...activeNotesRef.current.keys()];
    persistedRef.current = false;
    setLastWrong(false);
    setCountdown(null);
    setRuntime(next);
  }, [buildAttempt]);

  useEffect(installRuntime, [installRuntime]);

  const snapshot = useSyncExternalStore(
    useCallback((listener) => runtime?.subscribe(listener) || (() => {}), [runtime]),
    useCallback(() => runtime?.getStoreSnapshot() || EMPTY_SNAPSHOT, [runtime]),
    () => EMPTY_SNAPSHOT,
  );

  const persist = useCallback(async (result, status = result?.status || 'completed', { keepalive = false } = {}) => {
    if (persistedRef.current || !instance) return;
    persistedRef.current = true;
    const terminalResult = { ...(result || {}), status };
    const body = buildPianoAttemptEvidence({
      result: terminalResult,
      attemptId: makeId('attempt'),
      ...(challenge
        ? { challengeId: makeId('exercise-challenge') }
        : { activityId: `exercise:${instance.id}:${selectedMode}` }),
      kind: instance.form ?? 'exercise',
      purpose: challenge ? 'challenge' : 'practice',
      prompt: { exercise_id: instance.id, label: instance.title, mode: selectedMode, level: instance.level?.[selectedMode] ?? null },
      context: { surface: 'exercises', matcher: runtimeRef.current?.getSnapshot().matcher ?? null, program_id: programId, step_id: stepId },
      gradingPolicyVersion: result?.rubric?.id ?? 'exercise-interrupted-v2',
      providerVersion: 'exercise-runtime-v4',
    });
    if (!access.persistent) {
      logger.info('piano.exercise-assessment', pianoAssessmentTelemetry(body, { outcome: 'skipped-guest' }));
      return;
    }
    const response = await pianoAttemptClient.record(currentUser, body, { keepalive });
    const outcome = pianoPersistenceOutcome(response);
    const log = pianoAssessmentTelemetry(body, {
      outcome, status: response.status, error: response.error, durationMs: response.durationMs,
    });
    if (outcome === 'saved') logger.info('piano.exercise-assessment', log);
    else logger.warn('piano.exercise-assessment', log);
  }, [access.persistent, challenge, currentUser, instance, logger, programId, selectedMode, stepId]);

  useEffect(() => {
    if (!snapshot.result || persistedRef.current) return;
    persist(snapshot.result);
    if (snapshot.result.status === 'completed') logger.info('piano.exercise-complete', {
      id: instance.id, purpose: challenge ? 'challenge' : 'practice', matcher: snapshot.matcher,
      score: snapshot.result.score, passed: snapshot.result.verdict.passed,
    });
  }, [challenge, instance, logger, persist, snapshot]);

  const start = useCallback(() => {
    if (!runtime) return;
    const leadInMs = runtime.getSnapshot().mode === 'cued' ? 2000 : 0;
    runtime.start({ leadInMs, clock: 'date-now' });
    if (!leadInMs) return;
    setCountdown(2);
    const timer = globalThis.setInterval(() => {
      const state = runtime.getSnapshot();
      const remaining = Math.max(0, Math.ceil((state.startedAt + state.leadInMs - Date.now()) / 1000));
      setCountdown(remaining || null);
      if (!remaining || state.status !== 'running') globalThis.clearInterval(timer);
    }, 100);
  }, [runtime]);

  const held = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);
  const clickBpm = Number(requirement?.gates?.pace?.target_bpm ?? instance?.tempo?.start_bpm);
  useMetronomeClick({
    enabled: snapshot.status === 'running' && ['metronome', 'cued'].includes(snapshot.mode),
    bpm: clickBpm,
  });
  const heldKey = held.join(',');
  useEffect(() => {
    if (!runtime || snapshot.status !== 'running') { previousNotesRef.current = held; return; }
    if (snapshot.matcher === 'held') {
      runtime.observe({ held: activeNotes, time: Date.now(), clock: 'date-now' });
    } else {
      for (const midi of held) if (!previousNotesRef.current.includes(midi)) runtime.observe({ midi, time: Date.now(), clock: 'date-now' });
    }
    previousNotesRef.current = held;
  }, [activeNotes, held, heldKey, runtime, snapshot.matcher, snapshot.status]);

  useEffect(() => () => {
    const active = runtimeRef.current?.getSnapshot();
    if (active?.status === 'running' && active.musicalInput && !persistedRef.current) {
      const interrupted = runtimeRef.current.abort();
      persist(interrupted.result, 'aborted', { keepalive: true });
    }
    runtimeRef.current?.dispose();
  }, [persist]);

  if (!access.allowed) return <PianoEmpty title="Choose a player" hint="Challenges require a persistent piano profile so the result can be verified and recorded." />;
  if (instance === undefined || (challenge && !requirement) || !runtime) return <SkeletonStage />;
  if (!instance) return <PianoEmpty title="Exercise not found" hint="It may have been renamed." />;

  const progress = assessmentProgress(snapshot);
  const eventIndex = Math.min(progress.eventIndex, instance.events.length);
  const result = snapshot.result?.status === 'completed' ? snapshot.result : null;
  const phase = snapshot.status === 'prepared' ? 'ready' : snapshot.status === 'completed' ? 'done' : countdown ? 'countdown' : 'running';
  const expected = instance.events.flatMap((event) => event.notes.map((note) => note.midi));
  const currentEvent = instance.events[Math.min(eventIndex, instance.events.length - 1)] || instance.events[0];
  const targetNotes = new Map((currentEvent?.notes || []).map((note) => [note.midi, { velocity: 1 }]));

  return (
    <section className={`piano-exercise-run is-${intent} is-${phase}`}>
      <header className="piano-exercise-run__head">
        <button type="button" className="piano-exercise-run__back" onClick={onExit}>Exit</button>
        <div><span>{challenge ? 'Pass challenge' : 'Practice'}</span><h1>{instance.title}</h1></div>
        <div className="piano-exercise-run__context"><span>{instance.key}</span><span>{instance.meter}</span>{challenge && requirement.gates?.pace?.target_bpm && <strong>{requirement.gates.pace.target_bpm} BPM</strong>}</div>
      </header>
      <div className="piano-exercise-run__score">
        <ExerciseNotation instance={instance} eventIndex={eventIndex} wrong={lastWrong} complete={phase === 'done' && result?.verdict?.passed} />
        {countdown && <div className="piano-exercise-run__countdown" aria-live="assertive">{countdown}</div>}
      </div>
      {phase === 'ready' && <div className="piano-exercise-run__ready"><p>{challenge ? 'The tempo and pass criteria are fixed for this run. The count-in starts when you are ready.' : 'Correct mistakes and continue at your own pace. Practice is saved, but it does not unlock a gate.'}</p>{!connected && <span>Waiting for the piano…</span>}<button type="button" onClick={start}>{challenge ? 'Begin challenge' : 'Begin practice'}</button></div>}
      {['countdown', 'running'].includes(phase) && <p className={`piano-exercise-run__status${lastWrong ? ' is-wrong' : ''}`} role="status">{phase === 'countdown' ? 'Listen to the count-in.' : lastWrong ? 'That note was not expected — keep going.' : snapshot.matcher === 'held' ? 'Play the complete chord.' : 'Follow the highlighted notes.'}</p>}
      {phase === 'done' && result && <section className={`piano-exercise-run__result${result.verdict.passed ? ' is-passed' : ' is-developing'}`}>
        <div><span>{result.verdict.passed ? 'Passed' : challenge ? 'Keep working' : 'Practice complete'}</span><strong>{Math.round(result.score * 100)}%</strong></div>
        <dl><div><dt>All notes</dt><dd>{Math.round((result.criteria.completeness ?? 0) * 100)}%</dd></div><div><dt>Clean notes</dt><dd>{Math.round((result.criteria.cleanliness ?? 0) * 100)}%</dd></div>{Number.isFinite(result.criteria.placement) && <div><dt>On the beat</dt><dd>{Math.round(result.criteria.placement * 100)}%</dd></div>}</dl>
        <div className="piano-exercise-run__result-actions"><button type="button" className="piano-exercises__quiet-action" onClick={installRuntime}>{challenge ? 'Retry' : 'Again'}</button>{challenge && !result.verdict.passed && <button type="button" onClick={onExit}>Practice first</button>}{result.verdict.passed && <button type="button" onClick={onPassed}>Continue</button>}</div>
      </section>}
      <footer className="piano-exercise-run__keys"><PianoKeyboard activeNotes={activeNotes} targetNotes={targetNotes} dimTarget startNote={Math.max(21, Math.min(...expected) - 5)} endNote={Math.min(108, Math.max(...expected) + 5)} /></footer>
    </section>
  );
}
