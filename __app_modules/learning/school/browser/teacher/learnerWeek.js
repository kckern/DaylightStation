/**
 * A learner's week as a subject × day grid — the question "how did they do
 * this week" that no console screen answered (audit 2026-10-21). Built from
 * the same pure join the Day record uses, one day at a time, so a cell can
 * never disagree with the Day record it opens.
 *
 * Pure: no fetching, no React. `WeekGrid` owns the reads.
 */
import { joinLearnerDay } from "./learnerDay.js";

/** `count` ISO days ending on `endDay`, oldest first. Noon UTC keeps DST out of it. */
export function weekDays(endDay, count = 7) {
  const end = new Date(`${endDay}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(end); d.setUTCDate(end.getUTCDate() - (count - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

// When a subject has two rows on one day, the cell shows the least-finished:
// the grid answers "is anything left", and a done row must not hide an open one.
const RANK = { blocked: 0, planned: 1, deferred: 2, 'in-progress': 3, done: 4 };

/**
 * @param {{studyDay:string, sections:object[], sessions:object[], carriedOver?:object[], known:boolean}[]} days
 * @returns {{ totals: {studyDay, done, planned, known}[], subjects: {subject, cells}[] }}
 *
 * `planned` counts the rows the plan offered; work done off the plan shows in
 * its subject's cell but is not counted against the day. A subject the plan
 * left unassigned has no cell — "nothing to do" is not a state to colour.
 */
export function buildWeek(days) {
  const subjects = new Map();
  const totals = days.map((day) => {
    const joined = joinLearnerDay({
      sections: day.sections ?? [], sessions: day.sessions ?? [], carriedOver: day.carriedOver ?? [], studyDay: day.studyDay,
    });
    const rows = joined.rows.filter((row) => row.status !== 'unassigned');
    for (const row of rows) {
      const key = row.subject ?? null;
      if (!subjects.has(key)) subjects.set(key, {});
      const cells = subjects.get(key);
      const current = cells[day.studyDay];
      if (!current || (RANK[row.status] ?? 1) < (RANK[current.status] ?? 1)) {
        cells[day.studyDay] = { status: row.status, percent: row.session?.effectiveScore?.percent ?? null };
      }
    }
    const planned = rows.filter((row) => !row.unplanned);
    return {
      studyDay: day.studyDay,
      done: planned.filter((row) => row.status === 'done').length,
      planned: planned.length,
      known: day.known !== false,
    };
  });
  return { totals, subjects: [...subjects.entries()].map(([subject, cells]) => ({ subject, cells })) };
}
