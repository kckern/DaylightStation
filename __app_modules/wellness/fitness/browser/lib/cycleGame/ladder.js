/** Pure helpers for the weekly featured-course ladder. */

/** Featured course → the override shape CycleGameContainer.startRace consumes. */
export function courseStartOverride(course = {}) {
  const time = course.win_condition === 'time';
  return {
    id: course.id,
    win_condition: course.win_condition,
    goal_m: time ? null : (course.goal_m ?? null),
    time_cap_s: time ? (course.time_cap_s ?? null) : null
  };
}

/**
 * Which past race to arm as the rival ghost: the week's high score. Every rider
 * but the leader chases the top rung, ranked or not; the leader chases their own
 * PB (raceId resolved separately via the PB endpoint).
 */
export function pickRival({ standings = [], riderId = null } = {}) {
  if (!standings.length) return { kind: 'none', raceId: null, rivalUserId: null };
  const top = standings[0];
  if (riderId && top.userId === riderId) return { kind: 'self-pb', raceId: null, rivalUserId: riderId };
  return { kind: 'leader', raceId: top.raceId, rivalUserId: top.userId };
}

/** A rider's movement between two ladder snapshots. null if not on the new ladder. */
export function ladderDelta({ before = [], after = [], userId } = {}) {
  const idx = after.findIndex((r) => r.userId === userId);
  if (idx < 0) return null;
  const prevIdx = before.findIndex((r) => r.userId === userId);
  const above = idx > 0 ? after[idx - 1] : null;
  return {
    rank: idx + 1,
    prevRank: prevIdx >= 0 ? prevIdx + 1 : null,
    movedUp: prevIdx >= 0 && idx < prevIdx,
    isLead: idx === 0,
    aboveUserId: above ? above.userId : null,
    gapToAbove: above ? Math.abs(after[idx].bestValue - above.bestValue) : null
  };
}

/** Whole days until the exclusive week-end date ('YYYY-MM-DD'), min 0. */
export function daysLeft(endYmd, now = new Date()) {
  const [y, m, d] = String(endYmd).split('-').map(Number);
  const end = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((end - today) / 86400000));
}
