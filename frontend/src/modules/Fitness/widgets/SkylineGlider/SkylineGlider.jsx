import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { validateCourse, resolveCalibration } from '@/modules/Fitness/lib/skylineGlider/courseModel.js';
import { createFlightState, stepFlight } from '@/modules/Fitness/lib/skylineGlider/flightEngine.js';
import { projectCourseWindow } from '@/modules/Fitness/lib/skylineGlider/courseProjection.js';
import { collectFlightTelemetry } from '@/modules/Fitness/lib/skylineGlider/flightTelemetry.js';
import { altitudeToTrackPercent, SKYLINE_CRAFT_GEOMETRY } from '@/modules/Fitness/lib/skylineGlider/flightGeometry.js';
import { createSkylineAudio } from '@/modules/Fitness/lib/skylineGlider/skylineAudio.js';
import { clearFlightCheckpoint, readFlightCheckpoint, writeFlightCheckpoint } from '@/modules/Fitness/lib/skylineGlider/checkpointRepository.js';
import { buildSkylineGliderRun } from '@/modules/Fitness/lib/skylineGlider/runResult.js';
import { listUsableSkylineBikes, selectSkylineBike } from '@/modules/Fitness/lib/skylineGlider/bikeSelection.js';
import './SkylineGlider.scss';

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function TerrainSegment({ segment }) {
  const width = Math.max(4, segment.width);
  if (segment.type === 'lower-terrain') {
    const y = segment.top * 600;
    return <g data-testid={`course-segment-${segment.id}`} data-type={segment.type}>
      <rect x={segment.x} y={y} width={width} height={600 - y} className="skyline-glider__terrain skyline-glider__terrain--lower"/>
      <path d={`M${segment.x} ${y} l22 24 28 -24 32 34 34 -34 H${segment.x + width}`} className="skyline-glider__snowline"/>
    </g>;
  }
  if (segment.type === 'upper-terrain') {
    const y = segment.bottom * 600;
    return <g data-testid={`course-segment-${segment.id}`} data-type={segment.type}>
      <rect x={segment.x} y="0" width={width} height={y} className="skyline-glider__terrain skyline-glider__terrain--upper"/>
      <path d={`M${segment.x} ${y} l24 -20 28 20 30 -28 34 28 H${segment.x + width}`} className="skyline-glider__cave-edge"/>
    </g>;
  }
  if (segment.type === 'corridor') {
    const ceiling = segment.ceiling * 600;
    const floor = segment.floor * 600;
    return <g data-testid={`course-segment-${segment.id}`} data-type={segment.type}>
      <rect x={segment.x} y="0" width={width} height={ceiling} className="skyline-glider__terrain skyline-glider__terrain--upper"/>
      <rect x={segment.x} y={floor} width={width} height={600 - floor} className="skyline-glider__terrain skyline-glider__terrain--lower"/>
      <path d={`M${segment.x} ${ceiling} H${segment.x + width} M${segment.x} ${floor} H${segment.x + width}`} className="skyline-glider__corridor-edge"/>
    </g>;
  }
  if (segment.type === 'checkpoint') {
    return <g data-testid={`course-segment-${segment.id}`} data-type={segment.type} transform={`translate(${segment.x} 0)`} className="skyline-glider__checkpoint">
      <line x1="0" y1="90" x2="0" y2="530"/><path d="M0 100 h72 l-20 25 20 25 H0Z"/>
    </g>;
  }
  if (segment.type === 'finish') {
    return <g data-testid={`course-segment-${segment.id}`} data-type={segment.type} transform={`translate(${segment.x} 0)`} className="skyline-glider__finish">
      <path d="M-45 510 V170 Q0 80 45 170 V510"/>
    </g>;
  }
  return null;
}

export function FlightScene({ state, course, effects = {} }) {
  const projected = projectCourseWindow(course, state.courseTime);
  const craftX = projected.playerX;
  const craftY = state.altitude * projected.height;
  const pitch = clamp((state.verticalRate || 0) * 50, -12, 12);
  const craftFront = SKYLINE_CRAFT_GEOMETRY.frontSeconds * projected.unitsPerSecond;
  const craftRear = SKYLINE_CRAFT_GEOMETRY.rearSeconds * projected.unitsPerSecond;
  const craftRadius = SKYLINE_CRAFT_GEOMETRY.radius * projected.height;
  const farOffset = -((state.courseTime * 10) % 1000);
  const middleOffset = -((state.courseTime * 22) % 1000);
  const nearOffset = -((state.courseTime * 38) % 1000);
  return <svg className="skyline-glider__scene" viewBox="0 0 1000 600" role="img" aria-label="Alpine flight course">
    <defs>
      <linearGradient id="glider-sky" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#78bce8"/><stop offset="1" stopColor="#f8d69a"/></linearGradient>
      <linearGradient id="glider-rock" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#42685e"/><stop offset="1" stopColor="#193d38"/></linearGradient>
    </defs>
    <rect width="1000" height="600" fill="url(#glider-sky)"/>
    <g className="skyline-glider__parallax skyline-glider__parallax--far" transform={`translate(${farOffset} 0)`}>
      <path d="M0 420 L130 250 260 420 420 210 590 420 760 260 1000 420 1130 250 1260 420 1420 210 1590 420 1760 260 2000 420 V600 H0Z"/>
    </g>
    <g className="skyline-glider__parallax skyline-glider__parallax--middle" transform={`translate(${middleOffset} 0)`}>
      <path d="M0 490 L170 360 330 480 520 330 690 490 860 350 1000 470 1170 360 1330 480 1520 330 1690 490 1860 350 2000 470 V600 H0Z"/>
    </g>
    <g className="skyline-glider__parallax skyline-glider__parallax--near" transform={`translate(${nearOffset} 0)`}>
      <path d="M0 535 Q180 465 350 530 T700 510 T1000 530 Q1180 465 1350 530 T1700 510 T2000 530 V600 H0Z"/>
    </g>
    <g className="skyline-glider__course-geometry">
      {projected.segments.map((segment) => <TerrainSegment key={segment.id} segment={segment}/>)}
      {projected.collectibles.filter((item) => !(state.collectedIds || []).includes(item.id)).map((item) => <g key={item.id} transform={`translate(${item.x} ${item.y})`} className="skyline-glider__bell" data-testid={`course-collectible-${item.id}`}>
        <path d="M-12 9 Q-9 1 -7 -10 Q0 -18 7 -10 Q9 1 12 9Z"/><circle cy="12" r="3"/>
      </g>)}
    </g>
    <g className="skyline-glider__wind" transform={`translate(${craftX - 72} ${craftY})`}><path d="M0 -14 h42 M-18 0 h55 M5 14 h32"/></g>
    <g data-testid="skyline-glider-craft" data-facing="right" data-front-seconds={SKYLINE_CRAFT_GEOMETRY.frontSeconds} data-rear-seconds={SKYLINE_CRAFT_GEOMETRY.rearSeconds} data-radius={SKYLINE_CRAFT_GEOMETRY.radius} transform={`translate(${craftX} ${craftY}) rotate(${pitch})`} className="skyline-glider__craft">
      <path d={`M-${craftRear} -7 L4 -15 ${craftFront} 0 L6 12 L-${craftRear - 6} 8 L-${craftRear} 1Z`} className="skyline-glider__wing"/>
      <path d={`M-${craftRear - 18} 2 Q4 -3 ${craftFront - 14} 0 Q6 8 -${craftRear - 16} 7Z`} className="skyline-glider__body"/>
      <path d={`M-${craftRear - 24} 4 L-${craftRear - 10} ${craftRadius - 6} M-${craftRear - 10} ${craftRadius - 6} L-${craftRear - 2} ${craftRadius - 1}`} className="skyline-glider__frame"/>
      <circle cx={-(craftRear - 12)} cy={craftRadius - 6} r="4" className="skyline-glider__pilot"/>
      {(effects.collisionKey || state.invincibleRemaining > 0) && <g key={effects.collisionKey || 'protected'} data-testid="skyline-glider-collision-effect" className="skyline-glider__collision-burst"><path d="M-62 -34 l-16 -18 M-67 0 h-28 M-55 31 l-20 16 M43 -28 l18 -16 M57 15 l25 8"/></g>}
      {(effects.pops || []).map((pop) => <g key={pop.key} className="skyline-glider__bell-pop"><circle r="28"/><path d="M-30 0 H30 M0 -30 V30"/></g>)}
    </g>
  </svg>;
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
  const log = useMemo(() => getLogger().child({ component: 'skyline-glider' }), []);
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('loading');
  const [countdown, setCountdown] = useState(3);
  const [flight, setFlight] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle', record: null });
  const [muted, setMuted] = useState(false);
  const [preferredEquipmentId, setPreferredEquipmentId] = useState(null);
  const [effects, setEffects] = useState({ collisionKey: 0, pops: [], banner: null });
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
  if (!audioRef.current) audioRef.current = createSkylineAudio();
  const fitnessSessionInstance = ctx?.fitnessSessionInstance;
  const setGovernanceSuspended = ctx?.setGovernanceSuspended;
  const usableBikes = listUsableSkylineBikes(ctx?.equipment, fitnessSessionInstance);
  const selectedBike = selectSkylineBike(ctx?.equipment, fitnessSessionInstance, preferredEquipmentId);
  const activeBike = lockedSelectionRef.current || selectedBike;
  const equipment = activeBike?.equipment || null;
  const riderId = activeBike?.riderId || null;
  const course = courses[0] || null;
  const checkpointIdentity = useMemo(() => course && equipment && riderId ? {
    fitnessSessionId: fitnessSessionInstance?.sessionId || null,
    riderId,
    equipmentId: equipment.id,
    calibration: resolveCalibration(equipment),
  } : null, [course, equipment, fitnessSessionInstance?.sessionId, riderId]);
  const saved = course && checkpointIdentity ? readFlightCheckpoint(riderId, course, checkpointIdentity) : { status: 'missing' };

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

  useEffect(() => () => {
    effectTimersRef.current.forEach((timer) => clearTimeout(timer));
    effectTimersRef.current.clear();
    audioRef.current.stop();
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/fitness/skyline-glider/courses').then(async (response) => {
      if (!response.ok) throw new Error(`course request failed (${response.status})`);
      const body = await response.json();
      const valid = (body.courses || []).map(validateCourse).filter((entry) => entry.valid).map((entry) => entry.course);
      if (!valid.length) throw new Error('No playable courses');
      if (active) { setCourses(valid); setPhase('lobby'); }
    }).catch((requestError) => {
      log.error('skyline_glider.courses.error', { error: requestError.message });
      if (active) { setError('Mountain weather unavailable. Try again.'); setPhase('error'); }
    });
    return () => { active = false; };
  }, [log]);

  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    const timer = setInterval(() => setCountdown((value) => {
      if (value <= 1) { clearInterval(timer); setPhase('flight'); return 0; }
      return value - 1;
    }), 1000);
    return () => clearInterval(timer);
  }, [phase]);

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
    writeFlightCheckpoint(riderId, course, {
      identity: { ...runRef.current, ...checkpointIdentity }, state: terminalState,
      lifecycle: 'pending_terminal', terminalRecord: record,
    });
    try {
      const response = await fetch('/api/v1/fitness/skyline-glider/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record }) });
      if (!response.ok) throw new Error(`save failed (${response.status})`);
      if (status === 'completed') {
        fitnessSessionInstance?.treasureBox?.awardBonus?.({
          idempotencyKey: `rpm-flight:${record.run.id}:completion:${riderId}`,
          userId: riderId, rings: record.run.reward_rings, zoneId: 'skyline-glider', color: '#e0a85b',
          source: 'skyline-glider', metadata: { courseId: course.id, collectibles: record.collectibles.length },
        });
      }
      clearFlightCheckpoint(riderId, course);
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
  }, [checkpointIdentity, course, equipment?.id, fitnessSessionInstance, log, riderId]);

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
      const next = stepFlight(previous, cadence, Math.min(.1, Math.max(0, (now - prior) / 1000)), course);
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
          executeCue('collision-cue', 'collision');
        } else if (event.type === 'collectible') {
          executeVisual('bell-pop', () => {
            const key = `${event.data.collectibleId}-${next.courseTime}`;
            setEffects((current) => ({ ...current, pops: [...current.pops, { key }] }));
            const timer = setTimeout(() => setEffects((current) => ({ ...current, pops: current.pops.filter((pop) => pop.key !== key) })), 600);
            effectTimersRef.current.add(timer);
          });
          executeCue('bell-cue', 'bell');
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
      if (next.checkpoint.id !== previousCheckpointId || next.courseTime % 2 < .12) writeFlightCheckpoint(riderId, course, {
        identity: { ...runRef.current, ...checkpointIdentity }, state: next,
      });
      if (next.phase === 'completed') finalize('completed', next);
      frameId = requestAnimationFrame(frame);
    };
    audioRef.current.startWind();
    frameId = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(frameId); audioRef.current.stop(); };
  }, [phase, checkpointIdentity, course, equipment?.id, riderId, finalize, fitnessSessionInstance, log, muted]);

  const begin = (resume = false) => {
    if (!equipment || !riderId || !course) return;
    const armedAtMs = Date.now();
    const initial = createFlightState(course, { calibration: resolveCalibration(equipment), armedAtMs });
    const canResume = resume && saved.status === 'compatible';
    const next = canResume ? {
      ...initial, ...saved.state,
      phase: 'playing', pausedForSensor: false, collisionProtected: false,
      armedAtMs, inputReady: false, lastInputTs: null,
    } : initial;
    if (!resume) clearFlightCheckpoint(riderId, course);
    flightRef.current = next;
    const run = canResume ? { runId: saved.identity.runId, startedAt: saved.identity.startedAt } : {
      runId: globalThis.crypto?.randomUUID?.() || `flight-${Date.now()}`,
      startedAt: new Date().toISOString(),
    };
    runRef.current = run;
    lockedSelectionRef.current = selectedBike;
    finalizingRef.current = false;
    lastSampleSecondRef.current = -1;
    previousInputRef.current = null;
    setSaveState({ status: 'idle', record: null });
    setFlight(next);
    setCountdown(3);
    setPhase('countdown');
    void audioRef.current.prime();
    log.info('skyline_glider.flight.started', {
      runId: run.runId, courseId: course.id, courseVersion: course.version,
      riderId, equipmentId: equipment.id, calibration: initial.calibration, resumed: canResume,
    });
  };

  const exitFlight = () => {
    log.info('skyline_glider.flight.exited', {
      runId: runRef.current?.runId, riderId, equipmentId: equipment?.id,
      courseId: course?.id, courseVersion: course?.version,
      courseTime: flightRef.current?.courseTime,
    });
    finalize('abandoned');
  };

  const startOver = async () => {
    if (saved.status !== 'compatible' || !selectedBike) return;
    lockedSelectionRef.current = selectedBike;
    runRef.current = { runId: saved.identity.runId, startedAt: saved.identity.startedAt };
    flightRef.current = saved.state;
    setFlight(saved.state);
    finalizingRef.current = false;
    const persisted = await finalize('abandoned', saved.state);
    if (!persisted) return;
    lockedSelectionRef.current = null;
    begin(false);
  };

  if (phase === 'loading') return <main className="skyline-glider" data-testid="skyline-glider-loading">Charting the course…</main>;
  if (phase === 'error') return <main className="skyline-glider"><h1>Skyline Glider</h1><p role="alert">{error}</p></main>;
  if (phase === 'lobby') return <main className="skyline-glider skyline-glider--lobby" data-testid="skyline-glider-lobby">
    <div><p className="skyline-glider__eyebrow">Alpine cadence adventure</p><h1>Skyline Glider</h1><h2>{course.name}</h2><p>{course.description}</p><p>Pedal faster to climb. Ease off to descend.</p></div>
    <div className="skyline-glider__launch"><span>{equipment ? equipment.name : 'Connect and assign a cadence bike'}</span><span>{riderId ? ctx?.getDisplayName?.(riderId)?.displayName || riderId : 'Waiting for a live rider'}</span>
      {usableBikes.length > 1 && <label>Bike <select aria-label="Bike" value={equipment?.id || ''} onChange={(event) => setPreferredEquipmentId(event.target.value)}>{usableBikes.map((item) => <option key={item.equipment.id} value={item.equipment.id}>{item.equipment.name}</option>)}</select></label>}
      {saved.status === 'compatible' ? <><button onClick={() => begin(true)}>Resume flight</button><button className="secondary" onClick={() => void startOver()}>Start over</button></> : saved.status === 'pending_terminal' ? <button onClick={() => {
        lockedSelectionRef.current = selectedBike;
        runRef.current = { runId: saved.identity.runId, startedAt: saved.identity.startedAt };
        flightRef.current = saved.state;
        setFlight(saved.state);
        setSaveState({ status: 'error', record: saved.terminalRecord });
        setPhase('result');
      }}>Retry saving previous flight</button> : <button disabled={!equipment || !riderId} onClick={() => begin(false)}>Start flight</button>}
    </div>
  </main>;
  if (phase === 'countdown') return <main className="skyline-glider skyline-glider--countdown" data-testid="skyline-glider-countdown"><p>Ready your wings</p><strong>{countdown}</strong></main>;
  if (phase === 'result') return <main className="skyline-glider skyline-glider--result" data-testid="skyline-glider-result"><p>{saveState.record?.run.status === 'completed' ? 'Mountain Pass complete' : 'Flight ended'}</p><h1>{saveState.record?.run.status === 'completed' ? 'Touchdown!' : 'Back at base'}</h1><p>{flight?.collectedIds?.length || 0} bells found · {flight?.collisions || 0} bumps</p>{saveState.status === 'saving' && <p>Saving flight…</p>}{saveState.status === 'error' && <button onClick={() => finalize(saveState.record.run.status, flight, saveState.record)}>Retry save</button>}{saveState.status === 'saved' && <p>{saveState.record.run.reward_rings ? `+${saveState.record.run.reward_rings} rings` : 'Flight saved'}</p>}<button onClick={() => { lockedSelectionRef.current = null; setPhase('lobby'); setFlight(null); }}>Fly again</button></main>;
  return <main className="skyline-glider skyline-glider--flight" data-testid="skyline-glider-flight" data-course-time={flight.courseTime}>
    <FlightScene state={flight} course={course} effects={effects}/>
    <RpmGauge state={flight}/>
    <header className="skyline-glider__hud"><span>♥ {flight.lives}</span><span>{Math.round(flight.rawRpm)} RPM</span><span>{formatTime(course.duration_s - flight.courseTime)}</span><span>🔔 {flight.collectedIds.length}</span></header>
    {flight.phase === 'crashed' && <div className="skyline-glider__overlay"><h2>Wing down!</h2><p>Returning to the last windsock…</p></div>}
    {!flight.inputReady && <div className="skyline-glider__overlay" data-testid="skyline-glider-waiting-input"><h2>Ready to fly</h2><p>Pedal once to start the course.</p></div>}
    {flight.inputReady && flight.pausedForSensor && <div className="skyline-glider__overlay" data-testid="skyline-glider-reconnect"><h2>Cadence signal lost</h2><p>Reconnect the bike to continue safely.</p></div>}
    {effects.banner && <div className="skyline-glider__checkpoint-banner">{effects.banner}</div>}
    <button className="skyline-glider__end" onClick={exitFlight}>End flight</button>
    <button className="skyline-glider__mute" aria-pressed={muted} onClick={() => setMuted((value) => { const next = !value; audioRef.current.setMuted(next); return next; })}>{muted ? 'Sound on' : 'Mute'}</button>
  </main>;
}
