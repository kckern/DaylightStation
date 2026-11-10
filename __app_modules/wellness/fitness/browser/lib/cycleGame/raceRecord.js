import { SessionSerializerV3 } from "../../hooks/fitness/SessionSerializerV3.js";

/**
 * Build the persisted v1 race record.
 *
 * `meta.endedEarly` — the race was ended by a rider before its win condition
 *   closed it. The record is saved with `race.incomplete: true` and never counts
 *   for the ladder, personal bests or high scores. Omitted on a normal finish.
 * `meta.stopped` — userIds who were stopped (parked) when the race closed; each
 *   gets `stopped: true` on their participant entry. Omitted for everyone else.
 */
export function buildRaceRecord(state, meta = {}) {
  const { raceId, date, mode, winCondition, goalM, timeCapS, intervalSeconds, backgroundPlexId = null, courseId = null, endedEarly = false, stopped = [] } = meta;
  const stoppedIds = new Set(Array.isArray(stopped) ? stopped : []);
  const placeByUser = Object.fromEntries((state?.standings || []).map((s) => [s.userId, s.placement]));

  const participants = {};
  Object.values(state?.riders || {}).forEach((r) => {
    participants[r.userId] = {
      display_name: r.displayName,
      equipment: r.equipmentId,
      final_distance_m: r.cumulativeDistanceM,
      final_time_s: r.finishTimeS ?? null,
      placement: placeByUser[r.userId] ?? null,
      distance_series: SessionSerializerV3.encodeSeries(r.distanceSeries || []),
      hr_series: SessionSerializerV3.encodeSeries(r.hrSeries || []),
      rpm_series: SessionSerializerV3.encodeSeries(r.rpmSeries || []),
      zone_series: SessionSerializerV3.encodeSeries(r.zoneSeries || []),
      ...(stoppedIds.has(r.userId) ? { stopped: true } : {})
    };
  });

  const race = {
    id: raceId,
    date,
    mode,
    win_condition: winCondition,
    ...(winCondition === 'distance' ? { goal_m: goalM } : { time_cap_s: timeCapS }),
    interval_seconds: intervalSeconds,
    background_plex_id: backgroundPlexId,
    course_id: courseId,
    ...(endedEarly ? { incomplete: true } : {})
  };

  return { version: 1, race, participants };
}

export default buildRaceRecord;
