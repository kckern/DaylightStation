// Ghost-candidate mapping: turns a raw fetched race record (`{ race, participants }`)
// into a lightweight "candidate" the ghost picker can render, and turns a selected
// candidate into the rider set + ghost object the race lobby arms. Moved verbatim
// out of CycleGameContainer's `ghostCandidates` memo + `onSelectGhost` handler so
// the ladder (and any other future ghost-arming surface) can reuse the same logic.
import { resolveParticipantIdentity } from './participantIdentity.js';
import { formatDistance } from './formatDistance.js';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';

function fmtMs(s) {
  if (!Number.isFinite(s)) return '—';
  const total = Math.round(s); // round total first — else 119.6 → "1:60"
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Map one fetched race record to a ghost candidate. Each past race carries ALL
 * its participants, so racing a ghost replays the whole field. Goal vs score
 * are inverted by win condition (distance race → goal=distance, score=time;
 * time race → goal=time, score=distance).
 *
 * @param {object} rec `{ race, participants }` as returned by /cycle-races
 * @param {object} [opts]
 * @param {(name: string, ctx: { userId: string, preferGroupLabel: boolean }) => string|null} [opts.getDisplayLabel]
 *   Optional household relational-label resolver (SSOT for "Dad"/"Mom" labels).
 *   When omitted, the persisted/resolved display name is used as-is.
 * @param {(equipmentId: string) => number} [opts.resolveGaugeMaxRpm] Resolves the
 *   gauge scale of the recording equipment. Defaults to 120 (pre-field records).
 * @returns {object|null} candidate, or null when the record has no participants
 */
export function mapRaceRecordToCandidate(rec, { getDisplayLabel = null, resolveGaugeMaxRpm = () => 120 } = {}) {
  const race = rec?.race || {};
  const winCondition = race.win_condition || 'distance';
  const partEntries = Object.entries(rec?.participants || {});
  // 2+ riders → show the household relational label ("Dad"/"Mom") exactly like
  // a live race; a solo replay keeps the given name. getDisplayLabel is the SSOT.
  const preferGroupLabel = partEntries.length >= 2;
  const participants = partEntries
    .map(([id, p]) => {
      // Ghosts are persisted as `ghost:<raceId>:<sourceId>` — resolve to the
      // real face/name so the records rail doesn't fall back to the guest avatar.
      const ident = resolveParticipantIdentity(id, p.display_name);
      const displayName = getDisplayLabel
        ? (getDisplayLabel(ident.displayName, { userId: ident.sourceId, preferGroupLabel }) || ident.displayName)
        : ident.displayName;
      return {
        id,
        isGhost: ident.isGhost,
        displayName,
        avatarSrc: ident.avatarSrc,
        equipment: p.equipment || null,
        // Gauge scale of the recording equipment, resolved here (the recap
        // has no bikes config). Default 120 for records predating the field.
        gaugeMaxRpm: resolveGaugeMaxRpm(p.equipment),
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
}

/**
 * Build the ghost riders + ghost object from a candidate (as produced by
 * `mapRaceRecordToCandidate`). Selecting a ghost replays the WHOLE recorded
 * field and locks the race type + value to that recording. Returns null when
 * no rider has a non-empty distance series (nothing to replay).
 *
 * @param {object} candidate
 * @returns {{ ghost: object, riders: object[] } | null}
 */
export function buildGhostFromCandidate(candidate) {
  if (!candidate) return null;
  const riders = (candidate.participants || []).map((p) => {
    // Flatten ghost-of-a-ghost: reference the ORIGINAL source user so we never
    // mint `ghost:R2:ghost:R1:user` (which 404s the avatar). resolveParticipantIdentity
    // returns the final source slug for nested ids; for a real id it's the id itself.
    const { sourceId } = resolveParticipantIdentity(p.id, p.displayName);
    const baseName = String(p.displayName || sourceId).replace(/\s*👻\s*$/, '');
    return {
      userId: `ghost:${candidate.raceId}:${sourceId}`,
      displayName: `${baseName} 👻`,
      equipmentId: p.equipment || null,
      ghostSeries: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
      ghostHrSeries: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
      ghostRpmSeries: SessionSerializerV3.decodeSeries(p.rpmSeries) || [],
      ghostZoneSeries: SessionSerializerV3.decodeSeries(p.zoneSeries) || [],
      ghostIntervalS: candidate.intervalSeconds || 1
    };
  }).filter((r) => r.ghostSeries.length > 0);
  if (riders.length === 0) return null;
  const ghost = {
    sourceRaceId: candidate.raceId,
    winCondition: candidate.winCondition,
    goalM: candidate.goalM,
    timeCapS: candidate.timeCapS,
    riderCount: riders.length,
    displayName: candidate.winnerName + (riders.length > 1 ? ` +${riders.length - 1}` : ''),
    riders
  };
  return { ghost, riders };
}

export default { mapRaceRecordToCandidate, buildGhostFromCandidate };
