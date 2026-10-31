import SkylineControlPanel from './SkylineControlPanel.jsx';
import SkylineMenus from './SkylineMenus.jsx';
import { useSkylineController } from './useSkylineController.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from "../../context/FitnessContext.jsx";
import getLogger from '@/lib/logging/Logger.js';
import { validateCourse, resolveCalibration } from "../../lib/skylineGlider/courseModel.js";
import { createFlightState, stepFlight, retryFlightCheckpoint } from "../../lib/skylineGlider/flightEngine.js";
import { weaponPower } from "../../lib/skylineGlider/weaponPower.js";
import { weaponRules } from "../../lib/skylineGlider/weapons.js";
import { collectFlightTelemetry } from "../../lib/skylineGlider/flightTelemetry.js";
import { altitudeToTrackPercent } from "../../lib/skylineGlider/flightGeometry.js";
import { EMPTY_ZONE_ASSETS, loadZoneAssets } from "../../lib/skylineGlider/zoneAssets.js";
import { createSkylineAudio } from "../../lib/skylineGlider/skylineAudio.js";
import { clearFlightCheckpoint, readFlightCheckpoint, writeFlightCheckpoint } from "../../lib/skylineGlider/checkpointRepository.js";
import { buildSkylineGliderRun } from "../../lib/skylineGlider/runResult.js";
import { listUsableSkylineBikes, selectSkylineBike } from "../../lib/skylineGlider/bikeSelection.js";
import { useIdentity } from "../../identity/useIdentity.js";
import UnlockPrompt from "../../player/overlays/UnlockPrompt.jsx";
import { isLocalDevHost } from '@/lib/kioskEnv.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { FlightScene } from "./FlightScene.jsx";
import useSkylineAccess from "./useSkylineAccess.js";
import useSkylineWeapons from "./useSkylineWeapons.js";
import "./SkylineGlider.scss";

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export { FlightScene };

const mediaUrl = (path) => DaylightMediaPath(`/media/${path}`);

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

export function RpmGauge({ state }) {
  const rpm = Math.max(0, Math.round(state.rawRpm || 0));
  const altitude = altitudeToTrackPercent(state.altitude);
  const target = altitudeToTrackPercent(state.targetAltitude);
  return <aside
    className="skyline-glider__rpm-gauge"
    role="meter"
    aria-label="Cadence altitude"
    aria-valuemin={state.calibration.lowRpm}
    aria-valuemax={state.calibration.highRpm}
    aria-valuenow={rpm}
  >
    <span className="skyline-glider__rpm-high">{state.calibration.highRpm}</span>
    <div className="skyline-glider__rpm-track">
      <div className="skyline-glider__rpm-target" data-testid="rpm-target" style={{ top: `${target}%` }}/>
      <div className="skyline-glider__rpm-chevron" data-testid="rpm-chevron" data-altitude={state.altitude} style={{ top: `${altitude}%` }}><span>{rpm}</span></div>
    </div>
    <span className="skyline-glider__rpm-low">{state.calibration.lowRpm}</span>
    <strong>RPM</strong>
  </aside>;
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
  const [muted, setMuted] = useState(false);
  const [preferredEquipmentId, setPreferredEquipmentId] = useState(null);
  const [effects, setEffects] = useState({ collisionKey: 0, pops: [], banner: null });
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
  const persistCheckpoint=useCallback((...args)=>{
    try{writeFlightCheckpoint(...args);return true}catch(error){setStorageWarning('Local save unavailable. Keep this page open until the flight is saved.');log.warn('skyline_glider.checkpoint.storage_error',{error:error.message});return false}
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
  const drainWeapons = useSkylineWeapons({
    enabled: phase === 'flight' && !!armory.enabled,
    onGamepad: (pad) => log.info('skyline_glider.input.gamepad', { padId: pad.id, mapping: pad.mapping || null }),
    onFire: (press) => log.info('skyline_glider.input.fire', press),
  });
  const checkpointIdentity = useMemo(() => course && riderIdentity ? { ...riderIdentity, calibration: resolveCalibration(equipment, course) } : null, [course, riderIdentity, equipment]);
  const saved = course && checkpointIdentity ? readFlightCheckpoint(riderId, course, checkpointIdentity) : { status: 'missing' };
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
      if (!response.ok) throw new Error(`save failed (${response.status})`);
      const rewardIdentityMatches = record.run.fitness_session_id === (fitnessSessionInstance?.sessionId || null)
        && record.rider.user_id === riderId;
      if (status === 'completed' && rewardIdentityMatches) {
        fitnessSessionInstance?.treasureBox?.awardBonus?.({
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
      clearFlightCheckpoint(riderId, course);
      if (status === 'completed') { setChosenActId(null); await refreshWorld(record.rider.user_id); }
      setSaveState({ status: 'saved', record });
      setPhase('result');
      log.info('skyline_glider.flight.saved', {
        runId: record.run.id, status, riderId, equipmentId: equipment?.id,
        courseId: course.id, courseVersion: course.version,
      });
      return true;
    } catch (saveError) {
      finalizingRef.current = false;
      setSaveState({ status: 'error', record });
      setPhase('result');
      log.error('skyline_glider.flight.save_error', {
        runId: record.run.id, status, riderId, equipmentId: equipment?.id,
        courseId: course.id, courseVersion: course.version, error: saveError.message,
      });
      return false;
    }
  }, [checkpointIdentity, course, equipment?.id, fitnessSessionInstance, log, refreshWorld, riderId]);

  useEffect(() => {
    if (phase !== 'flight' || !flightRef.current) return undefined;
    let prior = performance.now();
    let frameId = 0;
    renderHealthRef.current = { startedAt: prior, frames: 0, longFrames: 0 };
    const frame = (now) => {
      const frameMs = Math.max(0, now - prior);
      const health = renderHealthRef.current;
      health.frames += 1;
      if (frameMs > 50) health.longFrames += 1;
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
      const elapsed = Math.min(.1, Math.max(0, (now - prior) / 1000));
      // A zero-length frame runs no engine sub-step, so presses wait for the next frame.
      const actions = elapsed > 0 ? drainWeapons() : [];
      const power = weaponPower(fitnessSessionInstance?.zoneProfileStore?.getProfile?.(riderId));
      const next = stepFlight(previous, { ...cadence, actions, weaponPower: power }, elapsed, course);
      prior = now;
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
      for (const event of telemetry.events) {
        log.info(`skyline_glider.flight.${event.type}`, { ...correlation, courseTime: next.courseTime, ...event.data });
        const executeVisual = (effectId, update) => {
          try {
            update?.();
            log.info('skyline_glider.effect.executed', { ...correlation, courseTime: next.courseTime, eventType: event.type, effectId });
          } catch (effectError) {
            log.error('skyline_glider.effect.failed', { ...correlation, courseTime: next.courseTime, eventType: event.type, effectId, error: effectError.message });
          }
        };
        const executeCue = (effectId, cue) => {
          try {
            if (audioRef.current.playCue(cue)) log.info('skyline_glider.effect.executed', { ...correlation, courseTime: next.courseTime, eventType: event.type, effectId });
            else log.info('skyline_glider.effect.skipped', { ...correlation, courseTime: next.courseTime, eventType: event.type, effectId, reason: muted ? 'muted' : 'audio-unavailable' });
          } catch (effectError) {
            log.error('skyline_glider.effect.failed', { ...correlation, courseTime: next.courseTime, eventType: event.type, effectId, error: effectError.message });
          }
        };
        if (event.type === 'collision') {
          executeVisual('collision-burst', () => {
            setEffects((current) => ({ ...current, collisionKey: current.collisionKey + 1 }));
            const timer = setTimeout(() => setEffects((current) => ({ ...current, collisionKey: 0 })), 450);
            effectTimersRef.current.add(timer);
          });
          executeCue('collision-cue', event.data.kind === 'crash' ? 'crash' : 'breakable');
        } else if (event.type === 'collectible') {
          executeVisual('bell-pop', () => {
            const key = `${event.data.collectibleId}-${next.courseTime}`;
            setEffects((current) => ({ ...current, pops: [...current.pops, { key }] }));
            const timer = setTimeout(() => setEffects((current) => ({ ...current, pops: current.pops.filter((pop) => pop.key !== key) })), 600);
            effectTimersRef.current.add(timer);
          });
          executeCue('bell-cue', 'bell');
        } else if (event.type === 'weapon.fired') {
          executeCue(`${event.data.weapon}-cue`, event.data.weapon);
        } else if (event.type === 'bomb.detonated') {
          executeCue('explosion-cue', 'explosion');
        } else if (event.type === 'entity.destroyed' && event.data.by === 'laser') {
          // Bomb kills are covered by the explosion cue, crash kills by the collision cue.
          executeCue('shatter-cue', 'breakable');
        } else if (event.type === 'checkpoint') {
          executeVisual('checkpoint-banner', () => {
            const label = `Checkpoint ${event.data.checkpointId}`;
            setEffects((current) => ({ ...current, banner: label }));
            const timer = setTimeout(() => setEffects((current) => ({ ...current, banner: current.banner === label ? null : current.banner })), 1500);
            effectTimersRef.current.add(timer);
          });
          executeCue('checkpoint-cue', 'checkpoint');
        } else if (event.type === 'restarted') {
          executeVisual('restart-ceremony');
          executeCue('restart-cue', 'restart');
        } else if (event.type === 'completed') {
          executeVisual('finish-ceremony');
          executeCue('finish-cue', 'finish');
        }
      }
      lastSampleSecondRef.current = telemetry.nextSampleSecond;
      previousInputRef.current = { ...cadence };
      if (next.checkpoint.id !== previousCheckpointId || next.courseTime % 2 < .12) persistCheckpoint(riderId, course, {
        identity: { ...runRef.current, ...checkpointIdentity }, state: next,
      });
      if (next.phase === 'completed') finalize('completed', next);
      frameId = requestAnimationFrame(frame);
    };
    audioRef.current.startWind();
    frameId = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(frameId); audioRef.current.stop(); };
  }, [phase, checkpointIdentity, course, equipment?.id, riderId, finalize, fitnessSessionInstance, log, muted, drainWeapons]);

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
    if (!resume) clearFlightCheckpoint(riderId, course);
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
    void audioRef.current.prime();
    log.info('skyline_glider.flight.started', {
      runId: run.runId, courseId: course.id, courseVersion: course.version,
      riderId, equipmentId: equipment.id, calibration: initial.calibration, resumed: canResume,
    });
  }, [course, equipment, log, riderId, saved.identity, saved.state, saved.status, selectedBike]);

  const requestAdminOverride = async () => {
    if (!riderId || riderId === 'guest') return;
    setAdminPromptOpen(true);
    log.info('skyline_glider.access.override_requested', {
      riderId, equipmentId: equipment?.id,
    });
    const result = await registerAdmin('skyline_glider');
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
    ctx,courses,world:riderWorld,access:{...access,unlocked:accessGranted},saved,saveState,flight,
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
        if(saveState.status==='saved'){lockedCourseRef.current=null;finalizingRef.current=false}
        setChosenActId(effect.actId);
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
        if(current?.phase==='playing'&&!current.stalled&&!current.pausedForSensor&&!current.collisionProtected&&!(cadence?.connected&&cadence.rpm===0))drainWeapons.enqueue([effect.action]);
      }else if(effect.type==='clear-input')drainWeapons.clear?.();
      else if(effect.type==='pause'||effect.type==='suspend'){
        if(runRef.current&&flightRef.current)persistCheckpoint(riderId,course,{identity:{...runRef.current,...checkpointIdentity},state:flightRef.current});
        drainWeapons.clear?.();setPhase('paused')
      }
      else if(effect.type==='toggle-sound')setMuted(value=>{audioRef.current.setMuted(!value);return !value});
      else if(effect.type==='finalize')void finalize('abandoned');
      else if(effect.type==='retry-save'){
        if(saveState.record){finalizingRef.current=false;void finalize(saveState.record.run.status,flightRef.current,saveState.record)}
      }else if(effect.type==='release-selector'){
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
  const panelControls=controller.controls.map(c=>c.position===4&&controller.state.phase==='flights'&&c.label==='Start'&&saved.status==='compatible'?{...c,label:'Resume',hint:'Continue this flight'}:c);
  const pressPanel=(position,gesture='single')=>controller.dispatch({type:'PRESS',position,gesture,source:'touch'});
  const chooseAct = (act) => {
    if (act.status === 'locked') { void requestActUnlock(act); return; }
    setChosenActId(act.id);
    log.info('skyline_glider.act.chosen', { riderId, actId: act.id, status: act.status });
  };

  if(phase==='loading')return <main className="skyline-glider skyline-glider--controls" data-testid="skyline-glider-loading"><p>Charting the course…</p><SkylineControlPanel controls={panelControls.map(c=>({...c,disabled:true}))} onPress={pressPanel}/></main>;
  if(phase==='error')return <main className="skyline-glider skyline-glider--controls"><p role="alert">{error}</p><SkylineControlPanel controls={panelControls} onPress={pressPanel}/></main>;
  if(!['flight','stall'].includes(controller.state.phase))return <main className="skyline-glider skyline-glider--controls"
    data-testid={controller.state.phase==='denied'?'skyline-glider-school-lock':controller.state.phase==='result'||controller.state.phase==='saving'?'skyline-glider-result':controller.state.phase==='countdown'?'skyline-glider-countdown':'skyline-glider-lobby'} data-control-phase={controller.state.phase}>
    <div><SkylineMenus state={controller.state} riders={controller.state.riders} acts={controller.state.acts} onEvent={controller.dispatch}/>
    {saveState.status==='saved'&&<p>Flight saved{saveState.record?.run.reward_rings?' · +'+saveState.record.run.reward_rings+' rings':''}</p>}
    {storageWarning&&<p role="status">{storageWarning}</p>}
    {(adminPromptOpen||actUnlock)&&<p>Present an admin badge to unlock. Bottom-left cancels.</p>}
    </div>
    <SkylineControlPanel controls={panelControls} onPress={(position,gesture)=>{if((adminPromptOpen||actUnlock)&&position===3){setAdminPromptOpen(false);setActUnlock(null);clearUnlock()}else pressPanel(position,gesture)}}/>
    <UnlockPrompt open={adminPromptOpen||!!actUnlock} state={unlockState} lockLabel="Skyline Glider" unlockedUser={unlockedUser} onCancel={()=>{setAdminPromptOpen(false);setActUnlock(null);clearUnlock()}}/>
  </main>;
  return <main className="skyline-glider skyline-glider--flight" data-control-phase={controller.state.phase} data-rider-id={riderId} data-testid="skyline-glider-flight" data-course-time={flight.courseTime}>
    <SkylineControlPanel controls={panelControls} onPress={pressPanel} compact/>
    <FlightScene state={flight} course={course} effects={effects} assets={assets}/>
    <RpmGauge state={flight}/>
    <header className="skyline-glider__hud"><span>♥ {flight.lives}</span><span>{Math.round(flight.rawRpm)} RPM</span><span>{formatTime(course.duration_s - flight.courseTime)}</span><span>🔔 {flight.collectedIds.length}</span>{!!armory.enabled && <span data-testid="skyline-glider-targets">◎ {Object.values(flight.destroyedBy || {}).filter(by => ['laser','bomb','missile'].includes(by)).length}</span>}{!!armory.enabled && <span data-testid="skyline-glider-power">Power {weaponPower(fitnessSessionInstance?.zoneProfileStore?.getProfile?.(riderId))}×</span>}{!!armory.enabled && <span data-testid="skyline-glider-bombs" aria-label="Bombs left">💣 {flight.bombsLeft ?? armory.bombs}</span>}</header>
    {flight.phase === 'crashed' && <div className="skyline-glider__overlay"><h2>{flight.crashCause === 'stall' ? 'Stall!' : 'Wing down!'}</h2><p>Returning to the last windsock…</p></div>}
    {!flight.inputReady && <div className="skyline-glider__overlay" data-testid="skyline-glider-waiting-input"><h2>Ready to fly</h2><p>Pedal once to start the course.</p></div>}
    {flight.inputReady && flight.pausedForSensor && <div className="skyline-glider__overlay" data-testid="skyline-glider-reconnect"><h2>Cadence signal lost</h2><p>Reconnect the bike to continue safely.</p></div>}
    {effects.banner && <div className="skyline-glider__checkpoint-banner">{effects.banner}</div>}
    {flight.stalled && flight.phase === 'playing' && <div className="skyline-glider__stop-warning" role="status">Stalled! Returning to the checkpoint…</div>}
    <button className="skyline-glider__end" onClick={()=>pressPanel(4,'long')}>End flight</button>
    <button className="skyline-glider__mute" aria-pressed={muted} onClick={()=>{audioRef.current.setMuted(!muted);setMuted(!muted)}}>{muted ? 'Sound on' : 'Mute'}</button>
  </main>;
}
