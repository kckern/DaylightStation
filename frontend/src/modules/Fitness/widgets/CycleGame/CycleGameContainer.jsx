import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { CycleRaceController } from '@/modules/Fitness/lib/cycleGame/CycleRaceController.js';
import { buildRaceConfigFromCourse } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { buildRaceRecord } from '@/modules/Fitness/lib/cycleGame/raceRecord.js';
import { zoneMultiplierFor } from '@/modules/Fitness/lib/cycleGame/distanceModel.js';
import CycleGameHome from './CycleGameHome.jsx';
import CountdownStoplight from './CountdownStoplight.jsx';
import CycleRaceScreen from './CycleRaceScreen.jsx';
import RaceResults from './RaceResults.jsx';
import './CycleGameContainer.scss';

const RACE_TICK_MS = 1000;
const COUNTDOWN_TICK_MS = 1000;

/**
 * Default course presets when the fitness config exposes no cycle_game.courses.
 * Always offers a distance race and a time race so both win conditions are
 * reachable from the home screen.
 */
function deriveCourses(cfg) {
  const configured = Array.isArray(cfg?.courses) ? cfg.courses : [];
  if (configured.length > 0) return configured;
  const goalM = Number.isFinite(cfg?.distance_goal_default_m) ? cfg.distance_goal_default_m : 3000;
  const timeCapS = Number.isFinite(cfg?.time_cap_default_s) ? cfg.time_cap_default_s : 300;
  return [
    { id: 'distance', name: `Distance — ${goalM} m`, win_condition: 'distance', goal_m: goalM },
    { id: 'time', name: `Time — ${Math.round(timeCapS / 60)} min`, win_condition: 'time', time_cap_s: timeCapS }
  ];
}

/**
 * Live cycle-game lifecycle container. Composes the prop-driven screens
 * (CycleGameHome / CountdownStoplight / CycleRaceScreen / RaceResults) with the
 * Plan-4 CycleRaceController and live fitness data (claimed riders, per-bike
 * RPM, per-user HR zone). Emits the lifecycle log contract.
 */
export default function CycleGameContainer({ onMount } = {}) {
  const ctx = useFitnessContext();
  const log = useMemo(() => getLogger().child({ component: 'cycle-game' }), []);

  const {
    equipment = [],
    zones = [],
    cycleGameConfig = {},
    fitnessSessionInstance: session,
    getUserVitals,
    getDisplayName,
    getUserByName
  } = ctx;

  const courses = useMemo(() => deriveCourses(cycleGameConfig), [cycleGameConfig]);
  const cadenceBands = useMemo(
    () => (Array.isArray(cycleGameConfig?.cadence_zones) ? cycleGameConfig.cadence_zones : []),
    [cycleGameConfig]
  );
  const hrlessMultiplier = Number.isFinite(cycleGameConfig?.hrless_multiplier)
    ? cycleGameConfig.hrless_multiplier
    : 1;

  // Bikes (equipment carrying a cadence sensor and a wheel circumference).
  const bikes = useMemo(
    () => (Array.isArray(equipment) ? equipment : []).filter((e) => e && e.cadence != null),
    [equipment]
  );

  const resolveDisplayName = useCallback((userId) => {
    if (!userId) return userId;
    const vitals = getUserVitals?.(userId);
    if (vitals?.name) return vitals.name;
    const user = getUserByName?.(userId);
    if (user?.name) return user.name;
    return getDisplayName?.(userId) || userId;
  }, [getUserVitals, getUserByName, getDisplayName]);

  // Resolve the currently-claimed riders (bikes with a getEquipmentRider claim).
  const buildRiders = useCallback(() => {
    const riders = [];
    bikes.forEach((bike) => {
      const userId = session?.getEquipmentRider?.(bike.id) || null;
      if (!userId) return;
      riders.push({
        userId,
        displayName: resolveDisplayName(userId),
        equipmentId: bike.id,
        wheelCircumferenceM: Number.isFinite(bike.wheel_circumference_m) ? bike.wheel_circumference_m : 0
      });
    });
    return riders;
  }, [bikes, session, resolveDisplayName]);

  // ── lifecycle state ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle'); // idle | countdown | racing | results
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [snapshot, setSnapshot] = useState(null); // controller.getState()
  const controllerRef = useRef(null);
  const raceMetaRef = useRef(null);
  const startCountdownRef = useRef(3);
  const savedRef = useRef(false);
  const prevDnfRef = useRef(new Set());

  // Map controller phases to render phases.
  const applySnapshot = useCallback((state) => {
    setSnapshot(state);
    if (!state) return;
    if (state.phase === 'countdown' || state.phase === 'staged') setPhase('countdown');
    else if (state.phase === 'racing') setPhase('racing');
    else if (state.phase === 'finished' || state.phase === 'results') setPhase('results');
    else if (state.phase === 'cancelled') setPhase('idle');
  }, []);

  // Roster shown on the home screen (live = the bike has a fresh RPM reading).
  const homeRiders = useMemo(() => buildRiders().map((r) => {
    const cadence = session?.getEquipmentCadence?.(r.equipmentId);
    return { userId: r.userId, displayName: r.displayName, live: !!(cadence && cadence.connected && cadence.rpm > 0) };
  }), [buildRiders, session, snapshot, phase]);

  // ── home → stage + start ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'idle') {
      log.info('cycle_game.home', { courses: courses.length, riderCount: buildRiders().length });
    }
    // run once on entering idle; depend on phase only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startRace = useCallback(() => {
    const course = courses.find((c) => c.id === selectedCourseId) || courses[0];
    if (!course) {
      log.warn('cycle_game.staged', { error: 'no_course' });
      return;
    }
    const riders = buildRiders();
    if (riders.length === 0) {
      log.warn('cycle_game.staged', { courseId: course.id, error: 'no_riders' });
      return;
    }
    const cfg = buildRaceConfigFromCourse(course, {
      riders,
      zones,
      hrlessMultiplier,
      startCountdownS: Number.isFinite(cycleGameConfig?.start_countdown_s) ? cycleGameConfig.start_countdown_s : 3,
      raceIdleDnfS: Number.isFinite(cycleGameConfig?.race_idle_dnf_s) ? cycleGameConfig.race_idle_dnf_s : 20,
      intervalMs: RACE_TICK_MS
    });

    const raceId = `cr_${Date.now()}`;
    raceMetaRef.current = {
      raceId,
      date: new Date().toISOString(),
      mode: cfg.mode,
      winCondition: cfg.winCondition,
      goalM: cfg.goalM,
      timeCapS: cfg.timeCapS,
      intervalSeconds: cfg.intervalMs / 1000,
      backgroundPlexId: cfg.backgroundPlexId
    };
    startCountdownRef.current = cfg.startCountdownS;
    savedRef.current = false;
    prevDnfRef.current = new Set();

    const controller = new CycleRaceController(cfg);
    controllerRef.current = controller;

    log.info('cycle_game.staged', {
      courseId: course.id,
      winCondition: cfg.winCondition,
      ...(cfg.winCondition === 'distance' ? { goalM: cfg.goalM } : { timeCapS: cfg.timeCapS }),
      riders: riders.map((r) => r.userId)
    });

    applySnapshot(controller.startCountdown());
  }, [courses, selectedCourseId, buildRiders, zones, hrlessMultiplier, cycleGameConfig, applySnapshot, log]);

  // ── countdown interval ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    const controller = controllerRef.current;
    if (!controller) return undefined;
    log.debug('cycle_game.countdown', { remaining: controller.getState().countdownRemaining });
    const id = setInterval(() => {
      const c = controllerRef.current;
      if (!c) return;
      const state = c.countdownTick();
      log.debug('cycle_game.countdown', { remaining: state.countdownRemaining });
      if (state.phase === 'racing') {
        log.info('cycle_game.race_started', {
          raceId: raceMetaRef.current?.raceId,
          riders: Object.keys(state.engineState?.riders || {}),
          winCondition: raceMetaRef.current?.winCondition
        });
      }
      applySnapshot(state);
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [phase, applySnapshot, log]);

  // ── race interval ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'racing') return undefined;
    const id = setInterval(() => {
      const controller = controllerRef.current;
      if (!controller) return;
      const before = controller.getState();
      const inputs = {};
      Object.keys(before.engineState?.riders || {}).forEach((userId) => {
        const rider = before.engineState.riders[userId];
        const cadence = session?.getEquipmentCadence?.(rider.equipmentId);
        const vitals = getUserVitals?.(userId);
        inputs[userId] = {
          rpm: cadence && cadence.connected ? cadence.rpm : 0,
          zoneId: vitals?.zoneId || null
        };
      });
      const state = controller.tick(inputs);

      // DNF detection — diff the controller dnf set.
      const dnfSet = new Set(state.dnf || []);
      dnfSet.forEach((userId) => {
        if (!prevDnfRef.current.has(userId)) {
          log.info('cycle_game.rider_dnf', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            elapsedS: state.engineState?.elapsedS ?? null
          });
        }
      });
      prevDnfRef.current = dnfSet;

      if (state.phase === 'finished') {
        const finalState = controller.showResults();
        const standings = finalState.engineState?.standings || [];
        log.info('cycle_game.race_finished', {
          raceId: raceMetaRef.current?.raceId,
          standings: standings.map((s) => ({
            userId: s.userId,
            placement: s.placement,
            finishTimeS: s.finishTimeS,
            distanceM: s.distanceM
          }))
        });
        applySnapshot(finalState);
        return;
      }
      applySnapshot(state);
    }, RACE_TICK_MS);
    return () => clearInterval(id);
  }, [phase, session, getUserVitals, applySnapshot, log]);

  // ── save the record once on results ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'results') return;
    if (savedRef.current) return;
    savedRef.current = true;
    const controller = controllerRef.current;
    const meta = raceMetaRef.current;
    const engineState = controller?.getState()?.engineState;
    if (!engineState || !meta) {
      log.warn('cycle_game.race_saved', { raceId: meta?.raceId || null, ok: false, error: 'no_state' });
      return;
    }
    const record = buildRaceRecord(engineState, meta);
    (async () => {
      try {
        const resp = await fetch('/api/v1/fitness/cycle-races', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record })
        });
        const ok = resp.ok;
        log.info('cycle_game.race_saved', { raceId: meta.raceId, ok });
      } catch (err) {
        log.error('cycle_game.race_saved', { raceId: meta.raceId, ok: false, error: err?.message || String(err) });
      }
    })();
  }, [phase, log]);

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  // ── handlers ─────────────────────────────────────────────────────────────
  const onSelectCourse = useCallback((course) => {
    setSelectedCourseId(course?.id ?? null);
  }, []);

  const onCancel = useCallback(() => {
    const controller = controllerRef.current;
    const raceId = raceMetaRef.current?.raceId || null;
    if (controller) controller.cancel();
    log.info('cycle_game.cancelled', { raceId });
    controllerRef.current = null;
    raceMetaRef.current = null;
    setSnapshot(null);
    setPhase('idle');
  }, [log]);

  const backToHome = useCallback(() => {
    controllerRef.current = null;
    raceMetaRef.current = null;
    setSnapshot(null);
    setSelectedCourseId(null);
    setPhase('idle');
  }, []);

  // ── render ───────────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="cycle-game-container" data-testid="cycle-game-container">
        <CycleGameHome
          courses={courses}
          riders={homeRiders}
          records={[]}
          onSelectCourse={onSelectCourse}
          onCustom={() => {}}
        />
        <div className="cycle-game-container__controls">
          <button
            type="button"
            data-testid="cycle-game-start"
            className="cycle-game-container__start"
            onClick={startRace}
          >
            Start race{selectedCourseId ? '' : ' (first course)'}
          </button>
          <button
            type="button"
            data-testid="cycle-game-cancel"
            className="cycle-game-container__cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'countdown') {
    const remaining = snapshot?.countdownRemaining ?? startCountdownRef.current;
    return (
      <div className="cycle-game-container" data-testid="cycle-game-container">
        <CountdownStoplight remaining={remaining} total={startCountdownRef.current} />
        <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (phase === 'racing') {
    const engineState = snapshot?.engineState || {};
    const riders = engineState.riders || {};
    const riderLive = {};
    Object.keys(riders).forEach((userId) => {
      const cadence = session?.getEquipmentCadence?.(riders[userId].equipmentId);
      const vitals = getUserVitals?.(userId) || {};
      const zoneId = vitals.zoneId || null;
      riderLive[userId] = {
        rpm: cadence && cadence.connected ? cadence.rpm : 0,
        heartRate: vitals.heartRate ?? null,
        zoneId,
        zoneColor: vitals.zoneColor || null,
        zoneProgress: vitals.progress ?? null,
        multiplier: zoneMultiplierFor(zoneId, zones, hrlessMultiplier)
      };
    });
    return (
      <div className="cycle-game-container" data-testid="cycle-game-container">
        <CycleRaceScreen
          winCondition={engineState.winCondition || raceMetaRef.current?.winCondition || 'distance'}
          goalM={engineState.goalM ?? raceMetaRef.current?.goalM ?? 3000}
          timeCapS={engineState.timeCapS ?? raceMetaRef.current?.timeCapS ?? 300}
          elapsedS={engineState.elapsedS || 0}
          riders={riders}
          riderLive={riderLive}
          cadenceBands={cadenceBands}
          backgroundPlexId={raceMetaRef.current?.backgroundPlexId || null}
        />
        <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  // results
  const engineState = snapshot?.engineState || {};
  return (
    <div className="cycle-game-container" data-testid="cycle-game-container">
      <RaceResults
        standings={engineState.standings || []}
        riders={engineState.riders || {}}
        winCondition={engineState.winCondition || raceMetaRef.current?.winCondition || 'distance'}
        dnf={snapshot?.dnf || []}
      />
      <button type="button" data-testid="cycle-game-start" className="cycle-game-container__start" onClick={backToHome}>
        Back to home
      </button>
    </div>
  );
}
