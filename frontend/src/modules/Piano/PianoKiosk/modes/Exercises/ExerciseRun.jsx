import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { PianoKeyboard } from '../../../components/PianoKeyboard.jsx';
import { resolveBoardRange } from '../../../noteUtils.js';
import { usePianoMidi, usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { usePianoKioskConfigOptional } from '../../PianoConfig.jsx';
import { usePianoExitGesture } from '../../../game-platform/input/usePianoExitGesture.js';
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
import DrillProgress from './DrillProgress.jsx';
import ExerciseNotation from './ExerciseNotation.jsx';
import { timedRunPresentation } from './timedRunPresentation.js';
import KeysAsk from './KeysAsk.jsx';
import ScorePassage from './ScorePassage.jsx';
import { titleFromScoreId } from '../SheetMusic/scoreTitle.js';
import { SvgSequenceStaff, sequenceStaffViewBox } from '../../../../MusicNotation/renderers/SvgSequenceStaff.jsx';
import { prepareExerciseAssessment } from './assessment.js';
import { resolveExerciseRunAccess } from './authorization.js';
import {
  accidentalForKey,
  instanceKeySignature,
  clefForInstance,
  deriveRunTier,
  eventsToStaffNotes,
  staffFitsAsk,
} from './runPresentation.js';
import { askTupleFor, deriveStage } from '../../../ask/askSchema.js';
import { useMetronomeClick } from '../SheetMusic/useMetronomeClick.js';
import CountInOverlay from '../SheetMusic/CountInOverlay.jsx';
import { countInPlan } from '../SheetMusic/countIn.js';
import './Exercises.scss';

const NO_FEEDBACK_NOTES = new Map();
const EMPTY_SNAPSHOT = Object.freeze({ status: 'prepared', result: null, musicalInput: false });

/** The surface's own windows. A requirement's `policy` is layered over these. */
const DEFAULT_POLICY = Object.freeze({ matchWindowMs: 220, missWindowMs: 420, timingToleranceMs: 80, timingWindowMs: 320 });

/**
 * The two statuses that carry a JUDGED attempt — one a child played and this
 * surface is entitled to report an outcome for.
 *
 * `completed` is every note eventually accounted for. `timeout` is the stall
 * below: a challenge that was started, took real notes, and then stopped. Both
 * are outcomes; `aborted` (an unmount) is not, and is
 * deliberately absent — a walk-away has nothing to judge.
 */
const JUDGED_STATUSES = Object.freeze(new Set(['completed', 'timeout']));

/**
 * How long a started FREE challenge may sit with no note-on before it is judged
 * as it stands.
 *
 * A free attempt cannot fail on its own. The cursor matcher produces no misses
 * — there is no beat to be late for — so completeness only ever rises, and a
 * completeness-only rubric (every tier 0-2 level, D9) is satisfied the instant
 * the last note lands and at no point before it. A child who cannot play the
 * ask therefore sits on a `running` attempt forever: no result, no fail panel,
 * no way down the ladder, and Exit costs them the game they earned.
 *
 * The stall is what ends it. Twenty seconds is long enough that a child working
 * a hard passage out under their hands is never interrupted (the clock resets
 * on every note-on, so thinking between notes is free) and short enough that
 * being stuck is over before it becomes being stranded.
 *
 * It does NOT run before the first note: an attempt with no musical input in it
 * is an abandonment, not a failure, and moving the ladder on those would let a
 * child reach the unfailable floor by walking away `retriesBeforeDegrade`
 * times without touching a key. Cued asks are excluded because they already
 * fail on their own — the timed matcher misses notes that never arrive.
 *
 * It does not touch D9's unfailable floor, and does not need a carve-out to
 * avoid it: no criterion is added, and the built-in floor's ask is ONE lit key,
 * so the note that arms it is the note that completes it. There is no interval
 * during which that attempt can be stalled.
 */
const FREE_STALL_MS = 20000;
/** A recall hint must arrive with enough time left to use it before the stall. */
const HINT_REVEAL_MS = 12000;

/**
 * How long metronome practice clicks at a piano nobody is sitting at.
 *
 * The pre-pulse exists so the grid is audible BEFORE the first note (the first
 * note is what starts the run, so a click that waits for `running` arrives
 * after the moment it exists to guide). Nothing stopped it: a kiosk left on this
 * screen clicked until someone closed the tab. Once it stops there is nothing
 * to resume — a child arms by playing, and the run brings its own click.
 */
const PRE_PULSE_LIMIT_MS = 60000;

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
 * The assessor may advance as soon as a correct key goes down.  The child still
 * has that key held, though, so drawing the assessor's NEXT event immediately
 * makes the cursor look one note ahead and turns the note under their finger
 * into a ghost.  Keep the just-completed event visible until its key is lifted.
 */
export function visualCursorFor(events = [], assessmentCursor = 0, activeNotes = null, status = 'prepared') {
  const cursor = Math.min(Math.max(Number.isInteger(assessmentCursor) ? assessmentCursor : 0, 0), events.length);
  if (status === 'completed' || status === 'aborted' || status === 'timeout' || cursor >= events.length) {
    return { index: cursor, reason: 'complete' };
  }
  const held = new Set(activeNotes ? activeNotes.keys() : []);
  const current = events[cursor]?.notes?.map((note) => note.midi) ?? [];
  if (current.some((midi) => held.has(midi))) return { index: cursor, reason: 'engine-current' };
  const previous = events[cursor - 1]?.notes?.map((note) => note.midi) ?? [];
  if (previous.some((midi) => held.has(midi))) return { index: cursor - 1, reason: 'held-completed' };
  return { index: cursor, reason: 'engine-current' };
}

/**
 * Did this run clear its bar?
 *
 * Two inputs, in this order, and both are needed:
 *
 *  - **A host-supplied `passScore`.** No level a `gateRepertoire` can express
 *    produces one — `requirementForLevel` writes `passScore: null` everywhere,
 *    because pass is verdict-driven and a second `score >= passScore` gate
 *    living alongside the rubric is exactly the cleanliness bar D9 forbids
 *    below tier 3. The branch survives for the OTHER host: a program step,
 *    whose requirement is authored by hand and may carry a numeric bar with no
 *    rubric beside it. On such a requirement `rubric.criteria` is empty, so
 *    `failedCriteria` and `failedGates` are both `[]` and `verdict.passed` is
 *    unconditionally true at any score — the number is the only real contract
 *    there, and reading the verdict would tell every child "Passed" the
 *    instant the run opened.
 *  - **Otherwise the engine's verdict.** Practice, and every repertoire rung.
 *    The rubric IS the contract, and at tier 0-2 that rubric is
 *    completeness-only, which is what keeps the floor unfailable (D9).
 *
 * A result with NO verdict is not a pass, and that is load-bearing rather than
 * incidental: a stalled attempt (`status: 'timeout'`) is finalized without one
 * — no score, no criteria, no verdict — so it falls to `verdict?.passed` being
 * `undefined` and answers `false` on its own, with nothing here forcing it.
 *
 * `passScore: null` must be excluded BEFORE the numeric check: `Number(null)`
 * is 0, which is finite, so a bare `Number.isFinite` would quietly turn a
 * verdict-driven rung into `score >= 0` and stop testing anything.
 */
export function runPassed(result, { challenge = false, passScore = null } = {}) {
  if (!result) return false;
  if (challenge && passScore != null && Number.isFinite(Number(passScore))) return result.score >= Number(passScore);
  return Boolean(result.verdict?.passed);
}

/**
 * @param {object} props
 * @param {object|null|undefined} [props.instance] The bank instance this run is
 *   OF, already resolved by whoever mounted it (`AskSession`). `undefined` is
 *   "still resolving" and shows the skeleton; `null` is "resolved, and there is
 *   none". Pass a stable reference — a fresh object rebuilds the attempt.
 * @param {object|null|undefined} [props.score] The MusicXML DOCUMENT, for score
 *   material, which resolves to no instance at all. It takes a materially
 *   different path: there is no authored event list, so the attempt cannot be
 *   built until the ENGRAVER has reported where the notes are. The stage
 *   (`ScorePassage`) mounts first and publishes the compiled expectation; the
 *   attempt is created from it directly, and `prepareExerciseAssessment` —
 *   which reads `instance.events` — is never called for a score.
 * @param {object|null} [props.requirement] What this run is judged by, chosen
 *   above. Practice passes none.
 * @param {((result:object)=>void)} [props.onFailed] A JUDGED attempt that did
 *   not pass — one the child actually played. Two results reach it: a
 *   `completed` attempt below its bar, and a `timeout` one, which is a free
 *   challenge that took real notes and then stalled (`FREE_STALL_MS`). The
 *   second carries diagnostics but NO score, criteria, or verdict, so a host
 *   reading a number off it must tolerate its absence.
 *
 *   Distinct from `onExit`, which means the player walked away with nothing to
 *   judge. A host that moves a difficulty ladder must only ever move it on this
 *   one: counting walk-aways as failures lets a player reach the easiest rung
 *   without playing a note, and an attempt with no musical input in it never
 *   arrives here for exactly that reason.
 * @param {string|null} [props.framing] Why this run is on screen, in the host's
 *   own words ("Play this to start Tetris"). It REPLACES the intent label — a
 *   child should read one reason, not two.
 * @param {string|null} [props.ask] The one sentence describing what to play
 *   ("Play the lit keys in order."). Stands where the exercise title otherwise
 *   does; a practice caller omits it and keeps the title.
 * @param {object|null} [props.askTuple] The resolved authored presentation.
 * When present it is the single source for the stage and hint policy; direct
 * legacy mounts retain the tier-derived tuple below.
 * @param {0|1|2|3|null} [props.tier] The rung's presentation band, which decides
 *   the STAGE — not how the attempt is graded. Omit it and the run derives one
 *   (see `deriveRunTier`): every caller that predates tiers keeps the screen it
 *   had, apart from `ordering:'any'` material, which now gets lit keys.
 * @param {((reason:'no-access'|'instance-not-found'|'unrunnable')=>void)} [props.onUnavailable]
 *   This run has settled into a terminal state it cannot leave under its own
 *   power. All three render a `PianoEmpty`, so a host without a recovery callback could strand a
 *   player on a dead end. Both callbacks are optional and additive: omit them
 *   and the surface behaves exactly as it did before.
 */
export default function ExerciseRun({ instance, score, requirement = null, intent = 'practice', practiceMode = 'free', programId = null, stepId = null, framing = null, ask = null, askTuple = null, tier = null, traceContext = null, onExit, onPassed, onFailed, onUnavailable }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-exercise-run' }), []);
  const { currentUser } = usePianoUser();
  const { activeNotes } = usePianoMidiNotes();
  const { connected } = usePianoMidi();
  const keyboardConfig = usePianoKioskConfigOptional()?.config?.keyboard;
  /**
   * RESOLUTION LIVES ABOVE THIS COMPONENT. `AskSession` owns it and hands down
   * a settled `instance`/`score`/`requirement`; this surface presents, grades,
   * persists, and reports, and never asks the network for its own subject.
   *
   * The compatibility seam that let a host pass `instanceId`/`material` and
   * have the run load for itself was created and retired inside one plan
   * (ask-platform SP1, tasks 3-6): every host mounts `AskSession` now, so the
   * seam had no caller left. `undefined` on either source still means "still
   * resolving" and shows the skeleton; `null` means "resolved, and there is
   * none", which together are what `notFound` reads below.
   */
  const [scoreExpectation, setScoreExpectation] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [lastWrong, setLastWrong] = useState(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const countdownHeldRef = useRef(new Set());
  const [unrunnable, setUnrunnable] = useState(false);
  // The stall clock's reset signal. Bumped by every note-on the run sees, and
  // read as a dependency by the stall effect below — which is the whole of "the
  // clock resets on every note-on", expressed where React can see it rather
  // than as a timestamp inside a ref nothing re-runs on.
  const [noteOnTick, setNoteOnTick] = useState(0);
  const [prePulseStopped, setPrePulseStopped] = useState(false);
  const [afterStallHint, setAfterStallHint] = useState(false);
  const previousNotesRef = useRef([]);
  // The last held set actually handed to the engine. The held matcher grades the
  // WHOLE set on every observation, so re-sending an unchanged set after the
  // cursor has moved on would be read as a wrong chord.
  const lastHeldObservedRef = useRef(null);
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;
  const persistedRef = useRef(false);
  // One durable assessment identity per installed runtime. Hosts that grant a
  // stake after a real pass use this same id; retries get a fresh one, while a
  // repeated host delivery remains idempotent server-side.
  const assessmentIdRef = useRef(null);
  const runtimeRef = useRef(null);
  const lastVisualCursorRef = useRef(null);
  const traceFieldsRef = useRef(null);
  traceFieldsRef.current = {
    assessmentId: assessmentIdRef.current,
    learnerId: typeof currentUser === 'string' ? currentUser : currentUser?.id ?? null,
    hostAttemptId: traceContext?.attemptId ?? null,
    hostSessionId: traceContext?.sessionId ?? null,
    subjectId: instance?.id ?? score?.id ?? null,
    intent,
  };
  const traceEvent = useCallback((event, data = {}) => {
    logger.info(event, { ...traceFieldsRef.current, assessmentId: assessmentIdRef.current, ...data });
  }, [logger]);
  const access = resolveExerciseRunAccess(intent, currentUser);
  const { challenge } = access;
  const selectedMode = challenge ? requirement?.mode : practiceMode;

  /**
   * A NEW subject clears the last one's engraving and its degraded state — a
   * run must never inherit either from the material before it.
   *
   * Adjusted DURING RENDER, and that is ordering rather than style. The stage
   * below can reach a terminal state inside the very commit it is mounted in:
   * `ScorePassage` reports `unrunnable` from its own effect when the engraver
   * cannot read the document, and React runs CHILD effects before the parent's.
   * A reset living in an effect here would therefore erase that answer a moment
   * after it was given, and the child would sit on "Getting the music ready…"
   * with no terminal state, no report to the host, and Leave as the only way
   * out — the exact hang this state exists to prevent. The compatibility path
   * hid that by skipping the reset entirely whenever the run resolved for
   * itself; with resolution gone the reset has to be correct on its own.
   */
  const [subjectSources, setSubjectSources] = useState({ instance, score });
  if (subjectSources.instance !== instance || subjectSources.score !== score) {
    setSubjectSources({ instance, score });
    setScoreExpectation(null);
    setUnrunnable(false);
  }

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
   * The passage's OTHER terminal answer: there will be no expectation from this
   * document. Without it a score run has no ending at all — `instance === null`
   * but `score` holds the document, so nothing here reads as "not found", the
   * run never becomes unavailable, and a child sits on "Getting the music
   * ready…" until they give up and press Leave, forfeiting the game they earned
   * and logging it as an abandonment rather than as the outage it was.
   *
   * `unrunnable` is the right terminal state and already exists: the gate reads
   * it as infrastructure and fails open, which is what a child is owed when the
   * music could not be put in front of them.
   */
  const handleScoreUnrunnable = useCallback((reason) => {
    // The document's own id, which IS the source path it was fetched from —
    // read off the score rather than off the material descriptor, because a
    // host that resolved above no longer passes one.
    logger.warn('piano.exercise-score-unrunnable', { id: score?.id ?? null, reason });
    setUnrunnable(true);
  }, [logger, score]);

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
    assessmentIdRef.current = makeId('attempt');
    const next = createAssessmentRuntime({
      attempt,
      createAttempt: buildAttempt,
      now: () => Date.now(),
      tickMs: 50,
      onEvent: (event, state, previous) => {
        setLastWrong(wrongEventState(event));
        traceEvent('piano.exercise-observation', {
          eventType: event.type,
          eventId: event.eventId ?? null,
          midi: event.midi ?? null,
          reason: event.reason ?? null,
          cursorBefore: previous?.cursor ?? null,
          cursorAfter: state?.cursor ?? null,
          statusBefore: previous?.status ?? null,
          statusAfter: state?.status ?? null,
          held: Array.isArray(event.held) ? event.held : null,
        });
      },
    });
    runtimeRef.current = next;
    previousNotesRef.current = [...activeNotesRef.current.keys()];
    lastHeldObservedRef.current = null;
    persistedRef.current = false;
    traceEvent('piano.exercise-runtime-installed', {
      matcher: next.getSnapshot().matcher,
      mode: next.getSnapshot().mode,
      cursor: next.getSnapshot().cursor,
    });
    setLastWrong(null);
    countdownHeldRef.current.clear();
    setClockNow(Date.now());
    // A fresh attempt is a fresh stall clock and a fresh pre-pulse budget:
    // Retry/Again must give a child the same run they were given the first
    // time, not the remainder of the last one's patience.
    setNoteOnTick(0);
    setPrePulseStopped(false);
    setRuntime(next);
  }, [buildAttempt, traceEvent]);

  useEffect(installRuntime, [installRuntime]);

  const snapshot = useSyncExternalStore(
    useCallback((listener) => runtime?.subscribe(listener) || (() => {}), [runtime]),
    useCallback(() => runtime?.getStoreSnapshot() || EMPTY_SNAPSHOT, [runtime]),
    () => EMPTY_SNAPSHOT,
  );

  const timed = snapshot.matcher === 'timed';
  const clockPosition = timed ? timedRunPresentation(snapshot, Math.max(clockNow, Date.now())) : null;
  // The matcher may finish early. Its result must not end the musical display
  // before the authored time has elapsed.
  const awaitingTimeline = timed && snapshot.status === 'completed' && !clockPosition.timelineDone;
  const timeline = awaitingTimeline ? { ...clockPosition, phase: 'running' } : clockPosition;
  const resultReady = !awaitingTimeline;
  useEffect(() => {
    if (!timed || (snapshot.status !== 'running' && !awaitingTimeline)) return undefined;
    setClockNow(Date.now());
    const timer = globalThis.setInterval(() => setClockNow(Date.now()), 50);
    return () => globalThis.clearInterval(timer);
  }, [runtime, timed, snapshot.status, awaitingTimeline]);
  const countingDown = timeline?.phase === 'countdown';
  const feedbackNotes = timed
    ? timeline.phase !== 'running' ? NO_FEEDBACK_NOTES
      : new Map([...activeNotes].filter(([midi]) => !countdownHeldRef.current.has(midi)))
    : activeNotes;

  const persist = useCallback(async (result, status = result?.status || 'completed', { keepalive = false } = {}) => {
    if (persistedRef.current || !subject) return;
    persistedRef.current = true;
    const terminalResult = { ...(result || {}), status };
    const body = buildPianoAttemptEvidence({
      result: terminalResult,
      attemptId: assessmentIdRef.current || (assessmentIdRef.current = makeId('attempt')),
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
    if (!snapshot.result || !resultReady || persistedRef.current) return;
    persist(snapshot.result);
    // A JUDGED attempt: completed, or stalled after real input. An `aborted`
    // one is persisted above and reported nowhere — there is nothing in it to
    // judge, and a host counting failures must not count a walk-away.
    if (!JUDGED_STATUSES.has(snapshot.result.status)) return;
    const passed = runPassed(snapshot.result, { challenge, passScore: requirement?.passScore });
    logger.info('piano.exercise-complete', {
      id: subject?.id ?? null, purpose: challenge ? 'challenge' : 'practice', matcher: snapshot.matcher,
      status: snapshot.result.status,
      // Both are absent on a stalled attempt, which is finalized without a
      // verdict at all. `null` says "this run produced none" — a hardcoded
      // `false` would say "the engine judged it and said no".
      score: snapshot.result.score ?? null,
      // `verdict.passed` is the engine's record and stays in the evidence
      // untouched — but on a requirement carrying only a passScore it is always
      // true, so it would tell a false story on its own. `passed` is what the
      // child was shown.
      engine_verdict: snapshot.result.verdict?.passed ?? null,
      passed,
    });
    // A judged attempt that did not clear its bar. `onPassed` stays
    // automatic for every host;
    // a failure is reported straight to the host so
    // it can offer its own ways forward — and so a host counting failures
    // counts only attempts that actually happened.
    if (!passed) onFailed?.(snapshot.result);
  }, [challenge, logger, onFailed, persist, requirement, resultReady, snapshot, subject]);

  // Completion belongs to the host whenever it supplied a callback. Every
  // host advances automatically; this piano surface has no pointer controls.
  const passTakenRef = useRef(false);
  const judgedResult = resultReady && JUDGED_STATUSES.has(snapshot.result?.status) ? snapshot.result : null;
  const resultPassed = runPassed(judgedResult, { challenge, passScore: requirement?.passScore });
  const hostOwnsResult = resultPassed ? Boolean(onPassed) : Boolean(onFailed);
  const localRetry = Boolean(judgedResult && !hostOwnsResult);
  useEffect(() => {
    passTakenRef.current = false;
  }, [runtime]);
  useEffect(() => {
    if (!judgedResult || !resultPassed || !onPassed || passTakenRef.current) return;
    passTakenRef.current = true;
    logger.info('piano.exercise-pass-taken', { ...traceFieldsRef.current, via: 'automatic' });
    onPassed({ ...judgedResult, assessmentId: assessmentIdRef.current });
  }, [judgedResult, resultPassed, onPassed, logger]);
  const { exitHeld } = usePianoExitGesture({
    activeNotes, keyboard: keyboardConfig, onExit, enabled: Boolean(onExit) || localRetry,
    continueEnabled: localRetry, resetKey: runtime,
    onContinue: () => {
      logger.info('piano.exercise-retry', { ...traceFieldsRef.current, via: 'piano' });
      installRuntime();
    },
  });

  /**
   * The stall: a free challenge that was started, took real notes, and stopped.
   *
   * Every condition is load-bearing (see `FREE_STALL_MS`): `challenge` because
   * practice has no ladder and nothing to report a failure to; `free` because a
   * cued ask already fails on its own; `running` because a prepared attempt has
   * no input in it and a finished one has an answer already; and `musicalInput`
   * because an attempt a child never played is an abandonment, not a failure.
   *
   * `noteOnTick` is the reset — a new note restarts this effect, and with it
   * the timer. The runtime is re-read inside the callback rather than closed
   * over: twenty seconds is long enough for the attempt underneath to have
   * finished, been retried, or been replaced.
   */
  const stallable = challenge && snapshot.mode === 'free'
    && snapshot.status === 'running' && snapshot.musicalInput === true;
  const hintPolicy = askTuple?.hints ?? 'none';
  const hintable = stallable && hintPolicy === 'after-stall';
  useEffect(() => {
    setAfterStallHint(false);
  }, [hintPolicy, subject]);
  useEffect(() => {
    if (!hintable) return undefined;
    // A new note is fresh work on the ask. Hide a previously revealed answer
    // and begin its quiet interval again, matching the stall clock's reset.
    setAfterStallHint(false);
    const timer = globalThis.setTimeout(() => setAfterStallHint(true), HINT_REVEAL_MS);
    return () => globalThis.clearTimeout(timer);
  }, [hintable, noteOnTick]);
  useEffect(() => {
    if (!stallable) return undefined;
    const timer = globalThis.setTimeout(() => {
      const active = runtimeRef.current;
      const state = active?.getSnapshot();
      if (!state || state.status !== 'running' || !state.musicalInput) return;
      logger.info('piano.exercise-stalled', {
        id: subject?.id ?? null,
        matcher: state.matcher,
        stallMs: FREE_STALL_MS,
        matched_notes: Object.keys(state.hits).length,
      });
      // The runtime's own terminal path, taken as it stands: it finalizes with
      // `status: 'timeout'` and no verdict, which is what makes `runPassed`
      // answer false without this component asserting anything about it.
      active.timeout();
    }, FREE_STALL_MS);
    return () => globalThis.clearTimeout(timer);
  }, [logger, noteOnTick, stallable, subject]);

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
  // KNOWN GAP: a score reaches here with no `instance` and therefore no meter,
  // so a cued passage is always counted in over FOUR beats — a 3/4 passage gets
  // one beat too many. Only the count-in is affected: the tempo the attempt is
  // GRADED at comes from the score's own compiled tempo map (see `countIn`
  // below), so nothing is mis-judged. Closing it means the passage publishing
  // its meter alongside its expectation.
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

  const countInBeat = countingDown && countIn
    ? Math.min(countIn.clicks, Math.floor(((snapshot.leadInMs ?? 0) - timeline.countdownRemainingMs) / countIn.periodMs) + 1)
    : null;

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
    countdownHeldRef.current = new Set(activeNotesRef.current.keys());
    setClockNow(Date.now());
    traceEvent('piano.exercise-countdown-started', {
      ...timedRunPresentation(runtime.getSnapshot(), Date.now()),
      ignored: [...activeNotesRef.current.keys()], reason: 'arming-key',
    });
  }, [countIn, runtime, traceEvent]);

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

  /**
   * The pre-pulse, and its end. Metronome practice promises a pulse to settle
   * into, and the first note is what STARTS the run — so the grid has to be
   * audible before it, or the click only ever arrives after the moment it was
   * meant to guide. But a kiosk nobody armed is a room being clicked at, so the
   * pulse gets a budget: `PRE_PULSE_LIMIT_MS` and then silence.
   *
   * The timer only exists while the pre-pulse does, so arming (which makes
   * `prePulse` false) and unmounting both clear it through the same cleanup.
   */
  const prePulse = snapshot.status === 'prepared' && snapshot.mode === 'metronome';
  useEffect(() => {
    if (!prePulse || prePulseStopped) return undefined;
    const timer = globalThis.setTimeout(() => setPrePulseStopped(true), PRE_PULSE_LIMIT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [prePulse, prePulseStopped]);

  useMetronomeClick({
    enabled: ((snapshot.status === 'running' || awaitingTimeline) && ['metronome', 'cued'].includes(snapshot.mode))
      || (prePulse && !prePulseStopped),
    // The tempo the attempt is GRADED at, which is not always `clickBpm`: a
    // cued rung carries no `gates.pace`, so a tempo-less single-event instance
    // (graded at the engine's default) would leave this NaN — the hook then
    // creates no scheduler at all and the count-in counts in silence.
    bpm: timeline?.phase === 'running' ? timeline.bpm : countIn?.bpm ?? clickBpm,
  });
  const heldKey = held.join(',');
  useEffect(() => {
    if (!runtime) return;
    const previousHeld = previousNotesRef.current;
    const onsets = held.filter((midi) => !previousHeld.includes(midi));
    const releases = previousHeld.filter((midi) => !held.includes(midi));
    previousNotesRef.current = held;
    const time = Date.now();
    traceEvent('piano.exercise-midi-state', {
      heldBefore: previousHeld,
      heldAfter: held,
      onsets,
      releases,
      assessmentCursor: runtime.getSnapshot().cursor,
      status: runtime.getSnapshot().status,
      time,
    });
    for (const midi of releases) countdownHeldRef.current.delete(midi);
    if (exitHeld) return;
    const currentState = runtime.getSnapshot();
    const inputClock = currentState.matcher === 'timed' ? timedRunPresentation(currentState, time) : null;
    if (inputClock?.phase === 'countdown') {
      for (const midi of held) countdownHeldRef.current.add(midi);
      if (onsets.length) traceEvent('piano.exercise-input-ignored', {
        ...inputClock, displayedCursor: -1, ignored: onsets, reason: 'countdown', held,
      });
      return;
    }
    // Every note-on the run sees resets the stall clock — including the one
    // that arms it, which is the note the clock should be measured from.
    if (onsets.length) setNoteOnTick((tick) => tick + 1);
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
        // EVERY new onset in this commit, not only the one that armed.
        //
        // Two keys struck together arrive in a single MIDI commit, and
        // `previousNotesRef` above has already consumed both — so a companion
        // note dropped here is not observed now and can never become an onset
        // again while it is held. On two-hand material (Hanon: every event is a
        // left/right pair) that is a cursor that never leaves event zero, at a
        // run whose first ask the child played correctly.
        //
        // The arming note goes first, so the note that started the run is still
        // the run's first graded note — the same order guarantee as before.
        const ordered = [arming, ...onsets.filter((midi) => midi !== arming)];
        for (const midi of ordered) runtime.observe({ midi, time: armedAt, clock: 'date-now' });
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
  }, [activeNotes, armingPitches, exitHeld, held, heldKey, runtime, snapshot.cursor, snapshot.matcher, snapshot.mode, snapshot.status, startCountIn, traceEvent]);

  useEffect(() => () => {
    const active = runtimeRef.current?.getSnapshot();
    if (active?.result && !persistedRef.current) {
      // A completed assessment can be waiting for the musical timeline. Exit
      // preserves that evidence without treating exit as a passed game gate.
      persist(active.result, active.status, { keepalive: true });
    } else if (active?.status === 'running' && active.musicalInput && !persistedRef.current) {
      const interrupted = runtimeRef.current.abort();
      persist(interrupted.result, 'aborted', { keepalive: true });
    }
    traceEvent('piano.exercise-runtime-disposed', {
      cursor: active?.cursor ?? null,
      status: active?.status ?? null,
    });
    runtimeRef.current?.dispose();
  }, [persist]);

  // PianoEmpty's prop is `message` — `title`/`hint` are silently dropped, which
  // is why these states used to render a bare "Nothing here yet."
  if (!access.allowed) return <PianoEmpty message="Choose a player. Challenges need a saved piano profile so the result can be recorded." />;
  // Both degraded states must be checked BEFORE the skeleton. `runtime` stays
  // null whenever there is no attempt to build, so a `!runtime` test placed
  // first swallows them and spins on a skeleton forever.
  const progress = runtime ? assessmentProgress(snapshot) : { eventIndex: 0 };
  const askEvents = instance ? instance.events : (snapshot.expectation?.events ?? []);
  const eventIndex = Math.min(progress.eventIndex, askEvents.length);
  const visualCursor = timed
    ? { index: timeline.phase === 'countdown' || timeline.phase === 'prepared' ? -1 : timeline.expectedCursor, reason: 'clock' }
    : visualCursorFor(askEvents, eventIndex, activeNotes, snapshot.status);
  const visualCursorSignature = `${assessmentIdRef.current ?? 'none'}:${eventIndex}:${visualCursor.index}:${visualCursor.reason}:${heldKey}:${snapshot.status}:${timeline?.phase}:${timeline?.beat}:${countInBeat}`;
  useEffect(() => {
    if (lastVisualCursorRef.current === visualCursorSignature) return;
    lastVisualCursorRef.current = visualCursorSignature;
    traceEvent('piano.exercise-visual-cursor', {
      ...timeline,
      time: Date.now(),
      countInBeat,
      phase: timeline?.phase ?? snapshot.status,
      assessmentCursor: eventIndex,
      displayedCursor: visualCursor.index,
      reason: visualCursor.reason,
      held,
      status: snapshot.status,
    });
  }, [eventIndex, held, snapshot.status, traceEvent, visualCursor.index, visualCursor.reason, visualCursorSignature, countInBeat]);

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

  // A judged attempt is over and has something to say, whether it finished or
  // stalled. Leaving a stalled one out would leave the child on the running
  // status line — a run that has ended, still saying "follow the highlighted
  // notes" at a piano nothing is listening to.
  const result = resultReady && JUDGED_STATUSES.has(snapshot.result?.status) ? snapshot.result : null;
  const phase = snapshot.status === 'prepared' ? 'ready' : resultReady && JUDGED_STATUSES.has(snapshot.status) ? 'done' : countingDown ? 'countdown' : 'running';
  const expected = askEvents.flatMap((event) => event.notes.map((note) => note.midi));
  // Two consumers, two different things. ExerciseNotation's `wrong` prop is a
  // FLAG (it only ever colours the cursor note), so it gets a boolean — passing
  // the object would "work" by truthiness and rot the moment either side
  // changes. The keyboard footer wants the pitch itself.
  const isWrong = !countingDown && lastWrong !== null;
  const wrongNotes = countingDown || lastWrong === null ? null : new Set([lastWrong.midi]);
  const passed = runPassed(result, { challenge, passScore: requirement?.passScore });
  // A host handling failures owns the next screen. Suppress the local result
  // panel so it cannot flash a retry instruction before that transition.
  const hostOwnsFailure = Boolean(onFailed) && !passed;
  const currentEvent = askEvents[Math.min(visualCursor.index, askEvents.length - 1)] || askEvents[0];
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
  //
  // The stage is now read off the SCHEMA rather than off the tier number
  // directly (ask-platform SP1, task 5b): `runTier` becomes the tuple
  // `askTupleFor` would build for a level asserting that tier and no material
  // (`stageForTier`'s own routing never read `source`, so a spec-less tuple
  // answers identically), and `deriveStage` reads the tuple's `notationStyle`/
  // `prompt` plus `instance.ordering` exactly as `stageForTier` read `tier`/
  // `instance.ordering` — the 16-cell table in `askSchema.test.js` is the proof
  // the two agree on every cell. `runTier` itself is unmoved: it still exists
  // to fill `data-tier`/`is-tier-N` below, which `Exercises.scss` keys real
  // layout off, and to gate `askStaff` two lines down.
  const presentation = askTuple ?? askTupleFor({ tier: runTier }, null).tuple;
  const stage = score ? 'score' : deriveStage(presentation, instance);
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
  const keyboardFooter = ['sequence', 'notation', 'score'].includes(stage) && expected.length > 0;

  /**
   * The drill chrome, when this run is one set of a multi-set program.
   *
   * The re-read signal lives inside DrillProgress, keyed on `phase`: the
   * projection only moves when a rep banks, and this component cannot own that
   * effect because the code here sits below an early return — a hook added at
   * this point changes the hook COUNT between renders, which is what "rendered
   * fewer hooks than expected" means and how it took out 114 tests at once.
   * A redone rep drains its ring without help, since `noteProgress` returns to
   * zero with the cursor.
   */
  const noteProgress = askEvents.length
    ? Math.min(Math.max(eventIndex, 0), askEvents.length) / askEvents.length
    : 0;
  const drillProgress = programId && stepId ? (
    <DrillProgress
      programId={programId}
      stepId={stepId}
      userId={currentUser}
      phase={phase}
      noteProgress={noteProgress}
    />
  ) : null;
  const hintVisible = hintPolicy === 'always' || afterStallHint;
  /**
   * A percentage belongs to a STAGE, not to a tier.
   *
   * Lit keys are read by children who cannot read a percentage and would not be
   * helped by one if they could — and lit keys are what `ordering:'any'`
   * material gets at EVERY tier, including a tier 2 or 3 an authored level
   * named. Keying this off `runTier` put "83%" under a keyboard on a level
   * whose whole point is that there is nothing to read.
   *
   * A stalled attempt is finalized with no score and no criteria at all, so it
   * has no number to show either; it takes the words, which are the right ones
   * for it ("Some of the notes are still missing").
   */
  const scoreReadout = stage !== 'keys' && Number.isFinite(result?.score);

  return (
    <section className={`piano-exercise-run is-${intent} is-${phase} is-tier-${runTier}`} data-tier={runTier} data-stage={stage} data-phase={phase} data-expected-cursor={timeline?.expectedCursor ?? eventIndex} data-displayed-cursor={visualCursor.index}>
      <header className="piano-exercise-run__head">
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
            cursorIndex={visualCursor.index}
            activeNotes={feedbackNotes}
            wrongMidi={countingDown ? null : lastWrong?.midi ?? null}
            showStaff={askStaff}
            accidental={accidental}
            keyboard={keyboardConfig}
            // No `clef` prop: KeysAsk's own default IS `clefForAsk(events)` on
            // the same events, which is also what `staffFitsAsk` above asked.
            // Computing it a second time here would be a second place for the
            // clef the ask was JUDGED to fit on to drift from the one drawn.
          />
        )}
        {stage === 'recall' && (
          <div className="piano-exercise-run__recall" data-testid="piano-recall-stage">
            <span>From memory</span>
            {/* The ask, at the size of the task.
                A recall stage draws no notation on purpose — being told the
                NAME and finding the notes yourself is the whole exercise — but
                "nothing to read" had been built as "nothing to look at": the
                ask lived only in the header's 1.3rem breadcrumb, so the stage,
                the largest region on the screen, was blank. A child too young
                to read the sentence underneath it got an empty card and no way
                to know what was being asked. On a recall rung the name IS the
                flashcard, so it is drawn like one. */}
            <strong className="piano-exercise-run__recall-ask">{ask ?? subject.title}</strong>
            <p>Play it from memory.</p>
            {hintVisible && (
              <div className="piano-exercise-run__recall-hint" data-testid="piano-recall-hint">
                <KeysAsk events={instance.events} cursorIndex={visualCursor.index} activeNotes={feedbackNotes} wrongMidi={countingDown ? null : lastWrong?.midi ?? null} keyboard={keyboardConfig} />
              </div>
            )}
          </div>
        )}
        {(stage === 'sequence' || stage === 'single-note') && (
          /* The staff carries its own aspect ratio (it depends on how many
             notes the ask has), so the host's only job is to hand it a width
             that cannot make it taller than the row. `--staff-aspect` is that
             ratio; the sheet caps the width at `aspect × row height`, which is
             what keeps the stretched staff lines and the uniformly-scaled
             notation on top of each other. */
          <div
            className={`piano-exercise-run__sequence${stage === 'single-note' ? ' piano-exercise-run__single-note' : ''}`}
            style={{ '--staff-aspect': staffViewBox.width / staffViewBox.height }}
          >
            {/* No `wrongMidi`: the staff reads hit/miss/ghost straight off
                `activeNotes` in real time (SvgSequenceStaff's own contract),
                never off `lastWrong` — that flag can outlive the key that set
                it, and a ghost that outlives a key-up is exactly the bug the
                rule this component now follows exists to forbid. */}
            <SvgSequenceStaff
              notes={staffNotes}
              cursorIndex={visualCursor.index}
              activeNotes={feedbackNotes}
              clef={clefForInstance(instance)}
              accidental={accidental}
            />
          </div>
        )}
        {stage === 'notation' && (
          <ExerciseNotation activeNotes={feedbackNotes} instance={instance} eventIndex={visualCursor.index} wrong={isWrong} complete={phase === 'done' && passed} />
        )}
        {stage === 'score' && (
          /* The passage is BOTH the stage and the source of the ask: it engraves
             the document, then hands up the expectation the attempt above is
             built from. It is mounted before there is a runtime, deliberately —
             see the guard above. */
          <ScorePassage
            showCursor={timed}
            musicXml={score.musicXml}
            sourceId={score.id}
            measures={score.measures}
            onExpectation={takeScoreExpectation}
            onUnrunnable={handleScoreUnrunnable}
            cursorIndex={visualCursor.index}
            wrongMidi={countingDown ? null : lastWrong?.midi ?? null}
          />
        )}
        <CountInOverlay active={countingDown} beat={countInBeat} />
      </div>
      {/* No button: the piano starts the run. A cued ask arms on any key and
          counts a measure; every other ask arms on the note it is asking for. */}
      {/* A run with no attempt yet is a score still engraving. Saying "play the
          first note" there would be a lie a child would act on: nothing is
          listening, and a piano that ignores you is indistinguishable from a
          broken one. */}
      <div className="piano-exercise-run__rail">
      {/* A DRILL SAYS WHERE YOU ARE, NOT WHAT TO DO. Inside a multi-set program
          the pills carry the position and the placard carries the subject, and
          the standing instruction underneath them ("Play the first note to
          begin", "Follow the highlighted notes") was telling a child something
          the staff and the cursor already say — nine times over, once per rep.
          It is kept for a lone exercise, which has no pills to read instead. */}
      {drillProgress ?? (<>
        {phase === 'ready' && <div className="piano-exercise-run__ready"><p>{!runtime ? 'Getting the music ready…' : snapshot.mode === 'cued' ? `Press any key to start. You'll hear ${countIn?.clicks ?? beatsPerMeasure} clicks, then play at that speed.` : 'Play the first note to begin.'}</p>{!connected && <span>Waiting for the piano…</span>}</div>}
        {['countdown', 'running'].includes(phase) && <p className={`piano-exercise-run__status${isWrong ? ' is-wrong' : ''}`} role="status">{phase === 'countdown' ? 'Listen to the count-in.' : isWrong ? 'That note was not expected — keep going.' : stage === 'recall' ? 'Play the named music from memory.' : snapshot.matcher === 'held' ? 'Play the complete chord.' : 'Follow the highlighted notes.'}{onExit && ' Hold the lowest and highest keys for two seconds to leave.'}</p>}
      </>)}
      {/* The piano still starts the run; only the sentence about it is gone.
          A disconnected piano is the one thing the pills cannot say, so it
          keeps its own line whatever the surface. */}
      {drillProgress && !connected && <span className="piano-exercise-run__waiting">Waiting for the piano…</span>}
      {phase === 'done' && result && !hostOwnsFailure && <section className={`piano-exercise-run__result${passed ? ' is-passed' : ' is-developing'}`}>
        <div><span>{passed ? 'Passed' : challenge ? 'Keep working' : 'Practice complete'}</span>{scoreReadout && <strong>{Math.round(result.score * 100)}%</strong>}</div>
        {/* A percentage is a reading task of its own, and the tiers below 2 are
            for children who have not been given it yet. They are told the same
            thing in words: what happened, and what to do about it. */}
        {scoreReadout
          ? <dl><div><dt>All notes</dt><dd>{Math.round((result.criteria.completeness ?? 0) * 100)}%</dd></div><div><dt>Clean notes</dt><dd>{Math.round((result.criteria.cleanliness ?? 0) * 100)}%</dd></div>{Number.isFinite(result.criteria.placement) && <div><dt>On the beat</dt><dd>{Math.round(result.criteria.placement * 100)}%</dd></div>}</dl>
          : <p className="piano-exercise-run__result-copy">{passed ? 'You played every note that was asked for.' : 'Some of the notes are still missing. Have another go.'}</p>}
        {localRetry && <p className="piano-exercise-run__result-onward">Release the keys, then play any key to try again.{onExit && ' Hold the lowest and highest keys for two seconds to leave.'}</p>}
      </section>}
      </div>
      {keyboardFooter && (
        /* The whole board, for the same reason KeysAsk draws it: a strip
           cropped to the ask ± 5 semitones has no black-key groups and no ends,
           so it cannot be read as a keyboard and the highlighted key cannot be
           located on the instrument. `resolveBoardRange` is the one rule for
           what this board physically is. */
        <footer className="piano-exercise-run__keys">
          <PianoKeyboard
            activeNotes={feedbackNotes} targetNotes={targetNotes} wrongNotes={wrongNotes} dimTarget
            {...resolveBoardRange(keyboardConfig)}
          />
        </footer>
      )}
    </section>
  );
}
