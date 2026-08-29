/**
 * GameGate — gate 4 of the Games stack (D11): a short playing challenge that
 * stands at a match boundary, in place of the game rather than over it.
 *
 * It owns the LADDER and the STAKE, and nothing else. `gateRepertoire` says
 * which level the child is on and how that walks up and down; this component
 * decides which of that level's material to try today, in which order, and
 * what a failure costs. `AskSession` does the asking — it turns the chosen
 * spec into an instance, a requirement, a sentence and a screen — and reports
 * back what it settled on, or the exact reason it could not.
 *
 * The division is deliberate and it is the point of the seam: this component
 * never resolves anything. It hands over a LEVEL and a SPEC and receives an
 * answer. Everything below is policy applied to that answer, and policy is
 * exactly what a session must not hold — which material a child meets, whether
 * a decline is worth a free match, and where a failure leaves them, are all
 * questions about this household's game boundary and about nothing else.
 *
 * Three things are easy to get wrong here and each one is load-bearing:
 *
 * 1. **Every level is judged on the VERDICT, not on a score.** A repertoire
 *    level carries a rubric and `passScore: null` (`requirementForLevel`, which
 *    the session derives from the level this gate hands it), so the run reads
 *    `verdict.passed`. That is deliberate and it is the
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
 *    Nor is a level whose every material spec is mistyped: `isConfigOnlyDecline`
 *    tells that apart from a bank that could not be reached, and the answer is
 *    the same — substitute `FALLBACK_LEVEL`'s material and log
 *    `gate.material-config-invalid`, rather than grant. The reason it reads to
 *    tell them apart arrives on `AskSession`'s `onUnavailable`, second
 *    argument: the session names what happened, this component decides what
 *    that is worth.
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
import AskSession from '../../../ask/AskSession.jsx';
import {
  climbLevel, degradeLevel, FALLBACK_LEVEL, isFloorLevel, levelById, materialKey, resolveRepertoire,
  startLevelFor,
} from './gateRepertoire.js';
import { isConfigOnlyDecline, materialOrder } from './gateMaterial.js';
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
  // Optional household-controlled migration marker.  Changing it starts each
  // learner at their configured level once, instead of resuming a rung earned
  // against an older repertoire.
  stateVersion: null,
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
    stateVersion: typeof source.stateVersion === 'string' && source.stateVersion.trim()
      ? source.stateVersion.trim()
      : null,
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
    ...(config.stateVersion ? { stateVersion: config.stateVersion } : {}),
  });
  try {
    const parsed = JSON.parse(store?.getItem(gateStateKey(learnerId)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fresh();
    if (config.stateVersion && parsed.stateVersion !== config.stateVersion) return fresh();
    if (typeof parsed.levelId !== 'string' || !levelById(levels, parsed.levelId)) return fresh();
    if (!isCount(parsed.failuresAtLevel) || !isCount(parsed.cleanPasses)) return fresh();
    return {
      levelId: parsed.levelId,
      failuresAtLevel: parsed.failuresAtLevel,
      cleanPasses: parsed.cleanPasses,
      lastMaterialId: typeof parsed.lastMaterialId === 'string' ? parsed.lastMaterialId : null,
      pickIndex: isCount(parsed.pickIndex) ? parsed.pickIndex : 0,
      ...(config.stateVersion ? { stateVersion: config.stateVersion } : {}),
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
  // own intent label, which is true if less specific. The CONTEXT travels, not
  // the finished sentence: writing framing copy is the session's job, and this
  // component knowing the wording would be a second place it lives.
  const framing = useMemo(() => (gameLabel ? { kind: 'gate', gameLabel } : null), [gameLabel]);

  const [state, setState] = useState(() => readGateState(learnerId, levels, config));
  /**
   * The attempt this gate is currently making, in STATE rather than in a memo
   * over render-scoped values: that is what makes `level` and `spec` stable
   * across a parent re-render. Both land in `AskSession`'s resolution effect,
   * and a fresh object per render would refetch the instance and rebuild the
   * attempt — restarting the run under the child's hands.
   *
   *  - `level`/`attemptId` — what is being asked, and the id every event of
   *    this attempt carries.
   *  - `order`/`index`/`spec` — the level's material in the order it is tried,
   *    and where in that order we are. A spec that declines steps forward; only
   *    a level where NOTHING resolves is a decline of the whole attempt.
   *  - `pickIndex` — the rotation counter this attempt was served at, held here
   *    rather than read from `state` because the state's advances the moment
   *    the attempt is served and a retry must resolve to the same material.
   *  - `skipped`/`substituted` — what declined on the way here, and whether the
   *    one substitution this attempt gets has been spent.
   *  - `material`/`requirement` — the session's answer, once it has one. Null
   *    until then; nothing that reads them may assume otherwise.
   */
  const [attempt, setAttempt] = useState(null);
  const [phase, setPhase] = useState('resolving'); // resolving | attempt | failed | no-access | opened
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

  // Everything the serve effect reads but must NOT re-run for, held in refs;
  // the session's callbacks read through the same ref, so a report that lands
  // after `learnerId` hydrates is answered by the current gate, not a captured
  // one. The effect's only trigger is `round` — the mount, Try again, and a
  // learner arriving late. That is by design, and both mistakes it prevents
  // are silent:
  //  - a `state.levelId` dependency would re-serve the instant a failure
  //    eased the ladder, replacing the fail panel with a fresh attempt so the
  //    child never sees the ways out, and the banner never appears;
  //  - an `onPassed`/`gateConfig`/`emit` dependency would re-serve on any
  //    parent re-render that passes a fresh literal, handing the session a NEW
  //    spec object and restarting the run under the child's hands.
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

  /**
   * Serve one attempt — and this is now the whole of it: WHICH level, and
   * WHICH of that level's material specs to try first.
   *
   * Both answers are pure. `levelById`/`startLevelFor` read a list;
   * `materialOrder` rotates one. Nothing here touches the network, nothing can
   * fail, and the attempt is on screen in the same tick. The asking — turning
   * that spec into an instance, a requirement and a sentence — happens in the
   * session below, which reports back what it settled on.
   *
   * `config`, `levels` and the stored position are read ONCE, deliberately:
   * this attempt is for the level as it stood when it started. `emit` is never
   * captured — it is called through the ref every time, because `learnerId`
   * hydrates mid-flight and a captured `emit` would send
   * `gate.presented`/`gate.attempt` out stamped with the null guest. That is
   * invisible whenever the resumed level equals the on-screen one, which is
   * the common case.
   */
  useEffect(() => {
    setPhase('resolving');
    const { config: current, levels: repertoire, state: stored } = latest.current;
    const level = levelById(repertoire, stored.levelId) ?? startLevelFor(repertoire, current);
    /**
     * "Try again" is a SECOND GO AT THE SAME THING, and re-picking here would
     * quietly make it something else.
     *
     * The serve advances `pickIndex` (see `handleResolved` — a child who walks
     * away must not meet the same ask forever), so a retry that re-picked would
     * rotate: at a level naming `roots: ['G','D','F']` a child who missed G
     * major and pressed Try again would be handed D major, and would never get
     * the second attempt the button promises. At the floor the lit key would
     * move too. The held `pickIndex` is what prevents it: the session resolves
     * the same spec at the same rotation, and therefore the same material.
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
      setAttempt({ ...held, attemptId: makeId('gate-attempt'), skipped: [], retry: true });
      setPhase('attempt');
      return;
    }
    const pickIndex = Math.abs(Math.trunc(Number(stored.pickIndex)) || 0);
    const order = materialOrder(level, { lastMaterialId: stored.lastMaterialId, pickIndex });
    if (!order.length) {
      // `resolveRepertoire` refuses a level with no material, so nothing in a
      // resolved repertoire can land here. It is handled anyway rather than
      // left to render a skeleton forever: a gate with nothing to ask is an
      // outage from the child's side, and the child earned this game.
      const context = { material: null, rung: level.id, tier: level.tier, mode: null, attemptId: null };
      presentOnce(context);
      failOpen('no-material-in-level', context);
      return;
    }
    setAttempt({
      level,
      order,
      index: 0,
      spec: order[0],
      pickIndex,
      attemptId: makeId('gate-attempt'),
      skipped: [],
      substituted: false,
      material: null,
      requirement: null,
      retry: false,
    });
    setPhase('attempt');
  }, [round]);

  /**
   * The gate mounted. Emitted once per mount and BEFORE anything can decline,
   * so a fail-open run still anchors its own log query — those are precisely
   * the runs worth reconstructing, and a `gate.presented` that only fires on
   * the happy path leaves them with no beginning.
   */
  function presentOnce(context) {
    if (presentedRef.current) return;
    presentedRef.current = true;
    latest.current.emit('gate.presented', context);
  }

  /**
   * Fail open. Once — a second call would grant two matches for one gate. The
   * phase goes back to the skeleton on the way out: the match is opening, and
   * the last thing a child should read on the way into it is an error the
   * gate has already decided not to hold against them.
   */
  function failOpen(error, context) {
    if (openedRef.current) return;
    openedRef.current = true;
    latest.current.emit('gate.unavailable', { ...context, error }, 'warn');
    setPhase('opened');
    latest.current.onPassed?.();
  }

  /**
   * The session settled on something runnable. This is where an attempt
   * becomes real: it is the first moment the gate can NAME what a child was
   * asked to play, because the level wrote `{collection:'scales', roots:[…]}`
   * and only the resolution knows that today that is G major.
   */
  function handleResolved({ material, requirement }) {
    const held = latest.current.attempt;
    if (!held) return;
    const context = {
      material: materialName(material),
      rung: held.level.id,
      tier: held.level.tier,
      mode: requirement?.mode ?? null,
      attemptId: held.attemptId,
    };
    presentOnce(context);
    latest.current.emit('gate.attempt', context);
    setAttempt({ ...held, material, requirement });
    // A retry is the same serve continuing, not a new one: it must not spend
    // the rotation a second time, or two Try agains would skip a scale.
    if (held.retry) return;
    // Remember what was served, and advance the rotation, BEFORE the child
    // plays a note. Writing this only on an outcome would make "a different
    // scale next time" depend on finishing this one — the child who walks
    // away would meet the same ask forever.
    commitState({
      ...latest.current.state,
      lastMaterialId: materialKey(held.spec),
      pickIndex: latest.current.state.pickIndex + 1,
    });
  }

  /**
   * The session could not serve this spec, and said exactly why.
   *
   * Three answers, in order, and the order is the policy:
   *
   * 1. **Try the level's other material.** A level may name several specs; one
   *    that cannot be served costs this attempt nothing while another can be.
   *    Failing the whole gate over one bad entry would take a match away from a
   *    child for a config decision they cannot see.
   * 2. **Substitute, if nothing here could EVER have resolved.**
   *    `isConfigOnlyDecline` is what tells a mistyped level from a bank that
   *    could not be reached, and the answer to the first is `FALLBACK_LEVEL`'s
   *    material — C major, addressed by id, always resolvable. The LEVEL does
   *    not change: the rung, the tier and the requirement all stay the ones the
   *    child is standing on, because a config typo is not a reason to move a
   *    ladder. Once per attempt — if even the fallback declines, THAT is
   *    infrastructure and it falls through.
   * 3. **Fail open.** The child earned this game and can do nothing about a 502.
   */
  function declineMaterial({ kind = null, reason, mode = null }) {
    const held = latest.current.attempt;
    if (!held) return;
    latest.current.emit('gate.material-skipped', {
      kind, reason, rung: held.level.id, tier: held.level.tier,
    });
    const skipped = [...held.skipped, { kind, reason }];
    const next = held.index + 1;
    if (next < held.order.length) {
      setAttempt({ ...held, index: next, spec: held.order[next], skipped });
      return;
    }
    if (!held.substituted && isConfigOnlyDecline(skipped)) {
      latest.current.emit('gate.material-config-invalid', {
        rung: held.level.id, tier: held.level.tier, reasons: skipped.map((entry) => entry.reason),
      }, 'warn');
      setAttempt({
        ...held,
        order: [...FALLBACK_LEVEL.material],
        index: 0,
        spec: FALLBACK_LEVEL.material[0],
        skipped,
        substituted: true,
      });
      return;
    }
    /**
     * Nothing this level names can be served, and nothing may be claimed about
     * what was.
     *
     * `gate.presented` is announced HERE and not on the way in, because it
     * carries `material` and there is no honest value for that until something
     * has actually been served. Announcing on the first decline named the spec
     * that FAILED: a level whose first entry was a sourceless score logged
     * `material: null` on presented while G major went on the stand a moment
     * later — a line that is not merely uninformative but wrong. So the walk is
     * silent about presentation, `handleResolved` announces it with what the
     * child got, and this path announces it with `null`, which is the true
     * answer when the child got nothing.
     */
    const context = {
      material: null, rung: held.level.id, tier: held.level.tier, mode, attemptId: held.attemptId,
    };
    presentOnce(context);
    failOpen(reason, context);
  }

  // An attempt now exists from the moment it is SERVED, before the session has
  // resolved it, so both halves are read defensively: `material` falls back to
  // the spec (which names a score or an addressed instance even unresolved),
  // and `mode` is `null` rather than a guess until the requirement arrives.
  const context = attempt ? {
    material: materialName(attempt.material ?? attempt.spec),
    rung: attempt.level.id,
    tier: attempt.level.tier,
    mode: attempt.requirement?.mode ?? null,
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
   * A JUDGED attempt that did not clear its bar. Only this moves the ladder.
   *
   * Two shapes arrive. A COMPLETED attempt below its bar carries a score. A
   * STALLED one — a free ask the child started, played into, and then stopped
   * for twenty seconds — carries none: it is finalized with diagnostics only,
   * no score and no verdict. That second shape is why a free level can fail at
   * all; without it `verdict.passed` is true by construction the moment the
   * last note lands and false at no point before, so a stuck child would sit on
   * a running attempt with no fail panel, no ways forward, and no way down.
   * `score` is read defensively for exactly this reason, and the panel's words
   * never depended on a number.
   *
   * The distinction from `handleAbandoned` below is the whole point: if walking
   * away counted as a failure, a child could press Exit `retriesBeforeDegrade`
   * times per match and arrive at the unfailable floor without ever touching a
   * key — the gate would become a formality that still logs like a gate. The
   * run enforces that on its side too: an attempt with no musical input in it
   * never reaches `onFailed`, whether it stalls or is exited.
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
   * The session settled into a state it cannot leave. THREE KINDS, and they
   * resolve differently — the distinction is the same one the design draws for
   * the gate as a whole (verdict versus infrastructure versus config).
   *
   * **The discriminator is the SECOND ARGUMENT, never the word.** A `decline` is
   * present exactly when the SESSION is the one refusing — material that never
   * resolved, or an ask the schema will not accept — and it carries the reason
   * that tells a typo from an outage. Reading the word instead would get this
   * wrong in both directions: `instance-not-found` and `unrunnable` each occur
   * on both sides of the line. A schema refusal arrives as `unrunnable` and is a
   * config mistake; a score that fetched fine and then would not engrave arrives
   * as `unrunnable` too and is an outage.
   *
   * With no decline, a mounted run has dead-ended on material that DID resolve:
   * infrastructure by construction. Nothing the child can do, and they earned
   * this game: fail open.
   *
   * `no-access` is NOT infrastructure. It is permanent, known, and entirely
   * within the household's control — nobody has chosen a player. Failing open
   * on it would make picking the Guest profile a deterministic one-tap bypass
   * of the whole gate, which any child who noticed would use every time. It
   * gets its own panel instead: say what to do, and offer the way out that now
   * exists. D12 holds — this does not reach a match.
   */
  const handleUnavailable = (reason, decline) => {
    if (reason === 'no-access') {
      emit('gate.blocked', { ...context, reason }, 'warn');
      setPhase('no-access');
      return;
    }
    if (decline) {
      declineMaterial(decline);
      return;
    }
    failOpen(`run-${reason}`, context);
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
      <AskSession
        intent="challenge"
        // The LEVEL and the SPEC, and nothing derived from either. What that
        // level requires, what the spec resolves to, and the sentence a child
        // reads are all one thing — the ask — and one thing has one owner.
        ask={attempt.level}
        materialSpec={attempt.spec}
        // Which of the level's roots is served today. Held on the attempt, not
        // read from `state`: the state's counter advances the moment this is
        // served, and a retry must land on the same scale.
        pickIndex={attempt.pickIndex}
        framing={framing}
        onResolved={handleResolved}
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
