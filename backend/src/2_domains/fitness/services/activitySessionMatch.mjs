/**
 * activitySessionMatch
 *
 * Pure domain policy deciding whether an external provider activity (Strava is
 * the current consumer) may bind to a locally-recorded fitness session.
 *
 * The household sessions this guards are stationary garage workouts: bikes, a
 * step platform, heart-rate straps. An activity recorded outdoors is therefore
 * never the same workout as a home session, no matter how well the clocks line
 * up — and a strap that drifts through ANT+ range for three minutes is not a
 * participant who did the work.
 *
 * Written after activity 19465331355 (a 5.3 km outdoor run) bound to garage
 * session 20260725132556 because the run fell entirely inside the session's
 * 3h15m window. Three checks, cheapest first:
 *
 *   1. Membership — the athlete must be a participant of the session.
 *   2. Venue      — an outdoor activity may only bind to a session that has
 *                   distance provenance of its own (i.e. one built FROM a
 *                   provider activity, not recorded in the garage).
 *   3. Presence   — the athlete's own heart-rate coverage inside the activity
 *                   window must account for a real share of the activity,
 *                   which containment inside a long session does not prove.
 *
 * @module domains/fitness/services/activitySessionMatch
 */

import moment from 'moment-timezone';
import { decodeSingleSeries } from './TimelineService.mjs';

const DEFAULT_TZ = 'America/Los_Angeles';
const DEFAULT_INTERVAL_SECONDS = 5;

/**
 * Tunable thresholds. `minOverlapFraction` preserves the pre-existing webhook
 * behaviour; the other two are the new guards.
 */
export const DEFAULT_MATCH_POLICY = Object.freeze({
  bufferMs: 5 * 60 * 1000,
  minOverlapFraction: 0.5,
  minPresenceFraction: 0.2,
  gpsDistanceThresholdMeters: 100,
});

/** Stable reason codes — these are logged and asserted against. */
export const MATCH_REJECTED = Object.freeze({
  NOT_A_PARTICIPANT: 'not_a_participant',
  OUTDOOR_VS_HOME: 'outdoor_activity_vs_home_session',
  NO_TIME_OVERLAP: 'no_time_overlap',
  OVERLAP_BELOW_FLOOR: 'overlap_fraction_below_floor',
  PRESENCE_BELOW_FLOOR: 'presence_below_floor',
});

/**
 * Classify where an activity happened.
 *
 * The trainer flag is checked before the GPS fix on purpose: mistaking an
 * indoor ride for an outdoor one would reject a legitimate match, which is the
 * more expensive error. Distance alone is the degraded signal for callers that
 * rebuild activities from summary rows (no `start_latlng`, no `trainer`).
 *
 * @param {Object} activity - Provider activity
 * @param {Object} [policy]
 * @returns {'outdoor'|'indoor'|'unknown'}
 */
export function classifyActivityVenue(activity, policy = DEFAULT_MATCH_POLICY) {
  if (!activity) return 'unknown';
  if (activity.trainer === true) return 'indoor';

  const latlng = activity.start_latlng;
  const hasGpsFix = Array.isArray(latlng)
    && latlng.length >= 2
    && latlng.every(n => Number.isFinite(Number(n)));
  if (hasGpsFix) return 'outdoor';

  const threshold = policy?.gpsDistanceThresholdMeters
    ?? DEFAULT_MATCH_POLICY.gpsDistanceThresholdMeters;
  if ((Number(activity.distance) || 0) > threshold) return 'outdoor';

  return 'unknown';
}

/**
 * Whether a session carries distance of its own — true for sessions built from
 * a provider activity, which legitimately represent outdoor work.
 *
 * @param {Object} session - Parsed session YAML
 * @param {Object} [policy]
 * @returns {boolean}
 */
export function sessionHasDistanceProvenance(session, policy = DEFAULT_MATCH_POLICY) {
  if (session?.session?.source === 'strava') return true;
  const threshold = policy?.gpsDistanceThresholdMeters
    ?? DEFAULT_MATCH_POLICY.gpsDistanceThresholdMeters;
  return (Number(session?.strava?.distance) || 0) > threshold;
}

/**
 * Seconds of a participant's own heart-rate coverage inside a window.
 *
 * Reads the timeline series rather than `summary.participants[].zone_minutes`:
 * the summary block is missing or partial on some stored sessions (e.g.
 * 20260616185313 lists one participant out of four), which would read as
 * "absent" for someone who was actually there.
 *
 * @param {Object} session - Parsed session YAML
 * @param {string} username
 * @param {{from: Date, to: Date, tz?: string}} window
 * @returns {number} Seconds of live HR samples within the window
 */
export function participantPresenceSeconds(session, username, { from, to, tz } = {}) {
  const series = session?.timeline?.series?.[`${username}:hr`];
  if (!series || !session?.session?.start) return 0;

  const decoded = decodeSingleSeries(series);
  if (!Array.isArray(decoded)) return 0;

  const zone = session.timezone || tz || DEFAULT_TZ;
  const intervalSeconds = Number(session.timeline?.interval_seconds) || DEFAULT_INTERVAL_SECONDS;
  const sessionStartMs = moment.tz(session.session.start, zone).valueOf();
  const fromMs = from instanceof Date ? from.getTime() : Number(from);
  const toMs = to instanceof Date ? to.getTime() : Number(to);

  let liveTicks = 0;
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i] == null) continue;
    const tickMs = sessionStartMs + (i * intervalSeconds * 1000);
    if (tickMs >= fromMs && tickMs <= toMs) liveTicks++;
  }

  return liveTicks * intervalSeconds;
}

/**
 * Whether the session recorded any heart rate for this participant at all.
 *
 * Distinguishes "the athlete wasn't really there" from "nothing was measured" —
 * riding the garage bike with cadence only and no strap leaves no series, and
 * absent evidence must not be read as an absent athlete.
 *
 * @param {Object} session - Parsed session YAML
 * @param {string} username
 * @returns {boolean}
 */
export function hasParticipantHrSeries(session, username) {
  const series = session?.timeline?.series?.[`${username}:hr`];
  if (!series) return false;
  return Array.isArray(decodeSingleSeries(series));
}

/**
 * Decide whether an activity may bind to a session.
 *
 * @param {Object} args
 * @param {Object} args.activity - Provider activity (start_date, moving_time, elapsed_time, distance, trainer, start_latlng)
 * @param {Object} args.session - Parsed session YAML
 * @param {string} args.username
 * @param {string} [args.tz] - Fallback timezone when the session carries none
 * @param {Object} [args.policy] - Partial override of DEFAULT_MATCH_POLICY
 * @returns {{ok: boolean, reason: string|null, venue: string, overlapMs: number,
 *   overlapFraction: number, presenceSeconds: number, presenceFraction: number}}
 */
export function evaluateActivitySessionMatch({ activity, session, username, tz, policy } = {}) {
  const p = { ...DEFAULT_MATCH_POLICY, ...(policy || {}) };
  const zone = session?.timezone || tz || DEFAULT_TZ;

  const verdict = {
    ok: false,
    reason: null,
    venue: 'unknown',
    overlapMs: 0,
    overlapFraction: 0,
    presenceMeasured: false,
    presenceSeconds: 0,
    presenceFraction: 0,
  };

  // 1. Membership — an activity cannot belong to a session its athlete sat out.
  if (!session?.participants?.[username]) {
    return { ...verdict, reason: MATCH_REJECTED.NOT_A_PARTICIPANT };
  }

  // 2. Venue — outdoor work never happened in the garage.
  verdict.venue = classifyActivityVenue(activity, p);
  if (verdict.venue === 'outdoor' && !sessionHasDistanceProvenance(session, p)) {
    return { ...verdict, reason: MATCH_REJECTED.OUTDOOR_VS_HOME };
  }

  // 3a. Time overlap, buffered — unchanged from the original matchers.
  const elapsedSeconds = Number(activity?.elapsed_time) || Number(activity?.moving_time) || 0;
  const actStart = moment(activity?.start_date).tz(zone);
  const actEnd = actStart.clone().add(elapsedSeconds, 'seconds');
  const sessStart = moment.tz(session.session?.start, zone);
  const sessEnd = session.session?.end
    ? moment.tz(session.session.end, zone)
    : sessStart.clone().add(Number(session.session?.duration_seconds) || 0, 'seconds');

  const overlapStart = moment.max(actStart.clone().subtract(p.bufferMs, 'ms'), sessStart);
  const overlapEnd = moment.min(actEnd.clone().add(p.bufferMs, 'ms'), sessEnd);
  verdict.overlapMs = overlapEnd.diff(overlapStart);
  if (verdict.overlapMs <= 0) {
    return { ...verdict, overlapMs: 0, reason: MATCH_REJECTED.NO_TIME_OVERLAP };
  }

  const elapsedMs = elapsedSeconds * 1000;
  verdict.overlapFraction = elapsedMs > 0 ? verdict.overlapMs / elapsedMs : 0;
  if (verdict.overlapFraction < p.minOverlapFraction) {
    return { ...verdict, reason: MATCH_REJECTED.OVERLAP_BELOW_FLOOR };
  }

  // 3b. Presence — containment inside a long session proves nothing about who
  // was on the equipment. Measure the athlete's own coverage instead, and only
  // when there is something to measure.
  verdict.presenceMeasured = hasParticipantHrSeries(session, username);
  if (verdict.presenceMeasured) {
    const movingSeconds = Number(activity?.moving_time) || elapsedSeconds;
    verdict.presenceSeconds = participantPresenceSeconds(session, username, {
      from: actStart.toDate(),
      to: actEnd.toDate(),
      tz: zone,
    });
    verdict.presenceFraction = movingSeconds > 0
      ? verdict.presenceSeconds / movingSeconds
      : 0;
    if (verdict.presenceFraction < p.minPresenceFraction) {
      return { ...verdict, reason: MATCH_REJECTED.PRESENCE_BELOW_FLOOR };
    }
  }

  return { ...verdict, ok: true, reason: null };
}

export default evaluateActivitySessionMatch;
