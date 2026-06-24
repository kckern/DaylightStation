// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.js
//
// Pure momentum computation for the fitness home Momentum widget. No DOM, no
// fetch — a function of (sessions, roster, opts). "This week" is a ROLLING 7-day
// window ending `now`; a streak is the run of consecutive calendar days ending
// today (or yesterday, so an un-worked-out today doesn't break a live streak).

const DAY_MS = 86_400_000;
const DEFAULT_GOAL_MIN = 150;

/** Shift a 'YYYY-MM-DD' day string by `delta` days (UTC-safe date arithmetic). */
export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Length of the consecutive-day run in `dateSet` ending today, or yesterday. */
function streakDays(dateSet, todayStr) {
  if (!dateSet || dateSet.size === 0) return 0;
  let cursor;
  if (dateSet.has(todayStr)) cursor = todayStr;
  else if (dateSet.has(addDays(todayStr, -1))) cursor = addDays(todayStr, -1);
  else return 0;
  let count = 0;
  while (dateSet.has(cursor)) { count += 1; cursor = addDays(cursor, -1); }
  return count;
}

/**
 * @param {Array} sessions - fitness sessions ({ date, durationMs, startTime, participants })
 * @param {Array} roster   - [{ id, name }] family members (display order preserved)
 * @param {object} [opts]
 * @param {number} [opts.now=Date.now()] - rolling-window anchor (epoch ms)
 * @param {string} [opts.todayStr]       - today's local 'YYYY-MM-DD' (defaults from now, UTC)
 * @param {number} [opts.goalMinutes=150]- per-person weekly active-minute goal
 * @param {string} [opts.householdLabel] - team headline label
 * @returns {{ household: object, members: object[] }}
 */
export function computeMomentum(sessions, roster, opts = {}) {
  const now = opts.now ?? Date.now();
  const todayStr = opts.todayStr ?? new Date(now).toISOString().slice(0, 10);
  const goalMinutes = opts.goalMinutes ?? DEFAULT_GOAL_MIN;
  const householdLabel = opts.householdLabel || 'Your household';
  const list = Array.isArray(sessions) ? sessions : [];
  const members = Array.isArray(roster) ? roster : [];
  const weekCutoff = now - 7 * DAY_MS;

  const minutesByUser = new Map(); // id -> minutes in last 7d
  const datesByUser = new Map();   // id -> Set('YYYY-MM-DD') over all history
  const householdDates = new Set();

  for (const s of list) {
    const mins = (s.durationMs || 0) / 60000;
    const inWeek = (s.startTime ?? 0) >= weekCutoff;
    const day = s.date;
    const userIds = s.participants ? Object.keys(s.participants) : [];
    for (const uid of userIds) {
      if (inWeek) minutesByUser.set(uid, (minutesByUser.get(uid) || 0) + mins);
      if (day) {
        if (!datesByUser.has(uid)) datesByUser.set(uid, new Set());
        datesByUser.get(uid).add(day);
      }
    }
    if (day && userIds.length) householdDates.add(day);
  }

  const memberRows = members.map((m) => {
    const activeMinutes = Math.round(minutesByUser.get(m.id) || 0);
    const pct = goalMinutes > 0 ? Math.min(1, activeMinutes / goalMinutes) : 0;
    return {
      id: m.id,
      name: m.name || m.id,
      avatarId: m.id,
      activeMinutes,
      goalMinutes,
      pct,
      met: activeMinutes >= goalMinutes,
      streakDays: streakDays(datesByUser.get(m.id), todayStr),
    };
  });

  const householdMinutes = memberRows.reduce((sum, r) => sum + r.activeMinutes, 0);
  const householdGoal = memberRows.length * goalMinutes;
  const household = {
    label: householdLabel,
    activeMinutes: householdMinutes,
    goalMinutes: householdGoal,
    pct: householdGoal > 0 ? Math.min(1, householdMinutes / householdGoal) : 0,
    met: householdGoal > 0 && householdMinutes >= householdGoal,
    streakDays: streakDays(householdDates, todayStr),
  };

  return { household, members: memberRows };
}
