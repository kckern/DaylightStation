import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { CycleRaceController } from '@/modules/Fitness/lib/cycleGame/CycleRaceController.js';
import { buildRaceConfigFromCourse } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { buildRaceRecord } from '@/modules/Fitness/lib/cycleGame/raceRecord.js';
import { zoneMultiplierFor } from '@/modules/Fitness/lib/cycleGame/distanceModel.js';
import { playSound } from '@/modules/Fitness/lib/cycleGame/playSound.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { usePersistentVolume } from '@/modules/Fitness/nav/usePersistentVolume.js';
import CycleGameHome from './CycleGameHome.jsx';
import CountdownStoplight from './CountdownStoplight.jsx';
import CycleRaceScreen from './CycleRaceScreen.jsx';
import RaceResults from './RaceResults.jsx';
import RaceRecap from './RaceRecap.jsx';
import './CycleGameContainer.scss';

const RACE_TICK_MS = 1000;
const COUNTDOWN_TICK_MS = 1000;

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
    usersConfig = {},
    fitnessSessionInstance: session,
    getUserVitals,
    getDisplayName,
    getDisplayLabel,
    getUserByName
  } = ctx;

  const distanceDefaultM = Number.isFinite(cycleGameConfig?.distance_goal_default_m)
    ? cycleGameConfig.distance_goal_default_m
    : 3000;
  const timeDefaultS = Number.isFinite(cycleGameConfig?.time_cap_default_s)
    ? cycleGameConfig.time_cap_default_s
    : 300;
  // "Riders, to your bikes!" buffer after Start, before the stoplight countdown
  // (lobby music keeps playing). Configurable; 0 = skip straight to countdown.
  const stagingBufferMs = Number.isFinite(cycleGameConfig?.staging_buffer_ms)
    ? cycleGameConfig.staging_buffer_ms
    : 5000;

  const cadenceBands = useMemo(
    () => (Array.isArray(cycleGameConfig?.cadence_zones) ? cycleGameConfig.cadence_zones : []),
    [cycleGameConfig]
  );
  const hrlessMultiplier = Number.isFinite(cycleGameConfig?.hrless_multiplier)
    ? cycleGameConfig.hrless_multiplier
    : 1;

  // Optional sound effects (config-driven; null/absent = silent). Kept in a ref
  // so the countdown/race intervals read the latest without re-subscribing.
  const sounds = useMemo(
    () => (cycleGameConfig?.sounds && typeof cycleGameConfig.sounds === 'object' ? cycleGameConfig.sounds : {}),
    [cycleGameConfig]
  );
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const musicVolume = Number.isFinite(cycleGameConfig?.music_volume) ? cycleGameConfig.music_volume : 0.55;

  // Master volume — the OFFICIAL fitness volume store (the same level the rest
  // of the app's video uses). Scales all cycle-game music + SFX; the lobby
  // exposes the standard TouchVolumeButtons control bound to it.
  const masterVol = usePersistentVolume({ grandparentId: 'fitness', parentId: 'global', trackId: 'video' });
  const effectiveMaster = masterVol.muted ? 0 : (Number.isFinite(masterVol.volume) ? masterVol.volume : 1);
  const masterRef = useRef(1);
  masterRef.current = effectiveMaster;

  // Background-music channel (one looping track at a time, swapped per phase).
  // Separate from the one-shot SFX channel (playSound). Null/absent = silent.
  const musicRef = useRef(null);
  const musicKeyRef = useRef(null);
  const stopMusic = useCallback(() => {
    if (musicRef.current) {
      try { musicRef.current.pause(); musicRef.current.src = ''; } catch { /* ignore */ }
    }
    musicRef.current = null;
    musicKeyRef.current = null;
  }, []);
  const playMusic = useCallback((url, key, { loop = true } = {}) => {
    if (!url) { stopMusic(); return; }
    if (musicKeyRef.current === key && musicRef.current) return; // already on this track
    stopMusic();
    try {
      const a = new Audio(url);
      a.loop = loop;
      a.volume = Math.max(0, Math.min(1, musicVolume * masterRef.current));
      a.play().catch(() => { /* autoplay may defer until a gesture */ });
      musicRef.current = a;
      musicKeyRef.current = key;
    } catch { /* Audio unavailable (e.g. tests) */ }
  }, [musicVolume, stopMusic]);
  // Pick a random track from the racing playlist folder.
  const pickRacingTrack = useCallback(() => {
    const r = soundsRef.current?.racing;
    if (!r || !r.dir || !Number.isFinite(r.tracks) || r.tracks < 1) return null;
    const n = Math.floor(Math.random() * r.tracks) + 1;
    return `${r.dir}/${String(n).padStart(3, '0')}.mp3`;
  }, []);

  // Bikes (equipment carrying a cadence sensor and a wheel circumference).
  const bikes = useMemo(
    () => (Array.isArray(equipment) ? equipment : []).filter((e) => e && e.cadence != null),
    [equipment]
  );

  // Race history + ghost selection (declared early — buildRiders/startRace read them).
  const [pastRaces, setPastRaces] = useState([]); // recent saved race records
  const [ghost, setGhost] = useState(null); // selected ghost competitor (locks config)

  // Use the canonical relational name resolver: getDisplayLabel applies the
  // household nickname ("Dad"/"Mom") when 2+ HR riders are present, else the
  // given name. Don't reinvent this.
  const resolveDisplayName = useCallback((userId) => {
    if (!userId) return userId;
    const name = getUserVitals?.(userId)?.name || getUserByName?.(userId)?.name || getDisplayName?.(userId) || userId;
    return getDisplayLabel?.(name, { userId }) || name;
  }, [getUserVitals, getUserByName, getDisplayName, getDisplayLabel]);

  // Per-equipment abuse defaults (used when a bike doesn't define its own).
  const abuseMaxRpmDefault = Number.isFinite(cycleGameConfig?.abuse_max_rpm)
    ? cycleGameConfig.abuse_max_rpm
    : null;
  const abuseDurationDefault = Number.isFinite(cycleGameConfig?.abuse_max_rpm_duration_s)
    ? cycleGameConfig.abuse_max_rpm_duration_s
    : null;

  // Resolve the currently-claimed riders (bikes with a getEquipmentRider claim).
  const buildRiders = useCallback(() => {
    const riders = [];
    bikes.forEach((bike) => {
      const userId = session?.getEquipmentRider?.(bike.id) || null;
      if (!userId) return;
      const maxRpm = Number.isFinite(bike.max_rpm) ? bike.max_rpm : abuseMaxRpmDefault;
      const maxRpmDurationS = Number.isFinite(bike.max_rpm_duration_s)
        ? bike.max_rpm_duration_s
        : abuseDurationDefault;
      riders.push({
        userId,
        displayName: resolveDisplayName(userId),
        equipmentId: bike.id,
        wheelCircumferenceM: Number.isFinite(bike.wheel_circumference_m) ? bike.wheel_circumference_m : 0,
        maxRpm: Number.isFinite(maxRpm) ? maxRpm : null,
        maxRpmDurationS: Number.isFinite(maxRpmDurationS) ? maxRpmDurationS : null
      });
    });
    // A selected ghost replays its whole recorded field as competitors.
    if (ghost && Array.isArray(ghost.riders)) {
      ghost.riders.forEach((g) => {
        riders.push({
          userId: g.userId,
          displayName: g.displayName,
          equipmentId: null,
          wheelCircumferenceM: 0,
          ghostSeries: g.ghostSeries,
          ghostHrSeries: g.ghostHrSeries,
          ghostIntervalS: g.ghostIntervalS
        });
      });
    }
    return riders;
  }, [bikes, session, resolveDisplayName, abuseMaxRpmDefault, abuseDurationDefault, ghost]);

  // ── lifecycle state ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle'); // idle | staging | countdown | racing | results
  const [stagingSeconds, setStagingSeconds] = useState(0); // "to your bikes" countdown
  const stagingTimerRef = useRef(null);
  const [raceType, setRaceType] = useState(null); // 'distance' | 'time' | null
  const [raceValueM, setRaceValueM] = useState(null); // chosen distance goal (m)
  const [raceValueS, setRaceValueS] = useState(null); // chosen time cap (s)
  // Bump to force a re-read of session.getEquipmentRider after an assignment
  // (the session is a mutable instance; mutating it doesn't change React state).
  const [assignVersion, setAssignVersion] = useState(0);
  const [snapshot, setSnapshot] = useState(null); // controller.getState()
  const controllerRef = useRef(null);
  const raceMetaRef = useRef(null);
  const startCountdownRef = useRef(3);
  const savedRef = useRef(false);
  const prevDnfRef = useRef(new Set());
  const prevDqRef = useRef(new Set());
  const prevPenalizedRef = useRef(new Set());

  // Live-data refs so the race-tick interval can read the freshest
  // session/vitals without re-subscribing. The fitness context value changes
  // identity on nearly every render (new RPM/HR readings); if the race interval
  // depended on those identities it would be torn down and recreated before its
  // 1000ms timer could fire, starving the engine of ticks (a time race would
  // never reach its cap). Keep these in refs and depend only on `phase`.
  const sessionRef = useRef(session);
  const getUserVitalsRef = useRef(getUserVitals);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { getUserVitalsRef.current = getUserVitals; }, [getUserVitals]);

  // Map controller phases to render phases.
  const applySnapshot = useCallback((state) => {
    setSnapshot(state);
    if (!state) return;
    if (state.phase === 'countdown' || state.phase === 'staged') setPhase('countdown');
    else if (state.phase === 'racing') setPhase('racing');
    else if (state.phase === 'finished' || state.phase === 'results') setPhase('results');
    else if (state.phase === 'cancelled') setPhase('idle');
  }, []);

  // People to choose from on the home screen: the registered users, mapped to
  // the avatar/HR shape the lobby renders. Users with an active heart rate are
  // surfaced first / highlighted.
  const people = useMemo(() => {
    // Registered users from the fitness config (always present, hydrated by the
    // backend) across all groups — NOT the session userCollections (which is
    // empty until a session is active).
    const cfg = usersConfig || {};
    const seen = new Set();
    const list = [];
    // Config group → picker category: household / family / guest.
    const CATEGORY_BY_GROUP = {
      primary: 'household',
      secondary: 'household',
      family: 'family',
      friends: 'guest',
      guests: 'guest'
    };
    ['primary', 'secondary', 'family', 'friends', 'guests'].forEach((group) => {
      (Array.isArray(cfg[group]) ? cfg[group] : []).forEach((u) => {
        const id = typeof u === 'string' ? u : (u?.id || u?.profileId);
        if (!id || seen.has(id)) return;
        seen.add(id);
        const vitals = getUserVitals?.(id);
        const heartRate = Number.isFinite(vitals?.heartRate) ? vitals.heartRate : null;
        const hasHR = Number.isFinite(heartRate) && heartRate > 0;
        const category = CATEGORY_BY_GROUP[group] || 'household';
        list.push({
          id,
          name: vitals?.name || (typeof u === 'object' ? u.name : null) || id,
          avatarSrc: `/api/v1/static/img/users/${id}`,
          heartRate,
          zoneId: vitals?.zoneId || null,
          zoneColor: vitals?.zoneColor || null,
          progress: Number.isFinite(vitals?.progress) ? vitals.progress : null,
          hasHR,
          group,
          category,
          isGuest: category === 'guest'
        });
      });
    });
    // Two always-available anonymous guests (no profile, no HR). They lead the
    // Guests tab. Avatars: media/img/users/guest-adult.* and guest-kid.*
    [
      { id: 'guest-adult', name: 'Guest (Adult)' },
      { id: 'guest-kid', name: 'Guest (Kid)' }
    ].forEach((g) => {
      if (seen.has(g.id)) return;
      seen.add(g.id);
      list.push({
        id: g.id,
        name: g.name,
        avatarSrc: `/api/v1/static/img/users/${g.id}`,
        heartRate: null,
        zoneId: null,
        zoneColor: null,
        progress: null,
        hasHR: false,
        group: 'guests',
        category: 'guest',
        isGuest: true,
        native: true
      });
    });
    // active-HR first, then by name (native anonymous guests handled in the picker)
    return list.sort((a, b) => {
      if (a.hasHR !== b.hasHR) return a.hasHR ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [usersConfig, getUserVitals]);

  // Bikes for the starting grid (each with its currently-claimed rider + live
  // cadence so the lobby shows wheels spinning / warmups before the race).
  const bikesForGrid = useMemo(
    () => bikes.map((bike) => {
      const cadence = session?.getEquipmentCadence?.(bike.id);
      const connected = !!(cadence && cadence.connected);
      const rpm = connected && Number.isFinite(cadence.rpm) ? cadence.rpm : 0;
      return {
        id: bike.id,
        name: bike.name || bike.id,
        type: bike.type || null,
        iconSrc: DaylightMediaPath(`/static/img/equipment/${bike.id}`),
        rider: session?.getEquipmentRider?.(bike.id) || null,
        rpm,
        connected
      };
    }),
    // assignVersion forces a re-read after assign/unassign AND on the idle poll,
    // so live RPM refreshes ~1 Hz on the lobby.
    [bikes, session, assignVersion]
  );

  const assignedRiderCount = useMemo(
    () => bikesForGrid.filter((b) => b.rider).length,
    [bikesForGrid]
  );

  // While on the lobby, riders can be claimed OUTSIDE the React tree — by the
  // physical rider-select button or the dev simulator, both of which mutate the
  // session instance directly without bumping assignVersion. Poll so the grid
  // (and the Start button's enabled state) reflects those external claims.
  useEffect(() => {
    if (phase !== 'idle') return undefined;
    const id = setInterval(() => setAssignVersion((v) => v + 1), 750);
    return () => clearInterval(id);
  }, [phase]);

  // Load recent race history (records rail + ghost candidates) on entering idle.
  useEffect(() => {
    if (phase !== 'idle') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const datesResp = await fetch('/api/v1/fitness/cycle-races');
        if (!datesResp.ok) return;
        const { dates = [] } = await datesResp.json();
        const recent = [...dates].sort().reverse().slice(0, 5);
        const all = [];
        for (const date of recent) {
          const r = await fetch(`/api/v1/fitness/cycle-races?date=${encodeURIComponent(date)}`);
          if (!r.ok) continue;
          const { races = [] } = await r.json();
          all.push(...races);
        }
        if (!cancelled) {
          setPastRaces(all);
          log.info('cycle_game.history_loaded', { dates: recent.length, races: all.length });
        }
      } catch (err) {
        log.warn('cycle_game.history_error', { error: err?.message || String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [phase, log]);

  // Ghost candidates: each past race with ALL its participants, so racing a
  // ghost replays the whole field. Goal vs score are inverted by win condition
  // (distance race → goal=distance, score=time; time race → goal=time, score=distance).
  const ghostCandidates = useMemo(() => {
    const fmtMs = (s) => {
      if (!Number.isFinite(s)) return '—';
      const m = Math.floor(s / 60);
      return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
    };
    return (Array.isArray(pastRaces) ? pastRaces : []).map((rec) => {
      const race = rec?.race || {};
      const winCondition = race.win_condition || 'distance';
      const participants = Object.entries(rec?.participants || {})
        .map(([id, p]) => ({
          id,
          displayName: p.display_name || id,
          avatarSrc: `/api/v1/static/img/users/${id}`,
          distanceSeries: p.distance_series || null,
          hrSeries: p.hr_series || null,
          finalDistanceM: p.final_distance_m ?? null,
          finalTimeS: p.final_time_s ?? null,
          placement: p.placement ?? null
        }))
        .sort((a, b) => (a.placement || 99) - (b.placement || 99));
      if (participants.length === 0) return null;
      const winner = participants[0];
      // Derive calendar day + time-of-day from the YYYYMMDDHHmmss raceId.
      const rid = String(race.id || '');
      const day = rid.length >= 8 ? `${rid.slice(0, 4)}-${rid.slice(4, 6)}-${rid.slice(6, 8)}` : 'unknown';
      const hh = rid.length >= 12 ? parseInt(rid.slice(8, 10), 10) : 0;
      const mm = rid.length >= 12 ? rid.slice(10, 12) : '00';
      const timeOfDay = rid.length >= 12
        ? `${((hh % 12) || 12)}:${mm} ${hh < 12 ? 'am' : 'pm'}`
        : '';
      return {
        raceId: race.id,
        date: race.date || null,
        day,
        timeOfDay,
        winCondition,
        goalM: race.goal_m ?? null,
        timeCapS: race.time_cap_s ?? null,
        intervalSeconds: race.interval_seconds || 1,
        participants,
        winnerName: winner.displayName,
        // goal = what the race was set to; score = the winner's achieved metric
        goalKind: winCondition === 'distance' ? 'distance' : 'time',
        goalLabel: winCondition === 'distance' ? formatDistance(race.goal_m || 0) : fmtMs(race.time_cap_s),
        scoreKind: winCondition === 'distance' ? 'time' : 'distance',
        scoreLabel: winCondition === 'distance' ? fmtMs(winner.finalTimeS) : formatDistance(winner.finalDistanceM || 0)
      };
    }).filter(Boolean);
  }, [pastRaces]);

  // Records rail rows: avatars of the field + goal chip + score (both metrics).
  const records = useMemo(
    () => ghostCandidates.slice(0, 12).map((g) => ({
      raceId: g.raceId,
      avatars: g.participants.slice(0, 4).map((p) => ({ id: p.id, src: p.avatarSrc, name: p.displayName })),
      goalKind: g.goalKind,
      goalLabel: g.goalLabel,
      scoreKind: g.scoreKind,
      scoreLabel: g.scoreLabel
    })),
    [ghostCandidates]
  );

  // Race Recap overlay — replay a saved race's chart from the records rail.
  const [recapRaceId, setRecapRaceId] = useState(null);
  const onSelectRecord = useCallback((raceId) => {
    log.info('cycle_game.recap_opened', { raceId, control: 'lobby.records-rail' });
    setRecapRaceId(raceId);
  }, [log]);
  const closeRecap = useCallback(() => {
    log.info('cycle_game.recap_closed', {});
    setRecapRaceId(null);
  }, [log]);
  const recapCandidate = useMemo(
    () => ghostCandidates.find((g) => g.raceId === recapRaceId) || null,
    [ghostCandidates, recapRaceId]
  );

  // The current value for the chosen race type (defaults applied at start).
  const raceValue = raceType === 'time' ? raceValueS : raceValueM;

  const canStart = !!raceType && assignedRiderCount >= 1;

  // ── home → stage + start ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'idle') {
      log.info('cycle_game.home', { raceType, riderCount: buildRiders().length });
    }
    // run once on entering idle; depend on phase only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startRace = useCallback(() => {
    log.info('cycle_game.start_pressed', {
      raceType: ghost ? 'ghost' : raceType, hasGhost: !!ghost, control: 'lobby.start-button'
    });
    // The race "course" is derived from the chosen type + value. Default the
    // value from config when none was picked (so the E2E — which only clicks a
    // race type then Start — still works).
    // A selected ghost is authoritative for the win condition + goal.
    const type = ghost ? ghost.winCondition : (raceType || 'distance');
    const goalM = type === 'distance'
      ? (ghost ? ghost.goalM : (Number.isFinite(raceValueM) ? raceValueM : distanceDefaultM))
      : null;
    const timeCapS = type === 'time'
      ? (ghost ? ghost.timeCapS : (Number.isFinite(raceValueS) ? raceValueS : timeDefaultS))
      : null;
    const course = {
      id: ghost ? 'ghost' : 'custom',
      win_condition: type,
      goal_m: goalM,
      time_cap_s: timeCapS
    };
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
      hotStartPenaltyS: Number.isFinite(cycleGameConfig?.hot_start_penalty_s) ? cycleGameConfig.hot_start_penalty_s : 0,
      backgroundPlexId: cycleGameConfig?.default_background ?? null,
      intervalMs: RACE_TICK_MS
    });

    // raceId MUST be a YYYYMMDDHHmmss timestamp — the datastore slices the date
    // (YYYY-MM-DD) directly out of it to choose the history folder. A `cr_<ms>`
    // form lands in a garbage dir that listDates() filters out (no history).
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const raceId = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
      + `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
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
    prevDqRef.current = new Set();
    prevPenalizedRef.current = new Set();

    const controller = new CycleRaceController(cfg);
    controllerRef.current = controller;

    log.info('cycle_game.staged', {
      courseId: cfg.winCondition,
      winCondition: cfg.winCondition,
      ...(cfg.winCondition === 'distance' ? { goalM: cfg.goalM } : { timeCapS: cfg.timeCapS }),
      riders: riders.map((r) => r.userId)
    });

    // "Riders, to your bikes!" — hold before the stoplight so whoever pressed
    // Start can get on their bike. Lobby music keeps playing through it.
    if (stagingBufferMs > 0) {
      setStagingSeconds(Math.ceil(stagingBufferMs / 1000));
      setPhase('staging');
      log.info('cycle_game.staging', { ms: stagingBufferMs });
      if (stagingTimerRef.current) clearTimeout(stagingTimerRef.current);
      stagingTimerRef.current = setTimeout(() => {
        applySnapshot(controllerRef.current?.startCountdown());
      }, stagingBufferMs);
    } else {
      applySnapshot(controller.startCountdown());
    }
  }, [raceType, raceValueM, raceValueS, distanceDefaultM, timeDefaultS, stagingBufferMs, ghost, buildRiders, zones, hrlessMultiplier, cycleGameConfig, applySnapshot, log]);

  // Staging seconds tick (display only). Cleared when leaving the staging phase.
  useEffect(() => {
    if (phase !== 'staging') return undefined;
    const id = setInterval(() => setStagingSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

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
        playSound(soundsRef.current?.go, { volume: masterRef.current }); // null = silent
        log.info('cycle_game.race_started', {
          raceId: raceMetaRef.current?.raceId,
          riders: Object.keys(state.engineState?.riders || {}),
          winCondition: raceMetaRef.current?.winCondition
        });
      } else {
        playSound(soundsRef.current?.countdown, { volume: masterRef.current }); // beep per tick; null = silent
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
      const liveSession = sessionRef.current;
      const liveGetUserVitals = getUserVitalsRef.current;
      const before = controller.getState();
      const inputs = {};
      Object.keys(before.engineState?.riders || {}).forEach((userId) => {
        const rider = before.engineState.riders[userId];
        const cadence = liveSession?.getEquipmentCadence?.(rider.equipmentId);
        const vitals = liveGetUserVitals?.(userId);
        inputs[userId] = {
          rpm: cadence && cadence.connected ? cadence.rpm : 0,
          zoneId: vitals?.zoneId || null,
          heartRate: Number.isFinite(vitals?.heartRate) ? vitals.heartRate : null
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

      // DQ detection — diff the controller dq set (sustained over-max RPM abuse).
      const dqSet = new Set(state.dq || []);
      dqSet.forEach((userId) => {
        if (!prevDqRef.current.has(userId)) {
          log.warn('cycle_game.rider_dq', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            elapsedS: state.engineState?.elapsedS ?? null
          });
        }
      });
      prevDqRef.current = dqSet;

      // Hot-start penalty detection — diff the controller penalized set.
      const penalizedSet = new Set(state.penalized || []);
      penalizedSet.forEach((userId) => {
        if (!prevPenalizedRef.current.has(userId)) {
          log.info('cycle_game.rider_penalized', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            reason: 'hot-start',
            elapsedS: state.engineState?.elapsedS ?? null
          });
        }
      });
      prevPenalizedRef.current = penalizedSet;

      if (state.phase === 'finished') {
        const finalState = controller.showResults();
        const standings = finalState.engineState?.standings || [];
        playSound(soundsRef.current?.finish, { volume: masterRef.current }); // null = silent
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
    // Live data is read from refs (sessionRef/getUserVitalsRef) so the interval
    // is set up once per racing phase and never starved by context churn.
  }, [phase, applySnapshot, log]);

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

  // ── lifecycle soundtrack ───────────────────────────────────────────────────
  // lobby (idle, loop) → start jingle (countdown, one-shot) → racing playlist
  // (loop, random track) → end (results, once). Background music swaps per phase;
  // the start jingle is a one-shot SFX layered over the (stopped) music.
  useEffect(() => {
    const s = soundsRef.current || {};
    if (phase === 'idle' || phase === 'staging') {
      // Lobby track carries through the "to your bikes" buffer ("start your engines").
      playMusic(s.lobby, 'lobby');
    } else if (phase === 'countdown') {
      stopMusic();
      playSound(s.start, { volume: masterRef.current }); // one-shot 3-2-1 jingle
    } else if (phase === 'racing') {
      playMusic(pickRacingTrack(), 'racing');
    } else if (phase === 'results') {
      playMusic(s.end, 'end', { loop: false });
    }
  }, [phase, playMusic, stopMusic, pickRacingTrack]);

  // Keep the currently-playing track in sync with live master-volume changes.
  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = Math.max(0, Math.min(1, musicVolume * (Number.isFinite(effectiveMaster) ? effectiveMaster : 1)));
    }
  }, [effectiveMaster, musicVolume]);

  // Silence everything (and cancel any pending staging) when the game unmounts.
  useEffect(() => () => {
    stopMusic();
    if (stagingTimerRef.current) clearTimeout(stagingTimerRef.current);
  }, [stopMusic]);

  // ── handlers ─────────────────────────────────────────────────────────────
  const onSelectRaceType = useCallback((type) => {
    log.info('cycle_game.race_type_selected', { type, clearedGhost: !!ghost, control: 'lobby.race-type-tile' });
    setGhost(null); // distance/time are mutually exclusive with a ghost race
    setRaceType((prev) => (prev === type ? prev : type));
    // Pre-select a concrete value so the value step never reads "default".
    if (type === 'time') setRaceValueS((v) => (Number.isFinite(v) ? v : timeDefaultS));
    else setRaceValueM((v) => (Number.isFinite(v) ? v : distanceDefaultM));
  }, [timeDefaultS, distanceDefaultM, ghost, log]);

  // Selecting a ghost replays the WHOLE recorded field and locks the race type
  // + value to that recording.
  const onSelectGhost = useCallback((candidate) => {
    if (!candidate) return;
    const riders = (candidate.participants || []).map((p) => ({
      userId: `ghost:${candidate.raceId}:${p.id}`,
      displayName: `${p.displayName} 👻`,
      ghostSeries: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
      ghostHrSeries: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
      ghostIntervalS: candidate.intervalSeconds || 1
    })).filter((r) => r.ghostSeries.length > 0);
    if (riders.length === 0) {
      log.warn('cycle_game.ghost_empty', { raceId: candidate.raceId });
      return;
    }
    setGhost({
      sourceRaceId: candidate.raceId,
      winCondition: candidate.winCondition,
      goalM: candidate.goalM,
      timeCapS: candidate.timeCapS,
      riderCount: riders.length,
      displayName: candidate.winnerName + (riders.length > 1 ? ` +${riders.length - 1}` : ''),
      riders
    });
    setRaceType(candidate.winCondition);
    if (candidate.winCondition === 'time') setRaceValueS(candidate.timeCapS);
    else setRaceValueM(candidate.goalM);
    log.info('cycle_game.ghost_selected', { raceId: candidate.raceId, winCondition: candidate.winCondition, riders: riders.length });
  }, [log]);

  const onClearGhost = useCallback(() => {
    setGhost(null);
    log.info('cycle_game.ghost_cleared', {});
  }, [log]);

  const onSetRaceValue = useCallback((value) => {
    if (ghost) return; // ghost locks the value
    if (!Number.isFinite(value)) return;
    setRaceType((current) => {
      log.info('cycle_game.race_value_set', { type: current, value, control: 'lobby.value-step' });
      if (current === 'time') setRaceValueS(value);
      else setRaceValueM(value);
      return current;
    });
  }, [ghost, log]);

  const onAssign = useCallback((bikeId, userId) => {
    log.info('cycle_game.rider_assigned', { equipmentId: bikeId, userId, control: 'lobby.rider-picker' });
    session?.setEquipmentRider?.(bikeId, userId);
    setAssignVersion((v) => v + 1);
  }, [session, log]);

  const onUnassign = useCallback((bikeId) => {
    log.info('cycle_game.rider_unassigned', { equipmentId: bikeId, control: 'lobby.rider-picker.clear' });
    session?.setEquipmentRider?.(bikeId, null);
    setAssignVersion((v) => v + 1);
  }, [session, log]);

  const onSetMasterVolume = useCallback((v) => {
    log.info('cycle_game.volume_set', { volume: v, control: 'lobby.volume' });
    masterVol.setVolume?.(v);
  }, [masterVol, log]);

  const onCancel = useCallback(() => {
    const controller = controllerRef.current;
    const raceId = raceMetaRef.current?.raceId || null;
    if (stagingTimerRef.current) { clearTimeout(stagingTimerRef.current); stagingTimerRef.current = null; }
    if (controller) controller.cancel();
    log.info('cycle_game.cancelled', { raceId, fromPhase: phase, control: 'cancel-button' });
    controllerRef.current = null;
    raceMetaRef.current = null;
    setSnapshot(null);
    setPhase('idle');
  }, [log, phase]);

  const backToHome = useCallback(() => {
    log.info('cycle_game.back_to_home', { from: 'results' });
    controllerRef.current = null;
    raceMetaRef.current = null;
    setSnapshot(null);
    setPhase('idle');
  }, [log]);

  // ── render ───────────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="cycle-game-container" data-testid="cycle-game-container">
        <CycleGameHome
          raceType={raceType}
          onSelectRaceType={onSelectRaceType}
          raceValue={Number.isFinite(raceValue) ? raceValue : undefined}
          onSetRaceValue={onSetRaceValue}
          bikes={bikesForGrid}
          people={people}
          onAssign={onAssign}
          onUnassign={onUnassign}
          records={records}
          onSelectRecord={onSelectRecord}
          ghost={ghost}
          ghostCandidates={ghostCandidates}
          onSelectGhost={onSelectGhost}
          onClearGhost={onClearGhost}
          masterVolume={masterVol.volume}
          masterMuted={masterVol.muted}
          onSetMasterVolume={onSetMasterVolume}
          onStart={startRace}
          canStart={canStart}
        />
        {recapCandidate && (
          <RaceRecap candidate={recapCandidate} onClose={closeRecap} />
        )}
      </div>
    );
  }

  if (phase === 'staging') {
    return (
      <div className="cycle-game-container" data-testid="cycle-game-container">
        <div className="cycle-game-staging" data-testid="cycle-game-staging">
          <div className="cycle-game-staging__eyebrow">Riders, to your bikes!</div>
          <div className="cycle-game-staging__count">{stagingSeconds}</div>
          <div className="cycle-game-staging__bar">
            <span style={{ animationDuration: `${stagingBufferMs}ms` }} />
          </div>
          <div className="cycle-game-staging__hint">Get on, get ready — the lights are next.</div>
        </div>
        <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
          Cancel
        </button>
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
      // Ghost rider ids are `ghost:<raceId>:<sourceUserId>` — resolve the avatar
      // from the original user so the speedometer shows their face.
      const isGhostRider = userId.startsWith('ghost:');
      const sourceId = isGhostRider ? userId.split(':')[2] : userId;
      const cadence = session?.getEquipmentCadence?.(riders[userId].equipmentId);
      const vitals = isGhostRider ? {} : (getUserVitals?.(userId) || {});
      const zoneId = vitals.zoneId || null;
      riderLive[userId] = {
        rpm: cadence && cadence.connected ? cadence.rpm : 0,
        avatarSrc: `/api/v1/static/img/users/${sourceId}`,
        heartRate: isGhostRider
          ? (Number.isFinite(riders[userId].heartRate) ? riders[userId].heartRate : null)
          : (vitals.heartRate ?? null),
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
        dq={snapshot?.dq || []}
      />
      <button type="button" data-testid="cycle-game-start" className="cycle-game-container__start" onClick={backToHome}>
        Back to home
      </button>
    </div>
  );
}
