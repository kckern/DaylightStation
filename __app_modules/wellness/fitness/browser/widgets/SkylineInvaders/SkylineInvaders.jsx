import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightImagePath, DaylightMediaPath } from '@/lib/api.mjs';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { PoseProvider } from '../../context/PoseContext.jsx';
import { useIdentity } from '../../identity/useIdentity.js';
import useFitnessModule from '../../player/useFitnessModule.js';
import UnlockPrompt from '../../player/overlays/UnlockPrompt.jsx';
import { useGamepadKeys } from '../../lib/useGamepadKeys.js';
import { createSkylineAudio } from '../../lib/skylineGlider/skylineAudio.js';
import { useGameVolume } from '../../nav/useGameVolume.js';
import { MoreButton } from '../SkylineGlider/SkylineFlightHud.jsx';
import { driftAim, manualAim } from '../../lib/skylineInvaders/aimAssist.js';
import { createGameState, stepFrame } from '../../lib/skylineInvaders/engine.js';
import { EMPTY_EFFECTS, INVADERS_LOG_NAMES, buildInvadersEffectTable, invadersSoundUrls } from '../../lib/skylineInvaders/invadersEffects.js';
import { validateLevel } from '../../lib/skylineInvaders/levels.js';
import { listInvadersMats, selectInvadersMat } from '../../lib/skylineInvaders/matSelection.js';
import { gateLearnerIds, listInvadersPeople, listSessionRiderIds } from '../../lib/skylineInvaders/people.js';
import { buildSkylineInvadersRun } from '../../lib/skylineInvaders/runResult.js';
import { shotTier } from '../../lib/skylineInvaders/tiers.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { invadersAction, invadersControls, pressForMenuKey, stompAction } from '../../lib/skylineInvaders/invadersPanel.js';
import { resolveLevelId, waveRows } from '../../lib/skylineInvaders/waves.js';
import { useSkylineGroupAccess } from '../SkylineGlider/useSkylineAccess.js';
import { CountdownOverlay, MomentBanner } from '../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
import { announceGameAchievement, createEffectDispatcher, createFrameDriver } from '../../../../../../__capabilities/gaming/browser/platform/realtime/index.js';
import { projectRunRole } from '../../../../../../__capabilities/gaming/portable/realtime/index.mjs';
import InvadersCalibration from './InvadersCalibration.jsx';
import InvadersHud from './InvadersHud.jsx';
import InvadersMenus, { InvadersTouchKeys } from './InvadersMenus.jsx';
import InvadersPoseBridge from './InvadersPoseBridge.jsx';
import InvadersResult from './InvadersResult.jsx';
import InvadersScene from './InvadersScene.jsx';
import useInvadersAim from './useInvadersAim.js';
import useInvadersBoost from './useInvadersBoost.js';
import useInvadersFire from './useInvadersFire.js';
import useMenuInput from './useMenuInput.js';
import './SkylineInvaders.scss';

// The Skyline Invaders shell: loads the levels, runs the menu screens, drives
// the engine from a frame loop, and saves the round.
//
// Phases: loading -> lobby <-> calibrating -> countdown -> playing <-> paused
// -> result (-> lobby or another countdown); `error` from loading.
// Every menu screen is one decision on Skyline Glider's window and bike-button
// panel (lib/skylineInvaders/invadersPanel.js): who (riders) / roster (others),
// waves, locked (school day), ready (calibration), paused, result, sound.
//
// What a frame reads (aim, tier, cadence, queued presses) comes from refs and
// hooks that never re-render the game: the pose runs at its own rate, as low
// as 13 a second, and the round must play the same whatever that rate is.

const API = '/api/v1/fitness/skyline-invaders';
const MODULE_ID = 'skyline_invaders';
const CAPABILITY_ID = 'fitness.skyline-invaders';
const ROLE_MAP = Object.freeze({ loading: 'ready', lobby: 'ready', calibrating: 'ready', error: 'ready' });
const ROUND_PHASES = Object.freeze(['countdown', 'playing', 'paused']);
// Where the Sound sheet can be opened: every screen a player can stop on. Not
// mid-countdown (three seconds) and not over calibration, which reads the pose.
const SOUND_PHASES = Object.freeze(['lobby', 'paused', 'result']);
const SOUND_SCREENS = Object.freeze(['who', 'roster', 'waves', 'locked', 'paused', 'result']);
// Ready waits this long for a camera that is still starting, then plays with gamepad aim.
const READY_CAMERA_WAIT_MS = 20_000;
const COUNTDOWN_FROM = 3;
const HEALTH_EVERY_MS = 20_000;   // the log ingest allows three of one event a minute
const STICK_DEAD_ZONE = 0.2;
const REWARD_COLOR = '#7bd88f';
const POSE_CONFIG = Object.freeze({
  temporalSmoothing: false, maxPoses: 1, modelType: INVADERS_TUNABLES.poseModelType,
  ...(INVADERS_TUNABLES.poseBackend ? { backend: INVADERS_TUNABLES.poseBackend } : {}),
});

const mediaUrl = (path) => DaylightMediaPath(`/media/${path}`);
// The shell may use real randomness; the engine may not. The seed is saved
// with the round's logs so a round can be replayed.
const newSeed = () => {
  try { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Math.floor(Math.random() * 2 ** 32); }
};
const newRunId = () => globalThis.crypto?.randomUUID?.() || `invaders-${Date.now()}-${newSeed()}`;
const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Stick first, then the D-pad, then held arrow keys: -1 (left) .. 1 (right).
const readPads = () => { try { return Array.from(navigator.getGamepads?.() || []).filter(Boolean); } catch { return []; } };
// Gamepad Start (standard button 9) pauses a round.
const startPressed = () => readPads().some((pad) => !!pad.buttons?.[9]?.pressed);

/** Whether a gamepad is plugged in: the Ready screen offers Skip only then. */
function useGamepadConnected() {
  const [connected, setConnected] = useState(() => readPads().length > 0);
  useEffect(() => {
    const update = () => setConnected(readPads().length > 0);
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    return () => { window.removeEventListener('gamepadconnected', update); window.removeEventListener('gamepaddisconnected', update); };
  }, []);
  return connected;
}

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

function SkylineInvadersGame() {
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
  const [choosingShooter, setChoosingShooter] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  // The roster's cursor shows only once a key or gamepad moves it: under touch a gold tile reads as already chosen.
  const [rosterCursor, setRosterCursor] = useState(false);
  const [rosterIndex, setRosterIndex] = useState(0);
  const gamepadConnected = useGamepadConnected();
  const [game, setGame] = useState(null);
  const [effects, setEffects] = useState(EMPTY_EFFECTS);
  const [poseStatus, setPoseStatus] = useState({ state: 'loading' });
  const [, setCalibrated] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle', record: null });
  const [accessOverride, setAccessOverride] = useState(null);
  const [prompt, setPrompt] = useState(null);   // { kind: 'access' } | { kind: 'level', levelId, name }

  const phaseRef = useRef(phase);
  const gameRef = useRef(null);
  const roundRef = useRef(null);       // the round in hand: { runId, startedAt, seed, level, shooterId, mat, tally }
  const aimRef = useRef(0.5);
  const tierRef = useRef(shotTier(null));
  const pausedByRef = useRef(null);
  const finalizingRef = useRef(false);
  const countdownTimerRef = useRef(null);
  const effectTimersRef = useRef(new Set());
  const unlockGenerationRef = useRef(0);
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = createSkylineAudio();
  const goPhase = useCallback((next) => { phaseRef.current = next; setPhase(next); }, []);

  // ── Sound ─────────────────────────────────────────────────────────────────
  // The game's own volume (useGameVolume, its track in the fitness volume
  // store), not the video level and not full gain. Every voice -- cue files,
  // music, synth tones -- ends on the one output gain this sets.
  const gameVolume = useGameVolume('skyline-invaders');
  const volumeRef = useRef(gameVolume);
  volumeRef.current = gameVolume;
  useEffect(() => {
    audioRef.current.setVolume(gameVolume.output);
    log.info('skyline_invaders.audio.volume', {
      level: gameVolume.level, muted: gameVolume.muted, isDefault: gameVolume.isDefault,
      output: audioRef.current.getLevels?.().output ?? gameVolume.output,
    });
  }, [gameVolume.output, gameVolume.level, gameVolume.muted, gameVolume.isDefault, log]);
  const [soundOpen, setSoundOpen] = useState(false);
  const soundOpenRef = useRef(false);
  soundOpenRef.current = soundOpen;

  // ── Who and what ──────────────────────────────────────────────────────────
  const session = ctx?.fitnessSessionInstance;
  const round = roundRef.current;
  const mat = round?.mat || selectInvadersMat(ctx?.equipment, session);
  const shooterId = round?.shooterId || pickedShooter || mat?.riderId || null;
  const people = useMemo(() => listInvadersPeople(ctx), [ctx?.participantRoster, ctx?.users, ctx?.userCollections, ctx?.usersConfig]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = useCallback((id) => people.find((person) => person.id === id)?.name || id, [people]);
  const boost = useInvadersBoost({ equipment: ctx?.equipment, session, shooterId });
  // The shooters on offer are the people in the workout, the mat's person first
  // and bike riders last; the school gate is every learner in the workout plus
  // the shooter, so a grown-up picked as the shooter never opens the round for
  // a child who has school left (people.js, gateLearnerIds).
  const bikeRiderIds = (Array.isArray(ctx?.equipment) ? ctx.equipment : [])
    .filter((item) => item?.id != null && String(item.id) !== mat?.equipmentId)
    .map((item) => session?.getEquipmentRider?.(item.id)).filter(Boolean);
  const sessionRiderIds = listSessionRiderIds(ctx, mat, bikeRiderIds);
  const sessionKey = sessionRiderIds.join('|');
  const riders = useMemo(() => sessionRiderIds.map((id) => people.find((person) => person.id === id) || { id, name: id }), [sessionKey, people]);   // eslint-disable-line react-hooks/exhaustive-deps
  const gateIds = gateLearnerIds({ shooterId, riderIds: sessionRiderIds, learnerOf: (id) => ctx?.getUserByName?.(id)?.schoolLearner });
  const access = useSkylineGroupAccess(gateIds, { capabilityId: CAPABILITY_ID, logScope: 'skyline_invaders' });
  // A grown-up's unlock is for these learners: anyone else joining asks again.
  const accessGranted = access.unlocked || (!!shooterId && !!accessOverride && accessOverride.key === access.key);
  const riderWorld = world?.riderId === shooterId ? world : null;
  const level = round?.level || levels.find((item) => item.id === resolveLevelId(levels, riderWorld, chosenLevelId)) || null;

  const drainFire = useInvadersFire({
    enabled: phase === 'playing', matId: mat?.matId || null, cannons: level?.cannons || 1,
    subscribeToAppEvent: ctx?.subscribeToAppEvent, tracker, getTier: () => tierRef.current.tier,
  });

  // Callbacks read the current render through this, so none of them goes stale
  // and none of them restarts the frame loop.
  const live = useRef({});
  live.current = { session, shooterId, mat, level, levels, riderWorld, access, accessGranted, boost, drainFire, saveState, registerAdmin, clearUnlock, nameOf, prompt };

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
      setWorld({ riderId: forRider, levels: body.levels, next: body.next || null });
      log.debug('skyline_invaders.world.loaded', { riderId: forRider, next: body.next || null });
    } catch (requestError) {
      // Progression is not a gate: without a world map every level stays open.
      log.warn('skyline_invaders.world.error', { riderId: forRider, error: requestError.message });
    }
  }, [log]);
  useEffect(() => { void refreshWorld(shooterId); }, [refreshWorld, shooterId]);

  // A different shooter has a different reach, a different school day and
  // their own place on the level map.
  const priorShooterRef = useRef(shooterId);
  useEffect(() => {
    if (priorShooterRef.current === shooterId) return;
    const prior = priorShooterRef.current;
    priorShooterRef.current = shooterId;
    setChosenLevelId(null);
    if (prior && tracker.calibration()) {
      tracker.setCalibration(null);
      setCalibrated(false);
      log.info('skyline_invaders.lobby.calibration_reset', { reason: 'shooter-changed', shooterId });
    }
  }, [shooterId, tracker, log]);

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
      tally: { mat: 0, keyboard: 0, gamepad: 0, auto: 0, frames: 0, longFrames: 0 },
    };
    finalizingRef.current = false;
    pausedByRef.current = null;
    gameRef.current = state;
    aimRef.current = tracker.sample().x;
    tierRef.current = shotTier(now.session?.zoneProfileStore?.getProfile?.(now.shooterId));
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
        aimMode: tracker.sample().mode, tier: tierRef.current.tier, tierTrusted: tierRef.current.trusted,
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
      startedAt: current.startedAt, endedAt: new Date().toISOString(), state, ended,
    });
    const correlation = { runId: record.run.id, levelId: record.run.level_id, shooterId: record.rider.user_id };
    setSaveState({ status: 'saving', record });
    goPhase('result');
    if (!retryRecord) {
      log.info('skyline_invaders.level.end', {
        ...correlation, status: record.run.status, score: record.run.score, stars: record.run.stars, kills: record.run.kills,
        baseHp: record.run.base_hp, shots: record.run.shots_fired, hits: record.run.hits, bestCombo: record.run.best_combo,
        nukes: record.run.nukes, boosts: record.run.boosts_used, durationS: record.run.duration_s, seed: current.seed,
        aimMode: tracker.sample().mode, shotsBySource: current.tally,
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
      await refreshWorld(record.rider.user_id);
      setSaveState({ status: 'saved', record });
      log.info('skyline_invaders.round.saved', { ...correlation, status: record.run.status, retried: !!retryRecord });
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
    // `start`: held at the round's first frame, so the press that began it never pauses it.
    const held = { left: false, right: false, start: startPressed() };
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
      correlation: () => correlation, skippedReason: () => (volumeRef.current.output <= 0 ? 'muted' : 'audio-unavailable'),
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
      // pose drifts toward the threat nearest the ground.
      const start = startPressed();
      if (start && !held.start) { held.start = true; pause('player'); return; }
      held.start = start;
      const sample = tracker.sample();
      const axis = readAimAxis(held);
      if (sample.mode === 'manual' || (sample.lost && axis !== 0)) tracker.setAim(manualAim(sample.x, axis, elapsedS));
      else if (sample.lost) tracker.setAim(driftAim(sample.x, previous.threats, elapsedS));
      const aimNow = tracker.sample();
      const tier = shotTier(now.session?.zoneProfileStore?.getProfile?.(current.shooterId));
      tierRef.current = tier;
      // A zero-length frame runs no engine sub-step, so its presses wait for the next one.
      const fire = elapsedS > 0 ? now.drainFire() : [];
      const twoCannons = lvl.cannons === 2 && aimNow.perArm.every((value) => value != null);
      const intents = { aim: twoCannons ? aimNow.perArm : aimNow.x, tier: tier.tier, armsUp: aimNow.armsUp, fire, partnerRpm: now.boost.readRpm() };
      const next = stepFrame(previous, intents, elapsedS, lvl);
      gameRef.current = next;
      aimRef.current = intents.aim;
      setGame(next);
      dispatcher.dispatch(next.events, { time: next.time });
      for (const event of next.events) {
        if (event.type !== 'shot.fired') continue;
        if (current.tally[event.data.source] !== undefined) current.tally[event.data.source] += 1;
        log.sampled('skyline_invaders.fire', { ...correlation, ...event.data, time: next.time }, { maxPerMinute: 30, aggregate: true });
        if (event.data.pressAt) log.sampled('skyline_invaders.mat.press_to_shot_ms', { ...correlation, ms: Date.now() - event.data.pressAt }, { maxPerMinute: 12, aggregate: true });
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

  // Gamepad B pauses, as Escape does.
  useGamepadKeys(phase === 'playing', (key) => { if (key === 'Escape') pause('player'); });

  // ── Lifecycle: workout pause, session end, hidden page ────────────────────
  useEffect(() => {
    registerLifecycle({
      onPause: () => pause('lifecycle'),
      // Also runs on mount and whenever the video is not paused: only undo a lifecycle pause.
      onResume: () => { if (phaseRef.current === 'paused' && pausedByRef.current === 'lifecycle' && !soundOpenRef.current) resume('lifecycle'); },
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

  // ── The Sound sheet ───────────────────────────────────────────────────────
  // Opened by the touch "more" button, Sound on the pause screen, or bike
  // button 2 there. Mid-round it pauses first, and Back lands on the pause
  // screen. It covers whatever screen it was opened over, which stays mounted.
  const openSound = useCallback((source) => {
    const from = phaseRef.current;
    if (soundOpenRef.current || !SOUND_PHASES.includes(from)) return;
    if (from === 'playing') pause('player');
    soundOpenRef.current = true;
    setSoundOpen(true);
    log.info('skyline_invaders.settings.opened', { phase: from, source, runId: roundRef.current?.runId || null });
  }, [log, pause]);
  const closeSound = useCallback((source) => {
    if (!soundOpenRef.current) return;
    soundOpenRef.current = false;
    setSoundOpen(false);
    log.info('skyline_invaders.settings.closed', { phase: phaseRef.current, source, level: volumeRef.current.level, muted: volumeRef.current.muted });
  }, [log]);
  const setSoundLevel = useCallback((level, control) => {
    const next = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
    volumeRef.current.setLevel(next);
    log.info('skyline_invaders.audio.level_set', { level: next, control });
  }, [log]);
  const stepSound = useCallback((delta, control) => {
    const now = volumeRef.current;
    if (delta < 0 && (now.muted || now.level <= 0)) return;
    if (delta > 0 && now.level >= 100 && !now.muted) return;
    setSoundLevel(now.level + delta, control);
  }, [setSoundLevel]);
  const toggleSound = useCallback((control) => {
    const now = volumeRef.current;
    now.toggleMute();
    log.info('skyline_invaders.audio.mute_toggled', { muted: !now.muted, control });
  }, [log]);

  // ── Grown-up unlocks ──────────────────────────────────────────────────────
  const cancelPrompt = useCallback(() => {
    unlockGenerationRef.current += 1;
    setPrompt(null);
    live.current.clearUnlock?.();
  }, []);
  const requestAdminOverride = useCallback(async () => {
    const riderId = live.current.shooterId;
    if (!riderId) return;
    const { key, learners } = live.current.access;
    const generation = ++unlockGenerationRef.current;
    setPrompt({ kind: 'access' });
    log.info('skyline_invaders.access.override_requested', { riderId, learners });
    const result = await live.current.registerAdmin(MODULE_ID);
    if (generation !== unlockGenerationRef.current) return;
    if (!result?.matched || !result.userId) {
      log.info('skyline_invaders.access.override_denied', { riderId, learners, reason: result?.reason || 'denied' });
      return;   // the prompt shows the denial; Cancel or its timeout closes it
    }
    // The admin authorizes; the shooter stays the player and the one who is paid.
    setAccessOverride({ key, riderId, adminUserId: result.userId });
    setPrompt(null);
    live.current.clearUnlock?.();
    log.info('skyline_invaders.access.override_granted', { riderId, learners, adminUserId: result.userId });
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

  // ── Who is shooting, which wave ───────────────────────────────────────────
  const pickShooter = useCallback((userId) => {
    const now = live.current;
    if (now.mat) now.session?.setEquipmentUser?.(now.mat.equipmentId, userId);
    setPickedShooter(userId);
    setChoosingShooter(false);
    setRosterOpen(false);
    log.info('skyline_invaders.lobby.shooter_picked', { shooterId: userId, matEquipmentId: now.mat?.equipmentId || null, previous: now.shooterId });
  }, [log]);
  const chooseLevel = useCallback((levelId) => {
    setChosenLevelId(levelId);
    log.info('skyline_invaders.lobby.level_chosen', { levelId, shooterId: live.current.shooterId });
  }, [log]);
  // Start: the Ready screen (stand on the mat, reach left, now right) unless
  // this shooter's reach is already known or there is no camera to aim with,
  // in which case straight to the countdown with gamepad aim.
  const startRound = useCallback((target) => {
    const pose = poseStatusRef.current.state;
    if (tracker.calibration() || pose === 'camera-denied' || pose === 'error') { begin(target); return; }
    if (target) setChosenLevelId(target.id);
    log.info('skyline_invaders.lobby.calibration_opened', { shooterId: live.current.shooterId, pose });
    goPhase('calibrating');
  }, [begin, goPhase, log, tracker]);
  const onPoseStatus = useCallback((next) => setPoseStatus(next), []);

  // ── The screen ────────────────────────────────────────────────────────────
  // The lock: shown instead of the wave list while the riders' school day
  // keeps the round shut; never while the verdict is loading, never over the picker.
  const locked = !!shooterId && !choosingShooter && !accessGranted && access.status !== 'loading';
  let screen = null;
  if (soundOpen) screen = 'sound';
  else if (phase === 'loading' || phase === 'error' || phase === 'paused' || phase === 'result') screen = phase;
  else if (phase === 'calibrating') screen = 'ready';
  else if (phase === 'lobby') screen = !shooterId || choosingShooter ? (rosterOpen ? 'roster' : 'who') : locked ? 'locked' : 'waves';
  const rows = useMemo(() => waveRows(levels, riderWorld), [levels, riderWorld]);
  const cursorRow = rows.find((row) => row.id === chosenLevelId) || rows.find((row) => row.id === level?.id) || rows[0] || null;
  const record = saveState.record;
  const nextLevel = record?.run.status === 'completed'
    ? levels.slice(levels.findIndex((item) => item.id === record.run.level_id) + 1).find((item) => riderWorld?.levels?.find((entry) => entry.id === item.id)?.status !== 'locked') || null
    : null;
  const avatarOf = (id) => DaylightImagePath(`users/${id}`);
  const rosterPerson = people.length ? { ...people[((rosterIndex % people.length) + people.length) % people.length] } : null;
  if (rosterPerson) rosterPerson.avatarSrc = avatarOf(rosterPerson.id);
  const view = {
    screen,
    riders: riders.map((rider) => ({ ...rider, avatarSrc: avatarOf(rider.id) })),
    person: rosterPerson,
    count: rows.length,
    wave: screen === 'result' ? roundRef.current?.level || level : cursorRow,
    shooterName: shooterId ? nameOf(shooterId) : '',
    mat: !!mat,
    gamepad: gamepadConnected,
    saveStatus: saveState.status,
    next: nextLevel,
    sound: { level: gameVolume.level, muted: gameVolume.muted },
  };
  const viewRef = useRef(view);
  viewRef.current = view;

  // ── One press, from any input ─────────────────────────────────────────────
  const act = (action, source) => {
    const now = live.current;
    log.info('skyline_invaders.control.action', { action, screen: viewRef.current.screen, source, shooterId: now.shooterId });
    if (action.startsWith('pick:')) { pickShooter(action.slice(5)); return; }
    const people_ = peopleRef.current;
    const at = (row, delta) => {
      const list = rowsRef.current;
      const index = Math.max(0, list.findIndex((item) => item.id === row?.id));
      return list[(index + delta + list.length) % list.length];
    };
    switch (action) {
      case 'open-roster': setRosterOpen(true); setRosterIndex(0); setRosterCursor(false); break;
      case 'roster-prev': setRosterIndex((index) => index - 1); setRosterCursor(true); break;
      case 'roster-next': setRosterIndex((index) => index + 1); setRosterCursor(true); break;
      case 'close-roster': setRosterOpen(false); break;
      case 'roster-choose': { const person = viewRef.current.person; if (person && people_.length) pickShooter(person.id); break; }
      case 'wave-prev': case 'wave-next': { const next = at(viewRef.current.wave, action === 'wave-next' ? 1 : -1); if (next) chooseLevel(next.id); break; }
      case 'change-shooter':
        if (phaseRef.current === 'result') toLobby();
        setChoosingShooter(true); setRosterOpen(false);
        break;
      case 'start': startRound(now.levels.find((item) => item.id === viewRef.current.wave?.id)); break;
      case 'unlock-wave': { const target = now.levels.find((item) => item.id === viewRef.current.wave?.id); if (target) void requestLevelUnlock(target); break; }
      case 'admin-unlock': void requestAdminOverride(); break;
      case 'back-to-waves': goPhase('lobby'); break;
      case 'skip-calibration': begin(); break;
      case 'resume': resume(source); break;
      case 'open-sound': openSound(source); break;
      case 'end-round': void finalize(false); break;
      case 'replay': begin(roundRef.current?.level); break;
      case 'next-wave': if (viewRef.current.next) begin(viewRef.current.next); break;
      case 'waves': toLobby(); break;
      case 'retry-save': { const saved = live.current.saveState.record; if (saved) void finalize(saved.run.status !== 'abandoned', saved); break; }
      case 'quieter': stepSound(-10, source); break;
      case 'louder': stepSound(10, source); break;
      case 'close-sound': closeSound(source); break;
      case 'toggle-mute': toggleSound(source); break;
      case 'retry-load': setLoadAttempt((attempt) => attempt + 1); break;
      default: break;
    }
  };
  const actRef = useRef(act);
  actRef.current = act;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const press = useCallback((position, gesture, source) => {
    if (live.current.prompt) {
      // While the fingerprint prompt is up, the only press that acts is the way out.
      if (position === 3) cancelPrompt();
      return;
    }
    const action = invadersAction(viewRef.current, position, gesture);
    if (action) actRef.current(action, source);
  }, [cancelPrompt]);

  // Keyboard, foot pad and gamepad on a menu screen (the digits are the kiosk OS's).
  const menuActive = !!screen && !['loading'].includes(screen);
  useMenuInput(menuActive || !!prompt, (action, source) => {
    if (live.current.prompt) { if (action === 'back') cancelPrompt(); return; }
    const hit = pressForMenuKey(viewRef.current.screen, action);
    if (hit) press(hit[0], hit[1], source);
  });

  // A stomp on the shooter's mat: Start on the wave list, go on after a saved round.
  const subscribeToAppEvent = ctx?.subscribeToAppEvent;
  const stompArmed = screen === 'waves' || (screen === 'result' && saveState.status === 'saved');
  useEffect(() => {
    if (!stompArmed || !subscribeToAppEvent) return undefined;
    return subscribeToAppEvent('pressure-mat:stomp', (event) => {
      const matId = live.current.mat?.matId;
      if (matId && String(event?.payload?.id ?? event?.source) !== String(matId)) return;
      if (live.current.prompt) return;
      const action = stompAction(viewRef.current);
      if (action) actRef.current(action, 'stomp');
    });
  }, [stompArmed, subscribeToAppEvent]);

  // Ready: the camera went away, or never came up: play with gamepad aim.
  useEffect(() => {
    if (phase !== 'calibrating') return undefined;
    if (['camera-denied', 'error'].includes(poseStatus.state)) { begin(); return undefined; }
    if (poseStatus.state !== 'loading') return undefined;
    const timer = setTimeout(() => {
      log.info('skyline_invaders.lobby.calibration.camera_timeout', { waitedMs: READY_CAMERA_WAIT_MS });
      begin();
    }, READY_CAMERA_WAIT_MS);
    return () => clearTimeout(timer);
  }, [phase, poseStatus.state, begin, log]);

  // ── Render ────────────────────────────────────────────────────────────────
  const inRound = ROUND_PHASES.includes(phase);
  const idle = useMemo(() => (level ? createGameState(level, { seed: 1 }) : null), [level]);
  const sceneState = game || idle;
  const sample = tracker.sample();
  const partner = boost.partner ? { ...boost.partner, name: nameOf(boost.partner.riderId) } : null;
  const testId = phase === 'loading' ? 'skyline-invaders-loading' : inRound || phase === 'result' ? 'skyline-invaders-play' : 'skyline-invaders';
  const controls = prompt
    ? invadersControls(view).map((control) => (control.position === 3
      ? { ...control, label: 'Cancel', hint: 'Back to the game', icon: '×', avatarSrc: null, disabled: false }
      : { ...control, label: 'Admin fingerprint', hint: 'Waiting', icon: '—', avatarSrc: null, disabled: true }))
    : invadersControls(view);

  // Touch keys: the screen's real actions. People are tiles on Who and the
  // roster, and the Sound sheet has its own strip and Mute, so those screens
  // keep only Back as a key.
  const touchKeys = controls.filter((control) => control.icon !== '—'
    && (screen !== 'who' || !!prompt) && (!['roster', 'sound'].includes(screen) || control.position === 3));
  const everyone = people.map((person) => ({ ...person, avatarSrc: avatarOf(person.id) }));

  return (
    <main
      className={`skyline-invaders skyline-invaders--${phase}`}
      data-testid={testId}
      data-phase={phase}
      data-screen={screen || undefined}
      data-run-role={projectRunRole(phase, ROLE_MAP)}
      data-level-id={level?.id || undefined}
      data-shooter-id={shooterId || undefined}
    >
      {/* Mounted for the whole life of the game, so the model loads while the players are choosing. */}
      <InvadersPoseBridge tracker={tracker} enabled onStatus={onPoseStatus} />

      {sceneState && level && (
        <InvadersScene
          state={sceneState} level={level} aim={game ? aimRef.current : 0.5} tier={tierRef.current.tier}
          twin={sceneState.boost?.active?.kind === 'twin'} effects={effects}
        />
      )}
      {inRound && game && (
        <InvadersHud
          state={game} level={level} tier={tierRef.current} aimStatus={{ lost: sample.lost, mode: sample.mode }}
          poseStatus={poseStatus} partner={partner} shooterName={nameOf(shooterId)}
        />
      )}
      {inRound && <MomentBanner text={effects.banner?.text || null} momentKey={effects.banner?.key} className="skyline-invaders__banner" />}
      {phase === 'playing' && !prompt && (
        <button type="button" className="skyline-invaders__pause" data-testid="skyline-invaders-pause" onClick={() => pause('player')}>Pause</button>
      )}
      {phase === 'countdown' && <CountdownOverlay value={countdown} className="skyline-invaders__countdown" />}

      {screen && (
        <section className="skyline-menu-screen skyline-invaders__menu" data-testid="skyline-invaders-menu" aria-label="Skyline Invaders menu">
          {/* Bottom-right of the screen, clear of the window, the panel and the HUD. */}
          {SOUND_SCREENS.includes(screen) && !prompt && <MoreButton onMore={() => openSound('touch')} className="skyline-invaders__more" />}
          <div className="skyline-invaders__window">
            {screen === 'ready' && <InvadersCalibration tracker={tracker} poseStatus={poseStatus} waveName={level?.name || ''} onDone={() => { setCalibrated(true); begin(); }} />}
            {screen === 'result' && record && <InvadersResult record={record} saveStatus={saveState.status} level={roundRef.current?.level || level} />}
            {!['ready', 'result'].includes(screen) && (
              <InvadersMenus
                screen={screen} riders={view.riders} person={rosterCursor ? rosterPerson : null} rows={rows} selectedId={cursorRow?.id || null}
                onSelect={(id) => chooseLevel(id)} shooterName={view.shooterName}
                everyone={everyone} onPick={(id) => actRef.current(`pick:${id}`, 'touch')} onSomeoneElse={() => actRef.current('open-roster', 'touch')}
                state={access.state} blockedNames={access.blockedBy.map(nameOf)}
                reason={pausedByRef.current} waveName={roundRef.current?.level?.name || ''} error={error}
                sound={{
                  level: gameVolume.level, muted: gameVolume.muted,
                  onLevel: (next) => setSoundLevel(next, 'touch'), onToggleMute: () => toggleSound('touch'),
                }}
              />
            )}
            <InvadersTouchKeys keys={touchKeys} onPress={(position) => press(position, 'single', 'touch')} />
          </div>
        </section>
      )}

      <UnlockPrompt
        open={!!prompt} state={unlockState} unlockedUser={unlockedUser} onCancel={cancelPrompt}
        lockLabel={prompt?.kind === 'level' ? prompt.name : 'Skyline Invaders'}
      />
    </main>
  );
}
