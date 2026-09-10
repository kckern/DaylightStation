/**
 * dayGridModel — the arithmetic behind every "days as squares" surface in
 * School: the reading streak wall (weeks as rows, a month deep), the status
 * board's term grid (weeks as columns, a term wide) and the shelf's
 * "when did you finish it?" picker.
 *
 * ONE CONCEPT, TWO ORIENTATIONS. A streak wall and a contribution graph are
 * the same object — a Monday-first week of cells, repeated — turned ninety
 * degrees. Keeping one layout function means the two can never disagree about
 * which column a Saturday is in, or whether a week starts on Sunday.
 *
 * Pure. Every date is a `YYYY-MM-DD` key and all arithmetic is UTC on those
 * keys; nothing here reads the clock or the machine's locale. `todayKey` is
 * always the caller's, which is what makes the verified literals in the test
 * hold on any machine in any timezone.
 *
 * JUDGING STAYS OUTSIDE. A cell carries whatever `state` its day row came
 * with; this module never compares a count to a target. The vocabulary the
 * hosts share:
 *
 *   met      the obligation was met            green
 *   partial  some of it                         amber
 *   none     none of it                         grey
 *   exempt   the house / calendar said no work  blue   (term grid)
 *   rest     nobody asked (reading's word)      near-transparent
 *   unknown  cannot say — pending, a fault      hollow
 */

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DAY_STATES = Object.freeze(['met', 'partial', 'none', 'exempt', 'rest', 'unknown']);
export const ORIENTATIONS = Object.freeze(['weeks-as-rows', 'weeks-as-columns']);

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → UTC midnight in ms. Strict: anything else throws. */
export function parseKey(key) {
  const m = typeof key === 'string' ? KEY_RE.exec(key) : null;
  if (!m) throw new Error('day key must be YYYY-MM-DD');
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  // Reject 2026-02-31 and friends: a key that round-trips is a real day.
  if (formatKey(ms) !== key) throw new Error('day key must be YYYY-MM-DD');
  return ms;
}

/** UTC midnight in ms → `YYYY-MM-DD`. */
export function formatKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(ms) {
  return ((new Date(ms).getUTCDay() + 6) % 7) + 1;
}

/** `YYYY-MM-DD` shifted by `n` days. */
export function addDays(key, n) {
  return formatKey(parseKey(key) + n * DAY_MS);
}

/** The Monday on or before `key` — the week's id everywhere in School. */
export function weekStart(key) {
  const ms = parseKey(key);
  return formatKey(ms - (isoWeekday(ms) - 1) * DAY_MS);
}

/** `Jan` … `Dec` for a key. */
export function monthLabel(key) {
  return MONTH_NAMES[new Date(parseKey(key)).getUTCMonth()].slice(0, 3);
}

/** `Saturday 30 August` — the words a cell says for itself. */
export function dayLabel(key) {
  const ms = parseKey(key);
  const d = new Date(ms);
  return `${WEEKDAY_NAMES[isoWeekday(ms) - 1]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/** `Sep 9` — the short form, for a tooltip. */
export function shortDayLabel(key) {
  try {
    const d = new Date(parseKey(key));
    return `${monthLabel(key)} ${d.getUTCDate()}`;
  } catch {
    return String(key ?? '');
  }
}

/**
 * Lay a list of day rows out as a rectangular, Monday-first grid.
 *
 * `days` is any order, one row per study day: `{studyDay, state, count?}`.
 * The grid spans from the Monday of `from`'s week to the Sunday of `to`'s
 * week; `from`/`to` default to the earliest and latest day given. A position
 * inside the span but outside `[from, to]` is `null` — a placeholder that
 * keeps the rectangle — and a day inside `[from, to]` with no row is drawn
 * `unknown` (nothing has said what happened on it).
 *
 * @param {Array<{studyDay: string, state?: string, count?: number}>} days
 * @param {{orientation?: 'weeks-as-rows'|'weeks-as-columns', from?: string|null,
 *          to?: string|null, todayKey?: string|null}} [options]
 * @returns {{cells: Array<object|null>, rows: number, cols: number, weekIds: string[],
 *            from: string|null, to: string|null}}
 *   `cells` is row-major: index = row * cols + col. Each cell:
 *   `{studyDay, row, col, weekday, weekId, state, count, today}`.
 */
export function layoutDayGrid(days, { orientation = 'weeks-as-rows', from = null, to = null, todayKey = null } = {}) {
  if (!ORIENTATIONS.includes(orientation)) throw new Error(`unknown orientation: ${orientation}`);
  const rowsByDay = new Map();
  for (const row of Array.isArray(days) ? days : []) {
    if (!row || typeof row.studyDay !== 'string') continue;
    try { parseKey(row.studyDay); } catch { continue; }
    rowsByDay.set(row.studyDay, row);
  }
  const keys = [...rowsByDay.keys()].sort();
  const first = from ?? keys[0] ?? null;
  const last = to ?? keys.at(-1) ?? null;
  if (!first || !last || last < first) return { cells: [], rows: 0, cols: 0, weekIds: [], from: first, to: last };

  const gridStart = weekStart(first);
  const gridEnd = addDays(weekStart(last), 6);
  const weekCount = Math.round((parseKey(gridEnd) - parseKey(gridStart) + DAY_MS) / (7 * DAY_MS));
  const weeksAsRows = orientation === 'weeks-as-rows';
  const rows = weeksAsRows ? weekCount : 7;
  const cols = weeksAsRows ? 7 : weekCount;
  const cells = new Array(rows * cols).fill(null);
  const weekIds = [];

  for (let w = 0; w < weekCount; w += 1) {
    const weekId = addDays(gridStart, w * 7);
    weekIds.push(weekId);
    for (let d = 0; d < 7; d += 1) {
      const studyDay = addDays(weekId, d);
      if (studyDay < first || studyDay > last) continue;
      const row = weeksAsRows ? w : d;
      const col = weeksAsRows ? d : w;
      const source = rowsByDay.get(studyDay) ?? null;
      cells[row * cols + col] = {
        studyDay, row, col, weekday: d + 1, weekId,
        state: source?.state ?? 'unknown',
        count: Number.isFinite(source?.count) ? source.count : null,
        today: todayKey != null && studyDay === todayKey,
      };
    }
  }
  return { cells, rows, cols, weekIds, from: first, to: last };
}
