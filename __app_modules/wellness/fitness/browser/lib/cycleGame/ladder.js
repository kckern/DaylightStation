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
 * The weekly-course ghost "Ride it" always arms (owner, 2026-11-11 — never
 * behind the "Race my best" switch):
 * - the week's leader, when the leader is not on a bike ('leader');
 * - the leader is riding: the best run this week by anyone not riding
 *   ('best-not-riding');
 * - everyone on the ladder is riding: the leader's own week-best run, as a ghost
 *   ('leader-own-record');
 * - no runs this week: no ghost ('none').
 * Rungs without a raceId cannot be replayed and are skipped.
 */
export function pickRival({ standings = [], riderIds = [] } = {}) {
  const riding = new Set((riderIds || []).filter(Boolean));
  const rows = (standings || []).filter((r) => r?.userId && r.raceId);
  if (!rows.length) return { kind: 'none', raceId: null, rivalUserId: null };
  const idx = rows.findIndex((r) => !riding.has(r.userId));
  if (idx < 0) return { kind: 'leader-own-record', raceId: rows[0].raceId, rivalUserId: rows[0].userId };
  const pick = rows[idx];
  const kind = pick === standings[0] ? 'leader' : 'best-not-riding';
  return { kind, raceId: pick.raceId, rivalUserId: pick.userId };
}

/**
 * The rival's own line from a race-record candidate: their best run may have
 * been ridden alongside others (or against a ghost), and only they race on the
 * weekly course. null when the record has no line for them.
 */
export function onlyParticipant(candidate, userId) {
  if (!candidate || !userId) return null;
  const mine = (candidate.participants || []).filter((p) => p.id === userId);
  if (!mine.length) return null;
  return { ...candidate, participants: mine, winnerName: mine[0].displayName || candidate.winnerName };
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
