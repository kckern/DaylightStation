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
import { resolveGateMaterial } from '../Games/gateMaterial.js';
import { useMetronomeClick } from '../SheetMusic/useMetronomeClick.js';
import CountInOverlay from '../SheetMusic/CountInOverlay.jsx';
import { countInPlan } from '../SheetMusic/countIn.js';
import './Exercises.scss';

const EMPTY_SNAPSHOT = Object.freeze({ status: 'prepared', result: null, musicalInput: false });

/** The surface's own windows. A requirement's `policy` is layered over these. */
const DEFAULT_POLICY = Object.freeze({ matchWindowMs: 220, missWindowMs: 420, timingToleranceMs: 80, timingWindowMs: 320 });

function makeId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

/**
 * The wrong-note state kept by the run: `null | { midi, eventId }`, never a
 * bare boolean. Every matcher emits both fields, and the played pitch is what
 * the keyboard footer highlights — a boolean would throw it away. Exported so
 * the shape is pinned by a test rather than only by whatever happens to read it.
 */
export function wrongEventState(event) {
  return event?.type === 'wrong' ? { midi: event.midi, eventId: event.eventId } : null;
}

/**
 * Did this run clear its bar? The surface must answer this itself, because
 * `verdict.passed` alone is not the answer for a gate rung.
 *
 *  - Practice, and the FLOOR rung (`passScore: null`): the engine's verdict is
 *    correct and is the only signal. The floor's rubric (`{completeness:1}`) IS
 *    its contract, and D9 requires it stay unfailable.
 *  - A NON-FLOOR rung carries a `passScore` and NO rubric — so
 *    `attempt.requirement.rubric.criteria` is empty, `failedCriteria` is `[]`,
 *    and with no pace gate `failedGates` is `[]` too. `verdict.passed` is then
 *    unconditionally true at ANY score, including a run where the child played
 *    nothing. The score is the contract on those rungs; reading the verdict
 *    would tell every child "Passed" the instant the gate opened.
 *
 * `passScore: null` must be excluded BEFORE the numeric check: `Number(null)`
 * is 0, which is finite, so a bare `Number.isFinite` would quietly turn the
 * floor into `score >= 0` and stop testing anything.
 */
export function runPassed(result, { challenge = false, passScore = null } = {}) {
  if (!result) return false;
  if (challenge && passScore != null && Number.isFinite(Number(passScore))) return result.score >= Number(passScore);
  return Boolean(result.verdict?.passed);
}

/**
 * @param {object} props
 * @param {string|null} [props.instanceId] Exercise-bank instance to run.
 * @param {{kind:'exercise'|'score', instanceId?:string}|null} [props.material]
 *   Gate material seam (D10). When present it REPLACES `instanceId` as the load
 *   source and is resolved through `resolveGateMaterial`. Pass a stable
 *   reference (memoize it) — a fresh object rebuilds the attempt, exactly as
 *   `requirementOverride` already does.
 * @param {((result:object)=>void)} [props.onFailed] A COMPLETED attempt that did
 *   not pass. Distinct from `onExit`, which means the player walked away with
 *   nothing to judge. A host that moves a difficulty ladder must only ever move
 *   it on this one: counting walk-aways as failures lets a player reach the
 *   easiest rung without playing a note.
 * @param {((reason:'no-access'|'instance-not-found'|'unrunnable')=>void)} [props.onUnavailable]
 *   This run has settled into a terminal state it cannot leave under its own
 *   power. All three render a `PianoEmpty` whose only affordance is the header
 *   Exit, so a host that mounted this run WITHOUT its own chrome would strand a
 *   player on a dead end. Both callbacks are optional and additive: omit them
 *   and the surface behaves exactly as it did before.
 */
export default function ExerciseRun({ instanceId, material = null, intent = 'practice', practiceMode = 'free', programId = null, stepId = null, requirementOverride = null, onExit, onPassed, onFailed, onUnavailable }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-exercise-run' }), []);
  const { currentUser } = usePianoUser();
  const { activeNotes } = usePianoMidiNotes();
  const { connected } = usePianoMidi();
  const [instance, setInstance] = useState(undefined);
  const [requirement, setRequirement] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [lastWrong, setLastWrong] = useState(null);
  const [countInBeat, setCountInBeat] = useState(null);
  const [unrunnable, setUnrunnable] = useState(false);
  const countInTimerRef = useRef(null);
  const previousNotesRef = useRef([]);
  // The last held set actually handed to the engine. The held matcher grades the
  // WHOLE set on every observation, so re-sending an unchanged set after the
  // cursor has moved on would be read as a wrong chord.
  const lastHeldObservedRef = useRef(null);
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;
  const persistedRef = useRef(false);
  const runtimeRef = useRef(null);
  const access = resolveExerciseRunAccess(intent, currentUser);
  const { challenge } = access;
  const selectedMode = challenge ? requirement?.mode : practiceMode;

  const loadInstance = useCallback(async () => {
    if (!material) return pianoLearningApi.instance(instanceId);
    const resolved = await resolveGateMaterial(material);
    if (resolved.ok) return { ok: true, data: resolved.instance };
    // A material kind this phase cannot render (or a bad id) is skipped, not
    // thrown: the run shows "Exercise not found" and the gate host moves on.
    logger.warn('piano.exercise-material-unresolved', { kind: material.kind ?? null, error: resolved.error });
    return { ok: false, data: null };
  }, [instanceId, logger, material]);

  useEffect(() => {
    let alive = true;
    setInstance(undefined);
    setUnrunnable(false);
    Promise.all([
      loadInstance(),
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
  }, [loadInstance, programId, requirementOverride, stepId]);

  const buildAttempt = useCallback(() => {
    if (!access.allowed || !instance || (challenge && !requirement)) return null;
    const mode = selectedMode;
    const activeRequirement = challenge ? requirement : null;
    try {
      const prepared = prepareExerciseAssessment({
        instance, mode, purpose: challenge ? 'challenge' : 'practice', requirement: activeRequirement,
      });
      // The requirement wins over the surface's defaults — a gate rung can widen
      // `wrongWindow`, allow extras, or loosen the timing windows without this
      // component knowing which knob it turned. Practice is deliberately left on
      // the defaults, exactly as it already ignores a step's rubric and gates.
      return createAssessmentAttempt({ ...prepared, policy: { ...DEFAULT_POLICY, ...(activeRequirement?.policy ?? {}) } });
    } catch (error) {
      // A requirement this instance cannot satisfy — e.g. a cued rung on a bank
      // instance carrying no tempo, which the engine rejects outright. Without
      // this catch the throw escapes installRuntime's effect and blanks the
      // whole kiosk. Same posture as unresolvable material: log, degrade.
      logger.warn('piano.exercise-attempt-unbuildable', { id: instance.id, mode, reason: error?.message ?? String(error) });
      setUnrunnable(true);
      return null;
    }
  }, [access.allowed, challenge, instance, logger, requirement, selectedMode]);

  const installRuntime = useCallback(() => {
    const attempt = buildAttempt();
    if (!attempt) return;
    setUnrunnable(false);
    runtimeRef.current?.dispose();
    const next = createAssessmentRuntime({
      attempt,
      createAttempt: buildAttempt,
      now: () => Date.now(),
      tickMs: 50,
      onEvent: (event) => setLastWrong(wrongEventState(event)),
    });
    runtimeRef.current = next;
    previousNotesRef.current = [...activeNotesRef.current.keys()];
    lastHeldObservedRef.current = null;
    persistedRef.current = false;
    globalThis.clearInterval(countInTimerRef.current);
    countInTimerRef.current = null;
    setLastWrong(null);
    setCountInBeat(null);
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
    if (snapshot.result.status !== 'completed') return;
    const passed = runPassed(snapshot.result, { challenge, passScore: requirement?.passScore });
    logger.info('piano.exercise-complete', {
      id: instance.id, purpose: challenge ? 'challenge' : 'practice', matcher: snapshot.matcher,
      score: snapshot.result.score,
      // `verdict.passed` is the engine's record and stays in the evidence
      // untouched — but on a non-floor rung it is always true, so it would
      // tell a false story on its own. `passed` is what the child was shown.
      engine_verdict: snapshot.result.verdict.passed,
      passed,
    });
    // A judged, completed attempt that did not clear its bar. `onPassed` stays
    // player-driven (the Continue button) because a pass is good news the
    // player should read first; a failure is reported straight to the host so
    // it can offer its own ways forward — and so a host counting failures
    // counts only attempts that actually happened.
    if (!passed) onFailed?.(snapshot.result);
  }, [challenge, instance, logger, onFailed, persist, requirement, snapshot]);

  /**
   * The three states this run cannot leave on its own. Reported through an
   * effect rather than from render so the host is told once, after the state
   * has settled, and never mid-render.
   *
   * `no-access` is WITHHELD until the user has settled. `currentUser` starts
   * `null` and hydrates asynchronously (`PianoUserContext`, which retries its
   * roster fetch on a 2s/5s/15s/30s backoff — precisely during the backend
   * restarts this reporting exists for), and `resolveExerciseRunAccess` denies a
   * challenge to a falsy user. Reporting on the first commit would tell a host
   * "this player is not allowed" about a player who simply has not arrived yet.
   * `null` means not hydrated; `'guest'` means hydrated and not permitted, and
   * only that second one is a real answer.
   */
  const unavailableReason = !access.allowed ? (currentUser ? 'no-access' : null)
    : instance === null ? 'instance-not-found'
      : unrunnable ? 'unrunnable' : null;
  const reportedUnavailableRef = useRef(null);
  useEffect(() => {
    if (!unavailableReason || reportedUnavailableRef.current === unavailableReason) return;
    reportedUnavailableRef.current = unavailableReason;
    onUnavailable?.(unavailableReason);
  }, [onUnavailable, unavailableReason]);

  const held = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);
  const clickBpm = Number(requirement?.gates?.pace?.target_bpm ?? instance?.tempo?.start_bpm);
  const beatsPerMeasure = useMemo(() => {
    const beats = Number(String(instance?.meter ?? '').split('/')[0]);
    return Number.isInteger(beats) && beats > 0 ? beats : 4;
  }, [instance?.meter]);
  /**
   * The cued count-in: exactly ONE measure of the run's own tempo, because that
   * is the promise the ready line makes and the length a child can hold in their
   * head. `countInPlan` owns the PULSE inside that measure — above ~140bpm it
   * coarsens the count so the numbers stay countable instead of becoming a buzz.
   * `clicks` is therefore how many of the plan's clicks fit in the measure, not
   * a second opinion about the meter.
   */
  const countIn = useMemo(() => {
    // The attempt's own tempo map is the tempo the engine GRADES against, and
    // it is not always `clickBpm`: a single-event cued instance carrying no
    // tempo is given the engine's default. Counting a child in at one tempo and
    // marking them against another is the one thing this must not do.
    const graded = Number(snapshot.expectation?.tempoMap?.[0]?.bpm);
    const bpm = graded > 0 ? graded : clickBpm;
    if (!(bpm > 0)) return null;
    const leadInMs = beatsPerMeasure * 60000 / bpm;
    const { periodMs } = countInPlan({ beats: beatsPerMeasure, bpm });
    return { leadInMs, periodMs, clicks: Math.max(1, Math.round(leadInMs / periodMs)) };
  }, [beatsPerMeasure, clickBpm, snapshot.expectation]);

  /**
   * A cued ask arms on ANY key — the child is saying "I am here", not playing
   * yet — and then hears one measure of clicks before the first graded beat.
   * The runtime is `running` for the whole lead-in (only the target times are
   * shifted), which is exactly why the metronome below needs no special case:
   * its clicks and the first played beat are one uninterrupted grid.
   */
  const startCountIn = useCallback(() => {
    if (!runtime) return;
    // No usable tempo to count at — start anyway. A key that does nothing is a
    // dead surface, and a child cannot tell that apart from a broken piano.
    runtime.start({ leadInMs: countIn?.leadInMs ?? 0, clock: 'date-now' });
    if (!countIn) return;
    setCountInBeat(1);
    globalThis.clearInterval(countInTimerRef.current);
    countInTimerRef.current = globalThis.setInterval(() => {
      const state = runtime.getSnapshot();
      const elapsed = Date.now() - (state.startedAt ?? 0);
      if (state.status !== 'running' || elapsed >= countIn.leadInMs) {
        globalThis.clearInterval(countInTimerRef.current);
        countInTimerRef.current = null;
        setCountInBeat(null);
        return;
      }
      setCountInBeat(Math.min(countIn.clicks, Math.floor(elapsed / countIn.periodMs) + 1));
    }, 100);
  }, [countIn, runtime]);

  /**
   * The notes that can arm a free ask: the pitches of the event the cursor is
   * sitting on. For a single-note ask that is "the first expected note". For a
   * CHORD — the `held` matcher's `ordering: any` material — it is any member,
   * because material whose own contract is "any order" must not then demand one
   * particular finger first; a child reaching the chord from the top would be
   * left pressing keys at a run that never starts.
   */
  const armingPitches = useMemo(() => {
    const events = snapshot.expectation?.events ?? [];
    const current = events[snapshot.cursor ?? 0];
    return new Set((current?.notes ?? []).map((note) => note.midi));
  }, [snapshot]);

  useMetronomeClick({
    enabled: snapshot.status === 'running' && ['metronome', 'cued'].includes(snapshot.mode),
    bpm: clickBpm,
  });
  const heldKey = held.join(',');
  useEffect(() => {
    if (!runtime) return;
    const onsets = held.filter((midi) => !previousNotesRef.current.includes(midi));
    previousNotesRef.current = held;
    const time = Date.now();
    if (snapshot.status === 'prepared') {
      if (!onsets.length) return;
      if (snapshot.mode === 'cued') { startCountIn(); return; }
      // A note this ask did not want is a child finding their hands, not a
      // wrong answer: it starts nothing and is never counted against them.
      const arming = onsets.find((midi) => armingPitches.has(midi));
      if (arming === undefined) return;
      // Start FIRST, observe second, so the note that armed the run is also its
      // first graded note — a free ask asks for eight notes, not nine.
      runtime.start({ leadInMs: 0, clock: 'date-now' });
      // The arming note is played AT the start instant, and must be timed from
      // the runtime's own clock reading: a `Date.now()` sampled a millisecond
      // earlier is `before_start` to the engine, which silently drops the note.
      const armedAt = runtime.getSnapshot().startedAt ?? time;
      if (snapshot.matcher === 'held') {
        lastHeldObservedRef.current = heldKey;
        runtime.observe({ held: activeNotesRef.current, time: armedAt, clock: 'date-now' });
      } else {
        runtime.observe({ midi: arming, time: armedAt, clock: 'date-now' });
      }
      return;
    }
    if (snapshot.status !== 'running') return;
    if (snapshot.matcher === 'held') {
      if (lastHeldObservedRef.current === heldKey) return;
      lastHeldObservedRef.current = heldKey;
      runtime.observe({ held: activeNotes, time, clock: 'date-now' });
      return;
    }
    for (const midi of onsets) runtime.observe({ midi, time, clock: 'date-now' });
  }, [activeNotes, armingPitches, held, heldKey, runtime, snapshot.cursor, snapshot.matcher, snapshot.mode, snapshot.status, startCountIn]);

  useEffect(() => () => {
    globalThis.clearInterval(countInTimerRef.current);
    countInTimerRef.current = null;
    const active = runtimeRef.current?.getSnapshot();
    if (active?.status === 'running' && active.musicalInput && !persistedRef.current) {
      const interrupted = runtimeRef.current.abort();
      persist(interrupted.result, 'aborted', { keepalive: true });
    }
    runtimeRef.current?.dispose();
  }, [persist]);

  // PianoEmpty's prop is `message` — `title`/`hint` are silently dropped, which
  // is why these states used to render a bare "Nothing here yet."
  if (!access.allowed) return <PianoEmpty message="Choose a player. Challenges need a saved piano profile so the result can be recorded." />;
  // Both degraded states must be checked BEFORE the skeleton. `runtime` stays
  // null whenever there is no attempt to build, so a `!runtime` test placed
  // first swallows them and spins on a skeleton forever.
  if (instance === null) return <PianoEmpty message="Exercise not found. It may have been renamed." />;
  if (unrunnable) return <PianoEmpty message="Cannot start this one. It is missing something the challenge needs — try another." />;
  if (instance === undefined || (challenge && !requirement) || !runtime) return <SkeletonStage />;

  const progress = assessmentProgress(snapshot);
  const eventIndex = Math.min(progress.eventIndex, instance.events.length);
  const result = snapshot.result?.status === 'completed' ? snapshot.result : null;
  const phase = snapshot.status === 'prepared' ? 'ready' : snapshot.status === 'completed' ? 'done' : countInBeat ? 'countdown' : 'running';
  const expected = instance.events.flatMap((event) => event.notes.map((note) => note.midi));
  // Two consumers, two different things. ExerciseNotation's `wrong` prop is a
  // FLAG (it only ever colours the cursor note), so it gets a boolean — passing
  // the object would "work" by truthiness and rot the moment either side
  // changes. The keyboard footer wants the pitch itself.
  const isWrong = lastWrong !== null;
  const wrongNotes = lastWrong === null ? null : new Set([lastWrong.midi]);
  const passed = runPassed(result, { challenge, passScore: requirement?.passScore });
  /**
   * A host that took `onFailed` owns what happens after a miss, and it is told
   * from a PASSIVE effect — which React schedules after paint. Rendering this
   * run's own result panel as well would flash "Keep working" with two tappable
   * buttons (Retry, Practice first) for a frame before the host swapped it out.
   * On a tablet that is a real mis-tap, not a cosmetic blink. A pass is
   * unaffected: `onPassed` is player-driven, so the panel and its Continue
   * button are still the only way to take it.
   */
  const hostOwnsFailure = Boolean(onFailed) && !passed;
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
        <ExerciseNotation instance={instance} eventIndex={eventIndex} wrong={isWrong} complete={phase === 'done' && passed} />
        <CountInOverlay active={countInBeat != null} beat={countInBeat} />
      </div>
      {/* No button: the piano starts the run. A cued ask arms on any key and
          counts a measure; every other ask arms on the note it is asking for. */}
      {phase === 'ready' && <div className="piano-exercise-run__ready"><p>{snapshot.mode === 'cued' ? `Press any key to start. You'll hear ${countIn?.clicks ?? beatsPerMeasure} clicks, then play at that speed.` : 'Play the first note to begin.'}</p>{!connected && <span>Waiting for the piano…</span>}</div>}
      {['countdown', 'running'].includes(phase) && <p className={`piano-exercise-run__status${isWrong ? ' is-wrong' : ''}`} role="status">{phase === 'countdown' ? 'Listen to the count-in.' : isWrong ? 'That note was not expected — keep going.' : snapshot.matcher === 'held' ? 'Play the complete chord.' : 'Follow the highlighted notes.'}</p>}
      {phase === 'done' && result && !hostOwnsFailure && <section className={`piano-exercise-run__result${passed ? ' is-passed' : ' is-developing'}`}>
        <div><span>{passed ? 'Passed' : challenge ? 'Keep working' : 'Practice complete'}</span><strong>{Math.round(result.score * 100)}%</strong></div>
        <dl><div><dt>All notes</dt><dd>{Math.round((result.criteria.completeness ?? 0) * 100)}%</dd></div><div><dt>Clean notes</dt><dd>{Math.round((result.criteria.cleanliness ?? 0) * 100)}%</dd></div>{Number.isFinite(result.criteria.placement) && <div><dt>On the beat</dt><dd>{Math.round(result.criteria.placement * 100)}%</dd></div>}</dl>
        <div className="piano-exercise-run__result-actions"><button type="button" className="piano-exercises__quiet-action" onClick={installRuntime}>{challenge ? 'Retry' : 'Again'}</button>{challenge && !passed && <button type="button" onClick={onExit}>Practice first</button>}{passed && <button type="button" onClick={() => onPassed?.(result)}>Continue</button>}</div>
      </section>}
      <footer className="piano-exercise-run__keys"><PianoKeyboard activeNotes={activeNotes} targetNotes={targetNotes} wrongNotes={wrongNotes} dimTarget startNote={Math.max(21, Math.min(...expected) - 5)} endNote={Math.min(108, Math.max(...expected) + 5)} /></footer>
    </section>
  );
}
