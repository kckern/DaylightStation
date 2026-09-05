/**
 * dayGrid — the arithmetic behind the reading shelf's "when did you finish
 * it?" control (books/DayPicker.jsx).
 *
 * Not a calendar. A calendar grid is laid out for an adult finding a date; a
 * child remembers "it was Saturday" and works forward from there. So the
 * weekday is the headline, the date of the month is the small print, and a
 * row NEVER breaks at a month boundary — the 31st and the 1st sit side by
 * side and the month is a footnote on the cell where it changes.
 *
 * Shape: rows of seven, Monday first (ISO, matching schoolCalendar), starting
 * on the Monday on or before `window end − 20 days` so at least three full
 * weeks show. The default window ends today; `offsetDays` pages it backward.
 * Cells after the window end are `null` rather than greyed.
 *
 * Pure. Every date is a `YYYY-MM-DD` key and all arithmetic is UTC on those
 * keys; nothing here reads the clock or the machine's locale. `today` is
 * always the caller's, which is what makes the verified literals in the test
 * hold on any machine in any timezone.
 */

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 20;

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

/**
 * Rows of seven cells, Monday first, from the Monday on or before
 * `window end − 20 days` through the window end. The default window ends
 * today; `offsetDays` moves it into the past. Later cells are `null`.
 *
 * @param {string} todayKey - `YYYY-MM-DD`; the caller's clock, never ours.
 * @param {{offsetDays?: number}} [options] - move the rolling window into the
 *   past without changing which day is the real `today`.
 * @returns {Array<Array<{key: string, day: number, weekday: number, monthStart: boolean, isToday: boolean} | null>>}
 */
export function buildDayGrid(todayKey, { offsetDays = 0 } = {}) {
  const todayMs = parseKey(todayKey);
  const safeOffset = Number.isInteger(offsetDays) && offsetDays > 0 ? offsetDays : 0;
  const endMs = todayMs - safeOffset * DAY_MS;
  const lookbackMs = endMs - LOOKBACK_DAYS * DAY_MS;
  const startMs = lookbackMs - (isoWeekday(lookbackMs) - 1) * DAY_MS;

  const rows = [];
  for (let rowStart = startMs; rowStart <= endMs; rowStart += 7 * DAY_MS) {
    const row = [];
    for (let i = 0; i < 7; i += 1) {
      const ms = rowStart + i * DAY_MS;
      if (ms > endMs) { row.push(null); continue; }
      const day = new Date(ms).getUTCDate();
      row.push({
        key: formatKey(ms),
        day,
        weekday: i + 1,
        monthStart: day === 1,
        isToday: ms === todayMs,
      });
    }
    rows.push(row);
  }
  return rows;
}
