import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { announceGameAchievement } from "../../../../../../__capabilities/gaming/browser/platform/realtime/index.js";
import { useFitnessContext } from "../../context/FitnessContext.jsx";
import getLogger from '@/lib/logging/Logger.js';
import { CycleRaceController } from "../../lib/cycleGame/CycleRaceController.js";
import { buildRaceConfigFromCourse, formatClock as fmtClock } from "../../lib/cycleGame/cycleGameLobby.js";
import { buildRaceRecord, raceOutcomeMeta } from "../../lib/cycleGame/raceRecord.js";
import { zoneMultiplierFor, zoneColorFor, computeDistanceDelta, resolveWheelCircumferenceM } from "../../lib/cycleGame/distanceModel.js";
import { playSound } from "../../lib/cycleGame/playSound.js";
import { saveRaceRecord } from "../../lib/cycleGame/saveRaceRecord.js";
import { DaylightMediaPath } from '@/lib/api.mjs';
import { buildHighScores } from "../../lib/cycleGame/highScores.js";
import { buildRecordRow } from "../../lib/cycleGame/recordRow.js";
import { resolveParticipantIdentity } from "../../lib/cycleGame/participantIdentity.js";
import { mapRaceRecordToCandidate, buildGhostFromCandidate } from "../../lib/cycleGame/ghostCandidate.js";
import { pickPaceRival, paceRivalPool, mergeRaceCandidates, rivalPoolCandidates, buildParRecord, PAR_ID, DEFAULT_PAR_SPEED_KMH } from "../../lib/cycleGame/paceRival.js";
import { courseStartOverride, pickRival, onlyParticipant, ladderDelta } from "../../lib/cycleGame/ladder.js";
import { formatDistance } from "../../lib/cycleGame/formatDistance.js";
import { resolveRpmLimits, clampCountedRpm, rpmDuringGap } from "../../lib/cycleGame/equipmentRpm.js";
import { writeCheckpoint, readFreshCheckpoint, clearCheckpoint, checkpointRaceState, checkpointOutcome } from "../../lib/cycleGame/raceCheckpoint.js";
import { buildAutoStartCourse } from "../../lib/cycleGame/autoStartCourse.js";
import { effectiveLapLength } from "../../lib/cycleGame/effectiveLapLength.js";
import { deriveRaceSnapshot } from "../../lib/cycleGame/deriveRaceSnapshot.js";
import { dramaEventToasts, beatToasts } from "../../lib/cycleGame/dramaEventCopy.js";
import { raceBeats } from "../../lib/cycleGame/raceBeats.js";
import { resultsComparison } from "../../lib/cycleGame/resultsComparison.js";
import { staleClaims } from "../../lib/cycleGame/staleClaims.js";
import { paceDelta } from "../../lib/cycleGame/paceDelta.js";
import { boostState, formatMultiplier } from "../../lib/cycleGame/boostState.js";
import { pushToast, nextToast, toastDurationMs } from "../../lib/cycleGame/toastQueue.js";
import { usePersistentVolume } from "../../nav/usePersistentVolume.js";
import { linearLevelFromVolume, logVolumeFromLevel } from "../../../../../../__capabilities/playback/browser/volume/touchVolumeModel.js";
import CycleGameHome from "./CycleGameHome.jsx";
import CountdownStoplight from "./CountdownStoplight.jsx";
import RaceMenu from "./RaceMenu.jsx";
import RiderReadyStrip from "./RiderReadyStrip.jsx";
import CycleRaceScreen from "./CycleRaceScreen.jsx";
import CycleEventToast from "./CycleEventToast.jsx";
import RaceResults from "./RaceResults.jsx";
import RaceRecap from "./RaceRecap.jsx";
import { StopSignIcon, RaceFlagIcon, MedalIcon, SpeedIcon, GhostIcon } from "./home/icons.jsx";
import { dueAnchoredSteps } from "../../../../../../__capabilities/gaming/portable/realtime/index.mjs";
import "./CycleGameContainer.scss";

// Drama-event toast icons, keyed by the `variant` dramaEventCopy.js returns
// (stateless glyphs — module-scope, not re-created per render/callback).
const DRAMA_ICON = {
  'lead-change': <SpeedIcon />,
  finished: <MedalIcon />,
  'photo-finish': <RaceFlagIcon />,
  'final-lap': <RaceFlagIcon />,
  lapping: <GhostIcon />,
};

// The competitors a ghost adds to a race: its whole recorded field.
function ghostFieldRiders(g) {
  if (!g || !Array.isArray(g.riders)) return [];
  return g.riders.map((r) => ({
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
  }));
}

// A ghost's riders as the pre-race surfaces show them (name + real avatar).
function ghostRosterOf(g) {
  return (g?.riders || []).map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    avatarSrc: resolveParticipantIdentity(r.userId, r.displayName).avatarSrc
  }));
}

// A one-rider ghost replaying just `pt` out of a past race, named after them.
function ghostOfParticipant(candidate, pt) {
  return buildGhostFromCandidate({ ...candidate, participants: [pt], winnerName: pt.displayName });
}

/**
 * Arm the automatic pace rival from a list of candidates: the rider's own best
 * at this race type and length, else the household's best, else par. Only
 * the picked rider is replayed (not the whole field of that race), and the
 * rival is named after them. A pick that cannot be replayed falls back to par;
 * if par cannot be built either the race runs without a rival (kind 'none').
 * `source` is 'history' for a replayed ride and 'par' for par (also when par
 * failed); the caller renames 'history' when the list came from the server.
 *
 * @returns {{ ghost: object|null, kind: 'self'|'household'|'par'|'none',
 *   requestedKind: 'self'|'household'|'par', sourceRaceId: string|null,
 *   participantId: string|null, source: 'history'|'par' }}
 */
function armPaceRival({ candidates, riderId, winCondition, goalM, timeCapS, parSpeedKmh }) {
  const pick = pickPaceRival({ candidates, riderId, winCondition, goalM, timeCapS });
  if (pick.kind !== 'par') {
    const source = candidates.find((c) => c.raceId === pick.raceId);
    const pt = (source?.participants || []).find((x) => x.id === pick.participantId);
    const built = pt ? ghostOfParticipant(source, pt) : null;
    if (built) {
      return {
        ghost: built.ghost, kind: pick.kind, requestedKind: pick.kind,
        sourceRaceId: pick.raceId, participantId: pick.participantId, source: 'history'
      };
    }
  }
  const parRecord = buildParRecord({ winCondition, goalM, timeCapS, speedKmh: parSpeedKmh });
  const built = parRecord ? buildGhostFromCandidate(mapRaceRecordToCandidate(parRecord)) : null;
  return built
    ? { ghost: built.ghost, kind: 'par', requestedKind: pick.kind, sourceRaceId: null, participantId: PAR_ID, source: 'par' }
    : { ghost: null, kind: 'none', requestedKind: pick.kind, sourceRaceId: null, participantId: null, source: 'par' };
}

// A recorded rider's display name carries a ghost glyph ("Rider B 👻"); beat
// toasts word the rival in a sentence, so it is dropped there.
const plainName = (name) => String(name || '').replace(/\s*👻\s*$/u, '');

// How much the racing music rises for the finale (last minute / last stretch),
// as a share of the master volume.
const FINALE_MUSIC_LIFT = 0.15;

/**
 * Each live rider's history at this exact race type and length, from the
 * candidates the start already had (the same pool and filter as the pace
 * rival: not incomplete, not a ghost, not stopped, a positive result).
 * `previousBest` is the best result (lowest finish time in a distance race,
 * furthest distance in a time race) and `last` the most recent ride's.
 *
 * @returns {Object<string, {previousBest: number|null, last: number|null}>}
 */
function riderHistoryAt({ candidates, userIds, winCondition, goalM, timeCapS }) {
  const isDistance = winCondition === 'distance';
  const out = {};
  userIds.forEach((id) => { out[id] = { previousBest: null, last: null, lastRaceId: null }; });
  paceRivalPool({ candidates, winCondition, goalM, timeCapS }).forEach((c) => {
    (c.participants || []).forEach((pt) => {
      if (!pt || pt.stopped || pt.isGhost) return;
      const ident = resolveParticipantIdentity(pt.id);
      if (ident.isGhost) return;
      const h = out[ident.sourceId];
      if (!h) return;
      const value = isDistance ? pt.finalTimeS : pt.finalDistanceM;
      if (!(Number.isFinite(value) && value > 0)) return;
      const better = h.previousBest == null || (isDistance ? value < h.previousBest : value > h.previousBest);
      if (better) h.previousBest = value;
      if (h.lastRaceId == null || String(c.raceId) > String(h.lastRaceId)) {
        h.last = value;
        h.lastRaceId = c.raceId;
      }
    });
  });
  Object.values(out).forEach((h) => { delete h.lastRaceId; });
  return out;
}

// How the results board names a solo rider's rival.
function rivalLabelFor(rivalKind, rival) {
  const name = plainName(rival?.displayName);
  if (rivalKind === 'self') return 'your best';
  if (rivalKind === 'household') return name ? `${name}'s best` : 'their best';
  if (rivalKind === 'par') return 'par pace';
  return name;
}

// The one line the results board shows for a ride ended from the race menu, in
// place of any ladder-movement callout (it rides the same notes slot).
const ENDED_EARLY_NOTE = 'Ended early: saved to history, not counted for records or the ladder.';

// The whole budget for finding a rival on the server, per Start press. Past
// it the race starts with whatever the lobby has loaded.
const PACE_RIVAL_LOOKUP_MS = 1500;

/**
 * Every saved race of one win condition and exact length, as candidates made
 * from the server's light index rows: results only, no series. The lobby loads
 * only the most recent race days; this is the full history, so a best ride
 * from long ago is still found. Rejects on a network/HTTP failure. What counts
 * is decided by pickPaceRival alone; a pick from these rows needs its record
 * (fetchRaceRecord) before it can be replayed.
 */
async function fetchRivalPool({ winCondition, goalM, timeCapS, signal }) {
  const length = winCondition === 'time' ? `timeCapS=${encodeURIComponent(timeCapS)}` : `goalM=${encodeURIComponent(goalM)}`;
  const resp = await fetch(`/api/v1/fitness/cycle-races/rival-pool?winCondition=${encodeURIComponent(winCondition)}&${length}`, { signal });
  if (!resp.ok) throw new Error(`rival-pool ${resp.status}`);
  const body = await resp.json();
  return rivalPoolCandidates(body?.entries);
}

/**
 * One saved race record (`{ race, participants }`), or null when the answer
 * holds none. Rejects on a network/HTTP failure.
 */
async function fetchRaceRecord(raceId, { signal = null } = {}) {
  const url = `/api/v1/fitness/cycle-races/${encodeURIComponent(raceId)}`;
  const resp = await (signal ? fetch(url, { signal }) : fetch(url));
  if (!resp.ok) throw new Error(`cycle-races/${raceId} ${resp.status}`);
  const body = await resp.json();
  return body?.race ?? null;
}

const RACE_TICK_MS = 1000;
const COUNTDOWN_TICK_MS = 1000;
const GO_HOLD_MS = 800; // hold the green light (engine already live) before the race screen
// A rider's sensor-gap counter (gapTicksRef, feeds rpmDuringGap) crossing this
// threshold means the hold has fully decayed to 0 — presumed genuinely
// disconnected, not a broadcast blip. Drives the "sensor lost" chip + edge log
// (audit game-design #6). Matches equipmentRpm.js's decay-to-zero tick.
const SENSOR_LOST_GAP_TICKS = 9;
/**
 * A sensor that has not appeared AT ALL by this many ticks is missing, not late.
 *
 * The chip used to require a rider to have been connected once, so a sensor
 * that never showed up produced no warning ever — and the race then forfeited
 * the rider with "Stopped pedaling", which was the only thing anyone saw. This
 * is deliberately longer than SENSOR_LOST_GAP_TICKS (a rider may be mounting,
 * clipping in, or waiting on a magnetless sensor to lock on) and deliberately
 * shorter than the start-grace that ends the race for them, so the warning
 * arrives while it can still be acted on.
 */
const SENSOR_ABSENT_GAP_TICKS = 15;
// A rider claim with no pedalling for this long is cleared by the lobby, so
// the next session does not start by clearing a stranger off a bike. Checked
// when the lobby appears and once a minute while it is up.
const STALE_CLAIM_MS = 30 * 60 * 1000;
const STALE_CLAIM_CHECK_MS = 60 * 1000;

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
  const musicVolumeRef = useRef(musicVolume);
  musicVolumeRef.current = musicVolume;
  // The finale lift (FINALE_MUSIC_LIFT while a race is in its finale, else 0),
  // added to the music level before the master scales it.
  const musicLiftRef = useRef(0);

  // Master volume — the OFFICIAL fitness volume store (the same level the rest
  // of the app's video uses). Scales all cycle-game music + SFX; the lobby
  // exposes the standard TouchVolumeButtons control bound to it.
  const masterVol = usePersistentVolume({ grandparentId: 'fitness', parentId: 'global', trackId: 'video' });
  // The store holds the button level linearly; game audio follows the house log
  // curve (touchVolumeModel, as the music player and dance party do) so the low
  // buttons are genuinely quiet.
  const storeVolume = Number.isFinite(masterVol.volume) ? masterVol.volume : 1;
  const effectiveMaster = masterVol.muted ? 0 : logVolumeFromLevel(linearLevelFromVolume(storeVolume));
  const masterRef = useRef(1);
  masterRef.current = effectiveMaster;

  // Background-music channel (one looping track at a time, swapped per phase).
  // Separate from the one-shot SFX channel (playSound). Null/absent = silent.
  const musicRef = useRef(null);
  const musicKeyRef = useRef(null);
  // The level every music track plays at: (music_volume + finale lift) × master.
  const musicLevel = useCallback((master = masterRef.current) => Math.max(0, Math.min(1,
    (musicVolumeRef.current + musicLiftRef.current) * (Number.isFinite(master) ? master : 1))), []);
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
      a.volume = musicLevel();
      // Autoplay can defer until a user gesture — benign, logged at debug so a
      // "no music" report can be told apart from a genuine load failure.
      a.play().catch((err) => { log.debug('cycle_game.music_deferred', { key, error: err?.message || String(err) }); });
      musicRef.current = a;
      musicKeyRef.current = key;
      log.debug('cycle_game.music', { key, loop });
    } catch (err) {
      log.warn('cycle_game.music_unavailable', { key, error: err?.message || String(err) });
    }
  }, [musicLevel, stopMusic, log]);
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
  // The ghost actually racing THIS race: the hand-picked/ladder ghost, or the
  // automatic pace rival, or null. Set by startRace for the staging/countdown
  // rider strip only. The lobby never reads it, so an automatic rival neither
  // locks the race type/value nor carries into the next race.
  const [raceGhost, setRaceGhost] = useState(null);
  // "Race my best" (lobby toggle, OFF by default): the only way a rival the
  // rider did not hand-pick in the Ghost picker joins a race — the automatic
  // pace rival for a lone rider, or the ladder rival on "Ride it". Off, a plain
  // Distance/Time race is just the riders on the bikes (2026-11-10: a rival was
  // added to a plain Distance race with no way to opt out).
  const [raceMyBest, setRaceMyBest] = useState(false);
  // The live riders staged for THIS race (`{ userId, equipmentId }`), fixed when
  // the race is built. The staging/countdown strip shows these, not whoever
  // holds a bike right now: a claim that changed while Start was waiting on its
  // rival lookup must not show a rider who is not in the race.
  const [raceRiders, setRaceRiders] = useState([]);
  // True once a lobby history load has completed (the pace-rival log reports it,
  // so "par because nobody has ridden this" is told apart from "par because the
  // history had not arrived yet").
  const historyLoadedRef = useRef(false);
  // A start waiting on the server: a Start press on its rival lookup, or "Ride
  // it" on its ladder rival. The ref is the
  // synchronous guard (a second press in the same tick is dropped, and unmount
  // clears it so a late answer starts nothing); the state freezes the lobby and
  // turns the Start button into "Starting…".
  const startPendingRef = useRef(null);
  const [startPending, setStartPending] = useState(false);
  const mountedRef = useRef(true);

  // Use the canonical relational name resolver: getDisplayLabel applies the
  // household nickname ("Dad"/"Mom") when 2+ HR riders are present, else the
  // given name. Don't reinvent this.
  const resolveDisplayName = useCallback((userId) => {
    if (!userId) return userId;
    const name = getUserVitals?.(userId)?.name || getUserByName?.(userId)?.name || getDisplayName?.(userId) || userId;
    return getDisplayLabel?.(name, { userId }) || name;
  }, [getUserVitals, getUserByName, getDisplayName, getDisplayLabel]);

  // Officiating thresholds. `race_idle_dnf_s` is the park window (legacy key name).
  const raceIdleDnfS = Number.isFinite(cycleGameConfig?.race_idle_dnf_s) ? cycleGameConfig.race_idle_dnf_s : 20;
  // Grace before a rider's FIRST movement is required (vs the idle clock that
  // runs after they've started). Covers magnetless cadence sensors that take
  // ~20s to lock onto rotation from a dead stop (e.g. the tricycle's BK467).
  const raceStartGraceS = Number.isFinite(cycleGameConfig?.race_start_grace_s) ? cycleGameConfig.race_start_grace_s : 30;
  // Distance-race mercy-kill (issue 2): seconds after the FIRST rider crosses the
  // line before the race auto-ends; anyone still going is put in overtime with
  // their real distance — a
  // distance race otherwise waits forever for the slowest rider. Defaults ON at
  // 60s; set race_mercy_after_winner_s: 0 to disable. Ignored by time races.
  const raceMercyAfterWinnerS = Number.isFinite(cycleGameConfig?.race_mercy_after_winner_s)
    ? cycleGameConfig.race_mercy_after_winner_s
    : 60;
  // How long the results board holds before auto-returning to the lobby.
  const resultsDwellS = Number.isFinite(cycleGameConfig?.results_dwell_s) ? cycleGameConfig.results_dwell_s : 45;
  // Speed of the "par" pace rival a lone rider races when nobody has ridden
  // this race type and length before.
  const parSpeedKmh = Number.isFinite(cycleGameConfig?.par_speed_kmh) && cycleGameConfig.par_speed_kmh > 0
    ? cycleGameConfig.par_speed_kmh
    : DEFAULT_PAR_SPEED_KMH;

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
      // A bike whose config has no wheel_circumference_m races on the default
      // rather than 0 m per rev (which made the 2026-09-08 pedaler race
      // unwinnable). Warn so the missing config is visible in the log store.
      const wheelCircumferenceM = resolveWheelCircumferenceM(bike);
      if (!(Number.isFinite(bike.wheel_circumference_m) && bike.wheel_circumference_m > 0)) {
        log.warn('cycle_game.wheel_default', {
          equipmentId: bike.id,
          userId,
          configured: bike.wheel_circumference_m ?? null,
          wheelCircumferenceM
        });
      }
      riders.push({
        userId,
        displayName: resolveDisplayName(userId),
        equipmentId: bike.id,
        wheelCircumferenceM
      });
    });
    // A selected ghost replays its whole recorded field as competitors.
    return riders.concat(ghostFieldRiders(g));
  }, [bikes, session, resolveDisplayName, ghost, log]);

  // ── lifecycle state ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle'); // idle | staging | countdown | racing | results
  const [stagingSeconds, setStagingSeconds] = useState(0); // "to your bikes" countdown
  const [resultsSecondsLeft, setResultsSecondsLeft] = useState(null); // results auto-exit countdown
  // Lobby banner text for a just-recovered crash checkpoint (audit C1 / T5
  // follow-up — recovery previously only logged, with no user-visible notice).
  // Set by the recovery effect on a successful save; cleared on its own 8s
  // timeout below OR when a new race starts (whichever comes first).
  const [recoveredNotice, setRecoveredNotice] = useState(null);
  const stagingDeadlineRef = useRef(0); // earliest wall-time staging may advance to countdown
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
  // Mid-race crash recovery (audit C1): guards the recovery check to run
  // exactly once — on the FIRST time the container reaches idle after mount
  // (not every return-to-idle, e.g. after backToHome/onCancel).
  const recoveryCheckedRef = useRef(false);
  // Parked riders (idle past the park window) → the race time they parked at,
  // so the resume log can say how long they were away. Edge-detected per tick.
  const prevParkedRef = useRef(new Map());
  const prevNoSensorRef = useRef(new Set());
  // Riders whose race was cut short by the clock/operator (mercy-kill window
  // closing, or a forced finish) while still riding — see CycleRaceController's
  // `overtime` set. Never a parked or no-sensor rider.
  const prevOvertimeRef = useRef(new Set());
  // Last seen heart-rate zone + multiplier per live rider, for the boost
  // toast (up only) and the boost_change log (both directions). Seeded by the
  // first reading of a race, which raises nothing.
  const prevBoostRef = useRef(new Map());
  // Telemetry: track prior tick state so transitions (not steady state) are what
  // gets logged — cadence connect/drop, phase, and a monotonic tick index for
  // the per-tick firehose.
  const prevCadenceRef = useRef(new Map());
  const prevPhaseRef = useRef('idle');
  const tickCountRef = useRef(0);
  // Per-rider recent CONNECTED rpm readings (oldest→newest, capped) — lets a
  // cadence broadcast gap hold the last value instead of flatlining, while a
  // genuine downward-trend-to-zero is still honored. See rpmDuringGap.
  const rpmHistoryRef = useRef(new Map());
  // Per-rider consecutive-gap-tick counter (userId → count), reset to 0 on any
  // CONNECTED reading and incremented once per disconnected tick. Feeds
  // rpmDuringGap's cap (hold → decay → 0) and, once it crosses
  // SENSOR_LOST_GAP_TICKS, the "sensor lost" flag/chip below (audit
  // game-design #6). Read directly at render time (riderLive assembly) — safe
  // because it's mutated synchronously inside the same tick effect that drives
  // the setSnapshot commit each tick, so it's always current by render.
  const gapTicksRef = useRef(new Map());
  // Edge-detection for the sensor-lost telemetry (mirrors prevCadenceRef).
  const prevSensorLostRef = useRef(new Set());
  const eventIdRef = useRef(0);
  // Single-slot, self-dismissing event toast + a queue for events that pile up
  // (toastQueue.js: entries `{ toast, atMs }`; stale news is dropped, a newer
  // toast of the same kind replaces a queued one). The ref mirrors the slot so
  // showToast decides synchronously, outside a state updater.
  const [eventToast, setEventToast] = useState(null);
  const eventToastRef = useRef(null);
  const toastQueueRef = useRef([]);
  // Edge-triggered drama events (audit C2 — deriveRaceSnapshot was fully built
  // + tested but never called from the live tick). Chained snapshot-to-
  // snapshot so LEAD_CHANGE/RIDER_FINISHED/PHOTO_FINISH/FINAL_LAP/
  // LAPPING_IMMINENT fire exactly once, on the tick they actually happen.
  const prevRaceSnapshotRef = useRef(null);
  // Race beats (raceBeats.js): its state between ticks, whether the clock is in
  // the final ten seconds (read at render, like gapTicksRef), and whether the
  // race has reached its finale (last minute / last stretch).
  const raceBeatsRef = useRef(null);
  const finalSecondsRef = useRef(false);
  const finalSecondsLoggedRef = useRef(false);
  const finaleRef = useRef(false);

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

  // When each claimed bike last moved: equipmentId → { userId, lastActiveMs }.
  // The session keeps no claim time and no last-pedalled time (its cadence
  // reading's `ts` moves on every packet, a still bike included), so the
  // container records it: seeded when it first sees a claim (or a claim
  // changes hands), moved on every reading above 0 rpm. Sampled by the lobby
  // and pre-race polls and every race tick.
  const bikeActivityRef = useRef(new Map());
  const noteBikeActivity = useCallback((nowMs = Date.now()) => {
    const live = sessionRef.current;
    bikes.forEach((bike) => {
      const userId = live?.getEquipmentRider?.(bike.id) || null;
      if (!userId) { bikeActivityRef.current.delete(bike.id); return; }
      const entry = bikeActivityRef.current.get(bike.id);
      if (!entry || entry.userId !== userId) {
        bikeActivityRef.current.set(bike.id, { userId, lastActiveMs: nowMs });
        return;
      }
      const cadence = live?.getEquipmentCadence?.(bike.id);
      if (cadence && cadence.connected && Number(cadence.rpm) > 0) entry.lastActiveMs = nowMs;
    });
  }, [bikes]);
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

  // The app's navigation rail is a distraction and an accidental-touch hazard
  // while a race is under way, so it hides from staging until the game is back
  // in the lobby (riders navigate from the lobby, so the lobby keeps it). The
  // unmount cleanup restores it however the game ends, including a crash that
  // an error boundary above catches.
  const setImmersive = ctx?.setImmersive;
  const immersiveOn = phase !== 'idle';
  const immersiveLoggedRef = useRef(false);
  useEffect(() => {
    if (immersiveLoggedRef.current !== immersiveOn) {
      immersiveLoggedRef.current = immersiveOn;
      log.debug('cycle_game.immersive', { on: immersiveOn });
    }
    if (typeof setImmersive === 'function') setImmersive(immersiveOn);
  }, [immersiveOn, setImmersive, log]);
  useEffect(() => () => {
    if (typeof setImmersive === 'function') setImmersive(false);
  }, [setImmersive]);

  // Every toast goes through here: shown now when the slot is free, otherwise
  // queued. Entries a push or a take leaves out of the queue are logged as
  // dropped (`replaced` by a newer toast of the same kind, `stale` past
  // TOAST_MAX_AGE_MS, `resolved` when what it announced is over).
  const logDropped = useCallback((entries, reason, nowMs) => {
    entries.forEach((e) => log.debug('cycle_game.event_toast.dropped', {
      variant: e.toast?.variant ?? null, ageMs: nowMs - e.atMs, reason
    }));
  }, [log]);
  const setSlot = useCallback((toast) => {
    eventToastRef.current = toast;
    setEventToast(toast);
  }, []);
  const showToast = useCallback((toast) => {
    const id = (eventIdRef.current += 1);
    const t = { ...toast, id };
    if (!eventToastRef.current) { setSlot(t); return; }
    const nowMs = Date.now();
    const before = toastQueueRef.current;
    const after = pushToast(before, t, nowMs);
    logDropped(before.filter((e) => !after.includes(e)), 'replaced', nowMs);
    toastQueueRef.current = after;
  }, [setSlot, logDropped]);
  // Withdraw queued toasts that no longer hold (e.g. a park notice for a rider
  // who has already resumed). The toast on screen is left to run out.
  const dropQueuedToasts = useCallback((match) => {
    const nowMs = Date.now();
    const gone = toastQueueRef.current.filter((e) => match(e.toast));
    if (!gone.length) return;
    toastQueueRef.current = toastQueueRef.current.filter((e) => !gone.includes(e));
    logDropped(gone, 'resolved', nowMs);
  }, [logDropped]);
  // The toast on screen ran out: show the next one that is still fresh.
  const onEventToastDone = useCallback(() => {
    const nowMs = Date.now();
    const before = toastQueueRef.current;
    const { toast, queue } = nextToast(before, nowMs);
    logDropped(before.filter((e) => e.toast !== toast && !queue.includes(e)), 'stale', nowMs);
    toastQueueRef.current = queue;
    setSlot(toast);
  }, [setSlot, logDropped]);

  // A rider's away toast (single-slot; queue overflow). Parked is calm: they
  // stopped pedalling and come back on their next stroke, so it says how to
  // rejoin. A rider whose sensor never reported is NOT told they stopped
  // pedalling: that sentence was once printed to a child who was pedalling the
  // whole time, because his cadence sensor had been silent for four minutes,
  // and the race cannot tell the difference from rpm alone. The blame goes to
  // the equipment, which is where it belongs.
  const recordRiderToast = useCallback((type, userId, state) => {
    const rider = state.engineState?.riders?.[userId] || {};
    const displayName = rider.displayName || userId;
    // `userId` lets a resume withdraw a park notice that has not been shown yet.
    showToast(type === 'nosensor'
      ? { variant: 'nosensor', userId, icon: <StopSignIcon />, title: `${displayName} — no sensor`, subtitle: 'Their bike never reported. Check the sensor.' }
      : { variant: 'parked', userId, icon: null, title: `${displayName} is parked`, subtitle: 'Pedal to rejoin' });
  }, [showToast]);

  // Race-closed toast: the mercy-kill window (or a forced finish) can cut several
  // stragglers in the SAME tick — one summary toast, not a stack of per-rider
  // toasts, so the moment reads as "the race ended" rather than "you all
  // failed" (audit game-design #7 — the riders it names are still credited their
  // real distance in the results).
  const recordOvertimeEvent = useCallback((userIds) => {
    const n = userIds.length;
    showToast({
      variant: 'overtime',
      icon: <RaceFlagIcon />,
      title: `Race closed — ${n} rider${n === 1 ? '' : 's'} still riding`
    });
  }, [showToast]);

  // Boost toast: a live rider's heart-rate zone went UP, so each stroke now
  // counts for more. One positive toast; a downward change raises nothing.
  const recordBoostToast = useCallback((displayName, zoneId) => {
    const b = boostState({ zoneId, zones: zonesRef.current, hrlessMultiplier: hrlessMultiplierRef.current });
    showToast({ variant: 'boost', icon: <SpeedIcon />, title: `${displayName}: ${b.label} ×${formatMultiplier(b.mult)}` });
  }, [showToast]);

  // Drama-event ceremony copy (audit C2 — "the highest fun-per-line fix in
  // the codebase"): the event→copy mapping is pure (dramaEventCopy.js,
  // independently unit-tested); this callback only adds the view-layer icon
  // and enqueues. RIDER_FINISHED doubles as the finish-line ceremony (audit
  // feedback 2026-07-02) — a distance-goal crossing gets its own celebratory
  // moment the instant it happens, not just a row on the end-of-race results
  // screen.
  const recordDramaEvent = useCallback((event, snapshot, riders) => {
    log.debug('cycle_game.drama_event', {
      raceId: raceMetaRef.current?.raceId ?? null,
      type: event.type,
      riderIds: event.riderIds || [],
      elapsedS: event.firedAtClock ?? null
    });
    dramaEventToasts(event, snapshot, riders).forEach((t) => {
      showToast({ icon: DRAMA_ICON[t.variant] || null, ...t });
    });
  }, [log, showToast]);

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
        connected,
        // The bike's cadence sensor is reporting right now (the lobby's sensor
        // check reads this; a bike that is reporting but still reads rpm 0).
        sensorLive: connected
      };
    }),
    // assignVersion forces a re-read after assign/unassign AND on the idle poll,
    // so live RPM refreshes ~1 Hz on the lobby.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bikes, session, assignVersion]
  );

  const assignedRiderCount = useMemo(
    () => bikesForGrid.filter((b) => b.rider).length,
    [bikesForGrid]
  );

  // Ghost riders enriched with a real avatar (audit C6 / user feedback
  // 2026-07-02): a selected ghost used to be invisible pre-race — only a
  // small "vs Name" chip on the race-type picker — and only materialized once
  // the race screen mounted. Shared by the starting grid (GhostSlot) and the
  // ready strip below, so both surfaces show the SAME ghost roster the race
  // will actually run with.
  const ghostRosterRiders = useMemo(() => ghostRosterOf(ghost), [ghost]);
  // The same, for the ghost racing THIS race (staging + countdown strip). Unlike
  // the lobby roster above it includes the automatic pace rival.
  const raceGhostRosterRiders = useMemo(() => ghostRosterOf(raceGhost), [raceGhost]);

  // On-board riders for the pre-race strip (staging + countdown): the riders
  // staged for this race with the LIVE rpm of the bike each was staged on and
  // whether that bike's sensor is reporting (READY / NO SIGNAL), PLUS the ghost
  // riders in this race (always AUTO: a ghost runs on its own recorded clock).
  // The start is rolling, so cadence before green never changes a chip's state.
  // assignVersion drives the refresh (bumped by the staging/countdown poll).
  const stagingRiders = useMemo(
    () => raceRiders.map(({ userId, equipmentId }) => {
      const cadence = session?.getEquipmentCadence?.(equipmentId);
      const sensorLive = !!(cadence && cadence.connected);
      const rpm = sensorLive && Number.isFinite(cadence.rpm) ? cadence.rpm : 0;
      const vitals = getUserVitals?.(userId) || {};
      return {
        id: userId,
        equipmentId,
        name: resolveDisplayName(userId),
        avatarSrc: `/api/v1/static/img/users/${userId}`,
        rpm,
        heartRate: Number.isFinite(vitals.heartRate) ? vitals.heartRate : null,
        zoneColor: vitals.zoneColor || null,
        sensorLive,
        // No heart rate: they ride at the strapless multiplier; the strip
        // says so before the race.
        noStrapMultiplier: Number.isFinite(vitals.heartRate) && vitals.heartRate > 0 ? null : hrlessMultiplier
      };
    }).concat(raceGhostRosterRiders.map((r) => ({
      id: r.userId,
      name: r.displayName,
      avatarSrc: r.avatarSrc,
      rpm: 0,
      heartRate: null,
      zoneColor: null,
      isGhost: true
    }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raceRiders, session, getUserVitals, resolveDisplayName, assignVersion, raceGhostRosterRiders, hrlessMultiplier]
  );

  // Keep on-board RPM and sensor state live during staging + countdown so the
  // strip reacts quickly when a bike starts (or stops) reporting.
  useEffect(() => {
    if (phase !== 'staging' && phase !== 'countdown') return undefined;
    const id = setInterval(() => { noteBikeActivity(); setAssignVersion((v) => v + 1); }, 300);
    return () => clearInterval(id);
  }, [phase, noteBikeActivity]);

  // While on the lobby, riders can be claimed OUTSIDE the React tree — by the
  // physical rider-select button or the dev simulator, both of which mutate the
  // session instance directly without bumping assignVersion. Poll so the grid
  // (and the Start button's enabled state) reflects those external claims.
  useEffect(() => {
    if (phase !== 'idle') return undefined;
    const id = setInterval(() => { noteBikeActivity(); setAssignVersion((v) => v + 1); }, 750);
    return () => clearInterval(id);
  }, [phase, noteBikeActivity]);

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
        // Parallel per-day fetches — sequential round-trips made lobby entry
        // wait ~5x longer than needed on the kiosk.
        const perDay = await Promise.all(recent.map(async (date) => {
          const r = await fetch(`/api/v1/fitness/cycle-races?date=${encodeURIComponent(date)}`);
          if (!r.ok) return [];
          const { races = [] } = await r.json();
          return races;
        }));
        const all = perDay.flat();
        if (!cancelled) {
          setPastRaces(all);
          historyLoadedRef.current = true;
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
  const [ladderNotes, setLadderNotes] = useState([]); // results-board movement callouts (Task 10)
  const [saveFailed, setSaveFailed] = useState(false); // all save retries exhausted → results badge

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

  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Build and stage the race from a resolved plan (see startRace, which decides
  // the field). `paceRival` is the automatic rival for a lone rider, or null.
  const stageRace = useCallback(({ ov, type, goalM, timeCapS, course, liveRiders, chosenGhost, historyCandidates = [] }, paceRival) => {
    const armedGhost = chosenGhost || paceRival?.ghost || null;
    // 'ghost' = hand-picked or ladder rival; null = nobody to chase.
    const rivalKind = chosenGhost ? 'ghost' : (paceRival?.ghost ? paceRival.kind : null);
    const riders = liveRiders.concat(ghostFieldRiders(armedGhost));
    setRaceGhost(armedGhost);
    setRaceRiders(liveRiders.map((r) => ({ userId: r.userId, equipmentId: r.equipmentId })));
    const cfgLap = Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0;
    const lapLengthM = effectiveLapLength({ lapLengthM: cfgLap, winCondition: type, goalM });
    const cfg = buildRaceConfigFromCourse(course, {
      riders,
      zones,
      hrlessMultiplier,
      startCountdownS: Number.isFinite(cycleGameConfig?.start_countdown_s) ? cycleGameConfig.start_countdown_s : 3,
      raceIdleDnfS,
      raceStartGraceS,
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
      lapLengthM,
      // Real course identity only — 'custom'/'ghost' lobby races persist null.
      courseId: ov?.id ?? null,
      // Who the field is chasing: 'self' | 'household' | 'par' (automatic pace
      // rival), 'ghost' (hand-picked or ladder rival), null (no rival).
      rivalKind,
      // Each live rider's best and most recent ride at this type and length,
      // as of this start (before this race is saved): the results comparison.
      history: riderHistoryAt({
        candidates: historyCandidates,
        userIds: liveRiders.map((r) => r.userId),
        winCondition: type, goalM, timeCapS
      }),
      // What a Rematch replays: the course override (a featured course keeps
      // its id) and the hand-picked or ladder ghost, if any. An automatic pace
      // rival is not kept: it is re-picked at the rematch.
      rematch: { ov, chosenGhost: chosenGhost || null, winCondition: type, goalM, timeCapS }
    };
    if (paceRival) {
      log.info('cycle_game.pace_rival', {
        raceId,
        kind: paceRival.kind,
        requestedKind: paceRival.requestedKind,
        sourceRaceId: paceRival.sourceRaceId,
        participantId: paceRival.participantId,
        source: paceRival.source,
        candidates: paceRival.candidates,
        historyLoaded: paceRival.historyLoaded,
        serverLookup: paceRival.serverLookup,
        lookupMs: paceRival.lookupMs,
        recordFetched: paceRival.recordFetched
      });
    }
    startCountdownRef.current = cfg.startCountdownS;
    savedRef.current = false;
    prevParkedRef.current = new Map();
    prevNoSensorRef.current = new Set();
    prevOvertimeRef.current = new Set();
    prevBoostRef.current = new Map();
    prevCadenceRef.current = new Map();
    rpmHistoryRef.current = new Map();
    gapTicksRef.current = new Map();
    prevSensorLostRef.current = new Set();
    prevRaceSnapshotRef.current = null;
    raceBeatsRef.current = null;
    finalSecondsRef.current = false;
    finalSecondsLoggedRef.current = false;
    finaleRef.current = false;
    musicLiftRef.current = 0;
    tickCountRef.current = 0;
    setSaveFailed(false);
    setLadderNotes([]);
    setSlot(null);
    toastQueueRef.current = [];

    const controller = new CycleRaceController(cfg);
    controllerRef.current = controller;

    // Telemetry: full effective config, once. Per-tick logs stay dynamic-only;
    // this is where the static facts (zone multipliers, idle windows, sounds)
    // live so "the multiplier was wrong" complaints can be corroborated.
    const sx = soundsRef.current || {};
    log.info('cycle_game.config', {
      raceId,
      winCondition: cfg.winCondition,
      goalM: cfg.goalM ?? null,
      timeCapS: cfg.timeCapS ?? null,
      startCountdownS: cfg.startCountdownS,
      raceIdleDnfS,
      raceStartGraceS,
      hrlessMultiplier,
      stagingBufferMs,
      intervalMs: RACE_TICK_MS,
      zoneMultipliers: (Array.isArray(zones) ? zones : []).map((z) => ({ id: z.id, mult: z.distance_multiplier })),
      cadenceBands: (Array.isArray(cadenceBands) ? cadenceBands : []).map((b) => ({ id: b.id, min: b.min })),
      sounds: {
        lobby: !!sx.lobby, ready: !!sx.ready, start: !!sx.start, go: !!sx.go,
        countdown: !!sx.countdown, final_seconds: !!sx.final_seconds, finish: !!sx.finish, end: !!sx.end, racing: !!sx.racing?.dir
      },
      backgroundPlexId: cfg.backgroundPlexId ?? null,
      rivalKind,
      riders: riders.map((r) => ({
        userId: r.userId,
        isGhost: Array.isArray(r.ghostSeries) && r.ghostSeries.length > 0,
        equipmentId: r.equipmentId ?? null,
        // The meters-per-rev each live rider actually races on (0 for ghosts,
        // which replay recorded distance) — a 0-m race is diagnosable from here.
        wheelCircumferenceM: Number.isFinite(r.wheelCircumferenceM) ? r.wheelCircumferenceM : 0
      }))
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
      // The advance to countdown happens when the buffer elapses (a dedicated
      // effect) — record the wall-time it may proceed.
      stagingDeadlineRef.current = Date.now() + stagingBufferMs;
    } else {
      applySnapshot(controller.startCountdown());
    }
    // The phase changes above only reach phaseRef after a render. Mark the lobby
    // as left right now, so a second start in this same tick is refused. (Last,
    // so a throw above leaves the lobby startable.)
    phaseRef.current = 'launching';
  }, [stagingBufferMs, zones, cadenceBands, hrlessMultiplier, cycleGameConfig, raceIdleDnfS, raceStartGraceS, raceMercyAfterWinnerS, applySnapshot, setSlot, log]);

  // Back to the lobby with no race in hand. phaseRef is set here as well as by
  // the [phase] effect: when a launch and this run in one batch the phase state
  // never changes, the effect never runs, and Start would stay refused.
  const returnToLobby = useCallback(() => {
    controllerRef.current = null;
    raceMetaRef.current = null;
    setSnapshot(null);
    setPhase('idle');
    phaseRef.current = 'idle';
  }, []);

  // Stage the race, all or nothing: a throw partway through must not leave a
  // controller or race meta behind for the next race to trip over.
  const launchRace = useCallback((plan, paceRival) => {
    try {
      stageRace(plan, paceRival);
    } catch (err) {
      returnToLobby();
      throw err;
    }
  }, [stageRace, returnToLobby]);

  // Start pressed. Decides the field, then launches. Returns whether the start
  // was accepted (false = dropped: a race is already under way, another start is
  // pending, there is nobody to race, or launching failed). A lone rider with no ghost waits up to
  // `lookupBudgetMs` for the server's rival pool (and the one record it picks)
  // before launching; every other start launches synchronously. `control` names the caller in the logs.
  const startRace = useCallback((override = null, ghostOverride = undefined, { lookupBudgetMs = PACE_RIVAL_LOOKUP_MS, control = null } = {}) => {
    const ov = override && override.win_condition ? override : null;
    const controlName = control || (ov ? 'sim.autostart' : 'lobby.start-button');
    if (!mountedRef.current) return false; // a late async caller after the game closed
    // One race per start: only the lobby starts a race, and only one at a time.
    if (phaseRef.current !== 'idle') {
      log.info('cycle_game.start_ignored', { reason: 'not_idle', control: controlName });
      return false;
    }
    if (startPendingRef.current) {
      log.info('cycle_game.start_ignored', { reason: 'start_pending', control: controlName });
      return false;
    }
    setRecoveredNotice(null); // a fresh race supersedes any "recovered your last race" notice
    log.info('cycle_game.start_pressed', {
      raceType: ov ? ov.win_condition : (ghost ? 'ghost' : raceType),
      hasGhost: !!ghost,
      control: controlName
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
    // The ghost that would race: an explicit override (the featured-course
    // button passes its ladder rival, or null for "none") beats the lobby's
    // hand-picked ghost.
    const chosenGhost = (ghostOverride !== undefined ? ghostOverride : ghost) || null;
    const liveRiders = buildRiders(null);
    // The field is live riders plus the ghost's: a ghost-only race (a featured
    // ride with nobody on a bike) is a race.
    if (liveRiders.length + ghostFieldRiders(chosenGhost).length === 0) {
      log.warn('cycle_game.staged', { courseId: course.id, error: 'no_riders' });
      return false;
    }
    const plan = { ov, type, goalM, timeCapS, course, liveRiders, chosenGhost };
    // Launch, reporting a failure instead of throwing it at the caller (a click
    // handler, the simulator, or a promise nobody awaits). `makeRival` builds
    // the automatic rival, or is null when the race has none.
    // `historyCandidates` is the pool the comparison on the results board is
    // taken from: the one the rival lookup assembled, else loaded history.
    const launch = (makeRival, historyCandidates = ghostCandidates) => {
      try {
        launchRace({ ...plan, historyCandidates }, makeRival ? makeRival() : null);
        return true;
      } catch (err) {
        log.error('cycle_game.start_failed', { control: controlName, error: err?.message || String(err) });
        return false;
      }
    };
    // A lone rider with no ghost who switched on "Race my best" gets someone to
    // chase: their own best at this race type and length, else the household's
    // best, else par. Off (the default), the race has no rival. It is armed for
    // this race only (never through `ghost` state), so it does not lock the
    // lobby or persist. Two or more riders race each other: no rival, no event.
    if (chosenGhost || liveRiders.length !== 1) return launch(null);
    if (!raceMyBest) {
      log.debug('cycle_game.pace_rival_skipped', { reason: 'not_opted_in', control: controlName });
      return launch(null);
    }
    const riderId = liveRiders[0].userId;
    const race = { winCondition: type, goalM, timeCapS };
    const historyLoaded = historyLoadedRef.current; // as of this press
    // One selection rule (pickPaceRival) over whichever list we end up with.
    // `candidates` reports how many races of this type + length it chose from;
    // `lookupMs` how long the server lookup took and `recordFetched` whether it
    // had to fetch a record (the pick was not in the loaded history).
    const rivalFrom = (candidates, fromServer, serverLookup, { lookupMs = 0, recordFetched = false } = {}) => {
      const rival = armPaceRival({ candidates, riderId, ...race, parSpeedKmh });
      return {
        ...rival,
        source: rival.source === 'history' && fromServer ? 'server-history' : rival.source,
        candidates: paceRivalPool({ candidates, ...race }).length,
        historyLoaded,
        serverLookup,
        lookupMs,
        recordFetched
      };
    };
    // The caller already spent the budget (a featured ride whose own rival
    // lookup ate it): pick from what the lobby has, now.
    if (!(lookupBudgetMs > 0)) return launch(() => rivalFrom(ghostCandidates, false, 'skipped'));
    // Search the full history: the server's light rows of every race of this
    // type and length, merged with what the lobby loaded. If the pick is a race
    // the lobby has not loaded, its one record is fetched so it can be replayed.
    // None of it may delay the start past the budget or fail it: an error, a
    // timeout or a record that cannot be replayed falls back to the loaded history.
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const pending = { abort };
    startPendingRef.current = pending;
    setStartPending(true);
    log.debug('cycle_game.pace_rival_lookup', { riderId, ...race, budgetMs: lookupBudgetMs });
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ outcome: 'timeout' }), lookupBudgetMs);
    });
    const resolveGaugeMaxRpm = (equipmentId) => resolveRpmLimits(bikeById.get(equipmentId) || {}).gaugeMaxRpm;
    const startedAt = Date.now();
    // How far the lookup got, readable by the timeout path too.
    const progress = { stage: 'pool', sourceRaceId: null, recordFetched: false };
    const signal = abort?.signal ?? null;
    const lookup = (async () => {
      const rows = await fetchRivalPool({ ...race, signal });
      // Timed out or unmounted while the pool was on its way: fetch nothing more.
      if (signal?.aborted) throw new Error('aborted');
      const merged = mergeRaceCandidates(ghostCandidates, rows);
      const pick = pickPaceRival({ candidates: merged, riderId, ...race });
      const isLoaded = ghostCandidates.some((c) => c && String(c.raceId) === String(pick.raceId));
      if (pick.kind === 'par' || isLoaded) return { outcome: 'used', candidates: merged };
      // The pick is a row with no series: fetch that one race so it can be replayed.
      progress.stage = 'record';
      progress.sourceRaceId = pick.raceId;
      progress.recordFetched = true;
      const record = await fetchRaceRecord(pick.raceId, { signal });
      const fetched = mapRaceRecordToCandidate(record, { getDisplayLabel, resolveGaugeMaxRpm });
      const candidates = mergeRaceCandidates(ghostCandidates.concat(fetched ? [fetched] : []), rows);
      // Usable only if the same rule, run over the record, arms that same ride.
      const armed = armPaceRival({ candidates, riderId, ...race, parSpeedKmh });
      if (String(armed.sourceRaceId) !== String(pick.raceId) || armed.participantId !== pick.participantId) {
        throw new Error('record not replayable');
      }
      return { outcome: 'used', candidates };
    })().catch((err) => ({ outcome: 'error', error: err?.message || String(err) }));
    const settle = () => {
      if (startPendingRef.current !== pending) return false; // unmounted while waiting
      startPendingRef.current = null;
      setStartPending(false);
      return true;
    };
    // Nothing else can leave the lobby while this start is pending (every other
    // start is refused and the lobby is frozen), so the answer launches as is.
    Promise.race([lookup, deadline]).then((res) => {
      clearTimeout(timer);
      if (res.outcome === 'timeout') abort?.abort();
      if (!settle()) return;
      launch(() => {
        const lookupStats = { lookupMs: Date.now() - startedAt, recordFetched: progress.recordFetched };
        if (res.outcome !== 'used') {
          log.warn('cycle_game.pace_rival_lookup_failed', {
            riderId, ...race, outcome: res.outcome, stage: progress.stage, sourceRaceId: progress.sourceRaceId,
            error: res.error ?? null, lookupMs: lookupStats.lookupMs
          });
        }
        return res.outcome === 'used'
          ? rivalFrom(res.candidates, true, 'used', lookupStats)
          : rivalFrom(ghostCandidates, false, res.outcome, lookupStats);
      }, res.outcome === 'used' ? res.candidates : ghostCandidates);
    });
    return true;
  }, [raceType, raceValueM, raceValueS, distanceDefaultM, timeDefaultS, ghost, raceMyBest, buildRiders, ghostCandidates, parSpeedKmh, bikeById, getDisplayLabel, launchRace, log]);

  // A Start still waiting on the rival lookup dies with the component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startPendingRef.current?.abort?.abort();
      startPendingRef.current = null;
    };
  }, []);

  // Keep a stable ref to the latest startRace so the sim control hook
  // (registered once) always reads current values. (phaseRef is above.)
  const startRaceRef = useRef(startRace);
  useEffect(() => { startRaceRef.current = startRace; }, [startRace]);
  // The same for Cancel (assigned where onCancel is defined, below).
  const onCancelRef = useRef(null);

  // Sim-panel seam: expose a programmatic race start so the simulation popup's
  // "Cycle Game Race" preset can launch a real race. Riders are assigned
  // separately (the sim sets equipment riders, which buildRiders reads).
  // getPhase lets the popup watch for the race to finish (reaches 'results')
  // so it can stop the RPM drivers it started.
  useEffect(() => {
    const api = {
      ready: true,
      startRace: ({ winCondition, value } = {}) => {
        // A programmatic start mid-race would replace the controller and orphan
        // the running race. startRace itself refuses unless the lobby is idle;
        // returns whether the start was accepted.
        return startRaceRef.current(buildAutoStartCourse({ winCondition, value }));
      },
      // Cancel the race in hand, exactly as the on-screen Cancel button does.
      cancel: () => { onCancelRef.current?.(); },
      getPhase: () => phaseRef.current,
      // Per-rider race readback so a driver (sim panel / tests) can close the loop:
      // see whether distance is advancing, instead of blindly holding RPM down a
      // course that may be wedged. Keyed by
      // equipmentId so the caller can map a bike → its rider's live state. Note a
      // ghost can carry the SAME equipmentId as a live rider (gauge scaling only),
      // so callers mapping bike → rider should filter out `isGhost` entries.
      getRaceState: () => {
        const st = controllerRef.current?.getState?.();
        if (!st) return null;
        const riders = st.engineState?.riders || {};
        return {
          phase: st.phase,
          riders: Object.values(riders).map((r) => ({
            userId: r.userId,
            equipmentId: r.equipmentId,
            distanceM: r.cumulativeDistanceM,
            rpm: r.rpm,
            finished: r.finishTimeS != null,
            isGhost: !!r.isGhost
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

  // Staging → countdown: advance once the buffer has elapsed (re-checked on every
  // staging second). The start is rolling, so cadence does not hold it.
  useEffect(() => {
    if (phase !== 'staging') return undefined;
    if (Date.now() >= stagingDeadlineRef.current) {
      applySnapshot(controllerRef.current?.startCountdown());
    }
    return undefined;
  }, [phase, stagingSeconds, applySnapshot]);

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
        // GREEN LIGHT. HOLD the green light while the engine is already live — the
        // race interval ticks in the 'go' phase, so RPMs count from green — and
        // switch to the race screen after GO_HOLD_MS.
        log.debug('cycle_game.sfx', { cue: 'go', attempted: playSound(soundsRef.current?.go, { volume: masterRef.current }) }); // null = silent
        log.info('cycle_game.race_started', {
          raceId: raceMetaRef.current?.raceId,
          riders: Object.keys(state.engineState?.riders || {}),
          winCondition: raceMetaRef.current?.winCondition
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

  // One tick's race beats (see the tick). A solo rider (one live rider and one
  // replayed rival) hears the gap to the rival at halfway and each minute; a
  // group race has no rival and gets the beats without a gap.
  const runBeats = useCallback((state) => {
    const meta = raceMetaRef.current;
    const engineRiders = state.engineState?.riders || {};
    const elapsedS = state.engineState?.elapsedS ?? 0;
    const away = new Set([...(state.parked || []), ...(state.noSensor || [])]);
    const liveIds = Object.keys(engineRiders).filter((id) => !engineRiders[id].isGhost);
    const ghostIds = Object.keys(engineRiders).filter((id) => engineRiders[id].isGhost);
    const presentIds = liveIds.filter((id) => !away.has(id));
    const leaderM = presentIds.length
      ? Math.max(...presentIds.map((id) => Number(engineRiders[id].cumulativeDistanceM) || 0))
      : 0;
    const { beats, state: next } = raceBeats({
      winCondition: meta?.winCondition, goalM: meta?.goalM, timeCapS: meta?.timeCapS, elapsedS, leaderM
    }, raceBeatsRef.current);
    raceBeatsRef.current = next;
    const finalNow = presentIds.length > 0 && beats.includes('FINAL_SECONDS');
    finalSecondsRef.current = finalNow;
    if (!presentIds.length || !beats.length) return;

    let delta = null;
    let rivalName;
    const rival = ghostIds.length === 1 ? engineRiders[ghostIds[0]] : null;
    if (liveIds.length === 1 && rival) {
      rivalName = plainName(rival.displayName);
      if (Array.isArray(rival.ghostRecordedSeries) && rival.ghostRecordedSeries.length) {
        delta = paceDelta({
          riderDistanceM: Number(engineRiders[liveIds[0]].cumulativeDistanceM) || 0,
          elapsedS,
          rivalSeries: rival.ghostRecordedSeries,
          intervalS: rival.ghostIntervalS
        });
      }
    }
    beats.forEach((beat) => {
      const isFinal = beat === 'FINAL_SECONDS';
      if (isFinal) {
        // Its own key: `sounds.countdown` is the stoplight cue, which a household may leave unset on purpose.
        playSound(soundsRef.current?.final_seconds, { volume: masterRef.current }); // unset = silent
        if (finalSecondsLoggedRef.current) return; // logged once, when it starts
        finalSecondsLoggedRef.current = true;
      }
      log.info('cycle_game.beat', {
        raceId: meta?.raceId ?? null, beat, elapsedS, gapS: delta?.gapS ?? null, gapM: delta?.gapM ?? null
      });
      if ((beat === 'LAST_MINUTE' || beat === 'LAST_STRETCH') && !finaleRef.current) {
        finaleRef.current = true;
        musicLiftRef.current = FINALE_MUSIC_LIFT;
        if (musicRef.current) musicRef.current.volume = musicLevel();
        log.info('cycle_game.finale_started', { raceId: meta?.raceId ?? null, beat, elapsedS });
      }
      beatToasts(beat, { delta, rivalName, rivalKind: meta?.rivalKind ?? null, elapsedS })
        .forEach((t) => showToast({ icon: null, ...t }));
    });
  }, [log, musicLevel, showToast]);

  // The finale ends with the race (results, discard): the music lift and the
  // final-seconds clock are dropped.
  useEffect(() => {
    if (phase === 'go' || phase === 'racing') return;
    finaleRef.current = false;
    finalSecondsRef.current = false;
    if (musicLiftRef.current) {
      musicLiftRef.current = 0;
      if (musicRef.current) musicRef.current.volume = musicLevel();
    }
  }, [phase, musicLevel]);

  // ── engine-live span (wall clock) ────────────────────────────────────────
  // True for the ENTIRE go+racing span — the exact window the race-tick effect
  // below runs for. Used (instead of raw `phase`) as that effect's dependency
  // so the go→racing flip does NOT tear the interval down and rebuild it (the
  // audited bug — the effect's own comment claimed "once per racing phase" but
  // `phase` was in the dep array, so React re-ran it on every phase value
  // change, including go→racing).
  const isEngineLive = phase === 'go' || phase === 'racing';
  // performance.now() at the instant the engine went live (green light) — the
  // wall-clock zero the race-tick interval below measures elapsed time against.
  const raceStartMsRef = useRef(null);
  useEffect(() => {
    if (isEngineLive) {
      raceStartMsRef.current = performance.now();
    } else {
      raceStartMsRef.current = null;
    }
    // This effect and the race-tick effect below share the isEngineLive
    // dependency and settle in the same commit; the race-tick effect only
    // reads the anchor lazily inside its own setInterval callback (which can't
    // fire before both effects have run), so ordering between them is moot.
  }, [isEngineLive]);

  // ── race interval ────────────────────────────────────────────────────────
  // Runs while racing AND during the brief green-light 'go' hold, so RPMs count from
  // the moment the light turns green — before the race screen appears. Anchored to
  // WALL-CLOCK time (raceStartMsRef), not to setInterval fire count: each fire
  // computes how many ticks are actually DUE against elapsed real time and runs
  // the (single, shared) per-tick body that many times — so a "5:00" race takes
  // 5 real minutes even under kiosk jank that delays/coalesces timer fires,
  // instead of drifting by counting fires 1:1. Gated on isEngineLive so the
  // effect is set up ONCE for the whole go→racing span (see above).
  useEffect(() => {
    if (!isEngineLive) return undefined;
    let tickedCount = 0; // wall-clock ticks already applied since raceStartMsRef anchor

    // The per-tick body — resolves inputs, advances the engine, and diffs
    // telemetry edges. Invoked once per DUE tick (possibly several times per
    // interval fire during catch-up); returns true when the race is over (no
    // more ticks should run this fire).
    const runTick = () => {
      const controller = controllerRef.current;
      if (!controller) return true;
      const liveSession = sessionRef.current;
      const liveGetUserVitals = getUserVitalsRef.current;
      const before = controller.getState();
      const inputs = {};
      const cadenceConnected = {}; // userId → bool, for the firehose + drop detection
      const sensorLostNow = new Set(); // userIds whose gap has crossed SENSOR_LOST_GAP_TICKS this tick
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
        // A connected reading (even 0) is the truth: use it + remember it, and
        // reset the consecutive-gap counter. While the sensor is DROPPED, hold
        // the last good reading through the broadcast gap instead of flatlining
        // — unless the rider was trending down into the gap, in which case a
        // real cooldown-to-stop is honored — but ONLY for a bounded number of
        // ticks: rpmDuringGap caps the hold (decay, then 0) so a sensor that
        // never comes back can't ride forever at a frozen RPM and can still
        // be parked by the idle clock (audit game-design #6). gapTicks is tracked only for riders
        // with real equipment — a rider with none never had a "connected"
        // reading to begin with, so it isn't a sensor loss.
        let rawRpm;
        let gapTicks = 0;
        if (connected) {
          rawRpm = Number.isFinite(cadence.rpm) ? cadence.rpm : 0;
          const hist = rpmHistoryRef.current.get(userId) || [];
          hist.push(rawRpm);
          if (hist.length > 4) hist.shift();
          rpmHistoryRef.current.set(userId, hist);
          gapTicksRef.current.set(userId, 0);
        } else {
          if (rider.equipmentId) {
            gapTicks = (gapTicksRef.current.get(userId) || 0) + 1;
            gapTicksRef.current.set(userId, gapTicks);
          }
          rawRpm = rpmDuringGap(rpmHistoryRef.current.get(userId) || [], gapTicks || 1);
        }
        // A rider who has NEVER had a single connected reading since the race
        // started hasn't lost a sensor — they simply haven't started pedaling
        // yet (mounting the bike, clipping in), which raceStartGraceS already
        // covers gracefully at the park layer. The SENSOR chip must only fire
        // for a genuine mid-race disconnect: was connected, then dropped.
        // Otherwise every race opened with an alarming false "SENSOR" warning
        // for the first ~9s, before the rider's first pedal stroke landed.
        const everConnected = (rpmHistoryRef.current.get(userId) || []).length > 0;
        // Two windows, because these are two different situations. A rider who
        // HAS been connected and drops is a mid-race loss and is flagged
        // quickly. A rider who has never connected may simply be mounting, so
        // they get longer — but not forever. Never flagging them is what let a
        // forfeit arrive with no explanation attached.
        const gapLimit = everConnected ? SENSOR_LOST_GAP_TICKS : SENSOR_ABSENT_GAP_TICKS;
        if (rider.equipmentId && gapTicks >= gapLimit) sensorLostNow.add(userId);
        inputs[userId] = {
          rpm: clampCountedRpm(rawRpm, abuseMaxRpm),
          zoneId: vitals?.zoneId || null,
          heartRate: Number.isFinite(vitals?.heartRate) ? vitals.heartRate : null,
          // So the controller can tell a still bike from a silent one. A rider
          // with equipment but no reading yet reports false; a rider with no
          // equipment at all reports true, because there is no sensor to blame
          // and the idle clock is the honest reading for them.
          connected: rider.equipmentId ? (connected || everConnected) : true
        };
      });
      const state = controller.tick(inputs);
      noteBikeActivity();

      // ── Drama events (audit C2) — LEAD_CHANGE / RIDER_FINISHED / PHOTO_FINISH /
      // FINAL_LAP / LAPPING_IMMINENT, edge-triggered against the previous tick's
      // snapshot. Runs every tick (not gated on phase==='racing' vs 'finished')
      // so the race-ending tick's own finisher still gets its ceremony toast.
      // Away riders (parked or no sensor at this tick) are never announced as
      // taking the lead, even when they are ahead on distance.
      const raceSnapshot = deriveRaceSnapshot(
        state.engineState,
        {
          lapLengthM: raceMetaRef.current?.lapLengthM || 0,
          awayIds: [...(state.parked || []), ...(state.noSensor || [])]
        },
        prevRaceSnapshotRef.current
      );
      raceSnapshot.events.forEach((evt) => recordDramaEvent(evt, raceSnapshot, state.engineState?.riders || {}));
      prevRaceSnapshotRef.current = raceSnapshot;

      // ── Race beats — halfway, a split each minute, the last minute / last
      // stretch, the final ten seconds. The leader is the furthest live rider
      // who is not away; with every live rider away the beats still advance
      // (so none fires late on their return) but nothing is shown or played.
      // The race-ending tick has none: the results board replaces the screen.
      if (state.phase !== 'finished') runBeats(state);

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

      // ── Sensor-lost transitions (info) — edge-only (mirrors cadence_change
      // above): fires once when a rider's gap crosses SENSOR_LOST_GAP_TICKS
      // (the hold has fully decayed to 0 — presumed genuinely disconnected,
      // not a broadcast blip), and once more when the sensor comes back.
      sensorLostNow.forEach((userId) => {
        if (!prevSensorLostRef.current.has(userId)) {
          log.info('cycle_game.sensor_lost', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            equipmentId: before.engineState.riders[userId]?.equipmentId ?? null,
            elapsedS: state.engineState?.elapsedS ?? null
          });
        }
      });
      prevSensorLostRef.current.forEach((userId) => {
        if (!sensorLostNow.has(userId)) {
          log.info('cycle_game.sensor_recovered', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            equipmentId: before.engineState.riders[userId]?.equipmentId ?? null,
            elapsedS: state.engineState?.elapsedS ?? null
          });
        }
      });
      prevSensorLostRef.current = sensorLostNow;

      // Parked / resumed — diff the controller's parked set. Nobody is
      // eliminated: a rider idle past the park window is parked (one calm
      // toast) and rejoins on their next pedal stroke (logged, no toast).
      const tickElapsedS = state.engineState?.elapsedS ?? null;
      const distanceOf = (userId) => {
        const d = state.engineState?.riders?.[userId]?.cumulativeDistanceM;
        return Number.isFinite(d) ? Math.round(d) : 0;
      };
      const parkedSet = new Set(state.parked || []);
      parkedSet.forEach((userId) => {
        if (prevParkedRef.current.has(userId)) return;
        prevParkedRef.current.set(userId, tickElapsedS);
        log.info('cycle_game.rider_parked', {
          raceId: raceMetaRef.current?.raceId,
          userId,
          elapsedS: tickElapsedS,
          distanceM: distanceOf(userId)
        });
        recordRiderToast('parked', userId, state);
      });
      [...prevParkedRef.current.keys()].forEach((userId) => {
        if (parkedSet.has(userId)) return;
        const parkedAtS = prevParkedRef.current.get(userId);
        prevParkedRef.current.delete(userId);
        // Back before their park notice reached the screen: it no longer holds.
        dropQueuedToasts((t) => t.variant === 'parked' && t.userId === userId);
        log.info('cycle_game.rider_resumed', {
          raceId: raceMetaRef.current?.raceId,
          userId,
          elapsedS: tickElapsedS,
          distanceM: distanceOf(userId),
          awayS: Number.isFinite(parkedAtS) && Number.isFinite(tickElapsedS) ? tickElapsedS - parkedAtS : null
        });
      });

      // A rider whose sensor never reported. Logged under its own name so the
      // store can answer "was this a kid not pedalling, or a dead sensor?" —
      // a question that previously took cross-referencing race telemetry
      // against raw bridge output by hand.
      const noSensorSet = new Set(state.noSensor || []);
      noSensorSet.forEach((userId) => {
        if (!prevNoSensorRef.current.has(userId)) {
          log.warn('cycle_game.rider_no_sensor', {
            raceId: raceMetaRef.current?.raceId,
            userId,
            equipmentId: before.engineState.riders[userId]?.equipmentId ?? null,
            elapsedS: state.engineState?.elapsedS ?? null
          });
          recordRiderToast('nosensor', userId, state);
        }
      });
      // Their sensor woke and they are moving: back in the race.
      prevNoSensorRef.current.forEach((userId) => {
        if (noSensorSet.has(userId)) return;
        log.info('cycle_game.rider_sensor_recovered', {
          raceId: raceMetaRef.current?.raceId,
          userId,
          equipmentId: before.engineState.riders[userId]?.equipmentId ?? null,
          elapsedS: tickElapsedS,
          distanceM: distanceOf(userId)
        });
      });
      prevNoSensorRef.current = noSensorSet;

      // Overtime detection — diff the controller overtime set (mercy-kill window
      // closing / forced finish). Log each rider's edge individually (mirrors the
      // parked edge log above) but raise ONE summary toast for the whole batch —
      // several stragglers can land in `overtime` on the same tick.
      const overtimeSet = new Set(state.overtime || []);
      const newOvertime = [...overtimeSet].filter((userId) => !prevOvertimeRef.current.has(userId));
      newOvertime.forEach((userId) => {
        log.info('cycle_game.rider_overtime', {
          raceId: raceMetaRef.current?.raceId,
          userId,
          elapsedS: state.engineState?.elapsedS ?? null
        });
      });
      if (newOvertime.length > 0) recordOvertimeEvent(newOvertime);
      prevOvertimeRef.current = overtimeSet;

      // Boost: a live rider's heart-rate zone changed. Logged both ways
      // (debug); a change that raises the multiplier gets one toast. The
      // first reading of the race only seeds the map. A finisher in a
      // distance race is parked at the line with no zone and is left out.
      Object.entries(state.engineState?.riders || {}).forEach(([userId, r]) => {
        if (r.isGhost || r.finishTimeS != null) return;
        const zoneId = r.zoneId ?? null;
        const mult = zoneMultiplierFor(zoneId, zonesRef.current, hrlessMultiplierRef.current);
        const prev = prevBoostRef.current.get(userId);
        prevBoostRef.current.set(userId, { zoneId, mult });
        if (!prev || prev.zoneId === zoneId) return;
        log.debug('cycle_game.boost_change', {
          raceId: raceMetaRef.current?.raceId,
          userId,
          from: prev.zoneId,
          to: zoneId,
          mult,
          elapsedS: tickElapsedS
        });
        if (mult > prev.mult) recordBoostToast(r.displayName || userId, zoneId);
      });

      const elapsedS = state.engineState?.elapsedS ?? null;

      // ── Per-tick firehose (debug) — one event per second, riders as an array,
      // read from post-resolution engine state (correct for ghosts/finish).
      // Off by default in console; captured to the per-session JSONL for forensics.
      tickCountRef.current += 1;

      // ── mid-race crash checkpoint (audit C1) — every 5th tick, snapshot the
      // ALREADY-IN-HAND post-resolution state (no extra getState() call) so a
      // reload/crash can be finalized into a saved record on next mount instead
      // of losing the race outright. writeCheckpoint swallows storage errors.
      if (tickCountRef.current % 5 === 0) {
        writeCheckpoint(window.sessionStorage, {
          raceMeta: raceMetaRef.current,
          engineState: state.engineState,
          raceState: checkpointRaceState(state),
          savedAt: Date.now()
        });
      }

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
            parked: parkedSet.has(userId) || noSensorSet.has(userId),
            finished: r.finishTimeS != null
          };
        })
      });

      // Info-level, rate-limited telemetry: prod runs at info, so the debug
      // firehose above never persists. This ~5s-resolution snapshot (plus the
      // full per-second series in the saved record) is what corroborates
      // "my distance/timing was wrong" reports from the session JSONL.
      // wallDriftMs = engine clock vs wall clock — nonzero drift beyond one
      // tick means the catch-up loop is behind (pair with tick_catchup warns).
      log.sampled?.('cycle_game.race_telemetry', {
        raceId: raceMetaRef.current?.raceId,
        tick: tickCountRef.current,
        elapsedS,
        wallDriftMs: raceStartMsRef.current != null
          ? Math.round((performance.now() - raceStartMsRef.current) - elapsedS * 1000)
          : null,
        riders: Object.keys(tickRiders).map((userId) => {
          const r = tickRiders[userId];
          return {
            u: userId,
            rpm: Math.round(Number.isFinite(r.rpm) ? r.rpm : 0),
            m: Math.round(Number.isFinite(r.cumulativeDistanceM) ? r.cumulativeDistanceM : 0),
            gap: gapTicksRef.current.get(userId) || 0
          };
        })
      }, { maxPerMinute: 12, aggregate: true });

      if (state.phase === 'finished') {
        const finalState = controller.showResults();
        // The race is over: checkpoint its FINAL state, marked finished. If the
        // save below never lands, recovery saves this as the complete race it
        // was instead of an older mid-race snapshot.
        writeCheckpoint(window.sessionStorage, {
          raceMeta: raceMetaRef.current,
          engineState: finalState.engineState,
          raceState: checkpointRaceState(finalState),
          savedAt: Date.now()
        });
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
        return true;
      }
      // During the green-light hold, advance the engine but keep showing the green
      // stoplight (don't flip render to 'racing' yet — the go-hold timer does that).
      // Read the render phase from the ref (not the `phase` closed over at effect
      // creation) — this effect is now long-lived across the go→racing edge, so
      // the closed-over `phase` would go stale the moment 'go' flips to 'racing'.
      if (phaseRef.current === 'go') setSnapshot(state); else applySnapshot(state);
      return false;
    };

    const id = setInterval(() => {
      const anchorMs = raceStartMsRef.current;
      const nowMs = performance.now();
      // Defensive fallback (anchor missing): advance exactly one tick rather than
      // stalling forever. Should not happen — the anchor effect above always
      // settles in the same commit as isEngineLive flipping true.
      const { due: dueTicks, run: cappedTicks } = dueAnchoredSteps({
        sinceAnchor: anchorMs == null ? null : nowMs - anchorMs,
        stepsTaken: tickedCount,
        step: RACE_TICK_MS,
        maxSteps: 30, // bound a resumed-from-freeze burst
      });
      if (dueTicks > 1) {
        log.warn('cycle_game.tick_catchup', {
          raceId: raceMetaRef.current?.raceId,
          dueTicks,
          ranTicks: cappedTicks
        });
      }
      for (let i = 0; i < cappedTicks; i += 1) {
        tickedCount += 1;
        if (runTick()) break; // race finished mid-catch-up — stop for this fire
      }
    }, RACE_TICK_MS);
    return () => clearInterval(id);
    // Live data is read from refs (sessionRef/getUserVitalsRef/phaseRef) so the
    // interval is set up ONCE for the whole go→racing span and never starved by
    // context churn or torn down by the go→racing phase edge.
  }, [isEngineLive, applySnapshot, recordRiderToast, recordOvertimeEvent, log, recordDramaEvent, dropQueuedToasts, runBeats, noteBikeActivity]);

  // ── pagehide best-effort save (audit C1) ─────────────────────────────────
  // A reload/crash may not give the periodic checkpoint a chance to run again
  // before the tab is gone. On pagehide (fires on reload/close/nav-away —
  // unlike beforeunload, not blocked by kiosk browsers) fire a best-effort
  // sendBeacon with the CURRENT engine state directly to the save endpoint.
  // The checkpoint is left in place regardless (belt over the beacon's braces
  // — double-submit is safe, the datastore overwrites by the same raceId).
  useEffect(() => {
    if (!isEngineLive) return undefined;
    const onPageHide = () => {
      if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
      const controller = controllerRef.current;
      const meta = raceMetaRef.current;
      const controllerState = controller?.getState?.();
      const engineState = controllerState?.engineState;
      if (!controller || !meta || !engineState) return;
      // Same zero-distance rule as the save effect and recovery path — never
      // beacon a junk "0 m" record from a pagehide during the go hold.
      const totalDistanceM = Object.values(engineState.riders || {})
        .reduce((sum, r) => sum + (Number(r?.cumulativeDistanceM) || 0), 0);
      if (totalDistanceM <= 0) return;
      try {
        // This listener only exists while the engine is live, so the ride is
        // being cut off mid-race: saved as ended early, whatever the controller
        // says, with whoever is stopped right now.
        const record = buildRaceRecord(engineState, { ...meta, ...raceOutcomeMeta(controllerState, { interrupted: true }) });
        const blob = new Blob([JSON.stringify({ record })], { type: 'application/json' });
        navigator.sendBeacon('/api/v1/fitness/cycle-races', blob);
      } catch {
        // best-effort only — pagehide is not a place to throw or retry.
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [isEngineLive]);

  // ── save the record once on results ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'results') return;
    if (savedRef.current) return;
    savedRef.current = true;
    const controller = controllerRef.current;
    const meta = raceMetaRef.current;
    const controllerState = controller?.getState();
    const engineState = controllerState?.engineState;
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
    // Outcome flags from the controller: who was stopped at the close (every
    // save), and whether the race was ended from the race menu.
    const record = buildRaceRecord(engineState, { ...meta, ...raceOutcomeMeta(controllerState) });
    const incomplete = record.race.incomplete === true;
    (async () => {
      try {
        // Retry transient failures (flaky kiosk WiFi) with backoff; a dropped
        // POST must not silently lose the race. Exhaustion → results badge.
        const result = await saveRaceRecord({
          record,
          onAttempt: ({ attempt, error }) => log.warn('cycle_game.race_save_retry', { raceId: meta.raceId, attempt, error })
        });
        const ok = result.ok;
        log.info('cycle_game.race_saved', {
          raceId: meta.raceId, ok, attempt: result.attempt,
          ...(ok ? {} : { error: result.error })
        });
        if (ok) clearCheckpoint(window.sessionStorage); // race safely landed — the checkpoint is now redundant
        if (ok) announceGameAchievement('cycle-race', { raceId: meta.raceId }); // the gem ceremony looks now
        else setSaveFailed(true);
        // The race just saved may have shuffled this week's featured-course
        // ladder — refetch and diff against the pre-race snapshot to surface
        // "2nd this week — 0:04 behind Dad"-style callouts on the results board.
        // An ended-early ride counts for nothing, so there is no ladder movement
        // to congratulate: say plainly what happened to it instead.
        if (ok && incomplete) setLadderNotes([ENDED_EARLY_NOTE]);
        if (ok && !incomplete && meta.courseId && meta.courseId === ladderBeforeRef.current?.course?.id) {
          try {
            const after = await fetchLadder();
            if (after?.course?.id === meta.courseId) {
              const course = after.course;
              const fmtVal = course.win_condition === 'distance' ? fmtClock : formatDistance;
              const before = ladderBeforeRef.current?.standings || [];
              const liveIds = Object.keys(engineState.riders || {}).filter((id) => !id.startsWith('ghost:'));
              const notes = liveIds
                .map((userId) => ({ userId, d: ladderDelta({ before, after: after.standings || [], userId }) }))
                .filter(({ d }) => d)
                .slice(0, 3)
                .map(({ userId, d }) => {
                  const name = resolveDisplayName(userId);
                  if (d.isLead) return `${name}: Ladder lead this week!`;
                  const ord = ['', '1st', '2nd', '3rd'][d.rank] || `${d.rank}th`;
                  return `${name}: ${ord} this week — ${fmtVal(d.gapToAbove)} behind ${resolveDisplayName(d.aboveUserId)}`;
                });
              setLadderNotes(notes);
              setFeaturedLadder(after);
              log.info('cycle_game.ladder_movement', { raceId: meta.raceId, notes: notes.length });
            } else {
              // The course rotated or the ladder is gone: the board must not
              // offer a Rematch of a course that can no longer be ridden.
              setFeaturedLadder(after);
            }
          } catch (err) {
            log.warn('cycle_game.ladder_movement_error', { error: err?.message || String(err) });
          }
        }
      } catch (err) {
        // saveRaceRecord never throws — this net catches unexpected errors only.
        log.error('cycle_game.race_saved', { raceId: meta.raceId, ok: false, error: err?.message || String(err) });
        setSaveFailed(true);
      }
    })();
    // fetchLadder/resolveDisplayName are stable useCallbacks (see their own dep
    // arrays); adding them here is a no-op in practice because savedRef latches
    // this effect to run once per race, but keeps exhaustive-deps honest.
  }, [phase, log, fetchLadder, resolveDisplayName]);

  // ── mid-race crash recovery (audit C1) ───────────────────────────────────
  // A kiosk reload/crash mid-race previously discarded the whole race — the
  // race-tick effect below checkpoints progress to sessionStorage every 5th
  // tick; this runs ONCE on mount (guarded by recoveryCheckedRef, not a plain
  // `phase === 'idle'` dependency, since the container returns to idle many
  // times in a session — after results, after cancel) and finalizes any
  // fresh checkpoint left behind by a race that never reached 'results'.
  // Live resume of the running engine is explicitly out of scope — this only
  // salvages the record. A successful save also raises `recoveredNotice`, a
  // small self-dismissing lobby banner (CycleGameHome) — recovery used to be
  // surfaced via the structured log only, invisible to the person who just
  // watched the kiosk reload mid-race.
  useEffect(() => {
    if (phase !== 'idle') return;
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    const store = window.sessionStorage;
    const checkpoint = readFreshCheckpoint(store, Date.now());
    if (!checkpoint) {
      // Covers both "nothing there" and "stale/corrupt" — clear defensively
      // either way (removeItem on an absent key is a no-op).
      clearCheckpoint(store);
      log.debug('cycle_game.checkpoint_discarded', {});
      return;
    }
    const { raceMeta, engineState } = checkpoint;
    const totalDistanceM = Object.values(engineState.riders || {})
      .reduce((sum, r) => sum + (Number(r?.cumulativeDistanceM) || 0), 0);
    if (totalDistanceM <= 0) {
      clearCheckpoint(store);
      log.info('cycle_game.race_recovered', { raceId: raceMeta.raceId, ok: false, skipped: 'zero_distance' });
      return;
    }
    // A recovered race is an interrupted ride and is saved as ended early —
    // unless the checkpoint says it had finished on its own and only the save
    // was lost (see checkpointOutcome).
    const record = buildRaceRecord(engineState, { ...raceMeta, ...checkpointOutcome(checkpoint) });
    (async () => {
      try {
        const result = await saveRaceRecord({ record });
        log.info('cycle_game.race_recovered', {
          raceId: raceMeta.raceId,
          ok: result.ok,
          incomplete: record.race.incomplete === true,
          ...(result.ok ? {} : { error: result.error })
        });
        if (result.ok) {
          setRecoveredNotice('Recovered your interrupted race — saved to history');
          clearCheckpoint(store);
        }
        // NOT ok → keep the checkpoint: a reload racing a still-booting backend
        // (e.g. right after a redeploy) must not destroy the race — the next
        // mount retries the recovery. Stale/corrupt/zero-distance paths above
        // clear their own checkpoints.
      } catch (err) {
        // saveRaceRecord never throws — this net catches unexpected errors only.
        log.error('cycle_game.race_recovered', { raceId: raceMeta.raceId, ok: false, error: err?.message || String(err) });
      }
    })();
    // Runs exactly once (recoveryCheckedRef); `phase` is the trigger only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Belt-and-suspenders expiry for the recovered-race banner: CycleGameHome
  // self-dismisses its own DOM after 8s regardless, but the container's own
  // state should also let go so a remount (e.g. leaving/returning to idle)
  // doesn't resurrect a stale notice.
  useEffect(() => {
    if (!recoveredNotice) return undefined;
    const id = setTimeout(() => setRecoveredNotice(null), 8000);
    return () => clearTimeout(id);
  }, [recoveredNotice]);

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
    if (musicRef.current) musicRef.current.volume = musicLevel(effectiveMaster);
  }, [effectiveMaster, musicVolume, musicLevel]);

  // Silence everything (and cancel any pending staging) when the game unmounts.
  useEffect(() => () => {
    stopMusic();
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

  // Ride It on the featured-course card: ALWAYS arm the weekly-course ghost —
  // the week's leader; the best run by anyone not riding when the leader is on a
  // bike; the leader's own record when everyone on the ladder is riding (see
  // pickRival). Only the rival's own line replays. "Race my best" does not gate
  // it (owner 2026-11-11: two riders on Sprint 1500 raced only each other); the
  // switch governs only the automatic pace rival a lone rider may get on top
  // when this lookup fails. The lobby is frozen from the press, exactly as for
  // Start, and the rival's fetch shares the one lookup budget. The ghost is
  // passed explicitly to startRace (never through `ghost` state) so a
  // previously-selected lobby ghost can't leak into a ladder ride.
  const onRideFeatured = useCallback(async () => {
    const ladder = featuredLadder;
    const course = ladder?.course;
    if (!course) return;
    // One start at a time: a repeat tap, or a tap in the same tick as a Start.
    const busyReason = phaseRef.current !== 'idle' ? 'not_idle' : (startPendingRef.current ? 'start_pending' : null);
    if (busyReason) {
      log.info('cycle_game.start_ignored', { reason: busyReason, control: 'featured' });
      return;
    }
    const riderIds = bikes.map((b) => session?.getEquipmentRider?.(b.id)).filter(Boolean);
    const firstRider = riderIds[0] || null;
    const rival = pickRival({ standings: ladder.standings || [], riderIds });
    const rideLog = (extra) => log.info('cycle_game.ride_featured', {
      courseId: course.id, rider: firstRider, riders: riderIds, rivalKind: rival.kind,
      rivalUserId: rival.rivalUserId, rivalRaceId: rival.raceId, raceMyBest, ...extra
    });
    if (!rival.raceId) {
      // No runs this week: the riders race the course alone.
      const accepted = startRace(courseStartOverride(course), null, { control: 'featured' });
      if (!accepted) return;
      ladderBeforeRef.current = ladder;
      rideLog({ ghostArmed: false });
      return;
    }
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const signal = abort?.signal ?? null;
    const pending = { abort };
    startPendingRef.current = pending;
    setStartPending(true);
    const pressedAt = Date.now();
    const progress = { stage: 'record' };
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ reason: 'timeout' }), PACE_RIVAL_LOOKUP_MS);
    });
    const lookup = (async () => {
      const race = await fetchRaceRecord(rival.raceId, { signal });
      const resolveGaugeMaxRpm = (equipmentId) => resolveRpmLimits(bikeById.get(equipmentId) || {}).gaugeMaxRpm;
      const candidate = onlyParticipant(mapRaceRecordToCandidate(race, { getDisplayLabel, resolveGaugeMaxRpm }), rival.rivalUserId);
      const built = candidate ? buildGhostFromCandidate(candidate) : null;
      if (!built) throw new Error('record not replayable');
      return { ghost: built.ghost };
    })().catch((err) => ({ reason: 'error', error: err?.message || String(err) }));
    const res = await Promise.race([lookup, deadline]);
    clearTimeout(timer);
    if (res.reason === 'timeout') abort?.abort();
    if (startPendingRef.current !== pending) return; // the game was closed while waiting
    const lookupMs = Date.now() - pressedAt;
    if (res.reason) {
      log.warn('cycle_game.featured_rival_lookup_failed', {
        courseId: course.id, stage: progress.stage, reason: res.reason, error: res.error ?? null, lookupMs
      });
    }
    const ghostOverride = res.ghost || null;
    // Hand the freeze to startRace: it takes a pending slot of its own if it has
    // to look up an automatic rival, and the lobby unfreezes here if it does not.
    startPendingRef.current = null;
    const accepted = startRace(courseStartOverride(course), ghostOverride, {
      control: 'featured',
      // One lookup budget per start: time spent on the ladder rival comes out of
      // what the automatic rival's lookup may use, and a failed one leaves none.
      lookupBudgetMs: res.reason ? 0 : Math.max(0, PACE_RIVAL_LOOKUP_MS - lookupMs)
    });
    if (!startPendingRef.current) setStartPending(false);
    // Lobby state is written only for a start that was accepted, so a dropped
    // one cannot leave the lobby locked to a ghost that is not racing.
    if (!accepted) return;
    if (ghostOverride) setGhost(ghostOverride);
    ladderBeforeRef.current = ladder;
    rideLog({ ghostArmed: !!ghostOverride });
  }, [featuredLadder, raceMyBest, bikes, session, bikeById, getDisplayLabel, startRace, log]);

  const onToggleRaceMyBest = useCallback(() => {
    setRaceMyBest((on) => !on);
    log.info('cycle_game.race_my_best_set', { on: !raceMyBest, control: 'lobby.race-my-best' });
  }, [raceMyBest, log]);

  const onSetRaceValue = useCallback((value) => {
    if (ghost) return; // ghost locks the value
    if (!Number.isFinite(value)) return;
    // Read raceType from the closure — updaters must stay pure (StrictMode
    // double-invokes them; logging/setState inside one is the classic footgun).
    log.info('cycle_game.race_value_set', { type: raceType, value, control: 'lobby.value-step' });
    if (raceType === 'time') setRaceValueS(value);
    else setRaceValueM(value);
  }, [ghost, raceType, log]);

  const onAssign = useCallback((bikeId, userId) => {
    log.info('cycle_game.rider_assigned', { equipmentId: bikeId, userId, control: 'lobby.rider-picker' });
    session?.setEquipmentRider?.(bikeId, userId);
    bikeActivityRef.current.set(bikeId, { userId, lastActiveMs: Date.now() });
    setAssignVersion((v) => v + 1);
  }, [session, log]);

  const unassignBike = useCallback((bikeId, control) => {
    log.info('cycle_game.rider_unassigned', { equipmentId: bikeId, control });
    session?.setEquipmentRider?.(bikeId, null);
    bikeActivityRef.current.delete(bikeId);
    setAssignVersion((v) => v + 1);
  }, [session, log]);
  const onUnassign = useCallback((bikeId) => unassignBike(bikeId, 'lobby.rider-picker.clear'), [unassignBike]);

  // Stale claims: on reaching the lobby (mount, or back from a race) and once
  // a minute while it is up, unclaim every bike nobody has pedalled for
  // STALE_CLAIM_MS. Never while a start is pending or anywhere but the lobby.
  useEffect(() => {
    if (phase !== 'idle') return undefined;
    const sweep = () => {
      if (phaseRef.current !== 'idle' || startPendingRef.current) return;
      const nowMs = Date.now();
      noteBikeActivity(nowMs);
      const rows = bikes.map((b) => ({
        id: b.id,
        rider: session?.getEquipmentRider?.(b.id) || null,
        lastActiveMs: bikeActivityRef.current.get(b.id)?.lastActiveMs ?? null
      }));
      staleClaims(rows, nowMs, STALE_CLAIM_MS).forEach((equipmentId) => {
        const row = rows.find((r) => r.id === equipmentId);
        log.info('cycle_game.rider_auto_cleared', { equipmentId, userId: row.rider, idleMs: nowMs - row.lastActiveMs });
        unassignBike(equipmentId, 'lobby.auto-clear');
      });
    };
    sweep();
    const id = setInterval(sweep, STALE_CLAIM_CHECK_MS);
    return () => clearInterval(id);
  }, [phase, bikes, session, noteBikeActivity, unassignBike, log]);

  const onSetMasterVolume = useCallback((v) => {
    log.info('cycle_game.volume_set', { volume: v, control: 'lobby.volume' });
    masterVol.setVolume?.(v);
  }, [masterVol, log]);

  // "End race here" (race menu): close the race where it stands and roll to
  // results so it saves — as an incomplete ride (the controller marks it
  // endedEarly), unlike discard, which saves nothing.
  const onFinishRace = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    log.info('cycle_game.ended_early', {
      raceId: raceMetaRef.current?.raceId,
      elapsedS: controller.getState()?.engineState?.elapsedS ?? null,
      control: 'race-menu.end'
    });
    controller.finishNow();
    const finalState = controller.showResults();
    // Checkpoint the ended race until its save lands (the save clears it).
    writeCheckpoint(window.sessionStorage, {
      raceMeta: raceMetaRef.current,
      engineState: finalState.engineState,
      raceState: checkpointRaceState(finalState),
      savedAt: Date.now()
    });
    applySnapshot(finalState);
  }, [applySnapshot, log]);

  const onCancel = useCallback(() => {
    const controller = controllerRef.current;
    const raceId = raceMetaRef.current?.raceId || null;
    if (goHoldTimerRef.current) { clearTimeout(goHoldTimerRef.current); goHoldTimerRef.current = null; }
    if (controller) controller.cancel();
    log.info('cycle_game.cancelled', { raceId, fromPhase: phase, control: 'race-menu.discard' });
    clearCheckpoint(window.sessionStorage); // an intentionally-cancelled race is not "crashed" — nothing to recover
    returnToLobby();
  }, [log, phase, returnToLobby]);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  const backToHome = useCallback(() => {
    log.info('cycle_game.back_to_home', { from: 'results' });
    returnToLobby();
  }, [log, returnToLobby]);

  // Results auto-exit: hold the board for resultsDwellS, ticking a countdown, then
  // return to the lobby. The board's Exit still leaves immediately, and the
  // first touch on the board (onResultsHold) stops the countdown for good.
  const resultsTimerRef = useRef(null);
  const resultsHeldRef = useRef(false);
  const resultsLeftRef = useRef(null);
  useEffect(() => {
    if (phase !== 'results') {
      resultsHeldRef.current = false;
      setResultsSecondsLeft(null);
      return undefined;
    }
    if (resultsHeldRef.current) return undefined;
    let left = resultsDwellS;
    resultsLeftRef.current = left;
    setResultsSecondsLeft(left);
    const id = setInterval(() => {
      left -= 1;
      resultsLeftRef.current = left;
      setResultsSecondsLeft(left);
      if (left <= 0) { clearInterval(id); backToHome(); }
    }, 1000);
    resultsTimerRef.current = id;
    return () => { clearInterval(id); resultsTimerRef.current = null; };
  }, [phase, resultsDwellS, backToHome]);

  const onResultsHold = useCallback(() => {
    if (resultsHeldRef.current) return;
    resultsHeldRef.current = true;
    if (resultsTimerRef.current) { clearInterval(resultsTimerRef.current); resultsTimerRef.current = null; }
    setResultsSecondsLeft(null);
    log.info('cycle_game.results_held', {
      raceId: raceMetaRef.current?.raceId ?? null, secondsLeft: resultsLeftRef.current
    });
  }, [log]);

  // Rematch: back to the lobby, then (on the idle render, so phaseRef, the
  // lobby effects and the start guards all see the lobby) the same race again.
  const [rematchRequest, setRematchRequest] = useState(null);
  const onRematch = useCallback(() => {
    const meta = raceMetaRef.current;
    const plan = meta?.rematch;
    if (!plan) return;
    // A featured course rides as it stands now on the ladder.
    const featuredCourse = plan.ov?.id && featuredLadder?.course?.id === plan.ov.id ? featuredLadder.course : null;
    const ov = featuredCourse
      ? courseStartOverride(featuredCourse)
      : { win_condition: plan.winCondition, goal_m: plan.goalM, time_cap_s: plan.timeCapS };
    log.info('cycle_game.rematch', {
      fromRaceId: meta.raceId, winCondition: plan.winCondition, goalM: plan.goalM ?? null,
      timeCapS: plan.timeCapS ?? null, hasGhost: !!plan.chosenGhost
    });
    if (featuredCourse) ladderBeforeRef.current = featuredLadder;
    setRematchRequest({ ov, ghost: plan.chosenGhost });
    returnToLobby();
  }, [featuredLadder, log, returnToLobby]);
  useEffect(() => {
    if (phase !== 'idle' || !rematchRequest) return;
    setRematchRequest(null);
    startRaceRef.current(rematchRequest.ov, rematchRequest.ghost, { control: 'results.rematch' });
  }, [phase, rematchRequest]);

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
          ghostRoster={ghostRosterRiders}
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
          recoveredNotice={recoveredNotice}
          busy={startPending}
          raceMyBest={raceMyBest}
          onToggleRaceMyBest={onToggleRaceMyBest}
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
          <div className="cycle-game-staging__bar" data-testid="staging-bar">
            <span style={{ animationDuration: `${stagingBufferMs}ms` }} />
          </div>
          <RiderReadyStrip riders={stagingRiders} />
          <div className="cycle-game-staging__hint">Pedal when you see green.</div>
        </div>
        <RaceMenu canEnd={false} onDiscard={onCancel} />
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
        {phase === 'countdown' && <RaceMenu canEnd={false} onDiscard={onCancel} />}
      </div>
    );
  }

  if (phase === 'racing') {
    const engineState = snapshot?.engineState || {};
    const riders = engineState.riders || {};
    const winConditionNow = engineState.winCondition || raceMetaRef.current?.winCondition || 'distance';
    const placementByUser = {};
    (engineState.standings || []).forEach((s) => { placementByUser[s.userId] = s.placement; });
    // Away from the pedals: parked (idle past the park window) or no sensor (the
    // bike never reported). Both dim, leave the framing and come back on movement.
    const parkedNow = new Set(snapshot?.parked || []);
    const noSensorNow = new Set(snapshot?.noSensor || []);
    // Overtime = the mercy-kill/forced-finish window closed around a rider who
    // was still riding (T3). The standings tower needs it live to dim/tag that
    // row, same as RaceResults does after the race.
    const overtimeNow = new Set(snapshot?.overtime || []);
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
        : resolveWheelCircumferenceM(bikeById.get(rider.equipmentId));
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
        // The boost meter under the gauge (zone, multiplier, progress to the
        // next zone). A ghost replays its zone, with no progress.
        boost: boostState({
          zoneId, zones, hrlessMultiplier,
          progress: isGhostRider ? null : (vitals.progress ?? null)
        }),
        finished: isFinished,
        // Live rank for EVERY rider (not gated on isFinished) — engine.standings()
        // ranks unfinished riders by distance every tick too, and the standings
        // tower (audit UX §4.1) needs a live "I'm 2nd" readout mid-race, not just
        // at the finish line.
        placement: placementByUser[userId] ?? null,
        // Live leader (rank-1 in standings) once the race is underway. standings()
        // ranks un-finished riders by distance every tick, so this hops on each lead
        // change and lands on the eventual winner.
        isLeader: engineState.elapsedS > 0 && placementByUser[userId] === 1,
        maxRpm: resolveRpmLimits(bikeById.get(rider.equipmentId) || {}).gaugeMaxRpm,
        // `parked` covers both away states; `noSensor` lets a surface word it as
        // a sensor problem ("NO SIGNAL") rather than a stop ("PARKED").
        parked: parkedNow.has(userId) || noSensorNow.has(userId),
        noSensor: noSensorNow.has(userId),
        overtime: overtimeNow.has(userId),
        // Sensor presumed genuinely disconnected (not a broadcast blip, and not
        // simply "hasn't started pedaling yet" — see the everConnected gate in
        // the tick effect above). Ghosts replay a recording and never carry a
        // live sensor, so never flagged.
        sensorLost: !isGhostRider
          && (gapTicksRef.current.get(userId) || 0) >= SENSOR_LOST_GAP_TICKS
          && (rpmHistoryRef.current.get(userId) || []).length > 0
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
          rivalKind={raceMetaRef.current?.rivalKind ?? null}
          finalSeconds={finalSecondsRef.current}
          finale={finaleRef.current}
          backgroundPlexId={raceMetaRef.current?.backgroundPlexId || null}
          lapLengthM={effectiveLapLength({
            lapLengthM: Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0,
            winCondition: engineState.winCondition || raceMetaRef.current?.winCondition || 'distance',
            goalM: engineState.goalM ?? raceMetaRef.current?.goalM ?? null
          })}
        />
        <CycleEventToast toast={eventToast} onDone={onEventToastDone} durationMs={toastDurationMs(eventToast?.variant)} />
        <RaceMenu onEnd={onFinishRace} onDiscard={onCancel} />
      </div>
    );
  }

  // results
  const engineState = snapshot?.engineState || {};
  const resultsMeta = raceMetaRef.current;
  const resultsWin = engineState.winCondition || resultsMeta?.winCondition || 'distance';
  const stoppedIds = [...new Set([...(snapshot?.parked || []), ...(snapshot?.noSensor || [])])];
  const resultRiders = engineState.riders || {};
  const resultLiveIds = Object.keys(resultRiders).filter((id) => !resultRiders[id].isGhost);
  const resultGhostIds = Object.keys(resultRiders).filter((id) => resultRiders[id].isGhost);
  // Each live rider's ride against their own history at this type and length.
  // None for an ended-early ride, a rider stopped at the close, or a distance
  // race not finished.
  const comparisons = {};
  if (!snapshot?.endedEarly && resultsMeta?.history) {
    (engineState.standings || []).forEach((s) => {
      const h = resultsMeta.history[s.userId];
      if (!h || stoppedIds.includes(s.userId)) return;
      const value = resultsWin === 'distance' ? s.finishTimeS : s.distanceM;
      const cmp = resultsComparison({ winCondition: resultsWin, value, previousBest: h.previousBest, last: h.last });
      if (cmp) comparisons[s.userId] = cmp;
    });
  }
  // A solo race: one live rider against one replayed rival.
  const soloRivalId = resultLiveIds.length === 1 && resultGhostIds.length === 1 ? resultGhostIds[0] : null;
  // Rematch needs someone on a bike, and a featured course that still exists.
  const rematchPlan = resultsMeta?.rematch;
  const courseGone = !!rematchPlan?.ov?.id && featuredLadder?.course?.id !== rematchPlan.ov.id;
  const anyoneClaimed = bikes.some((b) => session?.getEquipmentRider?.(b.id));
  const canRematch = !!rematchPlan && !courseGone && anyoneClaimed;
  return (
    <div className="cycle-game-container" data-testid="cycle-game-container">
      <RaceResults
        standings={engineState.standings || []}
        riders={resultRiders}
        winCondition={resultsWin}
        stopped={stoppedIds}
        overtime={snapshot?.overtime || []}
        lapLengthM={effectiveLapLength({
          lapLengthM: Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0,
          winCondition: engineState.winCondition || raceMetaRef.current?.winCondition || 'distance',
          goalM: engineState.goalM ?? raceMetaRef.current?.goalM ?? null
        })}
        elapsedS={engineState.elapsedS || 0}
        secondsLeft={resultsSecondsLeft}
        saveFailed={saveFailed}
        onExit={backToHome}
        onHold={onResultsHold}
        onRematch={canRematch ? onRematch : null}
        comparisons={comparisons}
        rivalId={soloRivalId}
        rivalLabel={soloRivalId ? rivalLabelFor(resultsMeta?.rivalKind, resultRiders[soloRivalId]) : ''}
        ladderNotes={ladderNotes}
      />
    </div>
  );
}
