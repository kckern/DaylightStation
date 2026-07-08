/**
 * Weekly time-trial ladder — pure domain logic. No I/O, no clock reads:
 * callers pass `now` / index entries in. All dates are LOCAL 'YYYY-MM-DD'
 * strings matching the datastore's day-folder names (sliced from the
 * YYYYMMDDHHmmss raceId) — week membership is plain string comparison,
 * so no timezone conversion can disagree with the storage layout.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dateFromRaceId = (raceId) => {
  const s = String(raceId);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

/** Local Monday 00:00 → next Monday (exclusive end), as date strings. `now` is caller-supplied. */
export function currentWeekWindow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ValidationError('now (Date) is required', { code: 'MISSING_CLOCK', field: 'now' });
  }
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const next = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return { start: ymd(monday), end: ymd(next) };
}

/** ISO-8601 week of a (local) date. */
export function isoWeekOf(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3); // Thursday of this week
  const year = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((date - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

/** 'YYYY-Www' → { week, window } or null if malformed / out of range. */
export function parseIsoWeekParam(s) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
  // Reject week numbers past the year's last ISO week (e.g. W99, or W53 in a 52-week year).
  if (isoWeekOf(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate())).week !== week) return null;
  const next = new Date(monday);
  next.setUTCDate(monday.getUTCDate() + 7);
  const u = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { week, window: { start: u(monday), end: u(next) } };
}

/** Featured course for a week: override pin wins, else rotate by ISO week. */
export function resolveFeaturedCourse(cycleGameConfig, isoWeekNumber) {
  const list = (Array.isArray(cycleGameConfig?.featured_courses) ? cycleGameConfig.featured_courses : [])
    .filter((c) => c && c.id);
  if (!list.length) return null;
  const pin = cycleGameConfig?.featured_course_override;
  if (pin) {
    const hit = list.find((c) => c.id === pin);
    if (hit) return hit;
  }
  const n = Number(isoWeekNumber) || 0;
  return list[((n % list.length) + list.length) % list.length];
}

/** course_id equality, or legacy fallback on (win_condition, goal). */
export function raceMatchesCourse(entry, course) {
  if (!entry || !course) return false;
  if (entry.course_id && entry.course_id === course.id) return true;
  if (entry.win_condition !== course.win_condition) return false;
  return course.win_condition === 'distance'
    ? entry.goal_m === course.goal_m
    : entry.time_cap_s === course.time_cap_s;
}

/**
 * Best qualifying attempt per rider over matching entries (optionally windowed).
 * Distance course: min final_time_s (finishers only). Time course: max
 * final_distance_m (> 0). Ghosts never qualify. Tie → smaller raceId.
 */
function bestByRider(entries, course, { start = null, end = null } = {}) {
  const lowerBetter = course.win_condition === 'distance';
  const best = new Map();
  for (const e of entries || []) {
    if (!raceMatchesCourse(e, course)) continue;
    if (start && !(e.date >= start && e.date < end)) continue;
    for (const part of e.participants || []) {
      if (part.isGhost) continue;
      const v = lowerBetter ? part.final_time_s : part.final_distance_m;
      if (!Number.isFinite(v) || v <= 0) continue;
      const cur = best.get(part.userId);
      const attempts = (cur?.attempts || 0) + 1;
      const beats = !cur
        || (lowerBetter ? v < cur.bestValue : v > cur.bestValue)
        || (v === cur.bestValue && String(e.id) < String(cur.raceId));
      best.set(part.userId, beats
        ? { userId: part.userId, bestValue: v, raceId: e.id, attempts }
        : { ...cur, attempts });
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.bestValue !== b.bestValue) return lowerBetter ? a.bestValue - b.bestValue : b.bestValue - a.bestValue;
    return String(a.raceId).localeCompare(String(b.raceId));
  });
}

export function computeLadder({ course, entries, weekStart, weekEnd }) {
  const standings = bestByRider(entries, course, { start: weekStart, end: weekEnd });
  const top = bestByRider(entries, course)[0] || null;
  return {
    course,
    week: { start: weekStart, end: weekEnd },
    standings,
    allTimeRecord: top
      ? { userId: top.userId, bestValue: top.bestValue, raceId: top.raceId, date: dateFromRaceId(top.raceId) }
      : null
  };
}

export function computePersonalBest({ entries, course, userId }) {
  const mine = bestByRider(entries, course).find((r) => r.userId === userId) || null;
  return {
    userId,
    courseId: course.id,
    best: mine
      ? { bestValue: mine.bestValue, raceId: mine.raceId, date: dateFromRaceId(mine.raceId) }
      : null
  };
}
