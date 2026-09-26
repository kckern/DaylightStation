// earningsModel.js — pure view helpers for the Coins panels (weekly earnings
// preview). No fetching, no React: the panels render what these return.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const at = (day) => new Date(`${day}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => iso(new Date(at(day).getTime() + n * 86_400_000));

/** The seven study days of the week starting `from` (a Monday). */
export function weekDays(from) {
  return Array.from({ length: 7 }, (_, i) => addDays(from, i));
}

/** The Monday `n` weeks away. */
export function shiftWeek(from, n) {
  return addDays(from, 7 * n);
}

/** "Mon 21" */
export function dayLabel(day) {
  const d = at(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** "Sep 21 – 27", or "Sep 28 – Oct 4" across a month. */
export function weekLabel({ from, to }) {
  const a = at(from);
  const b = at(to);
  const left = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}`;
  const right = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
  return `${left} – ${right}`;
}

/**
 * The week's work as a grid: a day-verdict row, then one row per subject
 * (alphabetical), one cell per study day. A cell with nothing asked is null.
 */
export function workGrid(work, from) {
  const days = weekDays(from);
  const byDay = new Map((work?.days ?? []).map((d) => [d.day, d]));
  const dayRow = days.map((day) => ({ day, state: byDay.get(day)?.state ?? null, reason: byDay.get(day)?.reason ?? null }));
  const subjects = [...new Set((work?.sectionDays ?? []).map((s) => s.subject))].sort();
  return {
    days,
    dayRow,
    subjects: subjects.map((subject) => {
      const cells = new Map((work.sectionDays ?? []).filter((s) => s.subject === subject).map((s) => [s.day, s]));
      return { subject, cells: days.map((day) => ({ day, state: cells.get(day)?.state ?? null, reason: cells.get(day)?.reason ?? null })) };
    }),
  };
}

const STATUS_TEXT = {
  earned: 'Earned',
  pending: 'Pending',
  indeterminate: 'Can’t tell yet',
  none: 'Not this week',
  disabled: 'Off',
};

export function statusText(status) {
  return STATUS_TEXT[status] ?? status;
}

const ONCE = new Set(['section-week', 'week-met', 'ring-contest']);

/** What the inline rate field edits for a line, and how to label its unit. */
export function editableRate(line) {
  if (line.kind === 'ring-threshold') {
    const rate = line.priced?.rate ?? { rings: 1, silver: 0 };
    return { field: 'rate', silver: rate.silver, unit: `per ${rate.rings} ring${rate.rings === 1 ? '' : 's'}` };
  }
  return { field: 'reward', silver: line.priced?.reward?.silver ?? 0, unit: ONCE.has(line.kind) ? 'once' : 'each' };
}

/** The per-learner override that sets this line's silver, keeping what it does not edit. */
export function ratePatch(line, silver) {
  if (line.kind === 'ring-threshold') {
    const rate = line.priced?.rate ?? { rings: 1, silver: 0 };
    return { rules: { [line.ruleId]: { rate: { rings: rate.rings, silver } } } };
  }
  return { rules: { [line.ruleId]: { reward: { silver, gems: line.priced?.reward?.gems ?? 0 } } } };
}
