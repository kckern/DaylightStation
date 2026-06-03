import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import getLogger from '@/lib/logging/Logger.js';
import { CycleRaceController } from '@/modules/Fitness/lib/cycleGame/CycleRaceController.js';
import { buildRaceConfigFromCourse } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { buildRaceRecord } from '@/modules/Fitness/lib/cycleGame/raceRecord.js';
import { zoneMultiplierFor, zoneColorFor } from '@/modules/Fitness/lib/cycleGame/distanceModel.js';
import { playSound } from '@/modules/Fitness/lib/cycleGame/playSound.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { buildRecordRow } from '@/modules/Fitness/lib/cycleGame/recordRow.js';
import { resolveParticipantIdentity } from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
import { resolveRpmLimits, clampCountedRpm, rpmDuringGap } from '@/modules/Fitness/lib/cycleGame/equipmentRpm.js';
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
  const hotStartPenaltyS = Number.isFinite(cycleGameConfig?.hot_start_penalty_s) ? cycleGameConfig.hot_start_penalty_s : 0;

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
          ghostRpmSeries: g.ghostRpmSeries,
          ghostZoneSeries: g.ghostZoneSeries,
          ghostIntervalS: g.ghostIntervalS
        });
      });
    }
    return riders;
  }, [bikes, session, resolveDisplayName, ghost]);

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
        .map(([id, p]) => {
          // Ghosts are persisted as `ghost:<raceId>:<sourceId>` — resolve to the
          // real face/name so the records rail doesn't fall back to the guest avatar.
          const ident = resolveParticipantIdentity(id, p.display_name);
          return {
            id,
            isGhost: ident.isGhost,
            displayName: ident.displayName,
            avatarSrc: ident.avatarSrc,
            distanceSeries: p.distance_series || null,
            hrSeries: p.hr_series || null,
            rpmSeries: p.rpm_series || null,
            zoneSeries: p.zone_series || null,
            finalDistanceM: p.final_distance_m ?? null,
            finalTimeS: p.final_time_s ?? null,
            placement: p.placement ?? null
          };
        })
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

  // History table rows: winner + both metric columns + which is the goal + when.
  // "today" is computed once here (the container may read the clock); recordRow
  // helpers stay pure by taking it as an argument.
  const todayYmd = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }, []);
  // Most-recent first: raceId is YYYYMMDDHHmmss, so lexical-desc = chronological
  // desc. (The load gives newest *day* first but oldest race first within a day,
  // so an explicit sort is needed for a true recent-on-top rail.)
  const records = useMemo(
    () => [...ghostCandidates]
      .sort((a, b) => String(b.raceId).localeCompare(String(a.raceId)))
      .slice(0, 12)
      .map((g) => buildRecordRow(g, todayYmd)),
    [ghostCandidates, todayYmd]
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
      raceIdleDnfS,
      hotStartPenaltyS,
      backgroundPlexId: cycleGameConfig?.default_background ?? null,
      lapLengthM: Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0,
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
  }, [raceType, raceValueM, raceValueS, distanceDefaultM, timeDefaultS, stagingBufferMs, ghost, buildRiders, zones, cadenceBands, hrlessMultiplier, cycleGameConfig, raceIdleDnfS, hotStartPenaltyS, applySnapshot, log]);

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
        log.debug('cycle_game.sfx', { cue: 'go', attempted: playSound(soundsRef.current?.go, { volume: masterRef.current }) }); // null = silent
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
      const cadenceConnected = {}; // userId → bool, for the firehose + drop detection
      Object.keys(before.engineState?.riders || {}).forEach((userId) => {
        const rider = before.engineState.riders[userId];
        const cadence = liveSession?.getEquipmentCadence?.(rider.equipmentId);
        const connected = !!(cadence && cadence.connected);
        if (rider.equipmentId) cadenceConnected[userId] = connected; // ghosts have no equipment
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
      applySnapshot(state);
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
      ghostRpmSeries: SessionSerializerV3.decodeSeries(p.rpmSeries) || [],
      ghostZoneSeries: SessionSerializerV3.decodeSeries(p.zoneSeries) || [],
      ghostIntervalS: candidate.intervalSeconds || 1
    })).filter((r) => r.ghostSeries.length > 0);
    if (riders.length === 0) {
      log.warn('cycle_game.ghost_empty', { raceId: candidate.raceId });
      return;
    }
    // Telemetry: per-ghost series point-counts so "the ghost wasn't moving / had
    // no rpm" is diagnosable (old records carry distance+HR only).
    log.info('cycle_game.ghost_rider', {
      raceId: candidate.raceId,
      riders: riders.map((r) => ({
        userId: r.userId,
        distancePts: r.ghostSeries.length,
        hrPts: r.ghostHrSeries.length,
        rpmPts: r.ghostRpmSeries.length,
        zonePts: r.ghostZoneSeries.length
      }))
    });
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
          <RiderReadyStrip riders={stagingRiders} />
          <div className="cycle-game-staging__hint">Don’t pedal until the light turns green.</div>
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
        <div className="cycle-game-countdown-riders">
          <RiderReadyStrip riders={stagingRiders} />
        </div>
        <button type="button" data-testid="cycle-game-cancel" className="cycle-game-container__cancel" onClick={onCancel}>
          Cancel
        </button>
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
    const penaltyInfo = snapshot?.penaltyInfo || {};
    const riderLive = {};
    Object.keys(riders).forEach((userId) => {
      const rider = riders[userId];
      // Ghost rider ids are `ghost:<raceId>:<sourceUserId>` — resolve the avatar
      // from the original user so the speedometer shows their face.
      const isGhostRider = userId.startsWith('ghost:');
      const sourceId = isGhostRider ? userId.split(':')[2] : userId;
      // A finished distance-race rider is parked at the line: gauge reads idle.
      const isFinished = winConditionNow === 'distance' && rider.finishTimeS != null;
      const cadence = isGhostRider ? null : session?.getEquipmentCadence?.(rider.equipmentId);
      const vitals = isGhostRider ? {} : (getUserVitals?.(userId) || {});
      // Ghosts replay their recorded rpm + zone; live riders read cadence/vitals.
      const zoneId = isGhostRider ? (rider.zoneId || null) : (vitals.zoneId || null);
      const liveRpm = isGhostRider
        ? (Number.isFinite(rider.rpm) ? rider.rpm : 0)
        : (cadence && cadence.connected ? cadence.rpm : 0);
      riderLive[userId] = {
        rpm: isFinished ? 0 : liveRpm,
        avatarSrc: `/api/v1/static/img/users/${sourceId}`,
        heartRate: isGhostRider
          ? (Number.isFinite(rider.heartRate) ? rider.heartRate : null)
          : (vitals.heartRate ?? null),
        zoneId,
        zoneColor: isGhostRider ? zoneColorFor(zoneId, zones) : (vitals.zoneColor || null),
        zoneProgress: isGhostRider ? null : (vitals.progress ?? null),
        multiplier: isFinished ? 1 : zoneMultiplierFor(zoneId, zones, hrlessMultiplier),
        finished: isFinished,
        placement: isFinished ? (placementByUser[userId] ?? null) : null,
        maxRpm: resolveRpmLimits(bikeById.get(rider.equipmentId) || {}).gaugeMaxRpm,
        // Penalty box: flag + countdown detail. Needle keeps showing real RPM
        // (riderLive.rpm above) so the rider can see they must pedal down to 0.
        penalized: penalizedNow.has(userId),
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
          lapLengthM={Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0}
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
      />
      <button type="button" data-testid="cycle-game-start" className="cycle-game-container__start" onClick={backToHome}>
        Back to home
      </button>
    </div>
  );
}
