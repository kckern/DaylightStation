import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { validateCourse, resolveCalibration } from '@/modules/Fitness/lib/skylineGlider/courseModel.js';
import { createFlightState, stepFlight } from '@/modules/Fitness/lib/skylineGlider/flightEngine.js';
import { clearFlightCheckpoint, readFlightCheckpoint, writeFlightCheckpoint } from '@/modules/Fitness/lib/skylineGlider/checkpointRepository.js';
import { buildSkylineGliderRun } from '@/modules/Fitness/lib/skylineGlider/runResult.js';
import './SkylineGlider.scss';

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function selectBike(equipment = []) {
  const cadenceEquipment = equipment.filter((item) => item?.cadence != null);
  return cadenceEquipment.find((item) => item.id === 'niceday')
    || cadenceEquipment.find((item) => item.id === 'cycle_ace')
    || cadenceEquipment[0]
    || null;
}

function Scene({ state, course }) {
  const x = Math.min(100, state.courseTime / course.duration_s * 100);
  const y = state.altitude * 100;
  return <svg className="skyline-glider__scene" viewBox="0 0 1000 600" role="img" aria-label="Alpine flight course">
    <defs><linearGradient id="glider-sky" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#78bce8"/><stop offset="1" stopColor="#f8d69a"/></linearGradient></defs>
    <rect width="1000" height="600" fill="url(#glider-sky)"/>
    <path d="M0 430 L120 300 230 410 380 230 520 420 680 250 820 430 1000 290 1000 600 0 600Z" fill="#456b62" opacity=".55"/>
    <path d="M0 485 Q160 420 330 490 T680 470 T1000 485 V600 H0Z" fill="#25473e"/>
    <g transform={`translate(${100 + x * 7.5} ${70 + y * 4.3})`} className="skyline-glider__craft">
      <path d="M-45 5 L0-18 48 5 8 0 0 18 -8 0Z" fill="#fff4cf" stroke="#553b2f" strokeWidth="4"/>
      <circle cx="0" cy="14" r="5" fill="#553b2f"/>
    </g>
  </svg>;
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
  const flightRef = useRef(null);
  const runRef = useRef(null);
  const finalizingRef = useRef(false);
  const equipment = selectBike(ctx?.equipment);
  const riderId = equipment ? ctx?.fitnessSessionInstance?.getEquipmentRider?.(equipment.id) : null;
  const course = courses[0] || null;
  const saved = course && riderId ? readFlightCheckpoint(riderId, course.id) : null;

  useEffect(() => {
    ctx?.setGovernanceSuspended?.(true);
    return () => ctx?.setGovernanceSuspended?.(false);
  }, [ctx?.setGovernanceSuspended]);

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
    if (!runRef.current || finalizingRef.current) return;
    finalizingRef.current = true;
    const record = retryRecord || buildSkylineGliderRun({
      ...runRef.current, course, riderId, state: terminalState, status,
      endedAt: new Date().toISOString(),
    });
    setSaveState({ status: 'saving', record });
    try {
      const response = await fetch('/api/v1/fitness/skyline-glider/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record }) });
      if (!response.ok) throw new Error(`save failed (${response.status})`);
      if (status === 'completed') {
        ctx?.fitnessSessionInstance?.treasureBox?.awardBonus?.({
          idempotencyKey: `rpm-flight:${record.run.id}:completion:${riderId}`,
          userId: riderId, rings: record.run.reward_rings, zoneId: 'skyline-glider', color: '#e0a85b',
          source: 'skyline-glider', metadata: { courseId: course.id, collectibles: record.collectibles.length },
        });
        clearFlightCheckpoint(riderId, course.id);
      }
      setSaveState({ status: 'saved', record });
      setPhase('result');
      log.info('skyline_glider.flight.saved', { runId: record.run.id, status });
    } catch (saveError) {
      finalizingRef.current = false;
      setSaveState({ status: 'error', record });
      setPhase('result');
      log.error('skyline_glider.flight.save_error', { runId: record.run.id, error: saveError.message });
    }
  }, [course, ctx?.fitnessSessionInstance, log, riderId]);

  useEffect(() => {
    if (phase !== 'flight' || !flightRef.current) return undefined;
    let prior = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const cadence = ctx?.fitnessSessionInstance?.getEquipmentCadence?.(equipment?.id) || { rpm: 0, connected: false };
      const previousCheckpointId = flightRef.current.checkpoint.id;
      const next = stepFlight(flightRef.current, cadence, Math.min(.25, (now - prior) / 1000), course);
      prior = now;
      flightRef.current = next;
      setFlight(next);
      if (next.checkpoint.id !== previousCheckpointId || next.courseTime % 2 < .12) writeFlightCheckpoint(riderId, course.id, next);
      if (next.phase === 'completed') finalize('completed', next);
    }, 100);
    return () => clearInterval(timer);
  }, [phase, course, ctx?.fitnessSessionInstance, equipment?.id, riderId, finalize]);

  const begin = (resume = false) => {
    if (!equipment || !riderId || !course) return;
    const initial = createFlightState(course, { calibration: resolveCalibration(equipment) });
    const next = resume && saved ? { ...initial, ...saved, phase: 'playing', pausedForSensor: false, collisionProtected: false } : initial;
    if (!resume) clearFlightCheckpoint(riderId, course.id);
    flightRef.current = next;
    runRef.current = { runId: globalThis.crypto?.randomUUID?.() || `flight-${Date.now()}`, startedAt: new Date().toISOString() };
    finalizingRef.current = false;
    setSaveState({ status: 'idle', record: null });
    setFlight(next);
    setCountdown(3);
    setPhase('countdown');
    log.info('skyline_glider.flight.started', { courseId: course.id, riderId, resumed: resume });
  };

  if (phase === 'loading') return <main className="skyline-glider" data-testid="skyline-glider-loading">Charting the course…</main>;
  if (phase === 'error') return <main className="skyline-glider"><h1>Skyline Glider</h1><p role="alert">{error}</p></main>;
  if (phase === 'lobby') return <main className="skyline-glider skyline-glider--lobby" data-testid="skyline-glider-lobby">
    <div><p className="skyline-glider__eyebrow">Alpine cadence adventure</p><h1>Skyline Glider</h1><h2>{course.name}</h2><p>{course.description}</p><p>Pedal faster to climb. Ease off to descend.</p></div>
    <div className="skyline-glider__launch"><span>{equipment ? equipment.name : 'Connect a cadence bike'}</span><span>{riderId ? ctx?.getDisplayName?.(riderId) || riderId : 'Assign a rider'}</span>
      {saved ? <><button onClick={() => begin(true)}>Resume flight</button><button className="secondary" onClick={() => begin(false)}>Start over</button></> : <button disabled={!equipment || !riderId} onClick={() => begin(false)}>Start flight</button>}
    </div>
  </main>;
  if (phase === 'countdown') return <main className="skyline-glider skyline-glider--countdown" data-testid="skyline-glider-countdown"><p>Ready your wings</p><strong>{countdown}</strong></main>;
  if (phase === 'result') return <main className="skyline-glider skyline-glider--result" data-testid="skyline-glider-result"><p>{saveState.record?.run.status === 'completed' ? 'Mountain Pass complete' : 'Flight ended'}</p><h1>{saveState.record?.run.status === 'completed' ? 'Touchdown!' : 'Back at base'}</h1><p>{flight.collectedIds.length} bells found · {flight.collisions} bumps</p>{saveState.status === 'saving' && <p>Saving flight…</p>}{saveState.status === 'error' && <button onClick={() => finalize(saveState.record.run.status, flight, saveState.record)}>Retry save</button>}{saveState.status === 'saved' && <p>{saveState.record.run.reward_rings ? `+${saveState.record.run.reward_rings} rings` : 'Flight saved'}</p>}<button onClick={() => { setPhase('lobby'); setFlight(null); }}>Fly again</button></main>;
  return <main className="skyline-glider skyline-glider--flight" data-testid="skyline-glider-flight">
    <Scene state={flight} course={course}/>
    <header className="skyline-glider__hud"><span>♥ {flight.lives}</span><span>{Math.round(flight.rawRpm)} RPM</span><span>{formatTime(course.duration_s - flight.courseTime)}</span><span>🔔 {flight.collectedIds.length}</span></header>
    {flight.phase === 'crashed' && <div className="skyline-glider__overlay"><h2>Wing down!</h2><p>Returning to the last windsock…</p></div>}
    {flight.pausedForSensor && <div className="skyline-glider__overlay" data-testid="skyline-glider-reconnect"><h2>Cadence signal lost</h2><p>Reconnect the bike to continue safely.</p></div>}
    <button className="skyline-glider__end" onClick={() => finalize('abandoned')}>End flight</button>
  </main>;
}
