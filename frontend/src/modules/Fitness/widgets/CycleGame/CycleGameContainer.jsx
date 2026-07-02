import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { CycleRaceController } from '@/modules/Fitness/lib/cycleGame/CycleRaceController.js';
import { buildRaceConfigFromCourse } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { buildRaceRecord } from '@/modules/Fitness/lib/cycleGame/raceRecord.js';
import { zoneMultiplierFor, zoneColorFor, computeDistanceDelta } from '@/modules/Fitness/lib/cycleGame/distanceModel.js';
import { playSound } from '@/modules/Fitness/lib/cycleGame/playSound.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { buildHighScores } from '@/modules/Fitness/lib/cycleGame/highScores.js';
import { buildRecordRow } from '@/modules/Fitness/lib/cycleGame/recordRow.js';
import { resolveParticipantIdentity } from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
import { mapRaceRecordToCandidate, buildGhostFromCandidate } from '@/modules/Fitness/lib/cycleGame/ghostCandidate.js';
import { courseStartOverride, pickRival } from '@/modules/Fitness/lib/cycleGame/ladder.js';
import { resolveRpmLimits, clampCountedRpm, rpmDuringGap } from '@/modules/Fitness/lib/cycleGame/equipmentRpm.js';
import { buildAutoStartCourse } from '@/modules/Fitness/lib/cycleGame/autoStartCourse.js';
import { effectiveLapLength } from '@/modules/Fitness/lib/cycleGame/effectiveLapLength.js';
import { usePersistentVolume } from '@/modules/Fitness/nav/usePersistentVolume.js';
import CycleGameHome from './CycleGameHome.jsx';
import CountdownStoplight from './CountdownStoplight.jsx';
import RiderReadyStrip from './RiderReadyStrip.jsx';
import CycleRaceScreen from './CycleRaceScreen.jsx';
import CycleEventToast from './CycleEventToast.jsx';
import RaceResults from './RaceResults.jsx';
import RaceRecap from './RaceRecap.jsx';
import './CycleGameContainer.scss';

const RACE_TICK_MS = 1000;
const COUNTDOWN_TICK_MS = 1000;
const GO_HOLD_MS = 800; // hold the green light (engine already live) before the race screen

/**
 * Live cycle-game lifecycle container. Composes the prop-driven screens
 * (CycleGameHome / CountdownStoplight / CycleRaceScreen / RaceResults) with the
 * Plan-4 CycleRaceController and live fitness data (claimed riders, per-bike
 * RPM, per-user HR zone). Emits the lifecycle log contract.
 */
export default function CycleGameContainer({ onMount } = {}) {
  const ctx = useFitnessContext();
  const log = useMemo(() => getLogger().child({ component: 'cycle-game' }), []);

  // Suspend HR/cycle governance for as long as the race owns the screen. The
  // paused governed video remains the engine's media, so without this the
  // engine keeps evaluating zones and firing challenges over the race (see
  // the 2026-06-06 governance audit). setGovernanceSuspended is a stable
  // useCallback, so this effect runs exactly once on mount / once on unmount.
  const setGovernanceSuspended = ctx?.setGovernanceSuspended;
  useEffect(() => {
    if (!setGovernanceSuspended) return undefined;
    setGovernanceSuspended(true);
    return () => setGovernanceSuspended(false);
  }, [setGovernanceSuspended]);

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

  // Default = the lobby's "Medium" tier (2500 m / 300 s) so the pre-selected
  // tile and the no-pick fallback agree. See DISTANCE_TIERS in CycleGameHome.
  const distanceDefaultM = Number.isFinite(cycleGameConfig?.distance_goal_default_m)
    ? cycleGameConfig.distance_goal_default_m
    : 2500;
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
      // Autoplay can defer until a user gesture — benign, logged at debug so a
      // "no music" report can be told apart from a genuine load failure.
      a.play().catch((err) => { log.debug('cycle_game.music_deferred', { key, error: err?.message || String(err) }); });
      musicRef.current = a;
      musicKeyRef.current = key;
      log.debug('cycle_game.music', { key, loop });
    } catch (err) {
      log.warn('cycle_game.music_unavailable', { key, error: err?.message || String(err) });
    }
  }, [musicVolume, stopMusic, log]);
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
  const bikeById = useMemo(() => new Map(bikes.map((b) => [b.id, b])), [bikes]);
  const bikeByIdRef = useRef(bikeById);
  useEffect(() => { bikeByIdRef.current = bikeById; }, [bikeById]);

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

  // Officiating thresholds (shared by the race config and the event toasts so
  // the on-screen copy always matches the rule that fired).
  const raceIdleDnfS = Number.isFinite(cycleGameConfig?.race_idle_dnf_s) ? cycleGameConfig.race_idle_dnf_s : 20;
  // Grace before a rider's FIRST movement is required (vs the idle clock that
  // runs after they've started). Covers magnetless cadence sensors that take
  // ~20s to lock onto rotation from a dead stop (e.g. the tricycle's BK467).
  const raceStartGraceS = Number.isFinite(cycleGameConfig?.race_start_grace_s) ? cycleGameConfig.race_start_grace_s : 30;
  const hotStartPenaltyS = Number.isFinite(cycleGameConfig?.hot_start_penalty_s) ? cycleGameConfig.hot_start_penalty_s : 0;
  // Distance-race mercy-kill (issue 2): seconds after the FIRST rider crosses the
  // line before the race auto-ends, forfeiting (DNF) anyone still going — a
  // distance race otherwise waits forever for the slowest rider. Defaults ON at
  // 60s; set race_mercy_after_winner_s: 0 to disable. Ignored by time races.
  const raceMercyAfterWinnerS = Number.isFinite(cycleGameConfig?.race_mercy_after_winner_s)
    ? cycleGameConfig.race_mercy_after_winner_s
    : 60;
  // How long the results board holds before auto-returning to the lobby.
  const resultsDwellS = Number.isFinite(cycleGameConfig?.results_dwell_s) ? cycleGameConfig.results_dwell_s : 20;

  // Resolve the currently-claimed riders (bikes with a getEquipmentRider claim).
  // ghostOverride lets a caller (e.g. onRideFeatured) supply an explicit ghost
  // for THIS build without touching the `ghost` state; undefined (the default)
  // preserves prior behavior by falling back to the current `ghost` state.
  const buildRiders = useCallback((ghostOverride) => {
    const g = ghostOverride === undefined ? ghost : ghostOverride;
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
    // A selected ghost replays its whole recorded field as competitors.
    if (g && Array.isArray(g.riders)) {
      g.riders.forEach((r) => {
        riders.push({
          userId: r.userId,
          displayName: r.displayName,
          // The recording equipment — drives the gauge's maxRpm and the synth-rpm
          // wheel size. Distance still replays from the recorded series (the ghost
          // branch in the engine), so this never double-applies wheel physics.
          equipmentId: r.equipmentId || null,
          wheelCircumferenceM: 0,
          ghostSeries: r.ghostSeries,
          ghostHrSeries: r.ghostHrSeries,
          ghostRpmSeries: r.ghostRpmSeries,
          ghostZoneSeries: r.ghostZoneSeries,
          ghostIntervalS: r.ghostIntervalS
        });
      });
    }
    return riders;
  }, [bikes, session, resolveDisplayName, ghost]);

  // ── lifecycle state ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle'); // idle | staging | countdown | racing | results
  const [stagingSeconds, setStagingSeconds] = useState(0); // "to your bikes" countdown
  const [resultsSecondsLeft, setResultsSecondsLeft] = useState(null); // results auto-exit countdown
  const stagingTimerRef = useRef(null);
  const stagingDeadlineRef = useRef(0); // earliest wall-time staging may advance to countdown
  const preGreenPedalersRef = useRef(new Set()); // riders who pedalled BEFORE the green light
  const goHoldTimerRef = useRef(null); // green-light hold before the race screen appears
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
  const prevPenalizedRef = useRef(new Set());
  // Telemetry: track prior tick state so transitions (not steady state) are what
  // gets logged — penalty awaiting-stop edges, cadence connect/drop, phase, and
  // a monotonic tick index for the per-tick firehose.
  const prevAwaitingRef = useRef(new Set());
  const prevCadenceRef = useRef(new Map());
  const prevPhaseRef = useRef('idle');
  const tickCountRef = useRef(0);
  // Per-rider recent CONNECTED rpm readings (oldest→newest, capped) — lets a
  // cadence broadcast gap hold the last value instead of flatlining, while a
  // genuine downward-trend-to-zero is still honored. See rpmDuringGap.
  const rpmHistoryRef = useRef(new Map());
  // Officiating events (DNF / hot-start penalty) accumulated over the race —
  // drives the persistent chart markers and the results legend.
  const [raceEvents, setRaceEvents] = useState([]);
  const eventIdRef = useRef(0);
  // Single-slot, self-dismissing event toast + a queue for events that pile up.
  const [eventToast, setEventToast] = useState(null);
  const toastQueueRef = useRef([]);

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
  // Same ref pattern for the zone config the per-tick firehose reads to compute
  // the multiplier — constant during a race, but kept in a ref so the interval
  // (which depends only on `phase`) isn't torn down by config identity churn.
  const zonesRef = useRef(zones);
  const hrlessMultiplierRef = useRef(hrlessMultiplier);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { hrlessMultiplierRef.current = hrlessMultiplier; }, [hrlessMultiplier]);

  // Map controller phases to render phases.
  const applySnapshot = useCallback((state) => {
    setSnapshot(state);
    if (!state) return;
    if (state.phase === 'countdown' || state.phase === 'staged') setPhase('countdown');
    else if (state.phase === 'racing') setPhase('racing');
    else if (state.phase === 'finished' || state.phase === 'results') setPhase('results');
    else if (state.phase === 'cancelled') setPhase('idle');
  }, []);

  // Telemetry spine: a single chokepoint logging every render-phase transition
  // exactly once, correlated by raceId + elapsed. No transition is ever silent.
  useEffect(() => {
    const from = prevPhaseRef.current;
    if (from === phase) return;
    prevPhaseRef.current = phase;
    log.info('cycle_game.phase_transition', {
      from,
      to: phase,
      raceId: raceMetaRef.current?.raceId ?? null,
      elapsedS: controllerRef.current?.getState()?.engineState?.elapsedS ?? null
    });
  }, [phase, log]);

  // Pop the finished toast and immediately show the next queued one (if any).
  const onEventToastDone = useCallback(() => {
    setEventToast(toastQueueRef.current.shift() || null);
  }, []);

  // Record an officiating event: append it for the chart markers + results
  // legend, and enqueue a self-explaining toast (single-slot; queue overflow).
  const recordRaceEvent = useCallback((type, userId, state) => {
    const rider = state.engineState?.riders?.[userId] || {};
    const seriesIndex = Math.max(0, (rider.distanceSeries?.length || 1) - 1);
    const distanceM = rider.cumulativeDistanceM || 0;
    const displayName = rider.displayName || userId;
    const id = (eventIdRef.current += 1);
    setRaceEvents((list) => [...list, { id, type, riderId: userId, displayName, seriesIndex, distanceM }]);
    const toast = type === 'dnf'
      ? { id, variant: 'dnf', icon: '🛑', title: `${displayName} — Did Not Finish`, subtitle: `Stopped pedaling for ${raceIdleDnfS}s` }
      : { id, variant: 'penalty', icon: '⏱️', title: `${displayName} — False Start`, subtitle: `Pedaling before the green · ${hotStartPenaltyS}s penalty` };
    // Show now if the slot is free, otherwise queue behind the current toast.
    setEventToast((cur) => {
      if (cur) { toastQueueRef.current.push(toast); return cur; }
      return toast;
    });
  }, [raceIdleDnfS, hotStartPenaltyS]);

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

  // On-board riders for the pre-race compliance strip (staging + countdown): the
  // claimed bikes with their LIVE rpm. `compliant = !(rpm > 0)` mirrors exactly
  // the controller's green-light test, so the strip predicts the penalty.
  // assignVersion drives the refresh (bumped by the staging/countdown poll).
  const stagingRiders = useMemo(
    () => bikes.map((bike) => {
      const userId = session?.getEquipmentRider?.(bike.id);
      if (!userId) return null;
      const cadence = session?.getEquipmentCadence?.(bike.id);
      const rpm = cadence && cadence.connected && Number.isFinite(cadence.rpm) ? cadence.rpm : 0;
      const vitals = getUserVitals?.(userId) || {};
      return {
        id: userId,
        equipmentId: bike.id,
        name: resolveDisplayName(userId),
        avatarSrc: `/api/v1/static/img/users/${userId}`,
        rpm,
        heartRate: Number.isFinite(vitals.heartRate) ? vitals.heartRate : null,
        zoneColor: vitals.zoneColor || null,
        compliant: !(rpm > 0)
      };
    }).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bikes, session, getUserVitals, resolveDisplayName, assignVersion]
  );

  // True when no on-board rider is pedalling — the gate for leaving staging.
  const stagingAllStopped = !stagingRiders.some((r) => r.rpm > 0);

  // Keep on-board RPM live during staging + countdown so the compliance strip
  // reacts quickly when someone starts pedalling early.
  useEffect(() => {
    if (phase !== 'staging' && phase !== 'countdown') return undefined;
    const id = setInterval(() => setAssignVersion((v) => v + 1), 300);
    return () => clearInterval(id);
  }, [phase]);

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

  // Weekly featured-course ladder (lobby card). null = no featured course
  // configured (or the fetch failed) — the card simply hides.
  const [featuredLadder, setFeaturedLadder] = useState(null);
  const ladderBeforeRef = useRef(null); // snapshot at race start, for results movement (Task 10)

  const fetchLadder = useCallback(async () => {
    const resp = await fetch('/api/v1/fitness/cycle-races/ladder');
    if (!resp.ok) return null; // 404 = no featured courses configured — card just hides
    return resp.json();
  }, []);

  useEffect(() => {
    if (phase !== 'idle') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const ladder = await fetchLadder();
        if (!cancelled) {
          setFeaturedLadder(ladder);
          if (ladder) log.info('cycle_game.ladder_loaded', { courseId: ladder.course?.id, rungs: ladder.standings?.length || 0 });
        }
      } catch (err) {
        if (!cancelled) log.warn('cycle_game.ladder_error', { error: err?.message || String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [phase, fetchLadder, log]);

  // Ghost candidates: each past race with ALL its participants, so racing a
  // ghost replays the whole field. Goal vs score are inverted by win condition
  // (distance race → goal=distance, score=time; time race → goal=time, score=distance).
  const ghostCandidates = useMemo(() => {
    const resolveGaugeMaxRpm = (equipmentId) => resolveRpmLimits(bikeById.get(equipmentId) || {}).gaugeMaxRpm;
    return (Array.isArray(pastRaces) ? pastRaces : [])
      .map((rec) => mapRaceRecordToCandidate(rec, { getDisplayLabel, resolveGaugeMaxRpm }))
      .filter(Boolean);
  }, [pastRaces, getDisplayLabel, bikeById]);

  // History table rows: winner + both metric columns + which is the goal + when.
  // "today" is computed once here (the container may read the clock); recordRow
  // helpers stay pure by taking it as an argument.
  const todayYmd = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }, []);
  // Sort by time DESC (most-recent first). raceId is a YYYYMMDDHHmmss timestamp,
  // so a numeric compare orders chronologically. (The history load gives newest
  // *day* first but oldest race first within a day, so this explicit sort is what
  // makes the rail truly recent-on-top.)
  const records = useMemo(
    () => [...ghostCandidates]
      .sort((a, b) => (Number(b.raceId) || 0) - (Number(a.raceId) || 0))
      .slice(0, 12)
      .map((g) => buildRecordRow(g, todayYmd)),
    [ghostCandidates, todayYmd]
  );

  // Personal-best high scores (furthest / longest), each tapping into the recap
  // of the race that set it — same affordance as a History row. todayYmd gives
  // each card a relative day label ("Today" / "Jun 3").
  const highScores = useMemo(() => buildHighScores(ghostCandidates, todayYmd), [ghostCandidates, todayYmd]);

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

  const startRace = useCallback((override = null, ghostOverride = undefined) => {
    const ov = override && override.win_condition ? override : null;
    log.info('cycle_game.start_pressed', {
      raceType: ov ? ov.win_condition : (ghost ? 'ghost' : raceType),
      hasGhost: !!ghost,
      control: ov ? 'sim.autostart' : 'lobby.start-button'
    });
    // The race "course" is derived from the chosen type + value. Default the
    // value from config when none was picked (so the E2E — which only clicks a
    // race type then Start — still works).
    // A selected ghost is authoritative for the win condition + goal.
    const type = ov ? ov.win_condition : (ghost ? ghost.winCondition : (raceType || 'distance'));
    const goalM = type === 'distance'
      ? (ov ? ov.goal_m : (ghost ? ghost.goalM : (Number.isFinite(raceValueM) ? raceValueM : distanceDefaultM)))
      : null;
    const timeCapS = type === 'time'
      ? (ov ? ov.time_cap_s : (ghost ? ghost.timeCapS : (Number.isFinite(raceValueS) ? raceValueS : timeDefaultS)))
      : null;
    const course = {
      id: ghost ? 'ghost' : 'custom',
      win_condition: type,
      goal_m: goalM,
      time_cap_s: timeCapS
    };
    const riders = buildRiders(ghostOverride);
    if (riders.length === 0) {
      log.warn('cycle_game.staged', { courseId: course.id, error: 'no_riders' });
      return;
    }
    const cfgLap = Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0;
    const lapLengthM = effectiveLapLength({ lapLengthM: cfgLap, winCondition: type, goalM });
    const cfg = buildRaceConfigFromCourse(course, {
      riders,
      zones,
      hrlessMultiplier,
      startCountdownS: Number.isFinite(cycleGameConfig?.start_countdown_s) ? cycleGameConfig.start_countdown_s : 3,
      raceIdleDnfS,
      raceStartGraceS,
      hotStartPenaltyS,
      raceMercyAfterWinnerS,
      backgroundPlexId: cycleGameConfig?.default_background ?? null,
      lapLengthM,
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
      backgroundPlexId: cfg.backgroundPlexId,
      // Real course identity only — 'custom'/'ghost' lobby races persist null.
      courseId: ov?.id ?? null
    };
    startCountdownRef.current = cfg.startCountdownS;
    savedRef.current = false;
    prevDnfRef.current = new Set();
    prevPenalizedRef.current = new Set();
    prevAwaitingRef.current = new Set();
    prevCadenceRef.current = new Map();
    rpmHistoryRef.current = new Map();
    tickCountRef.current = 0;
    setRaceEvents([]);
    setEventToast(null);
    toastQueueRef.current = [];

    const controller = new CycleRaceController(cfg);
    controllerRef.current = controller;

    // Telemetry: full effective config, once. Per-tick logs stay dynamic-only;
    // this is where the static facts (zone multipliers, penalty, sounds) live so
    // "the multiplier/penalty was wrong" complaints can be corroborated.
    const sx = soundsRef.current || {};
    log.info('cycle_game.config', {
      raceId,
      winCondition: cfg.winCondition,
      goalM: cfg.goalM ?? null,
      timeCapS: cfg.timeCapS ?? null,
      startCountdownS: cfg.startCountdownS,
      raceIdleDnfS,
      raceStartGraceS,
      hotStartPenaltyS,
      hrlessMultiplier,
      stagingBufferMs,
      intervalMs: RACE_TICK_MS,
      zoneMultipliers: (Array.isArray(zones) ? zones : []).map((z) => ({ id: z.id, mult: z.distance_multiplier })),
      cadenceBands: (Array.isArray(cadenceBands) ? cadenceBands : []).map((b) => ({ id: b.id, min: b.min })),
      sounds: {
        lobby: !!sx.lobby, ready: !!sx.ready, start: !!sx.start, go: !!sx.go,
        countdown: !!sx.countdown, finish: !!sx.finish, end: !!sx.end, racing: !!sx.racing?.dir
      },
      backgroundPlexId: cfg.backgroundPlexId ?? null,
      riders: riders.map((r) => ({ userId: r.userId, isGhost: Array.isArray(r.ghostSeries) && r.ghostSeries.length > 0, equipmentId: r.equipmentId ?? null }))
    });

    log.info('cycle_game.staged', {
      courseId: cfg.winCondition,
      winCondition: cfg.winCondition,
      ...(cfg.winCondition === 'distance' ? { goalM: cfg.goalM } : { timeCapS: cfg.timeCapS }),
      riders: riders.map((r) => r.userId)
    });

    // "Riders, to your bikes!" — hold before the stoplight so whoever pressed
    // Start can get on their bike. Lobby music keeps playing through it.
    preGreenPedalersRef.current = new Set(); // clean slate for false-start tracking
    if (stagingBufferMs > 0) {
      setStagingSeconds(Math.ceil(stagingBufferMs / 1000));
      setPhase('staging');
      log.info('cycle_game.staging', { ms: stagingBufferMs });
      // The advance to countdown is gated (buffer elapsed AND all bikes stopped) by
      // a dedicated effect — record the earliest wall-time it may proceed.
      stagingDeadlineRef.current = Date.now() + stagingBufferMs;
    } else {
      applySnapshot(controller.startCountdown());
    }
  }, [raceType, raceValueM, raceValueS, distanceDefaultM, timeDefaultS, stagingBufferMs, ghost, buildRiders, zones, cadenceBands, hrlessMultiplier, cycleGameConfig, raceIdleDnfS, raceStartGraceS, hotStartPenaltyS, raceMercyAfterWinnerS, applySnapshot, log]);

  // Keep stable refs to the latest startRace + phase so the sim control hook
  // (registered once) always reads current values.
  const startRaceRef = useRef(startRace);
  useEffect(() => { startRaceRef.current = startRace; }, [startRace]);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Sim-panel seam: expose a programmatic race start so the simulation popup's
  // "Cycle Game Race" preset can launch a real race. Riders are assigned
  // separately (the sim sets equipment riders, which buildRiders reads).
  // getPhase lets the popup watch for the race to finish (reaches 'results')
  // so it can stop the RPM drivers it started.
  useEffect(() => {
    const api = {
      ready: true,
      startRace: ({ winCondition, value } = {}) =>
        startRaceRef.current(buildAutoStartCourse({ winCondition, value })),
      getPhase: () => phaseRef.current,
      // Per-rider race readback so a driver (sim panel / tests) can close the loop:
      // see who is penalty-boxed (false start) and whether distance is advancing,
      // instead of blindly holding RPM down a course that may be wedged. Keyed by
      // equipmentId so the caller can map a bike → its rider's live state. Note a
      // ghost can carry the SAME equipmentId as a live rider (gauge scaling only),
      // so callers mapping bike → rider should filter out `isGhost` entries.
      getRaceState: () => {
        const st = controllerRef.current?.getState?.();
        if (!st) return null;
        const riders = st.engineState?.riders || {};
        const penaltyInfo = st.penaltyInfo || {};
        return {
          phase: st.phase,
          penaltyInfo,
          riders: Object.values(riders).map((r) => ({
            userId: r.userId,
            equipmentId: r.equipmentId,
            distanceM: r.cumulativeDistanceM,
            rpm: r.rpm,
            finished: r.finishTimeS != null,
            isGhost: !!r.isGhost,
            boxed: !!penaltyInfo[r.userId],            // false-started, meter locked
            penaltyRemainingS: penaltyInfo[r.userId]?.remainingS ?? 0,
            awaitingStop: penaltyInfo[r.userId]?.awaitingStop ?? false // served; needs RPM 0 to clear
          }))
        };
      }
    };
    window.__cycleGameControl = api;
    return () => {
      // Only clear if it's still ours (guards a StrictMode/remount interleave).
      if (window.__cycleGameControl === api) delete window.__cycleGameControl;
    };
  }, []);

  // Staging seconds tick (display only). Cleared when leaving the staging phase.
  useEffect(() => {
    if (phase !== 'staging') return undefined;
    const id = setInterval(() => setStagingSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Staging → countdown gate: advance only once the buffer has elapsed AND no bike
  // is pedalling (re-checked on every staging tick and whenever a bike stops, since
  // the RPM poll bumps assignVersion → stagingAllStopped). Until then we hold on the
  // "to your bikes" screen with the indeterminate "waiting for bikes to stop" bar.
  useEffect(() => {
    if (phase !== 'staging') return undefined;
    if (Date.now() >= stagingDeadlineRef.current && stagingAllStopped) {
      applySnapshot(controllerRef.current?.startCountdown());
    }
    return undefined;
  }, [phase, stagingSeconds, stagingAllStopped, applySnapshot]);

  // Track who pedals BEFORE the green light (during the red/yellow countdown) — only
  // those riders false-start. Green pedalling is the GO signal and is allowed, so we
  // stop accumulating once the countdown ends (phase leaves 'countdown').
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    stagingRiders.forEach((r) => { if (r.rpm > 0) preGreenPedalersRef.current.add(r.id); });
    return undefined;
  }, [phase, stagingRiders]);

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
        // GREEN LIGHT. Lock in the false starters (anyone who pedalled before green),
        // then HOLD the green light while the engine is already live — the race
        // interval ticks in the 'go' phase, so RPMs count from green — and switch to
        // the race screen after GO_HOLD_MS.
        c.markFalseStarters?.([...preGreenPedalersRef.current]);
        log.debug('cycle_game.sfx', { cue: 'go', attempted: playSound(soundsRef.current?.go, { volume: masterRef.current }) }); // null = silent
        log.info('cycle_game.race_started', {
          raceId: raceMetaRef.current?.raceId,
          riders: Object.keys(state.engineState?.riders || {}),
          winCondition: raceMetaRef.current?.winCondition,
          falseStarters: [...preGreenPedalersRef.current]
        });
        setSnapshot(state);
        setPhase('go');
        if (goHoldTimerRef.current) clearTimeout(goHoldTimerRef.current);
        goHoldTimerRef.current = setTimeout(() => setPhase('racing'), GO_HOLD_MS);
      } else {
        playSound(soundsRef.current?.countdown, { volume: masterRef.current }); // beep per tick; null = silent
        applySnapshot(state);
      }
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [phase, applySnapshot, log]);

  // ── race interval ────────────────────────────────────────────────────────
  // Runs while racing AND during the brief green-light 'go' hold, so RPMs count from
  // the moment the light turns green — before the race screen appears.
  useEffect(() => {
    if (phase !== 'racing' && phase !== 'go') return undefined;
    const id = setInterval(() => {
      const controller = controllerRef.current;
      if (!controller) return;
      const liveSession = sessionRef.current;
      const liveGetUserVitals = getUserVitalsRef.current;
      const before = controller.getState();
      const inputs = {};
      const cadenceConnected = {}; // userId → bool, for the firehose + drop detection
      Object.keys(before.engineState?.riders || {}).forEach((userId) => {
        const rider = before.engineState.riders[userId];
        // Ghosts replay recorded series — the engine ignores inputs for them, and
        // their equipmentId only drives gauge scaling (it can be the SAME bike a
        // live rider is on). Skip all cadence/inputs bookkeeping so a ghost never
        // mirrors the live bike's sensor (dup telemetry, phantom hot-start rpm).
        if (rider.isGhost) return;
        const cadence = liveSession?.getEquipmentCadence?.(rider.equipmentId);
        const connected = !!(cadence && cadence.connected);
        if (rider.equipmentId) cadenceConnected[userId] = connected;
        const vitals = liveGetUserVitals?.(userId);
        const { abuseMaxRpm } = resolveRpmLimits(bikeByIdRef.current.get(rider.equipmentId) || {});
        // Cadence gap tolerance (racing only — this loop runs only while racing).
        // A connected reading (even 0) is the truth: use it + remember it. While
        // the sensor is DROPPED, hold the last good reading through the broadcast
        // gap instead of flatlining — unless the rider was trending down into the
        // gap, in which case a real cooldown-to-stop is honored (rpmDuringGap).
        let rawRpm;
        if (connected) {
          rawRpm = Number.isFinite(cadence.rpm) ? cadence.rpm : 0;
          const hist = rpmHistoryRef.current.get(userId) || [];
          hist.push(rawRpm);
          if (hist.length > 4) hist.shift();
          rpmHistoryRef.current.set(userId, hist);
        } else {
          rawRpm = rpmDuringGap(rpmHistoryRef.current.get(userId) || []);
        }
        inputs[userId] = {
          rpm: clampCountedRpm(rawRpm, abuseMaxRpm),
          zoneId: vitals?.zoneId || null,
          heartRate: Number.isFinite(vitals?.heartRate) ? vitals.heartRate : null
        };
      });
      const state = controller.tick(inputs);

      // ── Cadence connectivity transitions (info) — connect/drop only, not steady
      // state. The first read seeds the map without logging. Answers "my pedaling
      // didn't register" with a timestamped connect/drop trail.
      Object.keys(cadenceConnected).forEach((userId) => {
        const now = cadenceConnected[userId];
        const had = prevCadenceRef.current.get(userId);
        if (had !== undefined && had !== now) {
          log.info('cycle_game.cadence_change', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            connected: now,
            elapsedS: state.engineState?.elapsedS ?? null
          });
        }
        prevCadenceRef.current.set(userId, now);
      });

      // DNF detection — diff the controller dnf set; a new entry logs + raises
      // an on-screen event (toast + persistent chart marker).
      const dnfSet = new Set(state.dnf || []);
      dnfSet.forEach((userId) => {
        if (!prevDnfRef.current.has(userId)) {
          log.info('cycle_game.rider_dnf', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            elapsedS: state.engineState?.elapsedS ?? null
          });
          recordRaceEvent('dnf', userId, state);
        }
      });
      prevDnfRef.current = dnfSet;

      // ── Penalty box lifecycle (info) — entry, awaiting-stop edge, and clear.
      // Every entry is paired with its exit so a tester's "stuck in penalty" is
      // fully reconstructable. recordRaceEvent (toast + chart marker) fires once,
      // on entry.
      const penaltyInfo = state.penaltyInfo || {};
      const penalizedSet = new Set(state.penalized || []);
      const elapsedS = state.engineState?.elapsedS ?? null;
      penalizedSet.forEach((userId) => {
        const info = penaltyInfo[userId] || {};
        if (!prevPenalizedRef.current.has(userId)) {
          log.info('cycle_game.penalty_entered', {
            raceId: raceMetaRef.current?.raceId, userId, reason: 'hot-start',
            totalS: info.totalS ?? null, remainingS: info.remainingS ?? null, elapsedS
          });
          recordRaceEvent('penalty', userId, state);
        }
        // Awaiting-stop edge: timer served but still pedalling (gate is now RPM 0).
        if (info.awaitingStop && !prevAwaitingRef.current.has(userId)) {
          log.info('cycle_game.penalty_awaiting_stop', {
            raceId: raceMetaRef.current?.raceId, userId, elapsedS
          });
        }
      });
      // Cleared: anyone who was boxed last tick but is no longer in the set.
      prevPenalizedRef.current.forEach((userId) => {
        if (!penalizedSet.has(userId)) {
          log.info('cycle_game.penalty_cleared', {
            raceId: raceMetaRef.current?.raceId, userId, elapsedS
          });
        }
      });
      prevPenalizedRef.current = penalizedSet;
      prevAwaitingRef.current = new Set(Object.keys(penaltyInfo).filter((id) => penaltyInfo[id]?.awaitingStop));

      // ── Per-tick firehose (debug) — one event per second, riders as an array,
      // read from post-resolution engine state (correct for ghosts/penalty/finish).
      // Off by default in console; captured to the per-session JSONL for forensics.
      tickCountRef.current += 1;
      const tickRiders = state.engineState?.riders || {};
      log.debug('cycle_game.tick', {
        raceId: raceMetaRef.current?.raceId,
        tick: tickCountRef.current,
        elapsedS,
        riders: Object.keys(tickRiders).map((userId) => {
          const r = tickRiders[userId];
          return {
            userId,
            rpm: Math.round(Number.isFinite(r.rpm) ? r.rpm : 0),
            cadenceConnected: cadenceConnected[userId] ?? null,
            hr: Number.isFinite(r.heartRate) ? r.heartRate : null,
            zoneId: r.zoneId ?? null,
            multiplier: zoneMultiplierFor(r.zoneId ?? null, zonesRef.current, hrlessMultiplierRef.current),
            distanceM: Math.round(Number.isFinite(r.cumulativeDistanceM) ? r.cumulativeDistanceM : 0),
            penalized: penalizedSet.has(userId),
            finished: r.finishTimeS != null
          };
        })
      });

      if (state.phase === 'finished') {
        const finalState = controller.showResults();
        const standings = finalState.engineState?.standings || [];
        log.debug('cycle_game.sfx', { cue: 'finish', attempted: playSound(soundsRef.current?.finish, { volume: masterRef.current }) }); // null = silent
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
      // During the green-light hold, advance the engine but keep showing the green
      // stoplight (don't flip render to 'racing' yet — the go-hold timer does that).
      if (phase === 'go') setSnapshot(state); else applySnapshot(state);
    }, RACE_TICK_MS);
    return () => clearInterval(id);
    // Live data is read from refs (sessionRef/getUserVitalsRef) so the interval
    // is set up once per racing phase and never starved by context churn.
  }, [phase, applySnapshot, recordRaceEvent, log]);

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
    // Never persist a dead race — if nobody covered any distance there's nothing
    // worth keeping, and it just clutters the history with "0 m" rows.
    const totalDistanceM = Object.values(engineState.riders || {})
      .reduce((sum, r) => sum + (Number(r?.cumulativeDistanceM) || 0), 0);
    if (totalDistanceM <= 0) {
      log.info('cycle_game.race_saved', { raceId: meta.raceId, ok: false, skipped: 'zero_distance' });
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
    if (phase === 'idle') {
      playMusic(s.lobby, 'lobby');
    } else if (phase === 'staging') {
      // "Riders, to your bikes!" — the get-ready cue (falls back to lobby if unset).
      playMusic(s.ready || s.lobby, s.ready ? 'ready' : 'lobby');
    } else if (phase === 'countdown') {
      stopMusic();
      log.debug('cycle_game.sfx', { cue: 'start', attempted: playSound(s.start, { volume: masterRef.current }) }); // one-shot 3-2-1 jingle
    } else if (phase === 'racing') {
      playMusic(pickRacingTrack(), 'racing');
    } else if (phase === 'results') {
      playMusic(s.end, 'end', { loop: false });
    }
  }, [phase, playMusic, stopMusic, pickRacingTrack, log]);

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
    if (goHoldTimerRef.current) clearTimeout(goHoldTimerRef.current);
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
    const built = buildGhostFromCandidate(candidate);
    if (!built) {
      log.warn('cycle_game.ghost_empty', { raceId: candidate.raceId });
      return;
    }
    // Telemetry: per-ghost series point-counts so "the ghost wasn't moving / had
    // no rpm" is diagnosable (old records carry distance+HR only).
    log.info('cycle_game.ghost_rider', {
      raceId: candidate.raceId,
      riders: built.riders.map((r) => ({
        userId: r.userId,
        distancePts: r.ghostSeries.length,
        hrPts: r.ghostHrSeries.length,
        rpmPts: r.ghostRpmSeries.length,
        zonePts: r.ghostZoneSeries.length
      }))
    });
    setGhost(built.ghost);
    setRaceType(candidate.winCondition);
    if (candidate.winCondition === 'time') setRaceValueS(candidate.timeCapS);
    else setRaceValueM(candidate.goalM);
    log.info('cycle_game.ghost_selected', { raceId: candidate.raceId, winCondition: candidate.winCondition, riders: built.riders.length });
  }, [log]);

  const onClearGhost = useCallback(() => {
    setGhost(null);
    log.info('cycle_game.ghost_cleared', {});
  }, [log]);

  // Ride It on the featured-course card: arm a rival ghost (ranked rider → the
  // rung above; leader → their own PB; unranked → the tail rung) and start the
  // course. Ghost lookups are best-effort — a fetch failure never blocks the
  // race, it just starts without a ghost. The ghost is passed explicitly to
  // startRace (never through `ghost` state) so a previously-selected lobby
  // ghost can't leak into a ladder ride.
  const onRideFeatured = useCallback(async () => {
    const ladder = featuredLadder;
    const course = ladder?.course;
    if (!course) return;
    const firstRider = bikes.map((b) => session?.getEquipmentRider?.(b.id)).find(Boolean) || null;
    const rival = pickRival({ standings: ladder.standings || [], riderId: firstRider });
    let rivalRaceId = rival.raceId;
    if (rival.kind === 'self-pb' && firstRider) {
      try {
        const resp = await fetch(`/api/v1/fitness/cycle-races/personal-bests?userId=${encodeURIComponent(firstRider)}&courseId=${encodeURIComponent(course.id)}`);
        if (resp.ok) rivalRaceId = (await resp.json())?.best?.raceId || null;
      } catch { /* PB lookup is best-effort; race proceeds plain */ }
    }
    let ghostOverride = null;
    if (rivalRaceId) {
      try {
        const resp = await fetch(`/api/v1/fitness/cycle-races/${encodeURIComponent(rivalRaceId)}`);
        if (resp.ok) {
          const { race } = await resp.json();
          const resolveGaugeMaxRpm = (equipmentId) => resolveRpmLimits(bikeById.get(equipmentId) || {}).gaugeMaxRpm;
          const candidate = mapRaceRecordToCandidate(race, { getDisplayLabel, resolveGaugeMaxRpm });
          const built = candidate ? buildGhostFromCandidate(candidate) : null;
          if (built) { ghostOverride = built.ghost; setGhost(built.ghost); }
        }
      } catch { /* ghost is optional — never block the start */ }
    }
    log.info('cycle_game.ride_featured', {
      courseId: course.id, rider: firstRider, rivalKind: rival.kind,
      rivalRaceId: rivalRaceId || null, ghostArmed: !!ghostOverride
    });
    ladderBeforeRef.current = ladder;
    startRace(courseStartOverride(course), ghostOverride ?? null);
  }, [featuredLadder, bikes, session, bikeById, getDisplayLabel, startRace, log]);

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

  // Operator-driven finish: forfeit any unfinished riders, finalize standings,
  // and roll to results so the race saves (unlike cancel, which discards it).
  const onFinishRace = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    log.info('cycle_game.finish_forced', {
      raceId: raceMetaRef.current?.raceId,
      elapsedS: controller.getState()?.engineState?.elapsedS ?? null
    });
    controller.finishNow();
    applySnapshot(controller.showResults());
  }, [applySnapshot, log]);

  const onCancel = useCallback(() => {
    const controller = controllerRef.current;
    const raceId = raceMetaRef.current?.raceId || null;
    if (stagingTimerRef.current) { clearTimeout(stagingTimerRef.current); stagingTimerRef.current = null; }
    if (goHoldTimerRef.current) { clearTimeout(goHoldTimerRef.current); goHoldTimerRef.current = null; }
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

  // Results auto-exit: hold the board for resultsDwellS, ticking a countdown, then
  // return to the lobby. The Back-to-home button still exits immediately.
  useEffect(() => {
    if (phase !== 'results') { setResultsSecondsLeft(null); return undefined; }
    let left = resultsDwellS;
    setResultsSecondsLeft(left);
    const id = setInterval(() => {
      left -= 1;
      setResultsSecondsLeft(left);
      if (left <= 0) { clearInterval(id); backToHome(); }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, resultsDwellS, backToHome]);

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
          highScores={highScores}
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
          featured={featuredLadder}
          onRideFeatured={onRideFeatured}
          resolveName={resolveDisplayName}
        />
        {recapCandidate && (
          <RaceRecap candidate={recapCandidate} onClose={closeRecap} />
        )}
      </div>
    );
  }

  if (phase === 'staging') {
    // Once the buffer elapses we may still be holding for a bike to stop — swap the
    // countdown bar for an indeterminate striped "waiting" bar until all are at 0.
    const waitingForStop = stagingSeconds <= 0 && !stagingAllStopped;
    return (
      <div className="cycle-game-container" data-testid="cycle-game-container">
        <div className="cycle-game-staging" data-testid="cycle-game-staging">
          <div className="cycle-game-staging__eyebrow">Riders, to your bikes!</div>
          {waitingForStop ? (
            <div className="cycle-game-staging__count cycle-game-staging__count--wait" data-testid="staging-waiting">Stop pedalling</div>
          ) : (
            <div className="cycle-game-staging__count">{stagingSeconds}</div>
          )}
          <div className={`cycle-game-staging__bar${waitingForStop ? ' cycle-game-staging__bar--waiting' : ''}`} data-testid="staging-bar">
            {!waitingForStop && <span style={{ animationDuration: `${stagingBufferMs}ms` }} />}
          </div>
          <RiderReadyStrip riders={stagingRiders} />
          <div className="cycle-game-staging__hint">
            {waitingForStop ? 'Waiting for all bikes to stop…' : 'Don’t pedal until the light turns green.'}
          </div>
        </div>
        <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (phase === 'countdown' || phase === 'go') {
    // 'go' is the held GREEN light: the engine is already running (race interval
    // ticks in 'go') while we show GO for a beat before the race screen appears.
    const remaining = phase === 'go' ? 0 : (snapshot?.countdownRemaining ?? startCountdownRef.current);
    return (
      <div className="cycle-game-container" data-testid="cycle-game-container">
        <CountdownStoplight remaining={remaining} total={startCountdownRef.current} />
        <div className="cycle-game-countdown-riders">
          <RiderReadyStrip riders={stagingRiders} />
        </div>
        {phase === 'countdown' && (
          <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (phase === 'racing') {
    const engineState = snapshot?.engineState || {};
    const riders = engineState.riders || {};
    const winConditionNow = engineState.winCondition || raceMetaRef.current?.winCondition || 'distance';
    const placementByUser = {};
    (engineState.standings || []).forEach((s) => { placementByUser[s.userId] = s.placement; });
    // Riders currently in the penalty box (pedalled at the green light). The
    // controller exposes per-rider detail for the countdown bar / awaiting-stop cue.
    const penalizedNow = new Set(snapshot?.penalized || []);
    const dnfNow = new Set(snapshot?.dnf || []);
    const penaltyInfo = snapshot?.penaltyInfo || {};
    const riderLive = {};
    Object.keys(riders).forEach((userId) => {
      const rider = riders[userId];
      // Ghost rider ids are `ghost:<raceId>:<sourceUserId>` — resolve the avatar
      // from the original user so the speedometer shows their face.
      const isGhostRider = userId.startsWith('ghost:');
      const sourceId = isGhostRider ? resolveParticipantIdentity(userId).sourceId : userId;
      // A finished distance-race rider is parked at the line: gauge reads idle.
      const isFinished = winConditionNow === 'distance' && rider.finishTimeS != null;
      const cadence = isGhostRider ? null : session?.getEquipmentCadence?.(rider.equipmentId);
      const vitals = isGhostRider ? {} : (getUserVitals?.(userId) || {});
      // Ghosts replay their recorded rpm + zone; live riders read cadence/vitals.
      const zoneId = isGhostRider ? (rider.zoneId || null) : (vitals.zoneId || null);
      const wheelM = Number.isFinite(rider.wheelCircumferenceM) && rider.wheelCircumferenceM > 0
        ? rider.wheelCircumferenceM
        : (bikeById.get(rider.equipmentId)?.wheel_circumference_m || 0);
      // Ghost speed comes from the engine (windowed distance delta, already 0
      // once finished). Records predating rpm_series have no cadence to replay —
      // synthesize one from speed + wheel size so the needle doesn't park at 0
      // under a moving km/h. (Approximate: recorded distance bakes in the zone
      // boost, so the synth needle overreads during boosted stretches.)
      const ghostSpeedKmh = Number.isFinite(rider.speedKmh) ? rider.speedKmh : 0;
      const ghostRpm = rider.hasRpmData === false && wheelM > 0
        ? (ghostSpeedKmh / 3.6 / wheelM) * 60
        : (Number.isFinite(rider.rpm) ? rider.rpm : 0);
      const liveRpm = isGhostRider ? ghostRpm : (cadence && cadence.connected ? cadence.rpm : 0);
      const effRpm = isFinished ? 0 : liveRpm;
      const mult = isFinished ? 1 : zoneMultiplierFor(zoneId, zones, hrlessMultiplier);
      // Live speed = the SAME physics the engine uses to accrue distance, taken
      // per second (rpm/60 rotations) → km/h.
      const speedKmh = isGhostRider ? ghostSpeedKmh : computeDistanceDelta(effRpm / 60, wheelM, mult) * 3.6;
      riderLive[userId] = {
        rpm: effRpm,
        speedKmh,
        avatarSrc: `/api/v1/static/img/users/${sourceId}`,
        heartRate: isGhostRider
          ? (Number.isFinite(rider.heartRate) ? rider.heartRate : null)
          : (vitals.heartRate ?? null),
        zoneId,
        zoneColor: isGhostRider
          ? zoneColorFor(zoneId, zones)
          : ((Number.isFinite(vitals.heartRate) && vitals.heartRate > 0) ? (vitals.zoneColor || null) : null),
        zoneProgress: isGhostRider ? null : (vitals.progress ?? null),
        multiplier: mult,
        finished: isFinished,
        placement: isFinished ? (placementByUser[userId] ?? null) : null,
        // Live leader (rank-1 in standings) once the race is underway. standings()
        // ranks un-finished riders by distance every tick, so this hops on each lead
        // change and lands on the eventual winner.
        isLeader: engineState.elapsedS > 0 && placementByUser[userId] === 1,
        maxRpm: resolveRpmLimits(bikeById.get(rider.equipmentId) || {}).gaugeMaxRpm,
        // Penalty box: flag + countdown detail. Needle keeps showing real RPM
        // (riderLive.rpm above) so the rider can see they must pedal down to 0.
        penalized: penalizedNow.has(userId),
        dnf: dnfNow.has(userId),
        penaltyRemainingS: penaltyInfo[userId]?.remainingS ?? null,
        penaltyTotalS: penaltyInfo[userId]?.totalS ?? null,
        penaltyAwaitingStop: !!penaltyInfo[userId]?.awaitingStop
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
          lapLengthM={effectiveLapLength({
            lapLengthM: Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0,
            winCondition: engineState.winCondition || raceMetaRef.current?.winCondition || 'distance',
            goalM: engineState.goalM ?? raceMetaRef.current?.goalM ?? null
          })}
          ovalCircuitM={Number.isFinite(cycleGameConfig?.oval_circuit_m) ? cycleGameConfig.oval_circuit_m : 1000}
          events={raceEvents}
        />
        <CycleEventToast toast={eventToast} onDone={onEventToastDone} />
        <button type="button" data-testid="cycle-game-finish" className="cycle-game-container__finish" onClick={onFinishRace}>
          Finish race
        </button>
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
        penalized={raceEvents.filter((e) => e.type === 'penalty').map((e) => e.riderId)}
        lapLengthM={effectiveLapLength({
          lapLengthM: Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0,
          winCondition: engineState.winCondition || raceMetaRef.current?.winCondition || 'distance',
          goalM: engineState.goalM ?? raceMetaRef.current?.goalM ?? null
        })}
        elapsedS={engineState.elapsedS || 0}
        secondsLeft={resultsSecondsLeft}
        onExit={backToHome}
      />
      <button type="button" data-testid="cycle-game-start" className="cycle-game-container__start" onClick={backToHome}>
        Back to home
      </button>
    </div>
  );
}
