/**
 * GameGate — gate 4 of the Games stack (D11): a short playing challenge that
 * stands at a match boundary, in place of the game rather than over it.
 *
 * It ties together the two halves built before it: `gameGateLadder` (what to
 * ask for, and how that eases after failures) and `gateMaterial` (which actual
 * exercise instance carries that ask today). `ExerciseRun` runs the attempt and
 * judges it; this component owns everything around it — where the rung is
 * remembered, what a failure offers, and when the ladder moves.
 *
 * Three things are easy to get wrong here and each one is load-bearing:
 *
 * 1. **`verdict.passed` is not the pass signal off the floor.** A non-floor
 *    requirement carries no rubric and no gates, so the engine's verdict is
 *    unconditionally true at any score. `ExerciseRun` judges those rungs on
 *    `result.score >= requirement.passScore` and only calls `onPassed` on a
 *    genuine pass — which is why `passScore` must always reach it as a finite
 *    number (see `resolveGateConfig`, and the guard in the resolve effect).
 *
 * 2. **Infrastructure fails OPEN — and only infrastructure.** A catalog 502
 *    during a backend restart, which this kiosk demonstrably hits, must start
 *    the match the child earned; those paths call `onPassed()` and log
 *    `gate.unavailable`. "Nobody has chosen a player" is NOT infrastructure: it
 *    is permanent, known, and fixed by one tap, so failing open on it would
 *    make the Guest profile a reliable one-tap bypass of the whole gate. That
 *    gets its own non-granting panel. Only the *verdict* can hold a child back,
 *    and at the ladder floor even that cannot (D9).
 *
 * 3. **None of the three failure buttons reaches a match** (D12). "Practice
 *    this" leaves for the ordinary `intent=practice` route, which is unmetered
 *    and ungated; it is a way out, not a way through.
 *
 * The gate itself is never metered (D13): it is what you pay with, not what you
 * pay for. Nothing here touches the budget meter.
 *
 * `enabled` is deliberately NOT consulted here. Whether a gate should stand at
 * this boundary is the mounting caller's decision; a component that silently
 * opened itself because a config key was absent would be a gate that quietly
 * stops existing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { SkeletonStage } from '../../Skeleton.jsx';
import { usePianoKioskConfigOptional } from '../../PianoConfig.jsx';
import { readKioskDeviceId } from '../../kioskDeviceIdentity.js';
import { clientStudyDate } from '../../clientStudyDate.js';
import ExerciseRun from '../Exercises/ExerciseRun.jsx';
import { climbRung, degradeRung, initialRung, isFloor } from './gameGateLadder.js';
import { pickGateMaterial } from './gateMaterial.js';
import './GameGate.scss';

/** The design's `gameGate` block. A household that sets none of it gets these. */
export const GATE_CONFIG_DEFAULTS = Object.freeze({
  enabled: false,
  every: 'match',
  passScore: 0.8,
  retriesBeforeDegrade: 3,
  metered: false,
  climbAfterCleanPasses: 3,
  material: Object.freeze([
    { kind: 'exercise', collections: ['scales', 'arpeggios', 'intervals', 'chords'] },
    { kind: 'score', source: 'current-study-piece', measures: 4 },
  ]),
});

/**
 * A count of attempts, so it must be whole. Floor FIRST, then check: validating
 * the raw value and flooring afterwards turns `retriesBeforeDegrade: 0.5` into
 * 0 — degrade on the very first failure — and `climbAfterCleanPasses: 0.5` into
 * a climb on every single pass. Both read as "the ladder is broken", and
 * neither is visible in a log.
 */
const positiveInt = (value, fallback) => {
  const whole = Math.floor(Number(value));
  return Number.isFinite(whole) && whole >= 1 ? whole : fallback;
};

/**
 * Merge a household's `gameGate` block over the defaults. `null` and `{}` are
 * ordinary inputs, not errors.
 *
 * `passScore` is RANGE-checked, not merely coerced: it is the only thing
 * standing between a non-floor rung and a gate that judges wrong, and it fails
 * silently in both directions.
 *  - `passScore: 80` — the percent-for-fraction mistake — is a perfectly finite
 *    number that reaches the run as `score >= 80`, which is never true. Every
 *    child fails every rung down to the floor, on every match, while the logs
 *    read as an unbroken run of ordinary `gate.failed`.
 *  - `""`, `false`, `[]` all coerce to 0, giving `score >= 0`: everyone passes
 *    every rung at any score, logged as healthy `gate.passed`.
 * A score is a fraction of 1, so anything outside `(0, 1]` is the default.
 */
export function resolveGateConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const passScore = Number(source.passScore);
  return {
    enabled: source.enabled === true,
    every: typeof source.every === 'string' ? source.every : GATE_CONFIG_DEFAULTS.every,
    passScore: Number.isFinite(passScore) && passScore > 0 && passScore <= 1
      ? passScore : GATE_CONFIG_DEFAULTS.passScore,
    retriesBeforeDegrade: positiveInt(source.retriesBeforeDegrade, GATE_CONFIG_DEFAULTS.retriesBeforeDegrade),
    metered: source.metered === true,
    climbAfterCleanPasses: positiveInt(source.climbAfterCleanPasses, GATE_CONFIG_DEFAULTS.climbAfterCleanPasses),
    // A malformed `material` (a string, a number) is passed through as-is:
    // `pickGateMaterial` declines it and the gate fails open, which is the
    // right answer for a config nobody can act on. Substituting the default
    // would hide the mistake behind material the household did not ask for.
    material: source.material ?? GATE_CONFIG_DEFAULTS.material,
  };
}

/** `piano.game-gate.rung.{learnerId}` — the ladder is per child, not per device. */
export const gateStateKey = (learnerId) => `piano.game-gate.rung.${learnerId ?? 'guest'}`;

const freshGateState = () => ({ rung: initialRung(), failuresAtRung: 0, cleanPasses: 0 });

/**
 * The set of legal values per axis, DERIVED by walking the ladder from the top
 * to the floor rather than restated here. A second hand-written copy of the
 * axis vocabulary would drift from `gameGateLadder`'s the first time an axis
 * changed, and a validator that drifts is worse than none: it would reject a
 * legitimate stored rung and silently send a struggling child back to the top.
 */
const RUNG_VALUES = (() => {
  let rung = initialRung();
  const values = Object.fromEntries(Object.entries(rung).map(([axis, value]) => [axis, new Set([value])]));
  for (let guard = 0; guard < 16 && !isFloor(rung); guard += 1) {
    rung = degradeRung(rung);
    for (const [axis, value] of Object.entries(rung)) values[axis]?.add(value);
  }
  return values;
})();

const AXES = Object.keys(RUNG_VALUES);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isValidRung = (rung) => Boolean(rung) && typeof rung === 'object' && !Array.isArray(rung)
  && Object.keys(rung).length === AXES.length
  && AXES.every((axis) => RUNG_VALUES[axis].has(rung[axis]));
const sameRung = (a, b) => AXES.every((axis) => a[axis] === b[axis]);

/**
 * Read the stored ladder position. `localStorage` is a corruptible input — a
 * half-written value, a hand edit, a value from an older shape — and every one
 * of those must land the child at the TOP of the ladder rather than on
 * `undefined` axes that degrade into nonsense. Structurally-wrong-but-parseable
 * is treated exactly like unparseable.
 */
export function readGateState(learnerId, store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    const parsed = JSON.parse(store?.getItem(gateStateKey(learnerId)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return freshGateState();
    if (!isValidRung(parsed.rung)) return freshGateState();
    if (!isCount(parsed.failuresAtRung) || !isCount(parsed.cleanPasses)) return freshGateState();
    return { rung: parsed.rung, failuresAtRung: parsed.failuresAtRung, cleanPasses: parsed.cleanPasses };
  } catch {
    return freshGateState();
  }
}

function writeGateState(learnerId, state, store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { store?.setItem(gateStateKey(learnerId), JSON.stringify(state)); } catch { /* private mode */ }
}

const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

/**
 * @param {object} props
 * @param {string|null} props.learnerId Roster slug — never the hydrated profile object.
 * @param {string} [props.deviceId] Which physical kiosk this is. Defaults to the
 *   captured self-identity (`readKioskDeviceId`), NOT to a literal: a shared
 *   constant cannot tell one tablet from another, and telling two kiosks apart
 *   is the whole reason the field is on every event. Unset stays `null` rather
 *   than becoming a guess.
 * @param {object|null} props.gateConfig The household's `gameGate` block.
 * @param {(result?:object)=>void} props.onPassed Open the match. Called with the
 *   run's result on a genuine pass, and with NO argument when the gate failed
 *   open — a caller that wants to mint earned minutes (D14) can tell them apart.
 * @param {()=>void} props.onLeave The child chose not to play.
 */
export default function GameGate({ learnerId = null, deviceId, gateConfig = null, onPassed, onLeave }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-game-gate' }), []);
  const sessionId = useMemo(() => makeId('gate'), []);
  const config = useMemo(() => resolveGateConfig(gateConfig), [gateConfig]);
  const navigate = useNavigate();
  const basePath = usePianoKioskConfigOptional()?.basePath ?? '/piano';
  const kioskDeviceId = useMemo(() => deviceId ?? readKioskDeviceId(), [deviceId]);

  const [state, setState] = useState(() => readGateState(learnerId));
  // `attempt` holds the resolved material/requirement in STATE, not in a memo
  // over render-scoped values: that is what makes both references stable across
  // a parent re-render. They land in ExerciseRun's load effect, and a fresh
  // object per render would refetch the instance and rebuild the attempt —
  // restarting the run under the child's hands.
  const [attempt, setAttempt] = useState(null);
  const [phase, setPhase] = useState('resolving'); // resolving | attempt | failed
  const [eased, setEased] = useState(false);
  const [lastScore, setLastScore] = useState(null);
  const [round, setRound] = useState(0);
  const openedRef = useRef(false);
  const presentedRef = useRef(false);

  const emit = useCallback((event, data = {}, level = 'info') => {
    logger[level](event, {
      learnerId, deviceId: kioskDeviceId, studyDate: clientStudyDate(), sessionId, ...data,
    });
  }, [kioskDeviceId, learnerId, logger, sessionId]);

  // Everything the resolve effect reads but must NOT re-run for, held in refs.
  // The effect's only trigger is `round` — the mount, Try again, and a learner
  // arriving late. That is by design, and both mistakes it prevents are silent:
  //  - a `state.rung` dependency would re-resolve the instant a failure eased
  //    the ladder, replacing the fail panel with a fresh attempt so the child
  //    never sees the three ways out, and the banner never appears;
  //  - an `onPassed`/`gateConfig`/`emit` dependency would re-resolve on any
  //    parent re-render that passes a fresh literal, handing ExerciseRun a NEW
  //    material object and restarting the run under the child's hands.
  const latest = useRef(null);
  latest.current = { config, rung: state.rung, onPassed, emit };

  // The roster slug arrives ASYNCHRONOUSLY: `PianoUserContext` starts at null
  // and hydrates. On a reload straight onto a games route the gate would
  // otherwise read the guest key, resume at the top of the ladder, and then
  // write that over a struggling child's hard-won position on the first
  // outcome. Re-read when the learner actually changes, and re-resolve if the
  // resumed rung is not the one already on screen — a child owed an eased rung
  // must not be judged against a harder one.
  const learnerRef = useRef(learnerId);
  useEffect(() => {
    if (learnerRef.current === learnerId) return;
    learnerRef.current = learnerId;
    const resumed = readGateState(learnerId);
    setState(resumed);
    if (!sameRung(resumed.rung, latest.current.rung)) setRound((value) => value + 1);
  }, [learnerId]);

  useEffect(() => {
    let alive = true;
    setPhase('resolving');
    // `config` and `rung` are read ONCE, deliberately: this resolution is for
    // the rung as it stood when it started. `emit` is NOT destructured — it is
    // called through the ref every time, because `learnerId` hydrates mid-flight
    // and a captured `emit` would send `gate.presented`/`gate.attempt` out
    // stamped with the null guest. That is the exact field the learner-change
    // fix below exists to get right, and it is invisible whenever the resumed
    // rung equals the on-screen one, which is the common case.
    const { config: current, rung } = latest.current;
    const emitNow = (...args) => latest.current.emit(...args);
    /**
     * The gate mounted. Emitted once per mount and BEFORE anything can decline,
     * so a fail-open run still anchors its own log query — those are precisely
     * the runs worth reconstructing, and a `gate.presented` that only fires on
     * the happy path leaves them with no beginning.
     */
    const presentOnce = (context) => {
      if (presentedRef.current) return;
      presentedRef.current = true;
      emitNow('gate.presented', context);
    };
    /** Fail open. Once — a second call would grant two matches for one gate. */
    const failOpen = (error, context) => {
      if (openedRef.current) return;
      openedRef.current = true;
      emitNow('gate.unavailable', { ...context, error }, 'warn');
      latest.current.onPassed?.();
    };
    pickGateMaterial(current.material, rung, { passScore: current.passScore })
      .then((picked) => {
        if (!alive) return;
        for (const skip of picked.skipped ?? []) {
          emitNow('gate.material-skipped', { kind: skip.kind, reason: skip.reason, rung });
        }
        const attemptId = makeId('gate-attempt');
        const { requirement } = picked;
        const context = {
          material: picked.material?.instanceId ?? null, rung, mode: requirement?.mode ?? null, attemptId,
        };
        presentOnce(context);
        if (!picked.ok) { failOpen(picked.error, context); return; }
        // Belt and braces over `resolveGateConfig`'s range check: a requirement
        // that reached the run without a usable passScore on a non-floor rung
        // would be judged on `verdict.passed`, which is always true there.
        const bar = Number(requirement?.passScore);
        if (!isFloor(rung) && !(Number.isFinite(bar) && bar > 0 && bar <= 1)) {
          failOpen('requirement-without-pass-score', context);
          return;
        }
        emitNow('gate.attempt', context);
        setAttempt({ ...picked, attemptId });
        setPhase('attempt');
      })
      .catch((error) => {
        // A rejected fetch, a bank payload nothing can read — same posture as a
        // 502: the child earned this game and cannot do anything about it.
        if (!alive) return;
        const context = { material: null, rung, mode: null, attemptId: null };
        presentOnce(context);
        failOpen(error?.message ?? String(error), context);
      });
    return () => { alive = false; };
  }, [round]);

  const context = attempt ? {
    material: attempt.material.instanceId,
    rung: state.rung,
    mode: attempt.requirement.mode,
    attemptId: attempt.attemptId,
  } : { rung: state.rung };

  const commit = (next) => { writeGateState(learnerId, next); setState(next); };

  const handlePassed = (result) => {
    const score = typeof result?.score === 'number' ? result.score : null;
    emit('gate.passed', { ...context, score });
    const cleanPasses = state.cleanPasses + 1;
    let next = { rung: state.rung, failuresAtRung: 0, cleanPasses };
    if (cleanPasses >= config.climbAfterCleanPasses) {
      const climbed = climbRung(state.rung);
      next = { rung: climbed, failuresAtRung: 0, cleanPasses: 0 };
      if (!sameRung(climbed, state.rung)) {
        emit('gate.rung-changed', { ...context, direction: 'climb', from: state.rung, rung: climbed });
      }
    }
    commit(next);
    onPassed?.(result);
  };

  /**
   * A COMPLETED attempt that did not clear its bar. Only this moves the ladder.
   *
   * The distinction from `handleAbandoned` below is the whole point: if walking
   * away counted as a failure, a child could press Exit `retriesBeforeDegrade`
   * times per match and arrive at the unfailable floor without ever touching a
   * key — the gate would become a formality that still logs like a gate.
   */
  const handleFailed = (result) => {
    const score = typeof result?.score === 'number' ? result.score : null;
    setLastScore(score);
    emit('gate.failed', { ...context, score });
    const failuresAtRung = state.failuresAtRung + 1;
    let next = { rung: state.rung, failuresAtRung, cleanPasses: 0 };
    let easedNow = false;
    if (failuresAtRung >= config.retriesBeforeDegrade) {
      const degraded = degradeRung(state.rung);
      next = { rung: degraded, failuresAtRung: 0, cleanPasses: 0 };
      if (!sameRung(degraded, state.rung)) {
        easedNow = true;
        emit('gate.rung-changed', { ...context, direction: 'degrade', from: state.rung, rung: degraded });
        // Once per ARRIVAL: a rung that was already the floor does not change,
        // so this cannot repeat while the child sits there.
        if (isFloor(degraded)) emit('gate.floor-reached', { ...context, rung: degraded });
      }
    }
    setEased(easedNow);
    commit(next);
    setPhase('failed');
  };

  const tryAgain = () => { setEased(false); setLastScore(null); setRound((value) => value + 1); };

  const practiceDetour = () => {
    // The ordinary practice route: unmetered, ungated, and NOT a way into the
    // match (D12). The gate is left behind entirely; the child comes back to
    // Games when they are ready.
    emit('gate.practice-detour', context);
    const target = `${basePath}/exercises/run/${encodeURIComponent(attempt.material.instanceId)}`;
    navigate(`${target}?intent=practice&mode=${encodeURIComponent(attempt.requirement.mode)}`);
  };

  /**
   * The player walked away rather than finishing — the run's header Exit. There
   * is nothing to judge, so the ladder does not move; the gate simply closes.
   */
  const handleAbandoned = () => { emit('gate.abandoned', context); onLeave?.(); };

  /**
   * The run settled into a state it cannot leave. TWO KINDS, and they resolve
   * differently — the distinction is the same one the design draws for the gate
   * as a whole (verdict versus infrastructure).
   *
   * `instance-not-found` / `unrunnable` are INFRASTRUCTURE: the instance 502'd
   * on the run's own fetch (the gate resolved through `instances(seedId)`, the
   * run re-resolves through `instance(instanceId)`, so a backend restart
   * between the two lands here), or the attempt could not be built. Nothing the
   * child can do, and they earned this game: fail open.
   *
   * `no-access` is NOT infrastructure. It is permanent, known, and entirely
   * within the household's control — nobody has chosen a player. Failing open
   * on it would make picking the Guest profile a deterministic one-tap bypass
   * of the whole gate, which any child who noticed would use every time. It
   * gets its own panel instead: say what to do, and offer the way out that now
   * exists. D12 holds — this does not reach a match.
   */
  const handleUnavailable = (reason) => {
    if (reason === 'no-access') {
      emit('gate.blocked', { ...context, reason }, 'warn');
      setPhase('no-access');
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    emit('gate.unavailable', { ...context, error: `run-${reason}` }, 'warn');
    onPassed?.();
  };

  if (phase === 'no-access') {
    return (
      <section className="piano-mode__placeholder piano-game-gate piano-game-gate--blocked" role="status">
        <h2>Choose a player first</h2>
        <p>A challenge is saved to whoever played it, so the piano needs to know who you are.</p>
        <div className="piano-game-gate__actions">
          <button type="button" onClick={handleAbandoned}>Leave</button>
        </div>
      </section>
    );
  }

  if (phase === 'failed') {
    const bar = Number(attempt?.requirement?.passScore);
    return (
      <section className="piano-mode__placeholder piano-game-gate piano-game-gate--failed" role="status">
        <h2>Not this time</h2>
        {/* Always rendered. A result can arrive without a usable score (an
            aborted attempt, a floor rung with no numeric bar), and gating the
            only words on the panel behind a number reduced it to a bare
            heading over three unexplained buttons. */}
        <p className="piano-game-gate__guidance">Play it once more, work on it first, or come back later.</p>
        {lastScore !== null && (
          <p className="piano-game-gate__score">
            <strong>{Math.round(lastScore * 100)}%</strong>
            {Number.isFinite(bar) && bar > 0 ? ` — you need ${Math.round(bar * 100)}%` : ''}
          </p>
        )}
        {eased && <p className="piano-game-gate__eased">We made it a little easier</p>}
        <div className="piano-game-gate__actions">
          <button type="button" onClick={tryAgain}>Try again</button>
          <button type="button" onClick={practiceDetour}>Practice this</button>
          <button type="button" onClick={handleAbandoned}>Leave</button>
        </div>
      </section>
    );
  }

  if (phase !== 'attempt' || !attempt) return <SkeletonStage />;

  return (
    <div className="piano-game-gate piano-game-gate--attempt">
      <ExerciseRun
        intent="challenge"
        material={attempt.material}
        requirementOverride={attempt.requirement}
        onPassed={handlePassed}
        onFailed={handleFailed}
        onExit={handleAbandoned}
        onUnavailable={handleUnavailable}
      />
      {/* Belt and braces over `onUnavailable`. The run owns the screen while it
          is up, and a state neither it nor this component anticipated would
          otherwise strand a child on a kiosk with no keyboard shortcut and no
          browser chrome. There is always a way out. */}
      <button type="button" className="piano-game-gate__leave" onClick={handleAbandoned}>
        Leave
      </button>
    </div>
  );
}
