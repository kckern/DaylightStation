import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { PoseProvider } from '../../context/PoseContext.jsx';
import { useIdentity } from '../../identity/useIdentity.js';
import useFitnessModule from '../../player/useFitnessModule.js';
import UnlockPrompt from '../../player/overlays/UnlockPrompt.jsx';
import { useGamepadKeys } from '../../lib/useGamepadKeys.js';
import { createSkylineAudio } from '../../lib/skylineGlider/skylineAudio.js';
import { driftAim, manualAim } from '../../lib/skylineInvaders/aimAssist.js';
import { createGameState, stepFrame } from '../../lib/skylineInvaders/engine.js';
import { GESTURE_INFO, isGesture } from '../../lib/skylineInvaders/gestures.js';
import { EMPTY_EFFECTS, INVADERS_LOG_NAMES, buildInvadersEffectTable, invadersSoundUrls } from '../../lib/skylineInvaders/invadersEffects.js';
import { validateLevel } from '../../lib/skylineInvaders/levels.js';
import { listInvadersMats, selectInvadersMat } from '../../lib/skylineInvaders/matSelection.js';
import { listInvadersPeople } from '../../lib/skylineInvaders/people.js';
import { buildSkylineInvadersRun } from '../../lib/skylineInvaders/runResult.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import useSkylineAccess from '../SkylineGlider/useSkylineAccess.js';
import { CountdownOverlay, MomentBanner } from '../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
import { announceGameAchievement, createEffectDispatcher, createFrameDriver } from '../../../../../../__capabilities/gaming/browser/platform/realtime/index.js';
import { projectRunRole } from '../../../../../../__capabilities/gaming/portable/realtime/index.mjs';
import InvadersActions from './InvadersActions.jsx';
import InvadersControls from './InvadersControls.jsx';
import InvadersHud from './InvadersHud.jsx';
import InvadersLobby, { resolveLevelId } from './InvadersLobby.jsx';
import InvadersPoseBridge from './InvadersPoseBridge.jsx';
import InvadersResult from './InvadersResult.jsx';
import InvadersScene from './InvadersScene.jsx';
import useInvadersAim from './useInvadersAim.js';
import useInvadersBoost from './useInvadersBoost.js';
import useInvadersFire from './useInvadersFire.js';
import useMenuInput from './useMenuInput.js';
import './SkylineInvaders.scss';

// The Skyline Invaders shell: loads the levels, runs the lobby and the controls
// intro, drives the engine from a frame loop, and saves the round.
//
// Phases: loading -> lobby <-> controls -> countdown -> playing <-> paused
// -> result (-> lobby or another countdown); `error` from loading. Every
// phase has a way out of the game (`onClose`, from FitnessModuleContainer).
//
// What a frame reads (aim, cadence, queued presses) comes from refs and
// hooks that never re-render the game: the pose runs at its own rate, as low
// as 13 a second, and the round must play the same whatever that rate is.

const API = '/api/v1/fitness/skyline-invaders';
const MODULE_ID = 'skyline_invaders';
const CAPABILITY_ID = 'fitness.skyline-invaders';
const ROLE_MAP = Object.freeze({ loading: 'ready', lobby: 'ready', controls: 'ready', error: 'ready' });
const ROUND_PHASES = Object.freeze(['countdown', 'playing', 'paused']);
const COUNTDOWN_FROM = 3;
const HEALTH_EVERY_MS = 20_000;   // the log ingest allows three of one event a minute
const STICK_DEAD_ZONE = 0.2;
const REWARD_COLOR = '#7bd88f';
const POSE_CONFIG = Object.freeze({
  temporalSmoothing: false, maxPoses: 1, modelType: INVADERS_TUNABLES.poseModelType,
  ...(INVADERS_TUNABLES.poseBackend ? { backend: INVADERS_TUNABLES.poseBackend } : {}),
});
const PAUSE_REASONS = Object.freeze({
  player: 'Take a breath. The clock is stopped.',
  lifecycle: 'The workout is paused. The clock is stopped.',
  hidden: 'The screen was away. The clock is stopped.',
});

const mediaUrl = (path) => DaylightMediaPath(`/media/${path}`);
// The shell may use real randomness; the engine may not. The seed is saved
// with the round's logs so a round can be replayed.
const newSeed = () => {
  try { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Math.floor(Math.random() * 2 ** 32); }
};
const newRunId = () => globalThis.crypto?.randomUUID?.() || `invaders-${Date.now()}-${newSeed()}`;
// keepalive: a save started as the game is closed still reaches the server.
const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
const EMPTY_PRESSES = Object.freeze({ steps: Object.freeze([]), stomps: Object.freeze([]) });

// Stick first, then the D-pad, then held arrow keys: -1 (left) .. 1 (right).
function readAimAxis(held) {
  let pads = [];
  try { pads = Array.from(navigator.getGamepads?.() || []); } catch { pads = []; }
  for (const pad of pads) {
    if (!pad) continue;
    const stick = pad.axes?.[0] ?? 0;
    if (Math.abs(stick) > STICK_DEAD_ZONE) return Math.max(-1, Math.min(1, stick));
    const left = !!pad.buttons?.[14]?.pressed;
    const right = !!pad.buttons?.[15]?.pressed;
    if (left !== right) return right ? 1 : -1;
  }
  return (held.right ? 1 : 0) - (held.left ? 1 : 0);
}

export default function SkylineInvaders(props) {
  // PoseProvider owns the detector singleton and disposes it on unmount, so the
  // game mounts its own. The game tree is `children`: stable, never a consumer.
  return <PoseProvider autoStart={false} initialConfig={POSE_CONFIG}><SkylineInvadersGame {...props} /></PoseProvider>;
}

function SkylineInvadersGame({ onClose }) {
  const ctx = useFitnessContext();
  const { registerAdmin, clearUnlock, unlockState, unlockedUser } = useIdentity();
  const { registerLifecycle } = useFitnessModule(MODULE_ID);
  const log = useMemo(() => getLogger().child({ app: 'fitness', component: 'skyline-invaders' }), []);
  const tracker = useInvadersAim();

  const [phase, setPhase] = useState('loading');
  const [levels, setLevels] = useState([]);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [world, setWorld] = useState(null);
  const [chosenLevelId, setChosenLevelId] = useState(null);
  const [pickedShooter, setPickedShooter] = useState(null);
  const [game, setGame] = useState(null);
  const [effects, setEffects] = useState(EMPTY_EFFECTS);
  const [poseStatus, setPoseStatus] = useState({ state: 'loading' });
  // Controls picked this session, by rider: shown at once, and kept if the save fails.
  const [pickedControls, setPickedControls] = useState({});
  const [countdown, setCountdown] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle', record: null });
  const [accessOverride, setAccessOverride] = useState(null);
  const [prompt, setPrompt] = useState(null);   // { kind: 'access' } | { kind: 'level', levelId, name }

  const phaseRef = useRef(phase);
  const gameRef = useRef(null);
  const roundRef = useRef(null);       // the round in hand: { runId, startedAt, seed, level, shooterId, mat, tally }
  const aimRef = useRef(0.5);
  const pausedByRef = useRef(null);
  const finalizingRef = useRef(false);
  const countdownTimerRef = useRef(null);
  const effectTimersRef = useRef(new Set());
  const unlockGenerationRef = useRef(0);
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = createSkylineAudio();
  const goPhase = useCallback((next) => { phaseRef.current = next; setPhase(next); }, []);

  // ── Who and what ──────────────────────────────────────────────────────────
  const session = ctx?.fitnessSessionInstance;
  const round = roundRef.current;
  const mat = round?.mat || selectInvadersMat(ctx?.equipment, session);
  const shooterId = round?.shooterId || pickedShooter || mat?.riderId || null;
  const people = useMemo(() => listInvadersPeople(ctx), [ctx?.participantRoster, ctx?.users, ctx?.userCollections, ctx?.usersConfig]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = useCallback((id) => people.find((person) => person.id === id)?.name || id, [people]);
  const boost = useInvadersBoost({ equipment: ctx?.equipment, session, shooterId });
  const access = useSkylineAccess(shooterId, { schoolLearner: shooterId ? ctx?.getUserByName?.(shooterId)?.schoolLearner : undefined, capabilityId: CAPABILITY_ID, logScope: 'skyline_invaders' });
  const accessGranted = access.unlocked || (!!shooterId && accessOverride?.riderId === shooterId);
  const riderWorld = world?.riderId === shooterId ? world : null;
  const level = round?.level || levels.find((item) => item.id === resolveLevelId(levels, riderWorld, chosenLevelId)) || null;
  // The aim gesture is the shooter's own: picked in the controls intro and saved with their progress.
  const stored = shooterId ? pickedControls[shooterId] || riderWorld?.controls?.gesture : null;
  const gesture = isGesture(stored) ? stored : null;

  const drainFire = useInvadersFire({
    enabled: phase === 'playing', matId: mat?.matId || null,
    subscribeToAppEvent: ctx?.subscribeToAppEvent, tracker,
  });

  // Callbacks read the current render through this, so none of them goes stale
  // and none of them restarts the frame loop.
  const live = useRef({});
  live.current = { session, shooterId, mat, level, levels, riderWorld, accessGranted, boost, drainFire, saveState, registerAdmin, clearUnlock, nameOf, gesture, onClose };

  // ── Mount, levels, world, sounds ──────────────────────────────────────────
  useEffect(() => {
    log.info('skyline_invaders.mounted', {
      sessionId: live.current.session?.sessionId || null, mats: listInvadersMats(ctx?.equipment, live.current.session).length,
      poseModel: POSE_CONFIG.modelType, poseBackend: POSE_CONFIG.backend || 'default',
      viewport: `${window.innerWidth}x${window.innerHeight}`, pixelRatio: window.devicePixelRatio || 1,
    });
    const timers = effectTimersRef.current;
    const audio = audioRef.current;
    audio.loadSounds(invadersSoundUrls(mediaUrl)).then((report) => {
      log.info('skyline_invaders.assets.loaded', { sounds: report.loaded, missing: report.missing.map(({ slot, reason }) => ({ slot, reason })) });
    }).catch((soundError) => log.warn('skyline_invaders.assets.error', { error: soundError?.message || String(soundError) }));
    return () => {
      clearInterval(countdownTimerRef.current);
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      audio.stop();
      log.info('skyline_invaders.unmounted', { phase: phaseRef.current, runId: roundRef.current?.runId || null });
    };
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);

  const setGovernanceSuspended = ctx?.setGovernanceSuspended;
  useEffect(() => {
    setGovernanceSuspended?.(true);
    return () => setGovernanceSuspended?.(false);
  }, [setGovernanceSuspended]);

  useEffect(() => {
    let active = true;
    goPhase('loading');
    fetch(`${API}/levels`).then(async (response) => {
      if (!response.ok) throw new Error(`level request failed (${response.status})`);
      const body = await response.json();
      const checked = (body.levels || []).map((raw) => ({ raw, ...validateLevel(raw) }));
      for (const entry of checked.filter((item) => !item.valid)) {
        log.warn('skyline_invaders.level.invalid', { levelId: entry.raw?.id || null, errors: entry.errors });
      }
      const valid = checked.filter((entry) => entry.valid).map((entry) => entry.level);
      if (!active) return;
      if (!valid.length) {
        log.error('skyline_invaders.levels.error', { reason: 'none-installed', received: checked.length });
        setError('No levels installed');
        goPhase('error');
        return;
      }
      log.info('skyline_invaders.levels.loaded', { levels: valid.length, rejected: checked.length - valid.length, ids: valid.map((item) => item.id) });
      setLevels(valid);
      goPhase('lobby');
    }).catch((requestError) => {
      log.error('skyline_invaders.levels.error', { reason: 'request-failed', error: requestError.message });
      if (active) { setError('Levels unavailable. Try again.'); goPhase('error'); }
    });
    return () => { active = false; };
  }, [goPhase, log, loadAttempt]);

  const refreshWorld = useCallback(async (forRider) => {
    if (!forRider) return;
    try {
      const response = await fetch(`${API}/world?rider=${encodeURIComponent(forRider)}`);
      if (!response.ok) throw new Error(`world request failed (${response.status})`);
      const body = await response.json();
      if (!Array.isArray(body?.levels)) throw new Error('world response has no levels');
      setWorld({ riderId: forRider, levels: body.levels, next: body.next || null, controls: body.controls || null });
      log.debug('skyline_invaders.world.loaded', { riderId: forRider, next: body.next || null, gesture: body.controls?.gesture || null });
    } catch (requestError) {
      // Progression is not a gate: without a world map every level stays open.
      log.warn('skyline_invaders.world.error', { riderId: forRider, error: requestError.message });
    }
  }, [log]);
  useEffect(() => { void refreshWorld(shooterId); }, [refreshWorld, shooterId]);

  // The tracker plays the shooter's gesture, or the default when they have not
  // picked one. The controls intro switches it card by card while it is open.
  useEffect(() => {
    if (phase !== 'controls') tracker.setGesture(gesture || INVADERS_TUNABLES.defaultGesture);
  }, [tracker, gesture, phase]);

  // A different shooter has a different school day, their own controls and
  // their own place on the level map.
  const priorShooterRef = useRef(shooterId);
  useEffect(() => {
    if (priorShooterRef.current === shooterId) return;
    priorShooterRef.current = shooterId;
    setAccessOverride((current) => (current?.riderId === shooterId ? current : null));
    setChosenLevelId(null);
  }, [shooterId]);

  // ── The round ─────────────────────────────────────────────────────────────
  const toLobby = useCallback(() => {
    clearInterval(countdownTimerRef.current);
    roundRef.current = null;
    finalizingRef.current = false;
    gameRef.current = null;
    setGame(null);
    setCountdown(null);
    setEffects(EMPTY_EFFECTS);
    setSaveState({ status: 'idle', record: null });
    goPhase('lobby');
  }, [goPhase]);

  const begin = useCallback((target) => {
    const now = live.current;
    const next = target || now.level;
    if (!next || !now.shooterId) return;
    // An unsaved round is never played over.
    if (['saving', 'error'].includes(now.saveState.status)) return;
    if (!now.accessGranted) { toLobby(); return; }
    const seed = newSeed();
    const state = createGameState(next, { seed });
    roundRef.current = {
      runId: newRunId(), startedAt: new Date().toISOString(), seed, level: next, shooterId: now.shooterId, mat: now.mat,
      gesture: tracker.gesture(),
      // Steps by where they came from, stomps, and volleys by what fired them.
      tally: { mat: 0, keyboard: 0, gamepad: 0, stomps: 0, stream: 0, rapid: 0, frames: 0, longFrames: 0 },
    };
    finalizingRef.current = false;
    pausedByRef.current = null;
    gameRef.current = state;
    aimRef.current = tracker.sample().x;
    setGame(state);
    setEffects(EMPTY_EFFECTS);
    setSaveState({ status: 'idle', record: null });
    setChosenLevelId(next.id);
    void audioRef.current.prime();   // this press is the gesture the browser's audio waits for
    let left = COUNTDOWN_FROM;
    setCountdown(left);
    goPhase('countdown');
    log.info('skyline_invaders.level.countdown', { runId: roundRef.current.runId, levelId: next.id, shooterId: now.shooterId });
    clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      left -= 1;
      if (left > 0) { setCountdown(left); return; }
      clearInterval(countdownTimerRef.current);
      setCountdown(null);
      const started = roundRef.current;
      if (!started || phaseRef.current !== 'countdown') return;
      goPhase('playing');
      log.info('skyline_invaders.level.start', {
        runId: started.runId, levelId: next.id, seed, shooterId: started.shooterId,
        partnerId: live.current.boost.readPartner()?.riderId || null,
        gesture: started.gesture, gestureChosen: !!live.current.gesture, aimMode: tracker.sample().mode, lane: tracker.sample().lane,
        matId: started.mat?.matId || null, cannons: next.cannons, durationS: next.duration_s,
        pose: poseStatusRef.current.state, poseFps: poseStatusRef.current.fps ?? null,
      });
    }, 1000);
  }, [goPhase, log, toLobby, tracker]);

  const poseStatusRef = useRef(poseStatus);
  poseStatusRef.current = poseStatus;

  const finalize = useCallback(async (ended, retryRecord = null, { then = null } = {}) => {
    const current = roundRef.current;
    if (!current || finalizingRef.current) return false;
    finalizingRef.current = true;
    clearInterval(countdownTimerRef.current);
    setCountdown(null);
    live.current.drainFire.clear();
    const now = live.current;
    const state = gameRef.current;
    const record = retryRecord || buildSkylineInvadersRun({
      runId: current.runId, level: current.level, riderId: current.shooterId,
      partnerId: now.boost.readPartner()?.riderId || null,
      fitnessSessionId: now.session?.sessionId || null, matEquipmentId: current.mat?.equipmentId || null,
      startedAt: current.startedAt, endedAt: new Date().toISOString(), state, ended, gesture: current.gesture,
    });
    const correlation = { runId: record.run.id, levelId: record.run.level_id, shooterId: record.rider.user_id };
    setSaveState({ status: 'saving', record });
    goPhase('result');
    if (!retryRecord) {
      log.info('skyline_invaders.level.end', {
        ...correlation, status: record.run.status, score: record.run.score, stars: record.run.stars, kills: record.run.kills,
        baseHp: record.run.base_hp, shots: record.run.shots_fired, hits: record.run.hits, bestCombo: record.run.best_combo,
        bombs: record.run.bombs, boosts: record.run.boosts_used, durationS: record.run.duration_s, seed: current.seed,
        steps: record.run.steps, firingS: record.run.firing_s, weaponPeak: record.run.weapon_peak,
        gesture: current.gesture, aimMode: tracker.sample().mode, tally: current.tally,
      });
    }
    try {
      const response = await postJson(`${API}/runs`, { record });
      if (!response.ok) throw new Error(`save failed (${response.status})`);
      const sameIdentity = (record.run.fitness_session_id || null) === (live.current.session?.sessionId || null)
        && record.rider.user_id === live.current.shooterId;
      if (record.run.status === 'completed' && sameIdentity) {
        live.current.session?.treasureBox?.awardBonus?.({
          idempotencyKey: `invaders:${record.run.id}:completion:${record.rider.user_id}`,
          userId: record.rider.user_id, rings: record.run.reward_rings, zoneId: 'skyline-invaders', color: REWARD_COLOR,
          source: 'skyline-invaders', metadata: { levelId: record.run.level_id, stars: record.run.stars },
        });
        log.info('skyline_invaders.reward.awarded', { ...correlation, rings: record.run.reward_rings, stars: record.run.stars });
      } else if (record.run.status === 'completed') {
        log.warn('skyline_invaders.reward.skipped', { ...correlation, fitnessSessionId: record.run.fitness_session_id || null, reason: 'terminal-identity-changed' });
      }
      log.info('skyline_invaders.round.saved', { ...correlation, status: record.run.status, retried: !!retryRecord });
      // The game was closed while this was saving: nothing is left to update.
      if (then === 'close') return true;
      await refreshWorld(record.rider.user_id);
      setSaveState({ status: 'saved', record });
      // After the save: a ceremony may show over the result, never during play.
      announceGameAchievement('skyline-invaders', { runId: record.run.id });
      if (then === 'lobby') toLobby();
      return true;
    } catch (saveError) {
      finalizingRef.current = false;
      setSaveState({ status: 'error', record });
      log.error('skyline_invaders.round.save_error', { ...correlation, status: record.run.status, error: saveError.message });
      return false;
    }
  }, [goPhase, log, refreshWorld, toLobby, tracker]);

  const pause = useCallback((reason) => {
    if (phaseRef.current !== 'playing') return;
    live.current.drainFire.clear();
    pausedByRef.current = reason;
    goPhase('paused');
    log.info('skyline_invaders.round.paused', { runId: roundRef.current?.runId, reason, time: gameRef.current?.time ?? null });
  }, [goPhase, log]);
  const resume = useCallback((how) => {
    if (phaseRef.current !== 'paused') return;
    const pausedBy = pausedByRef.current;
    pausedByRef.current = null;
    goPhase('playing');
    log.info('skyline_invaders.round.resumed', { runId: roundRef.current?.runId, how, pausedBy, time: gameRef.current?.time ?? null });
  }, [goPhase, log]);

  // The frame loop. Everything it needs is read at frame time.
  useEffect(() => {
    if (phase !== 'playing' || !roundRef.current || !gameRef.current) return undefined;
    const current = roundRef.current;
    const lvl = current.level;
    const correlation = { runId: current.runId, levelId: lvl.id };
    const held = { left: false, right: false };
    let health = { startedAt: performance.now(), frames: 0, longFrames: 0 };
    // One line per cue would flood the log store: every effect line is rate-limited.
    const effectLog = {
      info: (name, data) => log.sampled(name, data, { maxPerMinute: name === INVADERS_LOG_NAMES.executed || name === INVADERS_LOG_NAMES.skipped ? 6 : 20, aggregate: true }),
      error: (name, data) => log.sampled(name, data, { maxPerMinute: 6, aggregate: true, level: 'error' }),
    };
    const dispatcher = createEffectDispatcher({
      table: buildInvadersEffectTable({ setEffects, effectTimersRef }),
      playCue: (cue) => audioRef.current.playCue(cue),
      log: effectLog, logNames: INVADERS_LOG_NAMES,
      correlation: () => correlation, skippedReason: () => 'audio-unavailable',
    });

    const frame = ({ nowMs, rawElapsedS, elapsedS }) => {
      const now = live.current;
      const previous = gameRef.current;
      health.frames += 1;
      current.tally.frames += 1;
      if (rawElapsedS > 0.05) { health.longFrames += 1; current.tally.longFrames += 1; }
      if (nowMs - health.startedAt >= HEALTH_EVERY_MS) {
        const windowMs = nowMs - health.startedAt;
        log.info('skyline_invaders.render.health', {
          ...correlation, time: previous.time, frames: health.frames, longFrames: health.longFrames, windowMs: Math.round(windowMs),
          fps: Math.round((health.frames * 10000) / windowMs) / 10,
          pose: poseStatusRef.current.state, poseFps: poseStatusRef.current.fps ?? null, poseLatency: poseStatusRef.current.latency ?? null,
          threats: previous.threats.length, shots: previous.shots.length,
        });
        health = { startedAt: nowMs, frames: 0, longFrames: 0 };
      }
      // No live pose: the stick or the arrow keys steer; left alone, a lost
      // pose drifts toward the threat nearest the ground. Either way the
      // cannon stands on a lane: `x` is its centre.
      const sample = tracker.sample();
      const axis = readAimAxis(held);
      if (sample.mode === 'manual' || (sample.lost && axis !== 0)) tracker.setAim(manualAim(sample.raw, axis, elapsedS));
      else if (sample.lost) tracker.setAim(driftAim(sample.raw, previous.threats, elapsedS));
      const aimNow = tracker.sample();
      // A zero-length frame runs no engine sub-step, so its presses wait for the next one.
      const presses = elapsedS > 0 ? now.drainFire() : EMPTY_PRESSES;
      const twoCannons = lvl.cannons === 2 && aimNow.perArm.every((value) => value != null);
      const intents = { aim: twoCannons ? aimNow.perArm : aimNow.x, armsUp: aimNow.armsUp, steps: presses.steps, stomps: presses.stomps, partnerRpm: now.boost.readRpm() };
      const next = stepFrame(previous, intents, elapsedS, lvl);
      gameRef.current = next;
      aimRef.current = intents.aim;
      setGame(next);
      dispatcher.dispatch(next.events, { time: next.time });
      current.tally.stomps += presses.stomps.length;
      for (const event of next.events) {
        if (event.type === 'shot.fired') {
          if (current.tally[event.data.source] !== undefined) current.tally[event.data.source] += 1;
        } else if (event.type === 'fuel.added') {
          if (current.tally[event.data.source] !== undefined) current.tally[event.data.source] += 1;
          log.sampled('skyline_invaders.fuel', { ...correlation, source: event.data.source, fuel: event.data.fuel, lane: aimNow.lane, time: next.time }, { maxPerMinute: 30, aggregate: true });
          if (event.data.pressAt) log.sampled('skyline_invaders.mat.press_to_fuel_ms', { ...correlation, ms: Date.now() - event.data.pressAt }, { maxPerMinute: 12, aggregate: true });
        }
      }
      if (next.phase === 'ended') void finalize(true);
    };
    const driver = createFrameDriver({
      maxFrameS: 0.1, onFrame: frame,
      onError: (frameError) => log.sampled('skyline_invaders.frame.error', { ...correlation, error: frameError?.message }, { maxPerMinute: 5, aggregate: true, level: 'error' }),
    });

    const onKey = (down) => (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        held[event.key === 'ArrowLeft' ? 'left' : 'right'] = down;
        event.preventDefault();
      } else if (down && !event.repeat && event.key === 'Escape') {
        event.preventDefault();
        pause('player');
      }
    };
    const onKeyDown = onKey(true);
    const onKeyUp = onKey(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    driver.start();
    return () => {
      driver.stop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [phase, finalize, log, pause, tracker]);

  // The 3-2-1 has no menu: Escape or B is the way back out of it.
  useMenuInput(phase === 'countdown', (action) => {
    if (action !== 'back') return;
    log.info('skyline_invaders.level.countdown_cancelled', { runId: roundRef.current?.runId || null, levelId: roundRef.current?.level?.id || null });
    toLobby();
  });

  // Gamepad B pauses, as Escape does.
  useGamepadKeys(phase === 'playing', (key) => { if (key === 'Escape') pause('player'); });

  // ── The way out ───────────────────────────────────────────────────────────
  // Leaving is always allowed and never waits. A round in play is saved as
  // abandoned (the save carries on after the game has closed); a countdown is
  // dropped; a result that failed to save gets one more try on the way out.
  const exit = useCallback((how) => {
    const at = phaseRef.current;
    const current = roundRef.current;
    const save = live.current.saveState;
    let round = null;
    if (current && (at === 'playing' || at === 'paused')) round = 'abandoned';
    else if (current && at === 'countdown') round = 'discarded';
    else if (at === 'result') round = save.status;
    log.info('skyline_invaders.exit', { phase: at, how, runId: current?.runId || null, levelId: current?.level?.id || null, shooterId: live.current.shooterId, round, time: gameRef.current?.time ?? null });
    clearInterval(countdownTimerRef.current);
    if (round === 'abandoned') void finalize(false, null, { then: 'close' });
    else if (round === 'error' && save.record) void finalize(save.record.run.status !== 'abandoned', save.record, { then: 'close' });
    live.current.onClose?.();
  }, [finalize, log]);
  const onExit = onClose ? exit : undefined;

  // ── Lifecycle: workout pause, session end, hidden page ────────────────────
  useEffect(() => {
    registerLifecycle({
      onPause: () => pause('lifecycle'),
      // Also runs on mount and whenever the video is not paused: only undo a lifecycle pause.
      onResume: () => { if (phaseRef.current === 'paused' && pausedByRef.current === 'lifecycle') resume('lifecycle'); },
      // Runs whenever there is no session: only a round in hand is ended.
      onSessionEnd: () => {
        if (!ROUND_PHASES.includes(phaseRef.current)) return;
        log.info('skyline_invaders.round.session_ended', { runId: roundRef.current?.runId, phase: phaseRef.current });
        if (phaseRef.current === 'countdown') toLobby(); else void finalize(false);
      },
    });
  }, [registerLifecycle, pause, resume, finalize, toLobby, log]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') pause('hidden'); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause]);

  // Access taken away mid-round (the school day ran out): the round ends as
  // abandoned and the lobby shows the lock. A failed read is not a verdict.
  useEffect(() => {
    if (accessGranted || !ROUND_PHASES.includes(phase) || !['ready', 'locked'].includes(access.status)) return;
    log.info('skyline_invaders.access.revoked', { runId: roundRef.current?.runId, shooterId, state: access.state, phase });
    if (phase === 'countdown') toLobby(); else void finalize(false, null, { then: 'lobby' });
  }, [accessGranted, access.status, access.state, phase, finalize, toLobby, log, shooterId]);

  // ── Grown-up unlocks ──────────────────────────────────────────────────────
  const cancelPrompt = useCallback(() => {
    unlockGenerationRef.current += 1;
    setPrompt(null);
    live.current.clearUnlock?.();
  }, []);
  const requestAdminOverride = useCallback(async () => {
    const riderId = live.current.shooterId;
    if (!riderId) return;
    const generation = ++unlockGenerationRef.current;
    setPrompt({ kind: 'access' });
    log.info('skyline_invaders.access.override_requested', { riderId });
    const result = await live.current.registerAdmin(MODULE_ID);
    if (generation !== unlockGenerationRef.current) return;
    if (!result?.matched || !result.userId) {
      log.info('skyline_invaders.access.override_denied', { riderId, reason: result?.reason || 'denied' });
      return;   // the prompt shows the denial; Cancel or its timeout closes it
    }
    // The admin authorizes; the shooter stays the player and the one who is paid.
    setAccessOverride({ riderId, adminUserId: result.userId });
    setPrompt(null);
    live.current.clearUnlock?.();
    log.info('skyline_invaders.access.override_granted', { riderId, adminUserId: result.userId });
  }, [log]);
  const requestLevelUnlock = useCallback(async (locked) => {
    const riderId = live.current.shooterId;
    if (!riderId) return;
    const generation = ++unlockGenerationRef.current;
    setPrompt({ kind: 'level', levelId: locked.id, name: locked.name });
    log.info('skyline_invaders.progress.unlock_requested', { riderId, levelId: locked.id });
    const result = await live.current.registerAdmin(MODULE_ID);
    if (generation !== unlockGenerationRef.current) return;
    if (!result?.matched || !result.userId) {
      log.info('skyline_invaders.progress.unlock_denied', { riderId, levelId: locked.id, reason: result?.reason || 'denied' });
      return;
    }
    try {
      const response = await postJson(`${API}/progress/${encodeURIComponent(riderId)}/unlock`, { levelId: locked.id, unlockedBy: result.userId });
      if (!response.ok) throw new Error(`unlock failed (${response.status})`);
      await refreshWorld(riderId);
      setChosenLevelId(locked.id);
      log.info('skyline_invaders.progress.unlock_granted', { riderId, levelId: locked.id, adminUserId: result.userId });
    } catch (unlockError) {
      log.error('skyline_invaders.progress.unlock_error', { riderId, levelId: locked.id, error: unlockError.message });
    }
    if (generation !== unlockGenerationRef.current) return;
    setPrompt(null);
    live.current.clearUnlock?.();
  }, [log, refreshWorld]);
  // While the fingerprint prompt is up, the only key that acts is the way out.
  useMenuInput(!!prompt, (action) => { if (action === 'back') cancelPrompt(); });

  // ── Lobby handlers ────────────────────────────────────────────────────────
  const pickShooter = useCallback((userId) => {
    const now = live.current;
    if (now.mat) now.session?.setEquipmentUser?.(now.mat.equipmentId, userId);
    setPickedShooter(userId);
    log.info('skyline_invaders.lobby.shooter_picked', { shooterId: userId, matEquipmentId: now.mat?.equipmentId || null, previous: now.shooterId });
  }, [log]);
  const chooseLevel = useCallback((levelId) => {
    setChosenLevelId(levelId);
    log.info('skyline_invaders.lobby.level_chosen', { levelId, shooterId: live.current.shooterId });
  }, [log]);

  // ── Controls intro ────────────────────────────────────────────────────────
  const openControls = useCallback(() => {
    log.info('skyline_invaders.controls.opened', { shooterId: live.current.shooterId, pose: poseStatusRef.current.state, current: live.current.gesture, first: !live.current.gesture });
    goPhase('controls');
  }, [goPhase, log]);
  const closeControls = useCallback(() => {
    log.info('skyline_invaders.controls.closed', { shooterId: live.current.shooterId, current: live.current.gesture });
    goPhase('lobby');
  }, [goPhase, log]);
  const onTryout = useCallback((summary) => {
    log.sampled('skyline_invaders.controls.tryout', { shooterId: live.current.shooterId, pose: poseStatusRef.current.state, poseFps: poseStatusRef.current.fps ?? null, ...summary }, { maxPerMinute: 30, aggregate: true });
  }, [log]);
  const chooseControls = useCallback(async (picked, how) => {
    const riderId = live.current.shooterId;
    const previous = live.current.gesture;
    if (!riderId) return;
    setPickedControls((current) => ({ ...current, [riderId]: picked }));
    goPhase('lobby');
    let saved = false;
    try {
      const response = await postJson(`${API}/progress/${encodeURIComponent(riderId)}/controls`, { gesture: picked });
      if (!response.ok) throw new Error(`controls save failed (${response.status})`);
      saved = true;
    } catch (saveError) {
      // The choice still holds for this session; the intro comes back next time.
      log.warn('skyline_invaders.controls.save_error', { shooterId: riderId, gesture: picked, error: saveError.message });
    }
    log.info('skyline_invaders.controls.chosen', { shooterId: riderId, gesture: picked, label: GESTURE_INFO[picked]?.label, how, previous, saved });
    if (saved) await refreshWorld(riderId);
  }, [goPhase, log, refreshWorld]);
  const onPoseStatus = useCallback((next) => setPoseStatus(next), []);

  // ── Render ────────────────────────────────────────────────────────────────
  const inRound = ROUND_PHASES.includes(phase);
  const idle = useMemo(() => (level ? createGameState(level, { seed: 1 }) : null), [level]);
  const sceneState = game || idle;
  const sample = tracker.sample();
  const partner = boost.partner ? { ...boost.partner, name: nameOf(boost.partner.riderId) } : null;
  const record = saveState.record;
  const nextLevel = record?.run.status === 'completed'
    ? levels.slice(levels.findIndex((item) => item.id === record.run.level_id) + 1).find((item) => riderWorld?.levels?.find((entry) => entry.id === item.id)?.status !== 'locked') || null
    : null;
  const testId = phase === 'loading' ? 'skyline-invaders-loading' : inRound || phase === 'result' ? 'skyline-invaders-play' : 'skyline-invaders';

  return (
    <main
      className={`skyline-invaders skyline-invaders--${phase}`}
      data-testid={testId}
      data-phase={phase}
      data-run-role={projectRunRole(phase, ROLE_MAP)}
      data-level-id={level?.id || undefined}
      data-shooter-id={shooterId || undefined}
    >
      {/* Mounted for the whole life of the game, so the model loads while the players are choosing. */}
      <InvadersPoseBridge tracker={tracker} enabled onStatus={onPoseStatus} />

      {sceneState && level && phase !== 'controls' && (
        <InvadersScene
          state={sceneState} level={level} aim={game ? aimRef.current : 0.5} live={inRound}
          twin={sceneState.boost?.active?.kind === 'twin'} effects={effects}
        />
      )}
      {inRound && game && (
        <InvadersHud
          state={game} level={level} gesture={round?.gesture || null} aimStatus={{ lost: sample.lost, mode: sample.mode }}
          poseStatus={poseStatus} partner={partner}
        />
      )}
      {inRound && <MomentBanner text={effects.banner?.text || null} momentKey={effects.banner?.key} className="skyline-invaders__banner" />}
      {phase === 'countdown' && <CountdownOverlay value={countdown} className="skyline-invaders__countdown" />}
      {phase === 'playing' && (
        <button type="button" className="skyline-invaders__pause-button" aria-label="Pause" onClick={(event) => { event.currentTarget.blur(); pause('player'); }}>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      )}

      {phase === 'loading' && (
        <section className="skyline-invaders__notice">
          <h1>Skyline Invaders</h1>
          <p role="status">Loading the levels…</p>
          {onExit && <InvadersActions actions={[{ id: 'exit', label: 'Exit', hint: 'Leave the game', onPress: () => onExit('button') }]} onBack={() => onExit('back')} />}
        </section>
      )}
      {phase === 'error' && (
        <section className="skyline-invaders__notice" data-testid="skyline-invaders-error">
          <h1>Skyline Invaders</h1>
          <p role="alert">{error}</p>
          <InvadersActions
            actions={[
              { id: 'retry', label: 'Try again', onPress: () => setLoadAttempt((attempt) => attempt + 1) },
              ...(onExit ? [{ id: 'exit', label: 'Exit', hint: 'Leave the game', onPress: () => onExit('button') }] : []),
            ]}
            onBack={onExit ? () => onExit('back') : undefined}
          />
          <p className="skyline-invaders__how">{`Tap a button, press any key, or A on the gamepad.${onExit ? ' Escape or B leaves the game.' : ''}`}</p>
        </section>
      )}
      {phase === 'lobby' && (
        <InvadersLobby
          levels={levels} world={riderWorld} chosenLevelId={chosenLevelId} onChooseLevel={chooseLevel} onRequestUnlock={requestLevelUnlock}
          shooter={shooterId ? { id: shooterId, name: nameOf(shooterId) } : null} candidates={people} onPickShooter={pickShooter}
          mat={mat} partner={partner} poseStatus={poseStatus} controls={gesture ? { gesture } : null} onPickControls={openControls}
          access={{ ...access, unlocked: accessGranted }} onRequestAdmin={requestAdminOverride} onStart={() => begin()}
          tracker={tracker} active={!prompt} onExit={onExit}
        />
      )}
      {phase === 'controls' && (
        <InvadersControls
          tracker={tracker} current={gesture} shooter={shooterId ? { id: shooterId, name: nameOf(shooterId) } : null} poseStatus={poseStatus}
          matId={mat?.matId || null} subscribeToAppEvent={ctx?.subscribeToAppEvent}
          onChoose={chooseControls} onClose={closeControls} onTryout={onTryout} active={!prompt}
        />
      )}
      {phase === 'paused' && (
        <section className="skyline-invaders__pause" data-testid="skyline-invaders-pause" aria-label="Paused">
          <h1>Paused</h1>
          <p>{PAUSE_REASONS[pausedByRef.current] || PAUSE_REASONS.player}</p>
          <InvadersActions
            actions={[
              { id: 'resume', label: 'Resume', onPress: () => resume('player') },
              { id: 'end', label: 'End round', hint: 'Saves it as ended early', onPress: () => { void finalize(false); } },
              ...(onExit ? [{ id: 'exit', label: 'Exit', hint: 'Ends the round and leaves', onPress: () => onExit('button') }] : []),
            ]}
            onBack={() => resume('player')}
            tracker={tracker}
          />
          <p className="skyline-invaders__how">Tap a button, press any key, or A on the gamepad. Left and right move between the choices.</p>
        </section>
      )}
      {phase === 'result' && record && (
        <InvadersResult
          record={record} saveStatus={saveState.status} level={level} nextLevel={nextLevel} tracker={tracker} active={!prompt}
          onReplay={() => begin(roundRef.current?.level)}
          onNext={() => begin(nextLevel)}
          onLevels={toLobby}
          onRetrySave={() => { void finalize(record.run.status !== 'abandoned', record); }}
          onExit={onExit}
        />
      )}

      <UnlockPrompt
        open={!!prompt} state={unlockState} unlockedUser={unlockedUser} onCancel={cancelPrompt}
        lockLabel={prompt?.kind === 'level' ? prompt.name : 'Skyline Invaders'}
      />
    </main>
  );
}
