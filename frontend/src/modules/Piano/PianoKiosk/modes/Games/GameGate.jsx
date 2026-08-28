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
 * 2. **Infrastructure fails OPEN.** A catalog 502 during a backend restart —
 *    which this kiosk demonstrably hits — must start the match the child
 *    earned, not block it. Every unresolvable path calls `onPassed()` and logs
 *    `gate.unavailable`. Only the *verdict* can hold a child back, and at the
 *    ladder floor even that cannot (D9).
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
import ExerciseRun from '../Exercises/ExerciseRun.jsx';
import { climbRung, degradeRung, initialRung, isFloor } from './gameGateLadder.js';
import { pickGateMaterial } from './gateMaterial.js';

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

const positiveInt = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0
  ? Math.floor(Number(value)) : fallback);

/**
 * Merge a household's `gameGate` block over the defaults. `null` and `{}` are
 * ordinary inputs, not errors.
 *
 * `passScore` is coerced to a finite number here rather than trusted: it is the
 * only thing standing between a non-floor rung and a gate that passes everyone
 * (see the header note). A hand-authored `passScore: "80%"` must degrade to the
 * default, not travel down into the run as a string.
 */
export function resolveGateConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled === true,
    every: typeof source.every === 'string' ? source.every : GATE_CONFIG_DEFAULTS.every,
    passScore: Number.isFinite(Number(source.passScore)) && source.passScore !== null
      ? Number(source.passScore) : GATE_CONFIG_DEFAULTS.passScore,
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

/**
 * The household study day, client-side: the agenda's day begins at 4am, so a
 * 1am gate belongs to the evening that is still going on. Matches the backend's
 * `studyDate(instant, tz, 4)` boundary without importing a server module.
 */
export function clientStudyDate(now = new Date()) {
  const shifted = new Date(now.getTime() - 4 * 3_600_000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

/**
 * @param {object} props
 * @param {string|null} props.learnerId Roster slug — never the hydrated profile object.
 * @param {string} [props.deviceId] Which kiosk this is, for the log query.
 * @param {object|null} props.gateConfig The household's `gameGate` block.
 * @param {(result?:object)=>void} props.onPassed Open the match. Called with the
 *   run's result on a genuine pass, and with NO argument when the gate failed
 *   open — a caller that wants to mint earned minutes (D14) can tell them apart.
 * @param {()=>void} props.onLeave The child chose not to play.
 */
export default function GameGate({ learnerId = null, deviceId = 'piano-kiosk', gateConfig = null, onPassed, onLeave }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-game-gate' }), []);
  const sessionId = useMemo(() => makeId('gate'), []);
  const config = useMemo(() => resolveGateConfig(gateConfig), [gateConfig]);
  const navigate = useNavigate();
  const basePath = usePianoKioskConfigOptional()?.basePath ?? '/piano';

  const [state, setState] = useState(() => readGateState(learnerId));
  // `attempt` holds the resolved material/requirement in STATE, not in a memo
  // over render-scoped values: that is what makes both references stable across
  // a parent re-render. They land in ExerciseRun's load effect, and a fresh
  // object per render would refetch the instance and rebuild the attempt —
  // restarting the run under the child's hands.
  const [attempt, setAttempt] = useState(null);
  const [phase, setPhase] = useState('resolving'); // resolving | attempt | failed
  const [eased, setEased] = useState(false);
  const [round, setRound] = useState(0);
  const openedRef = useRef(false);
  const presentedRef = useRef(false);

  const emit = useCallback((event, data = {}, level = 'info') => {
    logger[level](event, {
      learnerId, deviceId, studyDate: clientStudyDate(), sessionId, ...data,
    });
  }, [deviceId, learnerId, logger, sessionId]);

  // Everything the resolve effect reads but must NOT re-run for, held in refs.
  // The effect's only triggers are the mount and Try again (`round`) — by
  // design, and both mistakes it prevents are silent:
  //  - a `state.rung` dependency would re-resolve the instant a failure eased
  //    the ladder, replacing the fail panel with a fresh attempt so the child
  //    never sees the three ways out, and the banner never appears;
  //  - an `onPassed`/`gateConfig` dependency would re-resolve on any parent
  //    re-render that passes a fresh literal, handing ExerciseRun a NEW
  //    material object and restarting the run under the child's hands.
  const latest = useRef(null);
  latest.current = { config, rung: state.rung, onPassed };

  useEffect(() => {
    let alive = true;
    setPhase('resolving');
    const { config: current, rung } = latest.current;
    /** Fail open. Once — a second call would grant two matches for one gate. */
    const failOpen = (error, extra = {}) => {
      if (openedRef.current) return;
      openedRef.current = true;
      emit('gate.unavailable', { error, ...extra }, 'warn');
      latest.current.onPassed?.();
    };
    pickGateMaterial(current.material, rung, { passScore: current.passScore })
      .then((picked) => {
        if (!alive) return;
        for (const skip of picked.skipped ?? []) {
          emit('gate.material-skipped', { kind: skip.kind, reason: skip.reason, rung });
        }
        if (!picked.ok) { failOpen(picked.error, { rung }); return; }
        const { requirement } = picked;
        // Belt and braces over `resolveGateConfig`'s coercion: a requirement
        // that reached the run without a finite passScore on a non-floor rung
        // would be judged on `verdict.passed`, which is always true there.
        if (!isFloor(rung) && !Number.isFinite(Number(requirement?.passScore))) {
          failOpen('requirement-without-pass-score', { rung });
          return;
        }
        const attemptId = makeId('gate-attempt');
        const context = {
          material: picked.material.instanceId, rung, mode: requirement.mode, attemptId,
        };
        if (!presentedRef.current) { presentedRef.current = true; emit('gate.presented', context); }
        emit('gate.attempt', context);
        setAttempt({ ...picked, attemptId });
        setPhase('attempt');
      })
      .catch((error) => {
        // A rejected fetch, a bank payload nothing can read — same posture as a
        // 502: the child earned this game and cannot do anything about it.
        if (alive) failOpen(error?.message ?? String(error), { rung });
      });
    return () => { alive = false; };
  }, [emit, round]);

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
   * The run has handed control back without a pass. `ExerciseRun` calls
   * `onExit` both for its own "Practice first" button and for the header Exit,
   * and it has no separate failure callback — so a walked-away attempt and a
   * played-and-missed one arrive here identically. Both are correct to treat as
   * "did not pass": neither may reach the match, and both should eventually
   * ease the rung rather than leave a child stuck. The score is not available
   * on this path, so `gate.failed` carries `score: null` rather than a guess.
   */
  const handleFailed = () => {
    emit('gate.failed', { ...context, score: null });
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

  const tryAgain = () => { setEased(false); setRound((value) => value + 1); };

  const practiceDetour = () => {
    // The ordinary practice route: unmetered, ungated, and NOT a way into the
    // match (D12). The gate is left behind entirely; the child comes back to
    // Games when they are ready.
    emit('gate.practice-detour', context);
    const target = `${basePath}/exercises/run/${encodeURIComponent(attempt.material.instanceId)}`;
    navigate(`${target}?intent=practice&mode=${encodeURIComponent(attempt.requirement.mode)}`);
  };

  const leave = () => { emit('gate.abandoned', context); onLeave?.(); };

  if (phase === 'failed') {
    return (
      <section className="piano-mode__placeholder piano-game-gate piano-game-gate--failed" role="status">
        <h2>Not this time</h2>
        <p>Play it once more, work on it first, or come back later.</p>
        {eased && <p className="piano-game-gate__eased">We made it a little easier</p>}
        <div className="piano-game-gate__actions">
          <button type="button" onClick={tryAgain}>Try again</button>
          <button type="button" onClick={practiceDetour}>Practice this</button>
          <button type="button" onClick={leave}>Leave</button>
        </div>
      </section>
    );
  }

  if (phase !== 'attempt' || !attempt) return <SkeletonStage />;

  return (
    <div className="piano-game-gate">
      <ExerciseRun
        intent="challenge"
        material={attempt.material}
        requirementOverride={attempt.requirement}
        onPassed={handlePassed}
        onExit={handleFailed}
      />
    </div>
  );
}
