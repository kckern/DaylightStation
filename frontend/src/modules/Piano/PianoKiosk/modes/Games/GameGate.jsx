/**
 * GameGate — gate 4 of the Games stack (D11): a short playing challenge that
 * stands at a match boundary, in place of the game rather than over it.
 *
 * It ties together the three pure halves built before it: `gateRepertoire`
 * (which level the child is on, and how that walks up and down),
 * `gateAsk` (what that level requires and what it asks for, in one sentence a
 * child can read) and `gateMaterial` (which actual thing carries that ask
 * today). `ExerciseRun` runs the attempt and judges it; this component owns
 * everything around it — where the level is remembered, what a failure offers,
 * and when the ladder moves.
 *
 * Three things are easy to get wrong here and each one is load-bearing:
 *
 * 1. **Every level is judged on the VERDICT, not on a score.** A repertoire
 *    level carries a rubric and `passScore: null` (`requirementForLevel`), so
 *    `ExerciseRun` reads `verdict.passed`. That is deliberate and it is the
 *    whole of D9: below tier 3 the rubric is completeness-only, so a stray
 *    wrong key cannot fail a child, and no second `score >= passScore` gate
 *    lives alongside it to quietly reintroduce one.
 *
 * 2. **Infrastructure fails OPEN — and only infrastructure.** A bank 502
 *    during a backend restart, which this kiosk demonstrably hits, must start
 *    the match the child earned; those paths call `onPassed()` and log
 *    `gate.unavailable`. A malformed `repertoire` is NOT infrastructure: it is
 *    a config mistake that would hand out free matches for as long as the typo
 *    survived, so `resolveRepertoire` falls back to a playable level instead.
 *    Nor is "nobody has chosen a player": it is permanent, known, and fixed by
 *    one tap, so failing open on it would make the Guest profile a reliable
 *    one-tap bypass of the whole gate. That gets its own non-granting panel.
 *    Only the *verdict* can hold a child back, and at the floor even that
 *    cannot (D9).
 *
 * 3. **None of the failure buttons reaches a match** (D12). "Practice this"
 *    leaves for the ordinary `intent=practice` route, which is unmetered and
 *    ungated; it is a way out, not a way through. It is offered only when the
 *    material has a bank id to practise — a synthesized lit key has none.
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
import {
  climbLevel, degradeLevel, isFloorLevel, levelById, materialKey, resolveRepertoire, startLevelFor,
} from './gateRepertoire.js';
import { askForMaterial, framingFor, requirementForLevel } from './gateAsk.js';
import { pickGateMaterial } from './gateMaterial.js';
import './GameGate.scss';

/** The design's `gameGate` block. A household that sets none of it gets these. */
export const GATE_CONFIG_DEFAULTS = Object.freeze({
  enabled: false,
  every: 'match',
  retriesBeforeDegrade: 3,
  metered: false,
  climbAfterCleanPasses: 3,
  // No repertoire of its own: `resolveRepertoire(null)` is the single place
  // that decides what a household which configured nothing plays, and it
  // answers with the built-in floor plus the C-major fallback level. A second
  // default here would be a second answer to the same question.
  repertoire: null,
  startLevel: null,
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
 * `repertoire` is passed through UNVALIDATED on purpose: `resolveRepertoire`
 * owns the level schema, and a second validator here would drift from it the
 * first time that schema moved. A validator that drifts is worse than none —
 * it would reject a legitimate level list and silently drop a household onto
 * the fallback.
 */
export function resolveGateConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled === true,
    every: typeof source.every === 'string' ? source.every : GATE_CONFIG_DEFAULTS.every,
    retriesBeforeDegrade: positiveInt(source.retriesBeforeDegrade, GATE_CONFIG_DEFAULTS.retriesBeforeDegrade),
    metered: source.metered === true,
    climbAfterCleanPasses: positiveInt(source.climbAfterCleanPasses, GATE_CONFIG_DEFAULTS.climbAfterCleanPasses),
    repertoire: source.repertoire ?? null,
    // A non-string startLevel cannot name a level, and `startLevelFor` would
    // fall through to its own default anyway — normalize it here so a caller
    // reading the config sees the same answer the resolver will give.
    startLevel: typeof source.startLevel === 'string' ? source.startLevel : null,
  };
}

/** `piano.game-gate.rung.{learnerId}` — the ladder is per child, not per device. */
export const gateStateKey = (learnerId) => `piano.game-gate.rung.${learnerId ?? 'guest'}`;

const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * Read the stored ladder position (state v2).
 *
 * `localStorage` is a corruptible input — a half-written value, a hand edit, a
 * value from an older shape — and every one of those must land the child on the
 * configured start level rather than on a level id nothing can resolve.
 * Structurally-wrong-but-parseable is treated exactly like unparseable.
 *
 * The five-axis rung written by the previous ladder is exactly that case, and
 * it is not hypothetical: every kiosk that ran it has one on disk. It carries
 * no `levelId`, so it fails the first check and resets. No migration code is
 * needed and none should be written — a rung's five axes cannot be mapped onto
 * a household's own level list without inventing a correspondence that is not
 * there.
 *
 * `pickIndex` is the exception: it is a rotation hint, not a position, so a
 * missing or damaged one is coerced to 0 rather than throwing away a level the
 * child earned.
 */
export function readGateState(
  learnerId,
  levels,
  config,
  store = (typeof localStorage !== 'undefined' ? localStorage : null),
) {
  const fresh = () => ({
    levelId: startLevelFor(levels, config).id,
    failuresAtLevel: 0,
    cleanPasses: 0,
    lastMaterialId: null,
    pickIndex: 0,
  });
  try {
    const parsed = JSON.parse(store?.getItem(gateStateKey(learnerId)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fresh();
    if (typeof parsed.levelId !== 'string' || !levelById(levels, parsed.levelId)) return fresh();
    if (!isCount(parsed.failuresAtLevel) || !isCount(parsed.cleanPasses)) return fresh();
    return {
      levelId: parsed.levelId,
      failuresAtLevel: parsed.failuresAtLevel,
      cleanPasses: parsed.cleanPasses,
      lastMaterialId: typeof parsed.lastMaterialId === 'string' ? parsed.lastMaterialId : null,
      pickIndex: isCount(parsed.pickIndex) ? parsed.pickIndex : 0,
    };
  } catch {
    return fresh();
  }
}

function writeGateState(learnerId, state, store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { store?.setItem(gateStateKey(learnerId), JSON.stringify(state)); } catch { /* private mode */ }
}

const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

/**
 * What the log calls the thing a child was asked to play.
 *
 * An exercise names its bank instance and that is already the answer. A SCORE
 * names no instance at all — the ask is bars of a document — so reading
 * `instanceId` off it gives `null`, and a run of gates on the study piece would
 * be a run of indistinguishable lines with the one identifying field empty.
 * The document plus its bars is that identity: `fur-elise.musicxml#1-4`. A
 * passage with no readable range is the WHOLE score, which is what the run
 * plays, so it is named without a fragment rather than with an invented one.
 *
 * A synthesized lit key stays `null` deliberately: it exists nowhere but in the
 * gate's own `pickIndex`, and `rung`/`tier` already say everything about it that
 * a query can act on.
 */
export function materialName(material) {
  if (material?.instanceId) return material.instanceId;
  if (material?.kind === 'score' && material.source) {
    const bars = Array.isArray(material.measures) ? `#${material.measures.join('-')}` : '';
    return `${material.source}${bars}`;
  }
  return null;
}

/**
 * @param {object} props
 * @param {string|null} props.learnerId Roster slug — never the hydrated profile object.
 * @param {string} [props.deviceId] Which physical kiosk this is. Defaults to the
 *   captured self-identity (`readKioskDeviceId`), NOT to a literal: a shared
 *   constant cannot tell one tablet from another, and telling two kiosks apart
 *   is the whole reason the field is on every event. Unset stays `null` rather
 *   than becoming a guess.
 * @param {object|null} props.gateConfig The household's `gameGate` block.
 * @param {string} [props.gameLabel] What the child calls the game they are
 *   about to play — it becomes the run's framing ("Play this to start Chess").
 *   Absent, the run keeps its own intent label rather than naming `undefined`.
 * @param {(result?:object)=>void} props.onPassed Open the match. Called with the
 *   run's result on a genuine pass, and with NO argument when the gate failed
 *   open — a caller that wants to mint earned minutes (D14) can tell them apart.
 * @param {()=>void} props.onLeave The child chose not to play.
 */
export default function GameGate({
  learnerId = null, deviceId, gateConfig = null, gameLabel = null, onPassed, onLeave,
}) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-game-gate' }), []);
  const sessionId = useMemo(() => makeId('gate'), []);
  const config = useMemo(() => resolveGateConfig(gateConfig), [gateConfig]);
  const levels = useMemo(() => resolveRepertoire(config.repertoire), [config.repertoire]);
  const navigate = useNavigate();
  const basePath = usePianoKioskConfigOptional()?.basePath ?? '/piano';
  const kioskDeviceId = useMemo(() => deviceId ?? readKioskDeviceId(), [deviceId]);
  // A game nobody named cannot be named in a sentence. The run then wears its
  // own intent label, which is true if less specific.
  const framing = useMemo(() => (gameLabel ? framingFor({ kind: 'gate', gameLabel }) : null), [gameLabel]);

  const [state, setState] = useState(() => readGateState(learnerId, levels, config));
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
  // Why `round` last advanced. `tryAgain` sets it; the mount and a late-arriving
  // learner do not, and both of those must re-pick.
  const retryRef = useRef(false);

  const emit = useCallback((event, data = {}, level = 'info') => {
    logger[level](event, {
      learnerId, deviceId: kioskDeviceId, studyDate: clientStudyDate(), sessionId, ...data,
    });
  }, [kioskDeviceId, learnerId, logger, sessionId]);

  // Everything the resolve effect reads but must NOT re-run for, held in refs.
  // The effect's only trigger is `round` — the mount, Try again, and a learner
  // arriving late. That is by design, and both mistakes it prevents are silent:
  //  - a `state.levelId` dependency would re-resolve the instant a failure
  //    eased the ladder, replacing the fail panel with a fresh attempt so the
  //    child never sees the ways out, and the banner never appears;
  //  - an `onPassed`/`gateConfig`/`emit` dependency would re-resolve on any
  //    parent re-render that passes a fresh literal, handing ExerciseRun a NEW
  //    material object and restarting the run under the child's hands.
  const latest = useRef(null);
  latest.current = { config, levels, state, attempt, learnerId, onPassed, emit };

  // The roster slug arrives ASYNCHRONOUSLY: `PianoUserContext` starts at null
  // and hydrates. On a reload straight onto a games route the gate would
  // otherwise read the guest key, resume at the start level, and then write
  // that over a struggling child's hard-won position on the first outcome.
  // Re-read when the learner actually changes, and re-resolve if the resumed
  // level is not the one already on screen — a child owed an eased level must
  // not be judged against a harder one.
  const learnerRef = useRef(learnerId);
  useEffect(() => {
    if (learnerRef.current === learnerId) return;
    learnerRef.current = learnerId;
    const resumed = readGateState(learnerId, levels, config);
    setState(resumed);
    if (resumed.levelId !== latest.current.state.levelId) setRound((value) => value + 1);
  }, [config, learnerId, levels]);

  useEffect(() => {
    let alive = true;
    setPhase('resolving');
    // `config`, `levels` and the stored position are read ONCE, deliberately:
    // this resolution is for the level as it stood when it started. `emit` is
    // NOT destructured — it is called through the ref every time, because
    // `learnerId` hydrates mid-flight and a captured `emit` would send
    // `gate.presented`/`gate.attempt` out stamped with the null guest. That is
    // invisible whenever the resumed level equals the on-screen one, which is
    // the common case.
    const { config: current, levels: repertoire, state: stored } = latest.current;
    const level = levelById(repertoire, stored.levelId) ?? startLevelFor(repertoire, current);
    const requirement = requirementForLevel(level);
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
    /**
     * "Try again" is a SECOND GO AT THE SAME THING, and re-picking here would
     * quietly make it something else.
     *
     * The serve advances `pickIndex` (see below — a child who walks away must
     * not meet the same ask forever), so a retry that re-picked would rotate:
     * at a level naming `roots: ['G','D','F']` a child who missed G major and
     * pressed Try again would be handed D major, and would never get the second
     * attempt the button promises. At the floor the lit key would move too.
     *
     * The one case where the material MUST change is the one where the ladder
     * moved: an eased level is a different ask by definition. So the held
     * attempt is reused only while the level is the same one it was served for,
     * which is exactly the "same thing again" case. The attemptId is fresh —
     * this is a new attempt at old material, and the log has to say so.
     */
    const retrying = retryRef.current;
    retryRef.current = false;
    const held = latest.current.attempt;
    if (retrying && held && held.level.id === level.id) {
      const attemptId = makeId('gate-attempt');
      const context = {
        material: materialName(held.material),
        rung: level.id,
        tier: level.tier,
        mode: held.requirement.mode,
        attemptId,
      };
      presentOnce(context);
      emitNow('gate.attempt', context);
      setAttempt({ ...held, attemptId });
      setPhase('attempt');
      return () => { alive = false; };
    }
    pickGateMaterial(level, {
      lastMaterialId: stored.lastMaterialId, pickIndex: stored.pickIndex, mode: requirement.mode,
    })
      .then((picked) => {
        if (!alive) return;
        for (const skip of picked.skipped ?? []) {
          emitNow('gate.material-skipped', {
            kind: skip.kind, reason: skip.reason, rung: level.id, tier: level.tier,
          });
        }
        const attemptId = makeId('gate-attempt');
        const context = {
          material: materialName(picked.material),
          rung: level.id,
          tier: level.tier,
          mode: requirement.mode,
          attemptId,
        };
        presentOnce(context);
        if (!picked.ok) { failOpen(picked.error, context); return; }
        emitNow('gate.attempt', context);
        setAttempt({
          material: picked.material,
          requirement,
          level,
          ask: askForMaterial(picked.spec, picked.instance),
          attemptId,
        });
        setPhase('attempt');
        // Remember what was served, and advance the rotation, BEFORE the child
        // plays a note. Writing this only on an outcome would make "a different
        // scale next time" depend on finishing this one — the child who walks
        // away would meet the same ask forever.
        commitState({
          ...latest.current.state,
          lastMaterialId: materialKey(picked.spec),
          pickIndex: latest.current.state.pickIndex + 1,
        });
      })
      .catch((error) => {
        // A rejected fetch, a bank payload nothing can read — same posture as a
        // 502: the child earned this game and cannot do anything about it.
        if (!alive) return;
        const context = {
          material: null, rung: level.id, tier: level.tier, mode: requirement.mode, attemptId: null,
        };
        presentOnce(context);
        failOpen(error?.message ?? String(error), context);
      });
    return () => { alive = false; };
  }, [round]);

  const context = attempt ? {
    material: materialName(attempt.material),
    rung: attempt.level.id,
    tier: attempt.level.tier,
    mode: attempt.requirement.mode,
    attemptId: attempt.attemptId,
  } : { rung: state.levelId, tier: levelById(levels, state.levelId)?.tier ?? null };

  /** Write and remember in one step, through the ref so the effect can use it too. */
  function commitState(next) {
    writeGateState(latest.current.learnerId, next);
    latest.current.state = next;
    setState(next);
  }

  const handlePassed = (result) => {
    const score = typeof result?.score === 'number' ? result.score : null;
    emit('gate.passed', { ...context, score });
    const cleanPasses = state.cleanPasses + 1;
    let next = { ...state, failuresAtLevel: 0, cleanPasses };
    if (cleanPasses >= config.climbAfterCleanPasses) {
      const climbed = climbLevel(levels, state.levelId);
      next = { ...state, levelId: climbed.id, failuresAtLevel: 0, cleanPasses: 0 };
      if (climbed.id !== state.levelId) {
        emit('gate.rung-changed', {
          ...context, direction: 'climb', from: state.levelId, to: climbed.id,
        });
      }
    }
    commitState(next);
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
    emit('gate.failed', { ...context, score });
    const failuresAtLevel = state.failuresAtLevel + 1;
    let next = { ...state, failuresAtLevel, cleanPasses: 0 };
    let easedNow = false;
    if (failuresAtLevel >= config.retriesBeforeDegrade) {
      const degraded = degradeLevel(levels, state.levelId);
      next = { ...state, levelId: degraded.id, failuresAtLevel: 0, cleanPasses: 0 };
      if (degraded.id !== state.levelId) {
        easedNow = true;
        emit('gate.rung-changed', {
          ...context, direction: 'degrade', from: state.levelId, to: degraded.id,
        });
        // Once per ARRIVAL: a level that was already the floor does not change,
        // so this cannot repeat while the child sits there.
        if (isFloorLevel(levels, degraded.id)) {
          emit('gate.floor-reached', { ...context, rung: degraded.id, tier: degraded.tier });
        }
      }
    }
    setEased(easedNow);
    commitState(next);
    setPhase('failed');
  };

  const tryAgain = () => {
    retryRef.current = true;
    setEased(false);
    setRound((value) => value + 1);
  };

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
   * `instance-not-found` / `unrunnable` are INFRASTRUCTURE: the material could
   * not be read, or the attempt could not be built from it. Nothing the child
   * can do, and they earned this game: fail open.
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
    // A synthesized lit key has no id in the exercise bank, so there is nothing
    // for the practice route to address. Offering the button anyway would send
    // a child to `/exercises/run/undefined` — a dead end dressed as a way out.
    const canPractise = Boolean(attempt?.material?.instanceId);
    return (
      <section className="piano-mode__placeholder piano-game-gate piano-game-gate--failed" role="status">
        <h2>Not this time</h2>
        {/* Always rendered. A result can arrive without a usable score (an
            aborted attempt, and every level below tier 3, which has no numeric
            bar at all), and gating the only words on the panel behind a number
            reduced it to a bare heading over unexplained buttons. */}
        <p className="piano-game-gate__guidance">Play it once more, work on it first, or come back later.</p>
        {/* NO PERCENTAGE, and no seam for one. `requirementForLevel` writes
            `passScore: null` for every level a repertoire can express, so a
            numeric-bar branch here could never render — and a percentage with
            no bar beside it invites comparison to a target that does not exist.
            The score still reaches the log, where an adult tuning the ladder
            reads it; what a failing child gets is words. */}
        {eased && <p className="piano-game-gate__eased">We made it a little easier</p>}
        <div className="piano-game-gate__actions">
          <button type="button" onClick={tryAgain}>Try again</button>
          {canPractise && <button type="button" onClick={practiceDetour}>Practice this</button>}
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
        framing={framing}
        ask={attempt.ask}
        // A NUMBER, straight off the level. `ExerciseRun` warns and derives its
        // own band for anything else, and a YAML tier that arrived as a string
        // would take that path in silence.
        tier={attempt.level.tier}
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
