/**
 * Per-rider episode history — who did an episode, and when.
 *
 * Input is one episode's sessions from GET /api/v1/fitness/sessions/episode-history
 * (newest first, each with riders {id, displayName, minutes, rings, isGuest}
 * and the session's circumstances: durationMs, totalRings, videoCount).
 *
 * Credit rule: a rider "did" the episode when they rode at least half of it.
 * Someone who walks in for the last few minutes was in the session but did not
 * do the workout. When either side of the comparison is unknown (an old
 * session with no zone minutes, an episode without a duration) the rider is
 * credited — the session is the only evidence there is.
 */

export const CREDIT_FRACTION = 0.5;
export const GRID_MAX_AVATARS = 3;

export function isCredited(rider, episodeDurationSeconds) {
  const minutes = Number(rider?.minutes);
  const duration = Number(episodeDurationSeconds);
  if (!Number.isFinite(minutes) || minutes <= 0) return true;
  if (!Number.isFinite(duration) || duration <= 0) return true;
  return minutes * 60 >= duration * CREDIT_FRACTION;
}

/**
 * Sessions where at least one rider is credited, riders narrowed to the
 * credited ones (guests included — the panel lists everyone who rode).
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

/**
 * The panel's history: one row per time the episode was actually done,
 * newest first — who (credited riders, guests included), when, and the
 * circumstances (how long the session ran, rings, other videos). Nothing is
 * listed for people who have not done it. `household` is [{id, displayName}].
 */
export function completionRows(sessions, episodeDurationSeconds, { limit = 4, household = [] } = {}) {
  // The household's names win over whatever the session recorded at the time.
  const names = new Map(household.map((m) => [m.id, m.displayName]));
  return creditedSessions(sessions, episodeDurationSeconds)
    .slice(0, limit)
    .map((s) => {
      const riderMinutes = s.riders.map((r) => Number(r.minutes)).filter((m) => Number.isFinite(m) && m > 0);
      const riderRings = s.riders.map((r) => Number(r.rings)).filter((m) => Number.isFinite(m) && m > 0);
      return {
        sessionId: s.sessionId,
        startTime: s.startTime ?? null,
        riders: s.riders.map((r) => ({ id: r.id, displayName: names.get(r.id) || r.displayName || r.id, isGuest: r.isGuest === true })),
        // The whole session when the index has it, else the longest rider's time.
        minutes: Number.isFinite(s.durationMs) && s.durationMs > 0
          ? Math.round(s.durationMs / 60000)
          : (riderMinutes.length ? Math.round(Math.max(...riderMinutes)) : null),
        rings: Number.isFinite(s.totalRings) && s.totalRings > 0
          ? s.totalRings
          : (riderRings.length ? riderRings.reduce((a, b) => a + b, 0) : null),
        otherVideos: Number.isFinite(s.videoCount) ? Math.max(0, s.videoCount - 1) : 0,
      };
    });
}

const DAY_MS = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Today", "Yesterday", "Tuesday", "3 weeks ago", "4 months ago", "May 2024" — a date in words, for the bike. */
export function whenInWords(startTime, now = Date.now()) {
  const t = Number(startTime);
  if (!Number.isFinite(t) || t <= 0) return '';
  const then = new Date(t);
  const today = new Date(now);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(then)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAYS[then.getDay()];
  if (days < 14) return 'Last week';
  if (days < 56) return `${Math.round(days / 7)} weeks ago`;
  const months = (today.getFullYear() - then.getFullYear()) * 12 + (today.getMonth() - then.getMonth());
  if (months < 12) return `${Math.max(2, months)} months ago`;
  return `${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
}

/** A small copy of an episode image — the proxy resizes on `w`/`h`. */
export function mosaicThumb(url, width, height) {
  if (!url) return null;
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}&h=${height}`;
}
