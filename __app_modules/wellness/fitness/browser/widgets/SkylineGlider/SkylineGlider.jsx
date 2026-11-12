import SkylineControlPanel from './SkylineControlPanel.jsx';
import { announceGameAchievement } from "../../../../../../__capabilities/gaming/browser/platform/realtime/index.js";
import SkylineMenus, { crashReason } from './SkylineMenus.jsx';
import { useSkylineController } from './useSkylineController.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from "../../context/FitnessContext.jsx";
import getLogger from '@/lib/logging/Logger.js';
import { validateCourse, resolveCalibration } from "../../lib/skylineGlider/courseModel.js";
import { createFlightState, stepFlight, retryFlightCheckpoint } from "../../lib/skylineGlider/flightEngine.js";
import { weaponPower } from "../../lib/skylineGlider/weaponPower.js";
import { cameraTime } from "../../lib/skylineGlider/liftBoost.js";
import { scoresAsTarget, weaponRefusal, weaponRules } from "../../lib/skylineGlider/weapons.js";
import { collectFlightTelemetry } from "../../lib/skylineGlider/flightTelemetry.js";
import { EMPTY_ZONE_ASSETS, loadZoneAssets } from "../../lib/skylineGlider/zoneAssets.js";
import { createSkylineAudio } from "../../lib/skylineGlider/skylineAudio.js";
import { clearFlightCheckpoint, readFlightCheckpoint, writeFlightCheckpoint } from "../../lib/skylineGlider/checkpointRepository.js";
import { buildSkylineGliderRun, countTargets } from "../../lib/skylineGlider/runResult.js";
import { listUsableSkylineBikes, selectSkylineBike } from "../../lib/skylineGlider/bikeSelection.js";
import { useIdentity } from "../../identity/useIdentity.js";
import { useGameVolume } from "../../nav/useGameVolume.js";
import UnlockPrompt from "../../player/overlays/UnlockPrompt.jsx";
import { isLocalDevHost } from '@/lib/kioskEnv.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { FlightScene, entityRole } from "./FlightScene.jsx";
import useSkylineAccess from "./useSkylineAccess.js";
import useSkylineWeapons from "./useSkylineWeapons.js";
import SkylineFlightHud, { CollectibleIcon, MoreButton } from "./SkylineFlightHud.jsx";
import RpmGauge from "./SkylineRpmGauge.jsx";
import SkylineFlightOverlays from "./SkylineFlightOverlays.jsx";
import { MomentBanner } from "../../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js";
import { createFrameDriver, createEffectDispatcher } from "../../../../../../__capabilities/gaming/browser/platform/realtime/index.js";
import "./SkylineGlider.scss";

const SKYLINE_LOG_NAMES = {
  event: (e) => `skyline_glider.flight.${e.type}`,
  executed: 'skyline_glider.effect.executed',
  skipped: 'skyline_glider.effect.skipped',
  failed: 'skyline_glider.effect.failed',
};

// Event type -> ordered effects. Rebuilt per frame so it reads current values.
function buildEffectTable({ setEffects, effectTimersRef, course }) {
  const later = (fn, ms) => { effectTimersRef.current.add(setTimeout(fn, ms)); };
  return {
    collision: (event) => [
      { id: 'collision-burst', visual: () => {
        setEffects((current) => ({ ...current, collisionKey: current.collisionKey + 1 }));
        later(() => setEffects((current) => ({ ...current, collisionKey: 0 })), 450);
      } },
      // Losing a heart has its own cue, never the sound of a target breaking.
      { id: 'collision-cue', cue: event.data.kind === 'crash' ? 'crash' : 'hurt' },
    ],
    collectible: (event, extra) => [
      { id: 'bell-pop', visual: () => {
        const key = `${event.data.collectibleId}-${extra.courseTime}`;
        setEffects((current) => ({ ...current, pops: [...current.pops, { key }] }));
        later(() => setEffects((current) => ({ ...current, pops: current.pops.filter((pop) => pop.key !== key) })), 600);
      } },
      { id: 'bell-cue', cue: 'bell' },
    ],
    'weapon.fired': (event) => [{ id: `${event.data.weapon}-cue`, cue: event.data.weapon }],
    'bomb.detonated': () => [{ id: 'explosion-cue', cue: 'explosion' }],
    'entity.destroyed': (event) => {
      if (!['laser', 'missile'].includes(event.data.by)) return null;
      // Bomb kills are covered by the explosion cue, crash kills by the collision cue.
      // Only a scored target gets the reward sound; breaking scenery just shatters.
      const scored = scoresAsTarget(course.entities?.find((entity) => entity.id === event.data.entityId));
      return [{ id: scored ? 'target-cue' : 'shatter-cue', cue: scored ? 'target' : 'breakable' }];
    },
    'weapon.hit': (event) => (event.data.effect !== 'kill' && event.data.weapon !== 'bomb'
      ? [{ id: 'hit-cue', cue: event.data.effect === 'damage' ? 'hit' : 'deny' }]
      : null),
    'boost.activated': () => [{ id: 'boost-cue', cue: 'boost' }],
    checkpoint: (event) => [
      { id: 'checkpoint-banner', visual: () => {
        const label = `Checkpoint ${event.data.checkpointId}`;
        setEffects((current) => ({ ...current, banner: label }));
        later(() => setEffects((current) => ({ ...current, banner: current.banner === label ? null : current.banner })), 1500);
      } },
      { id: 'checkpoint-cue', cue: 'checkpoint' },
    ],
    restarted: () => [{ id: 'restart-ceremony' }, { id: 'restart-cue', cue: 'restart' }],
    completed: () => [{ id: 'finish-ceremony' }, { id: 'finish-cue', cue: 'finish' }],
  };
}

const ACTION_POSITION = Object.freeze({ laser: 1, bomb: 2, missile: 3, boost: 4 });
// Save attempts per run before the rider is let go with the result unsaved.
const MAX_SAVE_ATTEMPTS = 3;
// Why a save failed, in words a grown-up at the bike can act on.
function saveFailureWords(error) {
  const status = error?.httpStatus;
  if (!status) return 'the server could not be reached';
  if (status === 400) return 'the server refused the flight record';
  if (status === 503) return 'flight saving is switched off on the server';
  if (status >= 500) return `the server had a problem (${status})`;
  return `the server answered ${status}`;
}

export { FlightScene, RpmGauge };

const mediaUrl = (path) => DaylightMediaPath(`/media/${path}`);
// Text cues are timed to what is on screen, so they follow the camera, not a
// craft that has dashed ahead of it.
const activeCue = (course, flight) => {
  const camera = cameraTime(flight);
  return (course.control_cues || []).find((c) => camera >= c.at_s && camera < c.at_s + 7)?.text;
};

// World-map rows when no rider progress is available: every act open.
function zonesFromCourses(courses) {
  const zones = new Map();
  for (const item of courses) {
    const id = item.zone?.id || 'alpine';
    if (!zones.has(id)) zones.set(id, { id, name: item.zone?.name || 'Alpine', acts: [] });
    zones.get(id).acts.push({ id: item.id, name: item.name, act: item.act ?? null, status: 'open' });
  }
  return [...zones.values()];
}

export default function SkylineGlider() {
  const ctx = useFitnessContext();
  const { registerAdmin, clearUnlock, unlockState, unlockedUser } = useIdentity();
  const log = useMemo(() => getLogger().child({ component: 'skyline-glider' }), []);
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState('');
  const [controllerSelection,setControllerSelection]=useState(null);
  const [storageWarning,setStorageWarning]=useState(null);
  const [phase, setPhase] = useState('loading');
  const [flight, setFlight] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle', record: null });
  const [preferredEquipmentId, setPreferredEquipmentId] = useState(null);
  const [effects, setEffects] = useState({ collisionKey: 0, pops: [], banner: null });
  const [pressFlash, setPressFlash] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);
  const [accessOverride, setAccessOverride] = useState(null);
  const [adminPromptOpen, setAdminPromptOpen] = useState(false);
  const [world, setWorld] = useState(null);
  const [chosenActId, setChosenActId] = useState(null);
  const [actUnlock, setActUnlock] = useState(null);
  const [assets, setAssets] = useState(EMPTY_ZONE_ASSETS);
  const flightRef = useRef(null);
  const runRef = useRef(null);
  const finalizingRef = useRef(false);
  const settledRunIdsRef=useRef(new Set());
  const saveAttemptsRef=useRef(new Map());
  const unlockGenerationRef=useRef(0);
  const lastSampleSecondRef = useRef(-1);
  const previousInputRef = useRef(null);
  const effectTimersRef = useRef(new Set());
  const checkpointNoticeRef = useRef(null);
  const renderHealthRef = useRef({ startedAt: 0, frames: 0, longFrames: 0 });
  const audioRef = useRef(null);
  const lockedSelectionRef = useRef(null);
  const lockedCourseRef = useRef(null);
  const phaseRef = useRef(phase);
  const suspensionContextRef = useRef(null);
  const suspensionLoggedRef = useRef(false);
  if (!audioRef.current) audioRef.current = createSkylineAudio();
  // Game volume: Skyline's own level in the fitness volume store (useGameVolume),
  // not the video level. The household plays videos at ~10% linear; that level
  // fed through the log curve put the game at 1.6% -- silent (2026-11-12).
  // Every voice -- cue files, music, wind, synth tones -- ends on this gain.
  const gameVolume = useGameVolume('skyline-glider');
  const effectiveMaster = gameVolume.output;
  const effectiveMasterRef = useRef(effectiveMaster);
  effectiveMasterRef.current = effectiveMaster;
  useEffect(() => {
    audioRef.current.setVolume(effectiveMaster);
    log.info('skyline_glider.audio.volume', {
      level: gameVolume.level, muted: gameVolume.muted, isDefault: gameVolume.isDefault,
      output: audioRef.current.getLevels().output,
    });
  }, [effectiveMaster, gameVolume.level, gameVolume.muted, gameVolume.isDefault, log]);
  const persistCheckpoint=useCallback((...args)=>{
    // A run the server already holds is never written back as a flight to resume
    // (2026-11-12: a saved run resumed under another act re-posted its id -> 409).
    const checkpoint=args[2];
    if(checkpoint?.lifecycle!=='pending_terminal'&&settledRunIdsRef.current.has(checkpoint?.identity?.runId))return false;
    try{writeFlightCheckpoint(...args);return true}catch(error){setStorageWarning('Local save unavailable. Keep this page open until the flight is saved.');log.warn('skyline_glider.checkpoint.storage_error',{error:error.message});return false}
  },[log]);
  const removeCheckpoint=useCallback((...args)=>{
    try{clearFlightCheckpoint(...args);return true}catch(error){setStorageWarning('Local saves unavailable. Keep this page open until the server confirms saving.');log.warn('skyline_glider.checkpoint.remove_error',{error:error.message});return false}
  },[log]);
  const fitnessSessionInstance = ctx?.fitnessSessionInstance;
  const setGovernanceSuspended = ctx?.setGovernanceSuspended;
  const usableBikes = listUsableSkylineBikes(ctx?.equipment, fitnessSessionInstance);
  const selectedBike = selectSkylineBike(ctx?.equipment, fitnessSessionInstance, preferredEquipmentId);
  const activeBike = lockedSelectionRef.current || controllerSelection || selectedBike;
  const equipment = activeBike?.equipment || null;
  const riderId = activeBike?.riderId || null;
  const localDev = isLocalDevHost();
  const schoolLearner = riderId ? ctx?.getUserByName?.(riderId)?.schoolLearner : undefined;
  const access = useSkylineAccess(riderId, { schoolLearner });
  const accessGranted = access.unlocked || accessOverride?.riderId === riderId;
  const riderIdentity = useMemo(() => equipment && riderId ? {
    fitnessSessionId: fitnessSessionInstance?.sessionId || null,
    riderId,
    equipmentId: equipment.id,
  } : null, [equipment, fitnessSessionInstance?.sessionId, riderId]);
  // Which act the lobby offers: a tapped tile, else an unfinished flight to
  // retry or resume, else the rider's next act on the world map. Once a flight
  // begins the act is locked with the bike until the rider returns to the lobby.
  const riderWorld = world?.riderId === riderId ? world : null;
  const actStatus = useMemo(() => new Map((riderWorld?.zones || [])
    .flatMap((zone) => zone.acts.map((act) => [act.id, act.status]))), [riderWorld]);
  const playable = (id) => actStatus.get(id) !== 'locked';
  const checkpointCourse = (status) => (riderIdentity
    ? courses.find((item) => playable(item.id) && readFlightCheckpoint(riderId, item, { ...riderIdentity, calibration: resolveCalibration(equipment, item) }).status === status)
    : null);
  const lobbyCourse = courses.find((item) => item.id === chosenActId && playable(item.id))
    || checkpointCourse('pending_terminal') || checkpointCourse('compatible')
    || courses.find((item) => item.id === riderWorld?.next)
    || courses.find((item) => playable(item.id)) || courses[0] || null;
  const course = lockedCourseRef.current || lobbyCourse;
  const armory = weaponRules(course);
  // Every press lights its HUD cell: green when it will fire, red with the
  // reason when it will not, plus a soft deny tone, so no press is silent.
  const flashPress = useCallback((action, refusal) => {
    const position = ACTION_POSITION[action];
    if (!position) return;
    const key = `${action}-${performance.now()}`;
    setPressFlash({ position, ok: !refusal, reason: refusal, key });
    const timer = setTimeout(() => setPressFlash((current) => current?.key === key ? null : current), refusal ? 700 : 350);
    effectTimersRef.current.add(timer);
    // A boost already running is not a refusal worth a buzz: the cell says "Boosting".
    if (refusal && refusal !== 'active') {
      audioRef.current.playCue('deny');
      log.info('skyline_glider.input.refused', { action, reason: refusal, courseTime: flightRef.current?.courseTime ?? null });
    }
  }, [log]);
  const drainWeapons = useSkylineWeapons({
    enabled: phase === 'flight' && !!armory.enabled,
    onGamepad: (pad) => log.info('skyline_glider.input.gamepad', { padId: pad.id, mapping: pad.mapping || null }),
    onFire: (press) => {
      log.info('skyline_glider.input.fire', press);
      // Bike-button presses are flashed where they are accepted or refused.
      if (press.source !== 'rider-button') flashPress(press.action, weaponRefusal(flightRef.current, press.action, course));
    },
  });
  // A partner on the step mat is the bombardier: every classified stomp drops
  // a bomb from the same rack the rider's button uses. Only stomps count — an
  // ordinary step is someone walking past, not a request to fire.
  const subscribeToAppEvent = ctx?.subscribeToAppEvent;
  const stompArmed = phase === 'flight' && !!armory.enabled;
  useEffect(() => {
    if (!stompArmed || !subscribeToAppEvent) return undefined;
    log.info('skyline_glider.stomp_mat.armed', { riderId });
    const stop = subscribeToAppEvent('pressure-mat:stomp', (event) => {
      drainWeapons.enqueue(['bomb'], 'stomp-mat');
      log.info('skyline_glider.stomp_mat.bomb', { matId: event?.source ?? null, courseTime: flightRef.current?.courseTime ?? null });
    });
    return () => { stop?.(); log.debug('skyline_glider.stomp_mat.disarmed', { riderId }); };
  }, [stompArmed, subscribeToAppEvent, drainWeapons, log, riderId]);
  const checkpointIdentity = useMemo(() => course && riderIdentity ? { ...riderIdentity, calibration: resolveCalibration(equipment, course) } : null, [course, riderIdentity, equipment]);
  let saved = course && checkpointIdentity ? readFlightCheckpoint(riderId, course, checkpointIdentity) : { status: 'missing' };
  if(saved.status==='pending_terminal'&&settledRunIdsRef.current.has(saved.identity?.runId))saved={status:'missing'};
  phaseRef.current = phase;
  suspensionContextRef.current = { course, equipmentId: equipment?.id, riderId };

  useEffect(() => {
    if (!['incompatible', 'invalid'].includes(saved.status)) return;
    const signature = `${riderId}:${course?.id}:${saved.status}:${saved.reason}`;
    if (checkpointNoticeRef.current === signature) return;
    checkpointNoticeRef.current = signature;
    log.warn('skyline_glider.checkpoint.discarded', {
      riderId, equipmentId: equipment?.id, courseId: course?.id,
      courseVersion: course?.version, status: saved.status, reason: saved.reason,
    });
  }, [course?.id, course?.version, equipment?.id, log, riderId, saved.reason, saved.status]);

  useEffect(() => {
    setGovernanceSuspended?.(true);
    return () => setGovernanceSuspended?.(false);
  }, [setGovernanceSuspended]);

  useEffect(() => {
    setAccessOverride((current) => current?.riderId === riderId ? current : null);
    setPendingStart((current) => current?.userId === riderId ? current : null);
    setChosenActId(null);
  }, [riderId]);

  const refreshWorld = useCallback(async (forRider) => {
    if (!forRider) return;
    try {
      const response = await fetch(`/api/v1/fitness/skyline-glider/world?rider=${encodeURIComponent(forRider)}`);
      if (!response.ok) throw new Error(`world request failed (${response.status})`);
      const body = await response.json();
      if (!Array.isArray(body?.zones)) throw new Error('world response has no zones');
      setWorld({ riderId: forRider, zones: body.zones, next: body.next || null });
      log.debug('skyline_glider.world.loaded', { riderId: forRider, next: body.next || null });
    } catch (requestError) {
      // Progression is not a gate: without a world map every act stays playable.
      log.warn('skyline_glider.world.error', { riderId: forRider, error: requestError.message });
    }
  }, [log]);

  useEffect(() => { void refreshWorld(riderId); }, [refreshWorld, riderId]);

  const zone = course?.zone || null;
  useEffect(() => {
    if (!zone) { setAssets(EMPTY_ZONE_ASSETS); return undefined; }
    let active = true;
    const sounds = Object.fromEntries(Object.entries(zone.sounds || {}).map(([slot, path]) => [slot, mediaUrl(path)]));
    Promise.all([loadZoneAssets(zone, { mediaUrl }), audioRef.current.loadSounds(sounds)]).then(([loaded, soundReport]) => {
      if (!active) return;
      setAssets(loaded);
      const missing = [
        ...loaded.missing,
        ...soundReport.missing.map(({ slot, url, reason }) => ({ src: zone.sounds[slot] || url, slot, reason })),
      ];
      // An empty placeholder file is expected until it is populated.
      const failures = missing.filter((item) => !['empty', 'audio-unavailable'].includes(item.reason));
      log[failures.length ? 'warn' : 'info']('skyline_glider.assets.loaded', {
        zoneId: zone.id, courseId: course?.id, images: loaded.images.size,
        spriteFrames: loaded.frames ? Object.keys(loaded.frames).length : 0,
        sounds: soundReport.loaded, missing,
      });
    });
    return () => { active = false; };
  }, [zone, course?.id, log]);

  useEffect(() => () => {
    effectTimersRef.current.forEach((timer) => clearTimeout(timer));
    effectTimersRef.current.clear();
    audioRef.current.stop();
  }, []);

  useEffect(() => {
    const suspensionData = (reason) => {
      const current = flightRef.current;
      const run = runRef.current;
      const context = suspensionContextRef.current;
      if (suspensionLoggedRef.current || phaseRef.current !== 'flight' || !current || !run || finalizingRef.current) return null;
      return {
        runId: run.runId, riderId: context?.riderId, equipmentId: context?.equipmentId,
        courseId: context?.course?.id, courseVersion: context?.course?.version,
        courseTime: current.courseTime, inputMode: current.inputMode || 'unknown', reason,
      };
    };
    const logSuspension = (reason) => {
      const data = suspensionData(reason);
      if (!data) return;
      suspensionLoggedRef.current = true;
      log.info('skyline_glider.flight.suspended', data);
    };
    const onPageHide = () => {
      const data = suspensionData('pagehide');
      if (!data) return;
      try {
        const body = new Blob([JSON.stringify(data)], { type: 'application/json' });
        if (navigator.sendBeacon?.('/api/v1/fitness/skyline-glider/suspensions', body)) {
          suspensionLoggedRef.current = true;
          return;
        }
      } catch (_) { /* fall through to the buffered logger */ }
      logSuspension('pagehide');
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      logSuspension('unmount');
    };
  }, [log]);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/fitness/skyline-glider/courses').then(async (response) => {
      if (!response.ok) throw new Error(`course request failed (${response.status})`);
      const body = await response.json();
      const checked = (body.courses || []).map((raw) => ({ raw, ...validateCourse(raw) }));
      for (const entry of checked.filter((item) => !item.valid)) {
        log.warn('skyline_glider.course.invalid', { courseId: entry.raw?.id || null, errors: entry.errors });
      }
      const valid = checked.filter((entry) => entry.valid).map((entry) => entry.course);
      if (!valid.length) throw new Error('No playable courses');
      if (active) { setCourses(valid); setPhase('lobby'); }
    }).catch((requestError) => {
      log.error('skyline_glider.courses.error', { error: requestError.message });
      if (active) { setError('Mountain weather unavailable. Try again.'); setPhase('error'); }
    });
    return () => { active = false; };
  }, [log]);

  // The run is done with this browser (saved, already saved, or given up): forget
  // its pending record wherever it was parked, so nothing offers it again.
  const settleRun = useCallback((record) => {
    settledRunIdsRef.current.add(record.run.id);
    removeCheckpoint(riderId, course);
    if (record.rider?.user_id && record.run?.course_id) removeCheckpoint(record.rider.user_id, record.run.course_id);
  }, [course, removeCheckpoint, riderId]);

  const finalize = useCallback(async (status, terminalState = flightRef.current, retryRecord = null) => {
    if (!runRef.current || finalizingRef.current) return false;
    finalizingRef.current = true;
    const record = retryRecord || buildSkylineGliderRun({
      ...runRef.current, course, riderId, equipmentId: equipment?.id,
      fitnessSessionId: fitnessSessionInstance?.sessionId || null,
      calibration: terminalState.calibration, state: terminalState, status,
      endedAt: new Date().toISOString(),
    });
    setSaveState({ status: 'saving', record });
    setPhase('result');
    const terminalIdentity = retryRecord ? {
      fitnessSessionId: record.run.fitness_session_id || null,
      riderId: record.rider.user_id,
      equipmentId: record.run.equipment_id || null,
      calibration: record.run.calibration ? { lowRpm: record.run.calibration.low_rpm, highRpm: record.run.calibration.high_rpm } : terminalState.calibration,
      runId: record.run.id,
      startedAt: record.run.started_at,
    } : { ...runRef.current, ...checkpointIdentity };
    persistCheckpoint(riderId, course, {
      identity: terminalIdentity, state: terminalState,
      lifecycle: 'pending_terminal', terminalRecord: record,
    });
    try {
      const response = await fetch('/api/v1/fitness/skyline-glider/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record }) });
      if (response.status === 409) {
        // The server already holds a run with this id: it was saved before. The
        // stored record is the truth; the flight is done and the rider moves on.
        let stored = record;
        try {
          const existing = await fetch(`/api/v1/fitness/skyline-glider/runs/${encodeURIComponent(record.run.id)}`);
          if (existing.ok) stored = (await existing.json())?.record || record;
        } catch { /* the posted record still describes the flight */ }
        settleRun(record);
        setSaveState({ status: 'saved', record: stored });
        setPhase('result');
        log.warn('skyline_glider.flight.save_duplicate', {
          runId: record.run.id, status, riderId, equipmentId: equipment?.id,
          courseId: record.run.course_id, storedCourseId: stored.run?.course_id || null, courseVersion: record.run.course_version,
        });
        return true;
      }
      if (!response.ok) throw Object.assign(new Error(`save failed (${response.status})`), { httpStatus: response.status });
      // A sessionless run omits fitness_session_id (undefined): normalise both sides
      // or every flight flown without a session reads as an identity change.
      const rewardIdentityMatches = (record.run.fitness_session_id || null) === (fitnessSessionInstance?.sessionId || null)
        && record.rider.user_id === riderId;
      const treasureBox = fitnessSessionInstance?.sessionId ? fitnessSessionInstance?.treasureBox : null;
      if (status === 'completed' && rewardIdentityMatches && !treasureBox?.awardBonus) {
        // Rings live in the session's treasure box; with no session there is nothing to pay into.
        log.info('skyline_glider.reward.skipped', {
          runId: record.run.id, riderId: record.rider.user_id, fitnessSessionId: record.run.fitness_session_id || null, reason: 'no-fitness-session',
        });
      } else if (status === 'completed' && rewardIdentityMatches) {
        treasureBox.awardBonus({
          idempotencyKey: `rpm-flight:${record.run.id}:completion:${riderId}`,
          userId: riderId, rings: record.run.reward_rings, zoneId: 'skyline-glider', color: '#e0a85b',
          source: 'skyline-glider', metadata: { courseId: course.id, collectibles: record.collectibles.length },
        });
      } else if (status === 'completed') {
        log.warn('skyline_glider.reward.skipped', {
          runId: record.run.id, riderId: record.rider.user_id,
          fitnessSessionId: record.run.fitness_session_id || null,
          reason: 'terminal-identity-changed',
        });
      }
      settleRun(record);
      if (status === 'completed') { setChosenActId(null); await refreshWorld(record.rider.user_id); }
      setSaveState({ status: 'saved', record });
      setPhase('result');
      log.info('skyline_glider.flight.saved', {
        runId: record.run.id, status, riderId, equipmentId: equipment?.id,
        courseId: course.id, courseVersion: course.version,
      });
      announceGameAchievement('skyline-glider', { runId: record.run.id }); // the gem ceremony looks now
      return true;
    } catch (saveError) {
      finalizingRef.current = false;
      const attempts = (saveAttemptsRef.current.get(record.run.id) || 0) + 1;
      saveAttemptsRef.current.set(record.run.id, attempts);
      const correlation = {
        runId: record.run.id, status, riderId, equipmentId: equipment?.id,
        courseId: record.run.course_id, courseVersion: record.run.course_version, error: saveError.message, attempts,
      };
      if (attempts >= MAX_SAVE_ATTEMPTS) {
        // Never trap the rider behind a save that keeps failing: drop the pending
        // record and let them fly again or leave. The log keeps the evidence.
        settleRun(record);
        setSaveState({ status: 'unsaved', record, reason: saveFailureWords(saveError) });
        setPhase('result');
        log.error('skyline_glider.flight.save_abandoned', { ...correlation, record });
        return false;
      }
      setSaveState({ status: 'error', record });
      setPhase('result');
      log.error('skyline_glider.flight.save_error', correlation);
      return false;
    }
  }, [checkpointIdentity, course, equipment?.id, fitnessSessionInstance, log, refreshWorld, riderId, settleRun]);

  useEffect(() => {
    if (phase !== 'flight' || !flightRef.current) return undefined;
    renderHealthRef.current = { startedAt: performance.now(), frames: 0, longFrames: 0 };
    const frame = ({ nowMs: now, rawElapsedS, elapsedS }) => {
      const health = renderHealthRef.current;
      health.frames += 1;
      if (rawElapsedS * 1000 > 50) health.longFrames += 1;
      const healthElapsedMs = now - health.startedAt;
      if (healthElapsedMs >= 10000) {
        log.info('skyline_glider.render.health', {
          runId: runRef.current?.runId, riderId, equipmentId: equipment?.id,
          courseId: course.id, courseVersion: course.version,
          courseTime: flightRef.current.courseTime,
          frameCount: health.frames,
          updateRateHz: Math.round((health.frames * 100000) / healthElapsedMs) / 100,
          longFrameCount: health.longFrames,
          windowMs: Math.round(healthElapsedMs),
        });
        renderHealthRef.current = { startedAt: now, frames: 0, longFrames: 0 };
      }
      const cadence = fitnessSessionInstance?.getEquipmentCadence?.(equipment?.id) || { rpm: 0, connected: false };
      const previous = flightRef.current;
      const previousCheckpointId = previous.checkpoint.id;
      // A zero-length frame runs no engine sub-step, so presses wait for the next frame.
      const actions = elapsedS > 0 ? drainWeapons() : [];
      const power = weaponPower(fitnessSessionInstance?.zoneProfileStore?.getProfile?.(riderId));
      const next = stepFlight(previous, { ...cadence, actions, weaponPower: power }, elapsedS, course);
      flightRef.current = next;
      setFlight(next);
      const telemetry = collectFlightTelemetry({
        previous, next, input: cadence, previousInput: previousInputRef.current,
        lastSampleSecond: lastSampleSecondRef.current, course,
      });
      const correlation = {
        runId: runRef.current?.runId, riderId, equipmentId: equipment?.id,
        courseId: course.id, courseVersion: course.version,
      };
      if (telemetry.sample) log.info('skyline_glider.flight.sample', { ...correlation, ...telemetry.sample });
      createEffectDispatcher({
        table: buildEffectTable({ setEffects, effectTimersRef, course }),
        playCue: (cue) => audioRef.current.playCue(cue),
        log,
        logNames: SKYLINE_LOG_NAMES,
        correlation: () => correlation,
        skippedReason: () => (effectiveMasterRef.current <= 0 ? 'muted' : 'audio-unavailable'),
      }).dispatch(telemetry.events, { courseTime: next.courseTime });
      lastSampleSecondRef.current = telemetry.nextSampleSecond;
      previousInputRef.current = { ...cadence };
      if (next.checkpoint.id !== previousCheckpointId || next.courseTime % 2 < .12) persistCheckpoint(riderId, course, {
        identity: { ...runRef.current, ...checkpointIdentity }, state: next,
      });
      if (next.phase === 'completed') finalize('completed', next);
    };
    const driver = createFrameDriver({
      maxFrameS: 0.1,
      onFrame: frame,
      onError: (err) => log.sampled('skyline_glider.frame.error', {
        runId: runRef.current?.runId, riderId, courseId: course.id, error: err?.message,
      }, { maxPerMinute: 5, aggregate: true, level: 'error' }),
    });
    audioRef.current.startWind();
    driver.start();
    return () => { driver.stop(); audioRef.current.stop(); };
  }, [phase, checkpointIdentity, course, equipment?.id, riderId, finalize, fitnessSessionInstance, log, drainWeapons]);

  const begin = useCallback((resume = false) => {
    if (!equipment || !riderId || !course) return;
    const armedAtMs = Date.now();
    const initial = createFlightState(course, { calibration: resolveCalibration(equipment, course), armedAtMs });
    const canResume = resume && saved.status === 'compatible';
    const next = canResume ? {
      ...initial, ...saved.state,
      phase: 'playing', pausedForSensor: false, collisionProtected: false,
      armedAtMs, inputReady: false, lastInputTs: null,
    } : initial;
    if (!resume) removeCheckpoint(riderId, course);
    suspensionLoggedRef.current = false;
    flightRef.current = next;
    const run = canResume ? { runId: saved.identity.runId, startedAt: saved.identity.startedAt } : {
      runId: globalThis.crypto?.randomUUID?.() || `flight-${Date.now()}`,
      startedAt: new Date().toISOString(),
    };
    runRef.current = run;
    lockedSelectionRef.current = activeBike;
    lockedCourseRef.current = course;
    finalizingRef.current = false;
    lastSampleSecondRef.current = -1;
    previousInputRef.current = null;
    setSaveState({ status: 'idle', record: null });
    setFlight(next);
    setPhase('flight');
    // The loops start once the audio context is running: resume() is async, and
    // the flight effect's startWind() can run while the context is still
    // suspended, which would leave the whole flight without music or wind.
    void audioRef.current.prime().then((running) => {
      if (running && phaseRef.current === 'flight') audioRef.current.startWind();
      log.info('skyline_glider.audio.started', { running, ...audioRef.current.getLevels() });
    });
    log.info('skyline_glider.flight.started', {
      runId: run.runId, courseId: course.id, courseVersion: course.version,
      riderId, equipmentId: equipment.id, calibration: initial.calibration, resumed: canResume,
    });
  }, [course, equipment, log, riderId, saved.identity, saved.state, saved.status, selectedBike]);

  const requestAdminOverride = async () => {
    if (!riderId || riderId === 'guest') return;
    const generation=++unlockGenerationRef.current;
    setAdminPromptOpen(true);
    log.info('skyline_glider.access.override_requested', {
      riderId, equipmentId: equipment?.id,
    });
    const result = await registerAdmin('skyline_glider');
    if(generation!==unlockGenerationRef.current)return;
    if (!result?.matched || !result.userId) {
      log.info('skyline_glider.access.override_denied', {
        riderId, equipmentId: equipment?.id, reason: result?.reason || 'denied',
      });
      return;
    }
    setAccessOverride({ riderId, adminUserId: result.userId });
    setAdminPromptOpen(false);
    clearUnlock();
    log.info('skyline_glider.access.override_granted', {
      riderId, equipmentId: equipment?.id, adminUserId: result.userId,
    });
  };

  const requestActUnlock = async (act) => {
    if (!riderId || riderId === 'guest') return;
    const generation=++unlockGenerationRef.current;
    setActUnlock({ actId: act.id, name: act.name });
    log.info('skyline_glider.progress.unlock_requested', { riderId, actId: act.id });
    const result = await registerAdmin('skyline_glider');
    if (!result?.matched || !result.userId) {
      log.info('skyline_glider.progress.unlock_denied', { riderId, actId: act.id, reason: result?.reason || 'denied' });
      return;
    }
    try {
      const response = await fetch(`/api/v1/fitness/skyline-glider/progress/${encodeURIComponent(riderId)}/unlock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actId: act.id, unlockedBy: result.userId }),
      });
      if (!response.ok) throw new Error(`unlock failed (${response.status})`);
      await refreshWorld(riderId);
      setChosenActId(act.id);
      log.info('skyline_glider.progress.unlock_granted', { riderId, actId: act.id, adminUserId: result.userId });
    } catch (unlockError) {
      log.error('skyline_glider.progress.unlock_error', { riderId, actId: act.id, error: unlockError.message });
    }
    setActUnlock(null);
    clearUnlock();
  };

  const controller = useSkylineController({
    ctx,courses,world:riderWorld,sound:{level:gameVolume.level,muted:gameVolume.muted},modalOpen:adminPromptOpen||!!actUnlock,access:{...access,unlocked:accessGranted},saved,saveState,flight,
    onEffect:effect=>{
      log.info('skyline_glider.control.action',{action:effect.type,riderId:effect.riderId,equipmentId:effect.equipmentId,actId:effect.actId});
      if(effect.type==='assign-rider'){
        const chosen=ctx?.equipment?.find(e=>e.id===effect.equipmentId)||equipment;
        if(!chosen)return;
        fitnessSessionInstance?.setEquipmentRider?.(chosen.id,effect.riderId);
        setPreferredEquipmentId(chosen.id);
        setControllerSelection({equipment:chosen,riderId:effect.riderId});
        setPendingStart({equipmentId:chosen.id,userId:effect.riderId});
        lockedSelectionRef.current=null;lockedCourseRef.current=null;
        setChosenActId(effect.actId);
      }else if(effect.type==='choose-act'){
        if(['saved','unsaved'].includes(saveState.status)){lockedCourseRef.current=null;finalizingRef.current=false}
        setChosenActId(effect.actId);
      }
      else if(effect.type==='recover-terminal'){
        if(saved.status!=='pending_terminal')return;
        lockedSelectionRef.current=activeBike;lockedCourseRef.current=course;
        runRef.current={runId:saved.identity.runId,startedAt:saved.identity.startedAt};
        flightRef.current=saved.state;setFlight(saved.state);finalizingRef.current=false;
        void finalize(saved.terminalRecord.run.status,saved.state,saved.terminalRecord);
      }
      else if(effect.type==='launch'){
        if(saved.status==='pending_terminal'){
          lockedSelectionRef.current=activeBike;lockedCourseRef.current=course;
          runRef.current={runId:saved.identity.runId,startedAt:saved.identity.startedAt};
          flightRef.current=saved.state;setFlight(saved.state);
          setSaveState({status:'error',record:saved.terminalRecord});
        }else begin(effect.resume);
        try{localStorage.setItem('fitness:skyline-glider:last-act:'+riderId,effect.actId)}catch{ /* memory selection remains available */ }
      }else if(effect.type==='retry-checkpoint'||effect.type==='resume-flight'){
        const current=flightRef.current;if(!current)return;
        const next=effect.type==='retry-checkpoint'?retryFlightCheckpoint(current,course):current;
        flightRef.current={...next,armedAtMs:Date.now(),inputReady:false,lastInputTs:null};
        setFlight(flightRef.current);setPhase('flight');
      }else if(effect.type==='combat'){
        const current=flightRef.current;
        const cadence=fitnessSessionInstance?.getEquipmentCadence?.(equipment?.id);
        const refusal=cadence?.connected&&cadence.rpm===0?'paused':weaponRefusal(current,effect.action,course);
        flashPress(effect.action,refusal);
        if(!refusal)drainWeapons.enqueue([effect.action]);
      }else if(effect.type==='clear-input')drainWeapons.clear?.();
      else if(effect.type==='commit-stall'){
        const current=flightRef.current;
        if(current){const next=stepFlight(current,{...effect.cadence,actions:[]},1/60,course);flightRef.current=next;setFlight(next);setPhase('flight')}
      }
      else if(effect.type==='pause'||effect.type==='suspend'){
        if(runRef.current&&flightRef.current)persistCheckpoint(riderId,course,{identity:{...runRef.current,...checkpointIdentity},state:flightRef.current});
        drainWeapons.clear?.();setPhase('paused')
      }
      else if(effect.type==='toggle-sound'){gameVolume.toggleMute();log.info('skyline_glider.audio.mute_toggled',{muted:!gameVolume.muted,source:effect.source||'bike'})}
      else if(effect.type==='volume-step'){const level=Math.max(0,Math.min(100,gameVolume.level+effect.delta));gameVolume.setLevel(level);log.info('skyline_glider.audio.level_set',{level,control:'bike'})}
      else if(effect.type==='finalize')void finalize('abandoned');
      else if(effect.type==='retry-save'){
        if(saveState.record){void finalize(saveState.record.run.status,flightRef.current,saveState.record)}
      }else if(effect.type==='cancel-unlock'){
        unlockGenerationRef.current++;setAdminPromptOpen(false);setActUnlock(null);clearUnlock();
      }else if(effect.type==='release-selector'){
        if(['saving','error'].includes(saveState.status))return;
        unlockGenerationRef.current++;if(adminPromptOpen||actUnlock)clearUnlock();setAdminPromptOpen(false);setActUnlock(null);
        if(runRef.current&&flightRef.current&&saveState.status!=='saved')persistCheckpoint(riderId,course,{identity:{...runRef.current,...checkpointIdentity},state:flightRef.current});
        lockedSelectionRef.current=null;lockedCourseRef.current=null;setControllerSelection(null);setFlight(null);flightRef.current=null;runRef.current=null;setChosenActId(null);setSaveState({status:'idle',record:null});setPhase('lobby');
      }else if(effect.type==='request-admin')void requestAdminOverride();
      else if(effect.type==='request-act-unlock'){const chosen=courses.find(c=>c.id===effect.actId);if(chosen)void requestActUnlock(chosen)}
    },
  });
  useEffect(()=>{
    if(['flight','stall'].includes(controller.state.phase)){if(flightRef.current)setPhase('flight')}
    else if(!['loading','error','result'].includes(phase))setPhase('paused');
  },[controller.state.phase]);
  const panelControls=controller.controls.map(c=>{
    if(adminPromptOpen||actUnlock)return {...c,label:c.position===3?'Cancel':'Present admin badge',hint:c.position===3?'Return to the game':'Waiting for approval',disabled:c.position!==3,avatarSrc:null,icon:c.position===3?'×':'—'};
    if(c.position!==4||controller.state.phase!=='flights')return c;
    if(saved.status==='pending_terminal')return {...c,label:'Retry previous save',hint:'Finish saving before a new flight'};
    if(c.label==='Start'&&saved.status==='compatible')return {...c,label:'Resume',hint:'Continue this flight'};
    return c;
  });
  const openSoundSheet=()=>{log.info('skyline_glider.settings.opened',{phase:controller.state.phase,source:'touch'});controller.dispatch({type:'OPEN_SETTINGS',source:'touch'})};
  const soundSheet={level:gameVolume.level,muted:gameVolume.muted,
    onLevel:level=>{gameVolume.setLevel(level);log.info('skyline_glider.audio.level_set',{level,control:'touch'})},
    onToggleMute:()=>{gameVolume.toggleMute();log.info('skyline_glider.audio.mute_toggled',{muted:!gameVolume.muted,source:'touch'})}};
  const pressPanel=(position,gesture='single')=>controller.dispatch({type:'PRESS',position,gesture,source:'touch'});
  const chooseAct = (act) => {
    if (act.status === 'locked') { void requestActUnlock(act); return; }
    setChosenActId(act.id);
    log.info('skyline_glider.act.chosen', { riderId, actId: act.id, status: act.status });
  };

  if(phase==='loading')return <main className="skyline-glider skyline-glider--controls skyline-menu-screen" data-testid="skyline-glider-loading"><p className="skyline-glider__notice">Charting the course…</p><SkylineControlPanel controls={panelControls.map(c=>({...c,disabled:true}))} onPress={pressPanel}/></main>;
  if(phase==='error')return <main className="skyline-glider skyline-glider--controls skyline-menu-screen"><p className="skyline-glider__notice" data-tone="bad" role="alert">{error}</p><SkylineControlPanel controls={panelControls} onPress={pressPanel}/></main>;
  if(!['flight','stall'].includes(controller.state.phase))return <main className="skyline-glider skyline-glider--controls skyline-menu-screen"
    data-testid={controller.state.phase==='denied'?'skyline-glider-school-lock':controller.state.phase==='result'||controller.state.phase==='saving'?'skyline-glider-result':controller.state.phase==='countdown'?'skyline-glider-countdown':'skyline-glider-lobby'} data-control-phase={controller.state.phase}>
    <div className="skyline-glider__menu">{!['settings','saving','loading'].includes(controller.state.phase)&&!(adminPromptOpen||actUnlock)&&<MoreButton onMore={openSoundSheet} className="skyline-glider__menu-more"/>}<SkylineMenus state={controller.state} riders={controller.state.riders} acts={controller.state.acts} onEvent={controller.dispatch} sound={soundSheet}
      crashNote={(()=>{const hit=course?.entities?.find(e=>e.id===flight?.lastCollisionEntityId);return crashReason(flight,hit&&{...hit,role:entityRole(hit,!!armory.enabled)})})()}
      summary={saveState.record?.run&&(()=>{const bells=saveState.record.collectibles?.length||0,targets=saveState.record.run.targets||0;
        // A zone with its own pickup sprite (coins) is not counted in bells.
        const sprite=!!(assets.sheet&&assets.frames?.[course?.zone?.collectible?.frames?.[0]||course?.zone?.collectible?.frame]);
        return [[sprite?'Collected':'Bells',bells,<CollectibleIcon zone={course?.zone} assets={assets}/>],...(armory.enabled?[['Targets',targets]]:[]),['Score',bells+targets],['Bumps',saveState.record.run.collisions||0]]})()}/>
    {saveState.status==='unsaved'&&controller.state.phase==='result'&&<p className="skyline-glider__notice" data-tone="bad" role="alert">This flight could not be saved — {saveState.reason}. You can still fly again.</p>}
    {saveState.status==='saved'&&<p className="skyline-glider__notice" data-tone="good">Flight saved{saveState.record?.run.reward_rings?' · +'+saveState.record.run.reward_rings+' rings':''}</p>}
    {storageWarning&&<p className="skyline-glider__notice" role="status">{storageWarning}</p>}
    {controller.state.phase==='flights'&&['incompatible','invalid'].includes(saved.status)&&<p className="skyline-glider__notice" role="status">This saved flight uses an older course. Start begins a fresh flight; earned completion is kept.</p>}
    {(adminPromptOpen||actUnlock)&&<p className="skyline-glider__notice">Present an admin badge to unlock. Bottom-left cancels.</p>}
    </div>
    <SkylineControlPanel controls={panelControls} onPress={pressPanel}/>
    <UnlockPrompt open={adminPromptOpen||!!actUnlock} state={unlockState} lockLabel="Skyline Glider" unlockedUser={unlockedUser} onCancel={()=>pressPanel(3)}/>
  </main>;
  // One value for both the text and the key, so a banner replays exactly when its words change.
  const bannerText = effects.banner || activeCue(course, flight);
  return <main className="skyline-glider skyline-glider--flight" data-control-phase={controller.state.phase} data-rider-id={riderId} data-course-id={course.id} data-testid="skyline-glider-flight" data-course-time={flight.courseTime}>
    <FlightScene state={flight} course={course} effects={effects} assets={assets}/>
    <RpmGauge state={flight}/>
    <SkylineFlightHud flight={flight} course={course} assets={assets} armed={!!armory.enabled} press={pressFlash} onMore={openSoundSheet}
      targetsHit={countTargets(flight, course)}
      power={weaponPower(fitnessSessionInstance?.zoneProfileStore?.getProfile?.(riderId))}/>
    <SkylineFlightOverlays flight={flight}/>
    <MomentBanner text={bannerText} momentKey={bannerText} className="skyline-glider__checkpoint-banner"/>
  </main>;
}
