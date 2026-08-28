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
import KeysAsk from './KeysAsk.jsx';
import ScorePassage from './ScorePassage.jsx';
import { titleFromScoreId } from '../SheetMusic/scoreTitle.js';
import { SvgSequenceStaff, sequenceStaffViewBox } from '../../../../MusicNotation/renderers/SvgSequenceStaff.jsx';
import { pianoLearningApi } from './pianoLearningApi.js';
import { prepareExerciseAssessment } from './assessment.js';
import { resolveExerciseRunAccess } from './authorization.js';
import {
  accidentalForKey,
  instanceKeySignature,
  clefForAsk,
  clefForInstance,
  deriveRunTier,
  eventsToStaffNotes,
  staffFitsAsk,
  stageForTier,
} from './runPresentation.js';
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
 * @param {{kind:'keys'|'exercise'|'score', instanceId?:string, source?:string,
 *   measures?:[number,number]}|null} [props.material]
 *   Gate material seam (D10). When present it REPLACES `instanceId` as the load
 *   source and is resolved through `resolveGateMaterial`. Pass a stable
 *   reference (memoize it) — a fresh object rebuilds the attempt, exactly as
 *   `requirementOverride` already does.
 *
 *   `kind:'score'` resolves to a MusicXML document rather than to a bank
 *   instance, and takes a materially different path: there is no authored event
 *   list, so the attempt cannot be built until the ENGRAVER has reported where
 *   the notes are. The stage (`ScorePassage`) mounts first and publishes the
 *   compiled expectation; the attempt is created from it directly, and
 *   `prepareExerciseAssessment` — which reads `instance.events` — is never
 *   called for a score.
 * @param {((result:object)=>void)} [props.onFailed] A COMPLETED attempt that did
 *   not pass. Distinct from `onExit`, which means the player walked away with
 *   nothing to judge. A host that moves a difficulty ladder must only ever move
 *   it on this one: counting walk-aways as failures lets a player reach the
 *   easiest rung without playing a note.
 * @param {string|null} [props.framing] Why this run is on screen, in the host's
 *   own words ("Play this to start Tetris"). It REPLACES the intent label — a
 *   child should read one reason, not two.
 * @param {string|null} [props.ask] The one sentence describing what to play
 *   ("Play the lit keys in order."). Stands where the exercise title otherwise
 *   does; a practice caller omits it and keeps the title.
 * @param {0|1|2|3|null} [props.tier] The rung's presentation band, which decides
 *   the STAGE — not how the attempt is graded. Omit it and the run derives one
 *   (see `deriveRunTier`): every caller that predates tiers keeps the screen it
 *   had, apart from `ordering:'any'` material, which now gets lit keys.
 * @param {((reason:'no-access'|'instance-not-found'|'unrunnable')=>void)} [props.onUnavailable]
 *   This run has settled into a terminal state it cannot leave under its own
 *   power. All three render a `PianoEmpty` whose only affordance is the header
 *   Exit, so a host that mounted this run WITHOUT its own chrome would strand a
 *   player on a dead end. Both callbacks are optional and additive: omit them
 *   and the surface behaves exactly as it did before.
 */
export default function ExerciseRun({ instanceId, material = null, intent = 'practice', practiceMode = 'free', programId = null, stepId = null, requirementOverride = null, framing = null, ask = null, tier = null, onExit, onPassed, onFailed, onUnavailable }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-exercise-run' }), []);
  const { currentUser } = usePianoUser();
  const { activeNotes } = usePianoMidiNotes();
  const { connected } = usePianoMidi();
  const [instance, setInstance] = useState(undefined);
  // Score material's two halves: the document (from the load) and the
  // expectation the engraver's geometry compiles into (from the stage). Both
  // start `undefined` = "not loaded yet" so the skeleton can tell that apart
  // from `null` = "loaded, and this run is not a score".
  const [score, setScore] = useState(undefined);
  const [scoreExpectation, setScoreExpectation] = useState(null);
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
    // A score resolves to a DOCUMENT, not an instance. It travels in its own
    // field rather than being dressed up as one: an instance with no events is
    // a shape every derivation downstream would have to special-case anyway,
    // and one that forgot to would silently grade an empty ask as complete.
    if (resolved.ok && resolved.kind === 'score') return { ok: true, data: null, score: resolved.score };
    if (resolved.ok) return { ok: true, data: resolved.instance, score: null };
    // Material that could not be resolved (a bad id, an unreachable score) is
    // reported, not thrown: the run shows "Exercise not found" and the gate
    // host moves on — which for a gate means failing open.
    logger.warn('piano.exercise-material-unresolved', { kind: material.kind ?? null, error: resolved.error });
    return { ok: false, data: null, score: null };
  }, [instanceId, logger, material]);

  useEffect(() => {
    let alive = true;
    setInstance(undefined);
    setScore(undefined);
    setScoreExpectation(null);
    setUnrunnable(false);
    Promise.all([
      loadInstance(),
      programId ? pianoLearningApi.program(programId) : Promise.resolve({ ok: false, data: null }),
    ]).then(([instanceResponse, programResponse]) => {
      if (!alive) return;
      if (!instanceResponse.ok) { setInstance(null); setScore(null); return; }
      const loaded = instanceResponse.data;
      const step = programResponse.ok ? programResponse.data.steps?.find((entry) => entry.id === stepId) : null;
      setInstance(loaded);
      setScore(instanceResponse.score ?? null);
      setRequirement(requirementOverride ?? step?.requirement ?? null);
    });
    return () => { alive = false; };
  }, [loadInstance, programId, requirementOverride, stepId]);

  /**
   * The engraver's answer, taken ONCE.
   *
   * `ScorePassage` republishes if a re-engrave (a resize, a reflow) changes its
   * geometry, and a run that accepted the second one would rebuild its attempt
   * — resetting the cursor and throwing away every note played so far, under
   * the child's hands, because the tablet rotated. The first answer stands for
   * the life of this material; a NEW material clears it above.
   */
  const takeScoreExpectation = useCallback((expectation) => {
    setScoreExpectation((held) => held ?? expectation);
  }, []);

  /**
   * What this run is OF, for everything that does not care which kind it is:
   * the header, the evidence, the completion log. A bank instance is its own
   * subject; a score stands in for one with the fields those three read.
   */
  const subject = useMemo(() => {
    if (instance) return instance;
    if (!score) return null;
    return { id: score.id, title: titleFromScoreId(score.id), form: 'score', level: null };
  }, [instance, score]);

  const buildAttempt = useCallback(() => {
    if (!access.allowed || (challenge && !requirement)) return null;
    // A score has no attempt until the engraving reports where the notes are.
    // Not an error and not a degraded state: the stage is on screen doing the
    // work, and the run picks this up again the moment it lands.
    if (!instance && !(score && scoreExpectation)) return null;
    const mode = selectedMode;
    const activeRequirement = challenge ? requirement : null;
    // The requirement wins over the surface's defaults — a gate rung can widen
    // `wrongWindow`, allow extras, or loosen the timing windows without this
    // component knowing which knob it turned. Practice is deliberately left on
    // the defaults, exactly as it already ignores a step's rubric and gates.
    const policy = { ...DEFAULT_POLICY, ...(activeRequirement?.policy ?? {}) };
    try {
      if (!instance) {
        // The compiled passage IS the expectation — there is nothing for
        // `prepareExerciseAssessment` to prepare from, and calling it would
        // throw on the events a score does not have. Free walks a cursor
        // through the passage; cued is timed against the score's own tempo map,
        // which the passage compiled from the document.
        return createAssessmentAttempt({
          expectation: scoreExpectation,
          matcher: mode === 'cued' ? 'timed' : 'cursor',
          mode,
          purpose: challenge ? 'challenge' : 'practice',
          requirement: activeRequirement,
          policy,
        });
      }
      const prepared = prepareExerciseAssessment({
        instance, mode, purpose: challenge ? 'challenge' : 'practice', requirement: activeRequirement,
      });
      return createAssessmentAttempt({ ...prepared, policy });
    } catch (error) {
      // A requirement this material cannot satisfy — e.g. a cued rung on a bank
      // instance carrying no tempo, which the engine rejects outright. Without
      // this catch the throw escapes installRuntime's effect and blanks the
      // whole kiosk. Same posture as unresolvable material: log, degrade.
      logger.warn('piano.exercise-attempt-unbuildable', { id: subject?.id ?? null, mode, reason: error?.message ?? String(error) });
      setUnrunnable(true);
      return null;
    }
  }, [access.allowed, challenge, instance, logger, requirement, score, scoreExpectation, selectedMode, subject]);

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
    if (persistedRef.current || !subject) return;
    persistedRef.current = true;
    const terminalResult = { ...(result || {}), status };
    const body = buildPianoAttemptEvidence({
      result: terminalResult,
      attemptId: makeId('attempt'),
      ...(challenge
        ? { challengeId: makeId('exercise-challenge') }
        : { activityId: `exercise:${subject.id}:${selectedMode}` }),
      kind: subject.form ?? 'exercise',
      purpose: challenge ? 'challenge' : 'practice',
      prompt: { exercise_id: subject.id, label: subject.title, mode: selectedMode, level: subject.level?.[selectedMode] ?? null },
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
  }, [access.persistent, challenge, currentUser, logger, programId, selectedMode, stepId, subject]);

  useEffect(() => {
    if (!snapshot.result || persistedRef.current) return;
    persist(snapshot.result);
    if (snapshot.result.status !== 'completed') return;
    const passed = runPassed(snapshot.result, { challenge, passScore: requirement?.passScore });
    logger.info('piano.exercise-complete', {
      id: subject?.id ?? null, purpose: challenge ? 'challenge' : 'practice', matcher: snapshot.matcher,
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
  }, [challenge, logger, onFailed, persist, requirement, snapshot, subject]);

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
  // Both halves are set together by the load, so "settled with nothing" is the
  // single condition — `instance === null` alone would report a resolved SCORE
  // as a missing exercise, and the gate would fail open on a passage that had
  // just arrived intact.
  const notFound = instance === null && score === null;
  const unavailableReason = !access.allowed ? (currentUser ? 'no-access' : null)
    : notFound ? 'instance-not-found'
      : unrunnable ? 'unrunnable' : null;
  const reportedUnavailableRef = useRef(null);
  useEffect(() => {
    if (!unavailableReason || reportedUnavailableRef.current === unavailableReason) return;
    reportedUnavailableRef.current = unavailableReason;
    onUnavailable?.(unavailableReason);
  }, [onUnavailable, unavailableReason]);

  /**
   * A `tier` this surface cannot use — `'2'`, `2.5`, `4`, `-1` — falls back to
   * derivation, which is the right behaviour and the wrong silence: the caller
   * that will pass this is a config-driven host reading an authored level, and
   * a tier that never arrives looks exactly like a tier that was never set.
   * Said once per value, from an effect, so a re-render is not a second report.
   */
  const tierUsable = Number.isInteger(tier) && tier >= 0 && tier <= 3;
  useEffect(() => {
    if (tier == null || tierUsable) return;
    logger.warn('piano.exercise-tier-invalid', { tier, type: typeof tier });
  }, [logger, tier, tierUsable]);

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
    return { bpm, leadInMs, periodMs, clicks: Math.max(1, Math.round(leadInMs / periodMs)) };
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
    enabled: (snapshot.status === 'running' && ['metronome', 'cued'].includes(snapshot.mode))
      // Metronome practice promises a pulse to settle into, and the first note
      // is now what STARTS the run — so the grid has to be audible before it,
      // or the click only ever arrives after the moment it was meant to guide.
      || (snapshot.status === 'prepared' && snapshot.mode === 'metronome'),
    // The tempo the attempt is GRADED at, which is not always `clickBpm`: a
    // cued rung carries no `gates.pace`, so a tempo-less single-event instance
    // (graded at the engine's default) would leave this NaN — the hook then
    // creates no scheduler at all and the count-in counts in silence.
    bpm: countIn?.bpm ?? clickBpm,
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
        // Only the chord's own members are handed over at the boundary. A key
        // already down from before — inert while the run was ready — would
        // otherwise be graded as an extra the moment the child reaches the
        // chord: a wrong note, a latch, and a chord that cannot complete until
        // they lift a finger nothing told them about. The attempt begins from
        // the intentional reach. Once running, the matcher's normal rules
        // apply to the whole held set, extras included.
        lastHeldObservedRef.current = heldKey;
        const reach = new Map([...activeNotesRef.current].filter(([midi]) => armingPitches.has(midi)));
        runtime.observe({ held: reach, time: armedAt, clock: 'date-now' });
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
  if (notFound) return <PianoEmpty message="Exercise not found. It may have been renamed." />;
  if (unrunnable) return <PianoEmpty message="Cannot start this one. It is missing something the challenge needs — try another." />;
  if (instance === undefined || score === undefined || (challenge && !requirement)) return <SkeletonStage />;
  /**
   * A score is the ONE case that renders before its runtime exists — and it has
   * to, because the runtime is built from what the stage below produces. A
   * skeleton here would never lift: the engraver would never mount, so no
   * expectation would ever arrive, so no attempt would ever be built.
   */
  if (!runtime && !score) return <SkeletonStage />;

  const progress = runtime ? assessmentProgress(snapshot) : { eventIndex: 0 };
  // What the run is asking for, event by event. A bank instance authored them;
  // a score's come from the compiled expectation, because the engraving is the
  // only place they exist.
  const askEvents = instance ? instance.events : (snapshot.expectation?.events ?? []);
  const eventIndex = Math.min(progress.eventIndex, askEvents.length);
  const result = snapshot.result?.status === 'completed' ? snapshot.result : null;
  const phase = snapshot.status === 'prepared' ? 'ready' : snapshot.status === 'completed' ? 'done' : countInBeat ? 'countdown' : 'running';
  const expected = askEvents.flatMap((event) => event.notes.map((note) => note.midi));
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
  const currentEvent = askEvents[Math.min(eventIndex, askEvents.length - 1)] || askEvents[0];
  const targetNotes = new Map((currentEvent?.notes || []).map((note) => [note.midi, { velocity: 1 }]));

  /**
   * The rung decides what the screen is. A `tier` prop is the host's own
   * answer; anything else derives one. The tier is a PRESENTATION band only —
   * `passed`, the evidence, and every callback above are computed from the
   * requirement and do not know it exists.
   */
  const runTier = tierUsable ? tier : deriveRunTier(instance, selectedMode);
  // A score's stage is the engraved passage at every tier. The tier still
  // decides the READOUT (words or a percentage) — it just cannot decide the
  // stage, because there is only one way to draw real sheet music.
  const stage = score ? 'score' : stageForTier(runTier, instance);
  // Tier 1's reinforcement staff is offered, not forced: an ask that no single
  // clef holds, or that spans more than an octave, is still a complete ask on
  // lit keys, and a staff it cannot draw legibly helps nobody.
  const askStaff = !score && runTier >= 1 && staffFitsAsk(instance.events);
  const staffShown = stage === 'keys' ? askStaff : true;
  // The bank splits a key across `key` (the root) and an axis (the quality);
  // `instanceKeySignature` re-joins them, so a minor instance is not spelled
  // with the sharps of its relative major.
  const accidental = accidentalForKey(instanceKeySignature(instance));
  const staffNotes = eventsToStaffNotes(instance?.events);
  const staffViewBox = sequenceStaffViewBox(staffNotes.length);
  const cued = selectedMode === 'cued';
  // Only the ordered stages carry a keyboard footer: KeysAsk brings its own
  // keyboard as its primary surface, and two pianos on one screen is a puzzle.
  // An empty `expected` is the score stage before its engraving has landed —
  // `Math.min()` of nothing is Infinity, and a keyboard drawn from that is a
  // blank strip where the piano should be.
  const keyboardFooter = stage !== 'keys' && expected.length > 0;
  // Tiers 0-1 are read by children who cannot read a percentage, and would not
  // be helped by one if they could. Pass or not, said in words.
  const scoreReadout = runTier >= 2;

  return (
    <section className={`piano-exercise-run is-${intent} is-${phase} is-tier-${runTier}`} data-tier={runTier} data-stage={stage}>
      <header className="piano-exercise-run__head">
        <button type="button" className="piano-exercise-run__back" onClick={onExit}>Exit</button>
        <div><span>{framing ?? (challenge ? 'Pass challenge' : 'Practice')}</span><h1>{ask ?? subject.title}</h1></div>
        <div className="piano-exercise-run__context">
          {/* Each chip only where it means something: a key names how a STAFF is
              spelled, so it is silent when there is no staff; a meter is what a
              cued ask is counted in, and nothing at all in a free one. A score
              carries neither: both are printed on the page the child is reading,
              and a chip repeating them would be the kiosk talking over the music. */}
          {staffShown && instance?.key && <span>Key of {instance.key}</span>}
          {cued && instance?.meter && <span>{instance.meter}</span>}
          {challenge && requirement.gates?.pace?.target_bpm && <strong>{requirement.gates.pace.target_bpm} BPM</strong>}
        </div>
      </header>
      {/* Notation and the sequence staff are ink, and ink needs paper on a dark
          screen — they keep the run's paper card. Lit keys are not ink, and a
          keyboard on a cream card would read as a picture of a piano. */}
      <div className={`piano-exercise-run__stage ${stage === 'keys' ? 'piano-exercise-run__ask' : 'piano-exercise-run__score'}`}>
        {stage === 'keys' && (
          <KeysAsk
            events={instance.events}
            cursorIndex={eventIndex}
            activeNotes={activeNotes}
            wrongMidi={lastWrong?.midi ?? null}
            showStaff={askStaff}
            accidental={accidental}
            // The clef the ask was JUDGED to fit on (`staffFitsAsk` asks the
            // same function). Without it the staff re-derives by majority and
            // a tie goes treble — which puts a two-note bass ask off the card.
            clef={clefForAsk(instance.events)}
          />
        )}
        {stage === 'sequence' && (
          /* The staff carries its own aspect ratio (it depends on how many
             notes the ask has), so the host's only job is to hand it a width
             that cannot make it taller than the row. `--staff-aspect` is that
             ratio; the sheet caps the width at `aspect × row height`, which is
             what keeps the stretched staff lines and the uniformly-scaled
             notation on top of each other. */
          <div
            className="piano-exercise-run__sequence"
            style={{ '--staff-aspect': staffViewBox.width / staffViewBox.height }}
          >
            <SvgSequenceStaff
              notes={staffNotes}
              cursorIndex={eventIndex}
              wrongMidi={lastWrong?.midi ?? null}
              activeNotes={activeNotes}
              clef={clefForInstance(instance)}
              accidental={accidental}
            />
          </div>
        )}
        {stage === 'notation' && (
          <ExerciseNotation instance={instance} eventIndex={eventIndex} wrong={isWrong} complete={phase === 'done' && passed} />
        )}
        {stage === 'score' && (
          /* The passage is BOTH the stage and the source of the ask: it engraves
             the document, then hands up the expectation the attempt above is
             built from. It is mounted before there is a runtime, deliberately —
             see the guard above. */
          <ScorePassage
            musicXml={score.musicXml}
            sourceId={score.id}
            measures={score.measures}
            onExpectation={takeScoreExpectation}
            cursorIndex={eventIndex}
            wrongMidi={lastWrong?.midi ?? null}
          />
        )}
        <CountInOverlay active={countInBeat != null} beat={countInBeat} />
      </div>
      {/* No button: the piano starts the run. A cued ask arms on any key and
          counts a measure; every other ask arms on the note it is asking for. */}
      {/* A run with no attempt yet is a score still engraving. Saying "play the
          first note" there would be a lie a child would act on: nothing is
          listening, and a piano that ignores you is indistinguishable from a
          broken one. */}
      {phase === 'ready' && <div className="piano-exercise-run__ready"><p>{!runtime ? 'Getting the music ready…' : snapshot.mode === 'cued' ? `Press any key to start. You'll hear ${countIn?.clicks ?? beatsPerMeasure} clicks, then play at that speed.` : 'Play the first note to begin.'}</p>{!connected && <span>Waiting for the piano…</span>}</div>}
      {['countdown', 'running'].includes(phase) && <p className={`piano-exercise-run__status${isWrong ? ' is-wrong' : ''}`} role="status">{phase === 'countdown' ? 'Listen to the count-in.' : isWrong ? 'That note was not expected — keep going.' : snapshot.matcher === 'held' ? 'Play the complete chord.' : 'Follow the highlighted notes.'}</p>}
      {phase === 'done' && result && !hostOwnsFailure && <section className={`piano-exercise-run__result${passed ? ' is-passed' : ' is-developing'}`}>
        <div><span>{passed ? 'Passed' : challenge ? 'Keep working' : 'Practice complete'}</span>{scoreReadout && <strong>{Math.round(result.score * 100)}%</strong>}</div>
        {/* A percentage is a reading task of its own, and the tiers below 2 are
            for children who have not been given it yet. They are told the same
            thing in words: what happened, and what to do about it. */}
        {scoreReadout
          ? <dl><div><dt>All notes</dt><dd>{Math.round((result.criteria.completeness ?? 0) * 100)}%</dd></div><div><dt>Clean notes</dt><dd>{Math.round((result.criteria.cleanliness ?? 0) * 100)}%</dd></div>{Number.isFinite(result.criteria.placement) && <div><dt>On the beat</dt><dd>{Math.round(result.criteria.placement * 100)}%</dd></div>}</dl>
          : <p className="piano-exercise-run__result-copy">{passed ? 'You played every note that was asked for.' : 'Some of the notes are still missing. Have another go.'}</p>}
        <div className="piano-exercise-run__result-actions"><button type="button" className="piano-exercises__quiet-action" onClick={installRuntime}>{challenge ? 'Retry' : 'Again'}</button>{challenge && !passed && <button type="button" onClick={onExit}>Practice first</button>}{passed && <button type="button" onClick={() => onPassed?.(result)}>Continue</button>}</div>
      </section>}
      {keyboardFooter && <footer className="piano-exercise-run__keys"><PianoKeyboard activeNotes={activeNotes} targetNotes={targetNotes} wrongNotes={wrongNotes} dimTarget startNote={Math.max(21, Math.min(...expected) - 5)} endNote={Math.min(108, Math.max(...expected) + 5)} /></footer>}
    </section>
  );
}
