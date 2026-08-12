import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { isPersistentUser } from '../../pianoUser.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';
import {
  advanceAssessment,
  applyAssessmentHeld,
  applyAssessmentPress,
  assessmentProgress,
  createAssessmentSession,
  finalizeAssessment,
} from '../../../performance/assessmentSession.js';
import ExerciseNotation from './ExerciseNotation.jsx';
import { pianoLearningApi } from './pianoLearningApi.js';
import './Exercises.scss';

const TIMING_POLICY = { perfectWindowMs: 90, goodWindowMs: 220, matchWindowMs: 220, missWindowMs: 420 };
const VALUE_QUARTERS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '8th': 0.5, '16th': 0.25, '32nd': 0.125 };

function makeId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function eventIndexOf(instance, step) {
  let seen = 0;
  for (const [index, event] of instance.events.entries()) {
    seen += event.notes.length;
    if (step < seen) return index;
  }
  return instance.events.length;
}

function buildRun(instance) {
  return createAssessmentSession({
    matcher: 'cursor',
    expectation: {
      spans: instance.events.map((event, index) => ({
        id: `event-${index}`, expectedMidi: event.notes.map((note) => note.midi),
      })),
    },
  });
}

function defaultRequirement(instance) {
  const bpm = Number(instance?.tempo?.start_bpm);
  return {
    exercise_id: instance.id,
    mode: Number.isFinite(bpm) ? 'cued' : 'free',
    rubric: {
      id: 'exercise-pass-v1', version: '1',
      criteria: { completeness: 1, cleanliness: 1, ...(Number.isFinite(bpm) ? { placement: 0.8 } : {}) },
    },
    ...(Number.isFinite(bpm) ? { gates: { pace: { target_bpm: bpm } } } : {}),
    required_passes: 1,
  };
}

function timedTargets(instance, startAt, bpm) {
  const quarterMs = 60_000 / bpm;
  let onsetQuarter = 0;
  return instance.events.map((event, index) => {
    const target = {
      id: index + 1,
      pitches: [...new Set(event.notes.map((note) => note.midi))],
      targetTimeMs: startAt + onsetQuarter * quarterMs,
      measureIndex: 0,
    };
    onsetQuarter += VALUE_QUARTERS[event.value] ?? 0.25;
    return target;
  });
}

function assess(session, requirement, bpm = null) {
  return finalizeAssessment(session, {
    requirement,
    achievedBpm: bpm,
    rubric: { id: 'exercise-pass-v1', version: '1' },
  });
}

export default function ExerciseRun({ instanceId, intent = 'practice', programId = null, stepId = null, requirementOverride = null, onExit, onPassed }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-exercise-run' }), []);
  const { currentUser } = usePianoUser();
  const { activeNotes } = usePianoMidiNotes();
  const { connected } = usePianoMidi();
  const [instance, setInstance] = useState(undefined);
  const [requirement, setRequirement] = useState(null);
  const [phase, setPhase] = useState('ready');
  const [progress, setProgress] = useState(0);
  const [lastWrong, setLastWrong] = useState(false);
  const [result, setResult] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const runRef = useRef(null);
  const timedRef = useRef(null);
  const heldRef = useRef(null);
  const startAtRef = useRef(null);
  const persistedRef = useRef(false);
  const previous = useRef([]);
  const phaseRef = useRef(phase);
  const persistCallbackRef = useRef(null);
  phaseRef.current = phase;

  const challenge = intent === 'challenge' && isPersistentUser(currentUser);

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
      setInstance(loaded);
      const step = programResponse.ok ? programResponse.data.steps?.find((entry) => entry.id === stepId) : null;
      setRequirement(requirementOverride ?? step?.requirement ?? defaultRequirement(loaded));
    });
    return () => { alive = false; };
  }, [instanceId, programId, requirementOverride, stepId]);

  const reset = useCallback(() => {
    if (!instance) return;
    runRef.current = instance.ordering === 'strict' ? buildRun(instance) : null;
    timedRef.current = null;
    heldRef.current = instance.ordering === 'any' ? createAssessmentSession({
      matcher: 'held',
      expectation: {
        root: ((Math.min(...instance.events[0].notes.map((note) => note.midi)) % 12) + 12) % 12,
        pitchClasses: new Set(instance.events[0].notes.map((note) => ((note.midi % 12) + 12) % 12)),
      },
      policy: {
        equivalence: 'pitch-class',
        bassMustBeRoot: instance.voicing !== 'inversions_ok',
      },
    }) : null;
    startAtRef.current = null;
    persistedRef.current = false;
    setPhase('ready');
    setProgress(0);
    setLastWrong(false);
    setResult(null);
    setCountdown(null);
  }, [instance]);

  useEffect(reset, [reset]);

  const persist = useCallback(async (assessment, status = 'completed', { keepalive = false } = {}) => {
    if (!isPersistentUser(currentUser) || persistedRef.current) return;
    persistedRef.current = true;
    const attemptId = makeId('attempt');
    const body = {
      attempt_id: attemptId,
      challenge_id: makeId(challenge ? 'exercise-challenge' : 'exercise-practice'),
      kind: instance.form ?? 'exercise',
      purpose: challenge ? 'challenge' : 'practice',
      status,
      ...(assessment ?? {}),
      prompt: {
        exercise_id: instance.id, label: instance.title, mode: challenge ? requirement.mode : 'free',
        level: instance.level?.[challenge ? requirement.mode : 'free'] ?? null,
      },
      context: { surface: 'exercises', program_id: programId, step_id: stepId },
      grading_policy_version: assessment?.rubric?.id ?? 'exercise-interrupted-v1',
      provider_version: 'exercise-runner-v2',
    };
    const response = await pianoLearningApi.recordAttempt(currentUser, body, { keepalive });
    if (!response.ok) logger.warn('piano.exercise-attempt-save-failed', { id: instance.id, status: response.status });
  }, [challenge, currentUser, instance, logger, programId, requirement, stepId]);
  persistCallbackRef.current = persist;

  const finish = useCallback((assessment) => {
    if (phase === 'done') return;
    setResult(assessment);
    setPhase('done');
    persist(assessment);
    logger.info('piano.exercise-complete', { id: instance.id, purpose: challenge ? 'challenge' : 'practice', score: assessment.score, passed: assessment.verdict.passed });
  }, [challenge, instance, logger, persist, phase]);

  const start = useCallback(() => {
    if (!instance || !requirement) return;
    if (!challenge) {
      setPhase('running');
      return;
    }
    const bpm = Number(requirement.gates?.pace?.target_bpm ?? instance.tempo?.start_bpm);
    if (instance.ordering === 'strict' && Number.isFinite(bpm)) {
      const starts = Date.now() + 2000;
      startAtRef.current = starts;
      timedRef.current = createAssessmentSession({
        matcher: 'timed',
        expectation: { targets: timedTargets(instance, starts, bpm) },
        policy: TIMING_POLICY,
        requirement,
      });
      setCountdown(2);
      setPhase('countdown');
    } else {
      setPhase('running');
    }
  }, [challenge, instance, requirement]);

  useEffect(() => {
    if (!challenge || !['countdown', 'running'].includes(phase) || !timedRef.current) return undefined;
    const timer = globalThis.setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((startAtRef.current - now) / 1000));
      setCountdown(remaining || null);
      if (now >= startAtRef.current && phase === 'countdown') setPhase('running');
      if (now < startAtRef.current) return;
      const advanced = advanceAssessment(timedRef.current, now);
      timedRef.current = advanced.session;
      setProgress(assessmentProgress(advanced.session));
      const last = advanced.session.run.targets.at(-1);
      if (last && now > last.targetTimeMs + TIMING_POLICY.missWindowMs) {
        globalThis.clearInterval(timer);
        const bpm = Number(requirement.gates?.pace?.target_bpm ?? instance.tempo?.start_bpm);
        finish(assess(advanced.session, requirement, bpm));
      }
    }, 50);
    return () => globalThis.clearInterval(timer);
  }, [challenge, finish, instance, phase, requirement]);

  const held = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);
  const heldKey = held.join(',');

  useEffect(() => {
    if (!instance || phase !== 'running' || instance.ordering !== 'any') return;
    const observed = applyAssessmentHeld(heldRef.current, activeNotes, Date.now());
    heldRef.current = observed.session;
    if (observed.event.status === 'correct') {
      const assessment = assess(observed.session, requirement);
      finish(challenge ? assessment : { ...assessment, verdict: { ...assessment.verdict, passed: false } });
    } else if (observed.event.status === 'wrong') {
      setLastWrong(true);
    }
  }, [activeNotes, challenge, finish, heldKey, instance, phase, requirement]);

  const pressPractice = useCallback((midi) => {
    const run = runRef.current;
    if (!run || phase !== 'running') return;
    const applied = applyAssessmentPress(run, midi);
    runRef.current = applied.session;
    setLastWrong(applied.event?.type === 'wrong');
    setProgress(assessmentProgress(applied.session));
    if (applied.event?.type === 'complete') {
      const assessment = assess(applied.session, requirement);
      finish(challenge ? assessment : { ...assessment, verdict: { ...assessment.verdict, passed: false } });
    }
  }, [challenge, finish, phase, requirement]);

  const pressChallenge = useCallback((midi) => {
    if (!timedRef.current || phase !== 'running') return;
    const judged = applyAssessmentPress(timedRef.current, midi, Date.now(), { measureIndex: 0 });
    timedRef.current = judged.session;
    setLastWrong(judged.event?.type === 'unmatched_note');
    setProgress(assessmentProgress(judged.session));
  }, [phase]);

  useEffect(() => {
    if (!instance || instance.ordering !== 'strict') { previous.current = held; return; }
    for (const midi of held) if (!previous.current.includes(midi)) {
      if (challenge && timedRef.current) pressChallenge(midi); else pressPractice(midi);
    }
    previous.current = held;
  }, [challenge, held, heldKey, instance, pressChallenge, pressPractice]);

  useEffect(() => () => {
    if (challenge && ['countdown', 'running'].includes(phaseRef.current) && !persistedRef.current) {
      persistCallbackRef.current?.(null, 'aborted', { keepalive: true });
    }
  }, [challenge]);

  if (instance === undefined || !requirement) return <SkeletonStage />;
  if (!instance) return <PianoEmpty title="Exercise not found" hint="It may have been renamed." />;

  const pacedChallenge = challenge && Boolean(timedRef.current);
  const eventIndex = instance.ordering === 'strict'
    ? (pacedChallenge ? Math.min(progress, instance.events.length) : eventIndexOf(instance, progress))
    : 0;
  const expected = instance.events.flatMap((event) => event.notes.map((note) => note.midi));
  const targetNotes = new Map((instance.ordering === 'strict'
    ? instance.events[Math.min(eventIndex, instance.events.length - 1)]?.notes.map((note) => note.midi) ?? []
    : instance.events[0].notes.map((note) => note.midi)).map((midi) => [midi, { velocity: 1 }]));

  return (
    <section className={`piano-exercise-run is-${intent} is-${phase}`}>
      <header className="piano-exercise-run__head">
        <button type="button" className="piano-exercise-run__back" onClick={onExit}>Exit</button>
        <div><span>{challenge ? 'Pass challenge' : 'Practice'}</span><h1>{instance.title}</h1></div>
        <div className="piano-exercise-run__context">
          <span>{instance.key}</span><span>{instance.meter}</span>
          {challenge && requirement.gates?.pace?.target_bpm && <strong>{requirement.gates.pace.target_bpm} BPM</strong>}
        </div>
      </header>

      <div className="piano-exercise-run__score">
        <ExerciseNotation instance={instance} eventIndex={eventIndex} wrong={lastWrong} complete={phase === 'done' && result?.verdict?.passed} />
        {countdown && <div className="piano-exercise-run__countdown" aria-live="assertive">{countdown}</div>}
      </div>

      {phase === 'ready' && (
        <div className="piano-exercise-run__ready">
          <p>{challenge ? 'The tempo and pass criteria are fixed for this run. The count-in starts when you are ready.' : 'Correct mistakes and continue at your own pace. Practice is saved, but it does not unlock a gate.'}</p>
          {!connected && <span>Waiting for the piano…</span>}
          <button type="button" onClick={start}>{challenge ? 'Begin challenge' : 'Begin practice'}</button>
        </div>
      )}

      {['countdown', 'running'].includes(phase) && (
        <p className={`piano-exercise-run__status${lastWrong ? ' is-wrong' : ''}`} role="status">
          {phase === 'countdown' ? 'Listen to the count-in.' : lastWrong ? 'That note was not expected — keep going.' : instance.ordering === 'any' ? 'Play the complete chord.' : 'Follow the highlighted notes.'}
        </p>
      )}

      {phase === 'done' && result && (
        <section className={`piano-exercise-run__result${result.verdict.passed ? ' is-passed' : ' is-developing'}`}>
          <div><span>{result.verdict.passed ? 'Passed' : challenge ? 'Keep working' : 'Practice complete'}</span><strong>{Math.round(result.score * 100)}%</strong></div>
          <dl>
            <div><dt>All notes</dt><dd>{Math.round((result.criteria.completeness ?? 0) * 100)}%</dd></div>
            <div><dt>Clean notes</dt><dd>{Math.round((result.criteria.cleanliness ?? 0) * 100)}%</dd></div>
            {Number.isFinite(result.criteria.placement) && <div><dt>On the beat</dt><dd>{Math.round(result.criteria.placement * 100)}%</dd></div>}
            {result.gates?.pace && <div><dt>Pace</dt><dd>{result.gates.pace.actual} / {result.gates.pace.target} BPM</dd></div>}
          </dl>
          <div className="piano-exercise-run__result-actions">
            <button type="button" className="piano-exercises__quiet-action" onClick={reset}>{challenge ? 'Retry' : 'Again'}</button>
            {challenge && !result.verdict.passed && <button type="button" onClick={onExit}>Practice first</button>}
            {result.verdict.passed && <button type="button" onClick={onPassed}>Continue</button>}
          </div>
        </section>
      )}

      <footer className="piano-exercise-run__keys">
        <PianoKeyboard activeNotes={activeNotes} targetNotes={targetNotes} dimTarget startNote={Math.max(21, Math.min(...expected) - 5)} endNote={Math.min(108, Math.max(...expected) + 5)} />
      </footer>
    </section>
  );
}
