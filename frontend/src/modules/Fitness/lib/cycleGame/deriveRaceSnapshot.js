import { lapCount, lapProgress } from './lapModel.js';

// Phase progress thresholds with hysteresis (enter/exit pairs) so phase can't
// flap at a boundary — mirrors the sticky logRef in CycleRaceScreen.
const EARLY_ENTER = 0.0, EARLY_EXIT = 0.15;   // EARLY while progress < 0.15
const FINALE_ENTER = 0.85, FINALE_EXIT = 0.80; // FINALE once > 0.85, until < 0.80
const PHOTO_FINISH_GAP_M = 25;

function progressOf(state) {
  if (state.winCondition === 'distance') {
    const lead = Math.max(0, ...Object.values(state.riders || {}).map((r) => r.cumulativeDistanceM || 0));
    return state.goalM > 0 ? lead / state.goalM : 0;
  }
  return state.timeCapS > 0 ? state.elapsedS / state.timeCapS : 0;
}

function nextPhase(prevPhase, started, finished, progress) {
  if (finished) return 'FINISHED';
  if (!started) return 'PRE';
  if (prevPhase === 'FINALE') return progress < FINALE_EXIT ? 'MID' : 'FINALE';
  if (progress >= FINALE_ENTER) return 'FINALE';
  if (prevPhase === 'MID') return 'MID'; // MID is sticky; only FINALE/FINISHED leave it
  if (prevPhase === 'EARLY') return progress >= EARLY_EXIT ? 'MID' : 'EARLY';
  // first started tick (from PRE)
  return progress >= EARLY_EXIT ? 'MID' : 'EARLY';
}

export function deriveRaceSnapshot(state, config = {}, prevSnapshot = null) {
  const lapLengthM = Number.isFinite(config.lapLengthM) && config.lapLengthM > 0 ? config.lapLengthM : 0;
  const lapsEnabled = lapLengthM > 0;
  const ids = Object.keys(state.riders || {});
  const fieldSize = ids.length;
  const ghostCount = ids.filter((id) => state.riders[id].isGhost).length;
  const humanCount = fieldSize - ghostCount;
  const isSolo = fieldSize === 1;

  // Per-rider derived view.
  const ridersView = {};
  ids.forEach((id) => {
    const r = state.riders[id];
    const d = r.cumulativeDistanceM || 0;
    const splits = r.lapSplits || [];
    ridersView[id] = {
      id, distanceM: d, isGhost: !!r.isGhost, finishTimeS: r.finishTimeS ?? null,
      laps: lapCount(d, lapLengthM), lapProgress: lapProgress(d, lapLengthM),
      lapSplits: splits, lastLapTimeS: splits.length >= 2 ? splits[splits.length - 1] - splits[splits.length - 2] : null
    };
  });

  // Leader + tension metrics.
  const byDist = [...ids].sort((a, b) => {
    const dd = (state.riders[b].cumulativeDistanceM || 0) - (state.riders[a].cumulativeDistanceM || 0);
    return dd !== 0 ? dd : String(a).localeCompare(String(b));
  });
  const leaderId = byDist[0] ?? null;
  const leaderGapM = byDist.length >= 2
    ? (state.riders[byDist[0]].cumulativeDistanceM || 0) - (state.riders[byDist[1]].cumulativeDistanceM || 0)
    : 0;
  let tightestPairGapM = Infinity;
  for (let i = 1; i < byDist.length; i++) {
    tightestPairGapM = Math.min(tightestPairGapM,
      (state.riders[byDist[i - 1]].cumulativeDistanceM || 0) - (state.riders[byDist[i]].cumulativeDistanceM || 0));
  }
  if (!Number.isFinite(tightestPairGapM)) tightestPairGapM = 0;
  const lapsArr = Object.values(ridersView).map((r) => r.laps);
  const lapDeltaMax = lapsArr.length >= 2 ? Math.max(...lapsArr) - Math.min(...lapsArr) : 0;
  const closingRateMPS = prevSnapshot && Number.isFinite(prevSnapshot.leaderGapM) && state.elapsedS > prevSnapshot.elapsedS
    ? (leaderGapM - prevSnapshot.leaderGapM) / (state.elapsedS - prevSnapshot.elapsedS)
    : 0;

  const started = (state.elapsedS || 0) > 0;
  const progress = progressOf(state);
  const phase = nextPhase(prevSnapshot?.phase || 'PRE', started, !!state.finished, progress);

  // Edge-triggered drama events.
  const events = [];
  const fire = (type, riderIds = []) => events.push({ type, riderIds, firedAtClock: state.elapsedS });
  if (prevSnapshot) {
    if (leaderId && prevSnapshot.leaderId && leaderId !== prevSnapshot.leaderId) fire('LEAD_CHANGE', [leaderId]);
    const newlyFinished = ids.filter((id) => ridersView[id].finishTimeS != null
      && (prevSnapshot.ridersView?.[id]?.finishTimeS == null));
    if (newlyFinished.length) fire('RIDER_FINISHED', newlyFinished);
    if (lapsEnabled && lapDeltaMax >= 1 && (prevSnapshot.lapDeltaMax || 0) < 1) fire('LAPPING_IMMINENT', [leaderId]);
    if (phase === 'FINALE' && tightestPairGapM <= PHOTO_FINISH_GAP_M && (prevSnapshot.tightestPairGapM ?? Infinity) > PHOTO_FINISH_GAP_M) fire('PHOTO_FINISH');
    // FINAL_LAP: any rider entered their last lap (distance race + laps on).
    if (lapsEnabled && state.winCondition === 'distance') {
      const lastLap = Math.max(0, lapCount(state.goalM, lapLengthM) - 1);
      const entered = ids.filter((id) => ridersView[id].laps >= lastLap
        && (prevSnapshot.ridersView?.[id]?.laps ?? 0) < lastLap);
      if (entered.length) fire('FINAL_LAP', entered);
    }
  }

  return {
    elapsedS: state.elapsedS, winCondition: state.winCondition, goalM: state.goalM,
    fieldSize, humanCount, ghostCount, isSolo, lapsEnabled, lapLengthM,
    phase, progress, leaderId, leaderGapM, tightestPairGapM, lapDeltaMax, closingRateMPS,
    ridersView, events
  };
}

export default deriveRaceSnapshot;
