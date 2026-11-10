// Pace rival: who a lone rider races when they did not pick a ghost. Their own
// best at this race type and length, else the household's best, else a constant
// "par" pace. Pure: no logging, no React, no I/O. The chosen candidate goes
// through the normal ghost pipeline (mapRaceRecordToCandidate →
// buildGhostFromCandidate in ghostCandidate.js).
import { resolveParticipantIdentity } from "./participantIdentity.js";
import { SessionSerializerV3 } from "../../hooks/fitness/SessionSerializerV3.js";

/** Race id and participant id of the synthetic par record. */
export const PAR_ID = 'par';
/** Par speed when none is configured (or the configured one is unusable). */
export const DEFAULT_PAR_SPEED_KMH = 18;

const isPositive = (v) => Number.isFinite(v) && v > 0;

/**
 * Choose the pace rival for a lone rider.
 *
 * Only rides that count are considered: same win condition and same length, a
 * race that was not ended early, a live rider (not a replay) who was not
 * stopped when the race closed, and for distance races one who finished.
 * Best = lowest finish time (distance race) or furthest distance (time race).
 * Equal scores go to the most recent race (race ids are YYYYMMDDHHmmss strings).
 *
 * @param {object} [args]
 * @param {Array} [args.candidates] mapRaceRecordToCandidate() results
 * @param {string|null} [args.riderId] the lone rider's user id
 * @param {'distance'|'time'} [args.winCondition]
 * @param {number|null} [args.goalM] distance-race length
 * @param {number|null} [args.timeCapS] time-race length
 * @returns {{ kind: 'self'|'household'|'par', raceId: string|null, participantId: string }}
 */
export function pickPaceRival({ candidates = [], riderId = null, winCondition = 'distance', goalM = null, timeCapS = null } = {}) {
  const isDistance = winCondition === 'distance';
  const sameRace = (c) => c && !c.incomplete && c.raceId !== PAR_ID && c.winCondition === winCondition
    && (isDistance ? c.goalM === goalM : c.timeCapS === timeCapS);
  const valid = (pt) => pt && !pt.stopped && !pt.isGhost && !resolveParticipantIdentity(pt.id).isGhost
    && (isDistance ? isPositive(pt.finalTimeS) : isPositive(pt.finalDistanceM));
  // Lower is better: finish time for distance races, negated distance for time races.
  const score = (pt) => (isDistance ? pt.finalTimeS : -pt.finalDistanceM);
  const beats = (a, b) => !b || a.score < b.score
    || (a.score === b.score && String(a.raceId) > String(b.raceId));

  let self = null;
  let house = null;
  (Array.isArray(candidates) ? candidates : []).filter(sameRace).forEach((c) => {
    (c.participants || []).filter(valid).forEach((pt) => {
      const entry = { raceId: c.raceId, participantId: pt.id, score: score(pt) };
      if (beats(entry, house)) house = entry;
      const isSelf = riderId != null && resolveParticipantIdentity(pt.id).sourceId === riderId;
      if (isSelf && beats(entry, self)) self = entry;
    });
  });
  if (self) return { kind: 'self', raceId: self.raceId, participantId: self.participantId };
  if (house) return { kind: 'household', raceId: house.raceId, participantId: house.participantId };
  return { kind: 'par', raceId: null, participantId: PAR_ID };
}

/**
 * A synthetic one-rider race record at a constant speed, in the saved-record
 * shape, so it can go through mapRaceRecordToCandidate like any fetched race.
 * One distance sample per second; sample i is the distance at (i + 1) seconds,
 * which is how the race engine replays a ghost series. A distance race ends
 * exactly on the goal. Returns null when the race has no usable length.
 *
 * @param {object} [args]
 * @param {'distance'|'time'} [args.winCondition]
 * @param {number|null} [args.goalM]
 * @param {number|null} [args.timeCapS]
 * @param {number} [args.speedKmh] par speed; anything not finite and positive uses 18
 * @returns {object|null} `{ version, race, participants: { par } }`
 */
export function buildParRecord({ winCondition = 'distance', goalM = null, timeCapS = null, speedKmh = DEFAULT_PAR_SPEED_KMH } = {}) {
  const isDistance = winCondition === 'distance';
  if (!isPositive(isDistance ? goalM : timeCapS)) return null;
  const mps = (isPositive(speedKmh) ? speedKmh : DEFAULT_PAR_SPEED_KMH) / 3.6;
  // The epsilon keeps float noise (300 / 2.9999999999999996) from adding a second.
  const seconds = isDistance ? Math.ceil(goalM / mps - 1e-9) : Math.ceil(timeCapS);
  if (seconds < 1) return null;
  const cap = isDistance ? goalM : Infinity;
  const series = Array.from({ length: seconds }, (_, i) => Math.min(cap, Math.round(mps * (i + 1) * 10) / 10));
  if (isDistance) series[seconds - 1] = goalM;
  return {
    version: 1,
    race: {
      id: PAR_ID, win_condition: winCondition, interval_seconds: 1,
      ...(isDistance ? { goal_m: goalM } : { time_cap_s: timeCapS })
    },
    participants: {
      [PAR_ID]: {
        display_name: 'Par',
        final_distance_m: series[seconds - 1],
        final_time_s: isDistance ? seconds : null,
        placement: 1,
        distance_series: SessionSerializerV3.encodeSeries(series)
      }
    }
  };
}

export default { pickPaceRival, buildParRecord };
