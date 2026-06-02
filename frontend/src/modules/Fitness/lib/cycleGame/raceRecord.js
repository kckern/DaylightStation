import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';

export function buildRaceRecord(state, meta = {}) {
  const { raceId, date, mode, winCondition, goalM, timeCapS, intervalSeconds, backgroundPlexId = null } = meta;
  const placeByUser = Object.fromEntries((state?.standings || []).map((s) => [s.userId, s.placement]));

  const participants = {};
  Object.values(state?.riders || {}).forEach((r) => {
    participants[r.userId] = {
      display_name: r.displayName,
      equipment: r.equipmentId,
      final_distance_m: r.cumulativeDistanceM,
      final_time_s: r.finishTimeS ?? null,
      placement: placeByUser[r.userId] ?? null,
      distance_series: SessionSerializerV3.encodeSeries(r.distanceSeries || [])
    };
  });

  const race = {
    id: raceId,
    date,
    mode,
    win_condition: winCondition,
    ...(winCondition === 'distance' ? { goal_m: goalM } : { time_cap_s: timeCapS }),
    interval_seconds: intervalSeconds,
    background_plex_id: backgroundPlexId
  };

  return { version: 1, race, participants };
}

export default buildRaceRecord;
