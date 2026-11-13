import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { GESTURES, GESTURE_INFO, isGesture } from '../../lib/skylineInvaders/gestures.js';
import { laneAim, laneX } from '../../lib/skylineInvaders/lanes.js';
import { EMPTY_EFFECTS, INVADERS_LOG_NAMES, buildInvadersEffectTable, invadersSoundUrls } from '../../lib/skylineInvaders/invadersEffects.js';
import { validateLevel } from '../../lib/skylineInvaders/levels.js';
import { listInvadersMats, selectInvadersMat } from '../../lib/skylineInvaders/matSelection.js';
import { gateLearnerIds, listInvadersPeople, listSessionRiderIds } from '../../lib/skylineInvaders/people.js';
import { buildSkylineInvadersRun } from '../../lib/skylineInvaders/runResult.js';
import { aimToX } from '../../lib/skylineInvaders/threats.js';
import { MANUAL_METHOD, setupStepId, setupTargets } from '../../lib/skylineInvaders/setupTest.js';
import { TRYOUT_TARGET_CODES, createTraceRecorder } from '../../lib/skylineInvaders/traceRecorder.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { invadersAction, invadersControls, pressForMenuKey, stompAction } from '../../lib/skylineInvaders/invadersPanel.js';
import { resolveLevelId, waveRows } from '../../lib/skylineInvaders/waves.js';
import { useSkylineGroupAccess } from '../SkylineGlider/useSkylineAccess.js';
import { CountdownOverlay, MomentBanner } from '../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
import { announceGameAchievement, createEffectDispatcher, createFrameDriver } from '../../../../../../__capabilities/gaming/browser/platform/realtime/index.js';
import { projectRunRole } from '../../../../../../__capabilities/gaming/portable/realtime/index.mjs';
import InvadersHud from './InvadersHud.jsx';
import InvadersMenus, { InvadersTouchKeys } from './InvadersMenus.jsx';
import InvadersPoseBridge from './InvadersPoseBridge.jsx';
import InvadersReady from './InvadersReady.jsx';
import InvadersResult from './InvadersResult.jsx';
import InvadersScene from './InvadersScene.jsx';
import useInvadersAim from './useInvadersAim.js';
import useInvadersBoost from './useInvadersBoost.js';
import useInvadersFire from './useInvadersFire.js';
import useInvadersSetup, { SETUP_METHODS } from './useInvadersSetup.js';
import useMenuInput from './useMenuInput.js';
import './SkylineInvaders.scss';

// The Skyline Invaders shell: loads the levels, runs the menu screens, drives
// the engine from a frame loop, and saves the round.
//
// Phases: loading -> lobby -> ready -> countdown -> playing <-> paused ->
// result (-> lobby or another countdown); `error` from loading. Every phase
// has a way out of the game (`onClose`, from FitnessModuleContainer),
// including a touch Exit key during the round itself.
// Every menu screen is one decision on Skyline Glider's window, as touch keys
// (lib/skylineInvaders/invadersPanel.js): who (riders) / roster (others),
// waves, locked (school day), ready (stand in view), paused, result, sound,
// and the setup: method (how you aim) and sweep (test it: go left, go right,
// stomp). The setup, like the Sound sheet, covers the lobby or a paused round
// without changing the phase. Start goes through it until the defender's
// method has passed its test in this visit.
//
// What a frame reads (aim, cadence, queued presses) comes from refs and
// hooks that never re-render the game: the pose runs at its own rate, as low
// as 13 a second, and the round must play the same whatever that rate is.

const API = '/api/v1/fitness/skyline-invaders';
const MODULE_ID = 'skyline_invaders';
const CAPABILITY_ID = 'fitness.skyline-invaders';
const ROLE_MAP = Object.freeze({ loading: 'ready', lobby: 'ready', ready: 'ready', error: 'ready' });
const ROUND_PHASES = Object.freeze(['countdown', 'playing', 'paused']);
// Where the Sound sheet can be opened: every screen a player can stop on. Not
// mid-countdown (three seconds) and not over Ready or the setup, which read the pose.
const SOUND_PHASES = Object.freeze(['lobby', 'paused', 'result']);
const SOUND_SCREENS = Object.freeze(['who', 'roster', 'waves', 'locked', 'paused', 'result']);
// Ready waits this long for a camera that is still starting, then plays with gamepad aim.
const READY_CAMERA_WAIT_MS = 20_000;
const COUNTDOWN_FROM = 3;
const HEALTH_EVERY_MS = 20_000;   // the log ingest allows three of one event a minute
const STICK_DEAD_ZONE = 0.2;
// A touch Exit that appeared under the finger this recently is not pressed: the
// tap (or second tap) that changed the screen must not leave the game from the next one.
const FRESH_EXIT_MS = 450;
const REWARD_COLOR = '#7bd88f';
const POSE_CONFIG = Object.freeze({
  temporalSmoothing: false, maxPoses: 1, modelType: INVADERS_TUNABLES.poseModelType,
  ...(INVADERS_TUNABLES.poseBackend ? { backend: INVADERS_TUNABLES.poseBackend } : {}),
});

const mediaUrl = (path) => DaylightMediaPath(`/media/${path}`);
/** A method by name: an aim gesture's label, or Gamepad. */
const methodLabel = (method) => (method === MANUAL_METHOD ? 'Gamepad' : GESTURE_INFO[method]?.label || '');
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
const readPads = () => { try { return Array.from(navigator.getGamepads?.() || []).filter(Boolean); } catch { return []; } };
// Gamepad Start (standard button 9) pauses a round; Select (button 8) leaves the game.
const startPressed = () => readPads().some((pad) => !!pad.buttons?.[9]?.pressed);
const selectPressed = () => readPads().some((pad) => !!pad.buttons?.[8]?.pressed);

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

function SkylineInvadersGame({ onClose }) {
  const ctx = useFitnessContext();
  const { registerAdmin, clearUnlock, unlockState, unlockedUser } = useIdentity();
  const { registerLifecycle } = useFitnessModule(MODULE_ID);
  const log = useMemo(() => getLogger().child({ app: 'fitness', component: 'skyline-invaders' }), []);
  const tracker = useInvadersAim();
  // The setup (choose a method, then the test sweep). Its callbacks are defined
  // further down and reached through this ref, so none goes stale.
  const setupHandlers = useRef({});
  const setup = useInvadersSetup({
    tracker,
    onPassed: (passed) => setupHandlers.current.passed?.(passed),
    onEvent: (name, data) => setupHandlers.current.event?.(name, data),
    onTick: (tick) => setupHandlers.current.tick?.(tick),
  });
  const setupRef = useRef(setup);
  setupRef.current = setup;

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
  // Likewise the method cursor: shown once a key or the gamepad is driving the setup.
  const [methodCursor, setMethodCursor] = useState(false);
  const methodCursorRef = useRef(methodCursor);
  methodCursorRef.current = methodCursor;
  const gamepadConnected = useGamepadConnected();
  const [game, setGame] = useState(null);
  const [effects, setEffects] = useState(EMPTY_EFFECTS);
  const [poseStatus, setPoseStatus] = useState({ state: 'loading' });
  // Methods picked this visit, by defender: shown at once, and kept if the save fails.
  // 'gamepad' (aim on the stick or the arrows) is a choice for this visit only.
  const [pickedControls, setPickedControls] = useState({});
  // The method each defender has passed the test sweep with in this visit. Start
  // goes through the setup until it matches their method.
  const [verified, setVerified] = useState({});
  // In a round: the cannon is not following (`lost`, `stuck`), with the way back to the setup.
  const [aimHelp, setAimHelp] = useState(null);
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
  // The joint recorder: pose and shot traces, batched, for comparing the gestures from data.
  const recorder = useMemo(() => createTraceRecorder({ emit: (name, data) => log.info(name, data) }), [log]);
  const setupIdRef = useRef(null);
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

  // How the defender aims is their own: an aim gesture chosen and tested in the
  // setup and saved with their progress, or the gamepad for this visit.
  const stored = shooterId ? pickedControls[shooterId] || riderWorld?.controls?.gesture : null;
  const method = isGesture(stored) || stored === MANUAL_METHOD ? stored : null;
  const gesture = isGesture(method) ? method : null;
  const cameraOff = poseStatus.state === 'camera-denied' || poseStatus.state === 'error';

  const drainFire = useInvadersFire({
    enabled: phase === 'playing', matId: mat?.matId || null,
    subscribeToAppEvent: ctx?.subscribeToAppEvent, tracker,
  });

  // Callbacks read the current render through this, so none of them goes stale
  // and none of them restarts the frame loop.
  const live = useRef({});
  live.current = { session, shooterId, mat, level, levels, riderWorld, access, accessGranted, boost, drainFire, saveState, registerAdmin, clearUnlock, nameOf, prompt, gesture, method, verified, onClose };

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
      recorder.end('unmount');
      log.info('skyline_invaders.unmounted', { phase: phaseRef.current, runId: roundRef.current?.runId || null });
    };
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, recorder]);

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

  // The tracker plays the defender's method: their gesture (the default when
  // they have none yet), or the gamepad. The setup switches it while it is open.
  useEffect(() => {
    if (setup.open) return;
    tracker.setManual(method === MANUAL_METHOD);
    tracker.setGesture(gesture || INVADERS_TUNABLES.defaultGesture);
  }, [tracker, gesture, method, setup.open]);

  // A different defender has their own controls and their own place on the level map.
  const priorShooterRef = useRef(shooterId);
  useEffect(() => {
    if (priorShooterRef.current === shooterId) return;
    priorShooterRef.current = shooterId;
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
    // A setup left open over a round that ended (session end, access revoked) does not outlive it.
    if (setupRef.current.open) setupRef.current.actions.close();
    goPhase('lobby');
  }, [goPhase]);

  const begin = useCallback((target) => {
    const now = live.current;
    const next = target || now.level;
    if (!next || !now.shooterId) return;
    // An unsaved round is never played over.
    if (['saving', 'error'].includes(now.saveState.status)) return;
    if (!now.accessGranted) { toLobby(); return; }
    if (setupRef.current.open) setupRef.current.actions.close();
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
      recorder.begin({ kind: 'round', runId: started.runId, levelId: next.id, shooterId: started.shooterId, gesture: started.gesture, seed });
      log.info('skyline_invaders.level.start', {
        runId: started.runId, levelId: next.id, seed, shooterId: started.shooterId,
        partnerId: live.current.boost.readPartner()?.riderId || null,
        gesture: started.gesture, gestureChosen: !!live.current.gesture, aimMode: tracker.sample().mode, lane: tracker.sample().lane,
        matId: started.mat?.matId || null, cannons: next.cannons, durationS: next.duration_s,
        pose: poseStatusRef.current.state, poseFps: poseStatusRef.current.fps ?? null,
      });
    }, 1000);
  }, [goPhase, log, toLobby, tracker, recorder]);

  const poseStatusRef = useRef(poseStatus);
  poseStatusRef.current = poseStatus;

  const finalize = useCallback(async (ended, retryRecord = null, { then = null } = {}) => {
    const current = roundRef.current;
    if (!current || finalizingRef.current) return false;
    finalizingRef.current = true;
    clearInterval(countdownTimerRef.current);
    setCountdown(null);
    live.current.drainFire.clear();
    if (!retryRecord) recorder.end(ended ? 'round-end' : 'abandoned');
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
    if (setupRef.current.open) setupRef.current.actions.close();
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
  }, [goPhase, log, refreshWorld, toLobby, tracker, recorder]);

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
    const held = { left: false, right: false, start: startPressed(), select: selectPressed() };
    // Aim help: how long the defender has been out of view, and how long the
    // cannon has stood in one lane while they are in view (game seconds).
    const help = { lane: null, laneAt: 0, lostAt: null, shown: null };
    setAimHelp(null);
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
      const select = selectPressed();
      if (select && !held.select) { held.select = true; exitRef.current?.('gamepad'); return; }
      held.select = select;
      // Either way the cannon stands on a lane: `x` is its centre.
      const sample = tracker.sample();
      const axis = readAimAxis(held);
      if (sample.mode === 'manual' || (sample.lost && axis !== 0)) tracker.setAim(manualAim(sample.raw, axis, elapsedS));
      else if (sample.lost) tracker.setAim(driftAim(sample.raw, previous.threats, elapsedS));
      const aimNow = tracker.sample();
      // The cannon not following: out of view for a while, or in view with the
      // cannon stuck in one lane. Said on screen, with the way back to the setup.
      {
        const watching = now.method !== MANUAL_METHOD && poseStatusRef.current.state === 'detecting';
        const t = previous.time;
        if (aimNow.lost) { help.lostAt ??= t; help.lane = null; } else help.lostAt = null;
        if (aimNow.lane !== help.lane) { help.lane = aimNow.lane; help.laneAt = t; }
        const kind = !watching ? null : help.lostAt !== null && t - help.lostAt >= INVADERS_TUNABLES.aimHelpLostS ? 'lost'
          : !aimNow.lost && aimNow.mode === 'pose' && t - help.laneAt >= INVADERS_TUNABLES.aimHelpStuckS ? 'stuck' : null;
        if (kind !== help.shown) {
          help.shown = kind;
          setAimHelp(kind);
          if (kind) log.info('skyline_invaders.round.aim_help', { ...correlation, kind, gesture: aimNow.gesture, lane: aimNow.lane, time: t });
        }
      }
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
      if (presses.steps.some((press) => press.source === 'mat') || presses.stomps.some((press) => press.source === 'mat')) recorder.step();
      recorder.pose(tracker.frame(), aimNow, { cannonX: aimToX(aimNow.x) });
      for (const event of next.events) {
        if (event.type === 'shot.fired') {
          if (current.tally[event.data.source] !== undefined) current.tally[event.data.source] += 1;
          recorder.volleyFired(event.data, aimNow);
        } else if (event.type === 'volley.settled') recorder.volleySettled(event.data.volley, event.data.hit);
        else if (event.type === 'fuel.added') {
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
  }, [phase, finalize, log, pause, tracker, recorder]);

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
    else recorder.end('exit');
    live.current.onClose?.();
  }, [finalize, log, recorder]);

  const exitRef = useRef(exit);
  exitRef.current = exit;

  // ── Lifecycle: workout pause, session end, hidden page ────────────────────
  useEffect(() => {
    registerLifecycle({
      onPause: () => pause('lifecycle'),
      // Also runs on mount and whenever the video is not paused: only undo a lifecycle pause.
      onResume: () => { if (phaseRef.current === 'paused' && pausedByRef.current === 'lifecycle' && !soundOpenRef.current && !setupRef.current.open) resume('lifecycle'); },
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
  // ── The setup: choose a method, then test it ─────────────────────────────
  // Opened by Start until the defender's method has passed its test in this
  // visit, by the Controls key on the wave list, and by Controls on the pause
  // screen (or the aim-help key in a round, which pauses first). The mat does
  // nothing here except as the sweep's fire step.
  // A sweep's pose trace (kind `tryout`) runs only outside a round; over a paused round the round's trace stays open.
  const endSweepTrace = (reason) => { if (setupRef.current.from !== 'paused') recorder.end(reason); };
  const openSetup = useCallback((from, source) => {
    const now = live.current;
    setupIdRef.current = newRunId();
    log.info('skyline_invaders.setup.opened', {
      setupId: setupIdRef.current, from, source, shooterId: now.shooterId, current: now.method,
      verified: now.verified[now.shooterId] || null, pose: poseStatusRef.current.state, runId: roundRef.current?.runId || null,
    });
    setMethodCursor(source === 'key' || source === 'gamepad');
    setupRef.current.actions.open(from, now.method);
  }, [log]);
  const closeSetup = useCallback((how) => {
    const now = setupRef.current;
    if (!now.open) return;
    endSweepTrace('tryout-closed');
    log.info('skyline_invaders.setup.closed', { setupId: setupIdRef.current, from: now.from, stage: now.stage, how, method: now.method, shooterId: live.current.shooterId });
    now.actions.close();
  }, [log, recorder]);
  const chooseMethod = useCallback((picked, how) => {
    const now = setupRef.current;
    if (!SETUP_METHODS.includes(picked)) return;
    log.info('skyline_invaders.setup.method_chosen', { setupId: setupIdRef.current, shooterId: live.current.shooterId, method: picked, how, previous: live.current.method });
    // Over a paused round the recorder keeps the round's own trace: a sweep there is not recorded.
    if (picked !== MANUAL_METHOD && now.from !== 'paused') recorder.begin({ kind: 'tryout', runId: setupIdRef.current, levelId: null, shooterId: live.current.shooterId, gesture: picked, card: GESTURES.indexOf(picked) });
    now.actions.choose(picked);
  }, [log, recorder]);
  // The method passed its test (or the gamepad was chosen): it is theirs, and verified for this visit.
  setupHandlers.current.passed = (passed) => {
    const now = live.current;
    const { from } = setupRef.current;
    const riderId = now.shooterId;
    const previous = now.method;
    endSweepTrace('tryout-chosen');
    setupRef.current.actions.close();
    if (!riderId) return;
    setPickedControls((current) => ({ ...current, [riderId]: passed }));
    setVerified((current) => ({ ...current, [riderId]: passed }));
    tracker.setManual(passed === MANUAL_METHOD);
    if (isGesture(passed)) tracker.setGesture(passed);
    log.info('skyline_invaders.setup.passed', { setupId: setupIdRef.current, shooterId: riderId, method: passed, from, runId: roundRef.current?.runId || null });
    if (roundRef.current && from === 'paused') roundRef.current.gesture = isGesture(passed) ? passed : roundRef.current.gesture;
    if (passed !== previous) void saveMethod(riderId, passed, previous);
    // From Start the round begins: the defender has just been seen doing it.
    if (from === 'start' && phaseRef.current === 'lobby') begin();
  };
  setupHandlers.current.event = (name, data) => {
    const payload = { setupId: setupIdRef.current, shooterId: live.current.shooterId, ...data };
    if (name === 'step' && data.result === 'timeout') log.warn('skyline_invaders.setup.step', payload);
    else log.info(`skyline_invaders.setup.${name}`, payload);
  };
  setupHandlers.current.tick = ({ sample, test }) => {
    recorder.pose(tracker.frame(), sample, { cannonX: laneX(sample.lane), target: TRYOUT_TARGET_CODES[test.status === 'running' ? setupStepId(test) : null] || 0 });
  };
  const saveMethod = async (riderId, picked, previous) => {
    let saved = false;
    let error = null;
    // The gamepad is a choice for this visit: the saved method stays a gesture.
    if (isGesture(picked)) {
      try {
        const response = await postJson(`${API}/progress/${encodeURIComponent(riderId)}/controls`, { gesture: picked });
        if (!response.ok) throw new Error(`controls save failed (${response.status})`);
        saved = true;
      } catch (saveError) {
        error = saveError.message;
      }
    }
    log[error ? 'warn' : 'info']('skyline_invaders.setup.method_changed', { setupId: setupIdRef.current, shooterId: riderId, method: picked, label: GESTURE_INFO[picked]?.label || 'Gamepad', previous, saved, error });
    if (saved) await refreshWorld(riderId);
  };

  // Start: through the setup until the defender's method has passed its test
  // in this visit; then the Ready screen (stand on the mat where the camera can
  // see you). With no camera to aim with, straight to the countdown with
  // gamepad aim, and the same for a defender who chose the gamepad.
  const startRound = useCallback((target, source) => {
    const pose = poseStatusRef.current.state;
    if (pose === 'camera-denied' || pose === 'error') { begin(target); return; }
    if (target) setChosenLevelId(target.id);
    const now = live.current;
    if (!now.method || now.verified[now.shooterId] !== now.method) { openSetup('start', source); return; }
    if (now.method === MANUAL_METHOD) { begin(target); return; }
    log.info('skyline_invaders.lobby.ready_opened', { shooterId: now.shooterId, pose, gesture: tracker.gesture() });
    goPhase('ready');
  }, [begin, goPhase, log, tracker, openSetup]);
  const onPoseStatus = useCallback((next) => setPoseStatus(next), []);

  // ── The screen ────────────────────────────────────────────────────────────
  // The lock: shown instead of the wave list while the riders' school day
  // keeps the round shut; never while the verdict is loading, never over the picker.
  const locked = !!shooterId && !choosingShooter && !accessGranted && access.status !== 'loading';
  let screen = null;
  if (soundOpen) screen = 'sound';
  else if (setup.open && (phase === 'lobby' || phase === 'paused')) screen = setup.stage === 'sweep' ? 'sweep' : 'method';
  else if (phase === 'loading' || phase === 'error' || phase === 'paused' || phase === 'result') screen = phase;
  else if (phase === 'ready') screen = phase;
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
    canExit: !!onClose,
    cameraOff,
    controlsName: methodLabel(method),
    setupFrom: setup.from,
    sweep: setup.status,
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
      case 'start': startRound(now.levels.find((item) => item.id === viewRef.current.wave?.id), source); break;
      case 'unlock-wave': { const target = now.levels.find((item) => item.id === viewRef.current.wave?.id); if (target) void requestLevelUnlock(target); break; }
      case 'admin-unlock': void requestAdminOverride(); break;
      case 'back-to-waves': goPhase('lobby'); break;
      case 'skip-ready': begin(); break;
      case 'open-controls':
        // From a round: pause it first; the setup covers the pause screen.
        if (phaseRef.current === 'playing') pause('player');
        openSetup(phaseRef.current === 'paused' ? 'paused' : 'lobby', source);
        break;
      case 'method-prev': setupRef.current.actions.move(-1); setMethodCursor(true); break;
      case 'method-next': setupRef.current.actions.move(1); setMethodCursor(true); break;
      case 'method-choose':
        // Under touch no cursor is drawn: a key's first accept shows it, never chooses an unseen tile.
        if (!methodCursorRef.current) { setMethodCursor(true); break; }
        chooseMethod(setupRef.current.method, source);
        break;
      case 'setup-close': closeSetup(source); break;
      case 'sweep-retry': setupRef.current.actions.retry(); break;
      case 'sweep-other':
        endSweepTrace('tryout-closed');
        log.info('skyline_invaders.setup.other', { setupId: setupIdRef.current, shooterId: now.shooterId, method: setupRef.current.method, step: setupRef.current.test ? setupStepId(setupRef.current.test) : null, status: setupRef.current.status });
        setupRef.current.actions.other();
        break;
      case 'exit': exit(source); break;
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

  // When the touch keys last changed screen. On 2026-11-13 one tap on Start was
  // followed 6 ms later by Exit on the controls screen that Start opened, and the
  // game closed; a child's double-tap on the garage screen does the same.
  const screenShownAt = useRef(0);
  useLayoutEffect(() => { screenShownAt.current = performance.now(); }, [screen]);
  const pressTouchKey = useCallback((position) => {
    const sinceMs = Math.round(performance.now() - screenShownAt.current);
    if (position === 6 && sinceMs < FRESH_EXIT_MS) {
      log.info('skyline_invaders.control.ignored', { position, screen: viewRef.current.screen, sinceMs, reason: 'fresh-exit' });
      return;
    }
    press(position, 'single', 'touch');
  }, [press, log]);

  // Keyboard, foot pad and gamepad on a menu screen (the digits are the kiosk OS's).
  const menuActive = !!screen;
  useMenuInput(menuActive || !!prompt, (action, source) => {
    if (live.current.prompt) { if (action === 'back') cancelPrompt(); return; }
    // The sweep's fire step without a mat: accept (Space, Enter, gamepad A, the foot pad).
    if (viewRef.current.screen === 'sweep' && action === 'accept' && setupRef.current.actions.fire(source)) return;
    const hit = pressForMenuKey(viewRef.current.screen, action);
    if (hit) press(hit[0], hit[1], source);
  });

  // A stomp on the defender's mat: Start on the wave list, go on after a saved
  // round. Never on the setup screens, where the defender is standing on it.
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

  // The sweep's fire step: a step or a stomp on the defender's mat. Nothing else.
  const sweepArmed = screen === 'sweep';
  useEffect(() => {
    if (!sweepArmed || !subscribeToAppEvent) return undefined;
    const onPress = (kind) => (event) => {
      const matId = live.current.mat?.matId;
      if (matId && String(event?.payload?.id ?? event?.source) !== String(matId)) return;
      setupRef.current.actions.fire(`mat-${kind}`);
    };
    const offStep = subscribeToAppEvent('pressure-mat:step', onPress('step'));
    const offStomp = subscribeToAppEvent('pressure-mat:stomp', onPress('stomp'));
    return () => { offStep?.(); offStomp?.(); };
  }, [sweepArmed, subscribeToAppEvent]);

  // Ready: the camera went away, or never came up: play with gamepad aim.
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    if (['camera-denied', 'error'].includes(poseStatus.state)) { begin(); return undefined; }
    if (poseStatus.state !== 'loading') return undefined;
    const timer = setTimeout(() => {
      log.info('skyline_invaders.lobby.ready.camera_timeout', { waitedMs: READY_CAMERA_WAIT_MS });
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
  // keep only Back as a key (and Who its Exit). The methods are tiles too.
  const touchKeys = controls.filter((control) => control.icon !== '—'
    && (screen !== 'who' || !!prompt || control.position === 6)
    && (!['roster', 'sound', 'method'].includes(screen) || control.position === 3 || control.position === 6));
  // The setup as the menus draw it.
  const camera = poseStatus.state;
  const sweeping = screen === 'sweep';
  const setupView = {
    stage: setup.stage, cursor: methodCursor ? setup.cursor : null, method: setup.method, current: method, verified: verified[shooterId] || null,
    test: setup.test, status: setup.status, lost: setup.lost, leftS: setup.leftS, timeoutS: INVADERS_TUNABLES.setupStepTimeoutS, lane: setup.lane, mat: !!mat, from: setup.from,
    camera: camera === 'camera-denied' || camera === 'error' ? 'off' : camera !== 'detecting' ? 'starting' : 'on',
  };
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
          state={sceneState} level={level}
          aim={sweeping ? laneAim(setup.lane ?? 4) : game ? aimRef.current : 0.5}
          live={inRound || sweeping} targets={sweeping ? setupTargets(setup.test) : null}
          twin={sceneState.boost?.active?.kind === 'twin'} effects={effects}
        />
      )}
      {inRound && game && (
        <InvadersHud
          state={game} level={level} gesture={round?.gesture || null} aimStatus={{ lost: sample.lost, mode: sample.mode, manual: method === MANUAL_METHOD, help: phase === 'playing' ? aimHelp : null }}
          poseStatus={poseStatus} partner={partner}
        />
      )}
      {inRound && <MomentBanner text={effects.banner?.text || null} momentKey={effects.banner?.key} className="skyline-invaders__banner" />}
      {/* The round's own keys, on the street where nothing falls: Pause, and Exit (the round is saved as abandoned). */}
      {(phase === 'playing' || phase === 'countdown') && !prompt && (
        <div className="skyline-invaders__round-keys" role="group" aria-label="Round">
          {phase === 'playing' && <button type="button" className="skyline-invaders__pause" data-testid="skyline-invaders-pause" onClick={() => pause('player')}>Pause</button>}
          {onClose && <button type="button" className="skyline-invaders__round-key skyline-invaders__exit" data-testid="skyline-invaders-exit" onClick={() => exit('touch')}>Exit</button>}
        </div>
      )}
      {phase === 'playing' && aimHelp && !prompt && (
        <div className="skyline-invaders__aim-help" role="alert" data-testid="invaders-aim-help" data-kind={aimHelp}>
          <strong>{aimHelp === 'lost' ? 'Can’t see you' : 'Cannon not moving?'}</strong>
          <button type="button" className="skyline-invaders__round-key" data-testid="invaders-aim-help-controls" onClick={() => actRef.current('open-controls', 'touch')}>Controls</button>
        </div>
      )}
      {phase === 'countdown' && <CountdownOverlay value={countdown} className="skyline-invaders__countdown" />}

      {screen && (
        <section className="skyline-menu-screen skyline-invaders__menu" data-testid="skyline-invaders-menu" aria-label="Skyline Invaders menu">
          {/* Bottom-right of the screen, clear of the window, the panel and the HUD. */}
          {SOUND_SCREENS.includes(screen) && !prompt && <MoreButton onMore={() => openSound('touch')} className="skyline-invaders__more" />}
          <div className="skyline-invaders__window">
            {screen === 'ready' && <InvadersReady tracker={tracker} poseStatus={poseStatus} waveName={level?.name || ''} gesture={gesture} mat={!!mat} onDone={() => begin()} />}
            {screen === 'result' && record && <InvadersResult record={record} saveStatus={saveState.status} level={roundRef.current?.level || level} />}
            {!['ready', 'result'].includes(screen) && (
              <InvadersMenus
                screen={screen} riders={view.riders} person={rosterCursor ? rosterPerson : null} rows={rows} selectedId={cursorRow?.id || null}
                onSelect={(id) => chooseLevel(id)} shooterName={view.shooterName}
                everyone={everyone} onPick={(id) => actRef.current(`pick:${id}`, 'touch')} onSomeoneElse={() => actRef.current('open-roster', 'touch')}
                state={access.state} blockedNames={access.blockedBy.map(nameOf)}
                reason={pausedByRef.current} waveName={roundRef.current?.level?.name || ''} error={error} setup={setupView}
                onMethod={(picked) => chooseMethod(picked, 'touch')}
                sound={{
                  level: gameVolume.level, muted: gameVolume.muted,
                  onLevel: (next) => setSoundLevel(next, 'touch'), onToggleMute: () => toggleSound('touch'),
                }}
              />
            )}
            <InvadersTouchKeys keys={touchKeys} onPress={pressTouchKey} />
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
