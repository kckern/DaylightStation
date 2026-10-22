/**
 * Per-rider episode history — who did an episode, and when.
 *
 * Input is one episode's sessions from GET /api/v1/fitness/sessions/episode-history
 * (newest first, each with riders {id, displayName, minutes, rings, isGuest}).
 *
 * Credit rule: a rider "did" the episode when they rode at least half of it.
 * Someone who walks in for the last few minutes was in the session but did not
 * do the workout. When either side of the comparison is unknown (an old
 * session with no zone minutes, an episode without a duration) the rider is
 * credited — the session is the only evidence there is.
 */

export const CREDIT_FRACTION = 0.5;
export const GRID_MAX_AVATARS = 3;
export const DETAIL_MAX_SESSIONS = 5;

export function isCredited(rider, episodeDurationSeconds) {
  const minutes = Number(rider?.minutes);
  const duration = Number(episodeDurationSeconds);
  if (!Number.isFinite(minutes) || minutes <= 0) return true;
  if (!Number.isFinite(duration) || duration <= 0) return true;
  return minutes * 60 >= duration * CREDIT_FRACTION;
}

/**
 * Sessions where at least one rider is credited, riders narrowed to the
 * credited ones (guests included — the detail list is a plain record).
 */
export function creditedSessions(sessions, episodeDurationSeconds) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((s) => ({ ...s, riders: (s.riders || []).filter((r) => isCredited(r, episodeDurationSeconds)) }))
    .filter((s) => s.riders.length > 0);
}

/**
 * The grid badge: household riders (never guests) who did the episode, each
 * once, most recent first, and the date of the most recent of them.
 * Returns null when no household rider is credited.
 */
export function gridBadge(sessions, episodeDurationSeconds) {
  const seen = new Map();
  let latest = null;
  for (const s of creditedSessions(sessions, episodeDurationSeconds)) {
    for (const r of s.riders) {
      if (r.isGuest || seen.has(r.id)) continue;
      seen.set(r.id, r);
      if (latest == null) latest = s.startTime ?? null;
    }
  }
  if (seen.size === 0) return null;
  const riders = [...seen.values()];
  return {
    riders: riders.slice(0, GRID_MAX_AVATARS),
    overflow: Math.max(0, riders.length - GRID_MAX_AVATARS),
    latestStartTime: latest,
  };
}

/** The detail list: the newest credited sessions, capped. */
export function detailRows(sessions, episodeDurationSeconds) {
  return creditedSessions(sessions, episodeDurationSeconds).slice(0, DETAIL_MAX_SESSIONS);
}
