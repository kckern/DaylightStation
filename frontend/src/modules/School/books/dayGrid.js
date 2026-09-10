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

import {
  WEEKDAY_LABELS, WEEKDAY_NAMES, MONTH_NAMES, DAY_MS,
  parseKey, formatKey, isoWeekday, monthLabel, dayLabel,
} from '../shared/dayGrid/dayGridModel.js';

// The key arithmetic is the SHARED grid's (`shared/dayGrid/dayGridModel.js`),
// re-exported so the picker's callers keep their imports. One `isoWeekday`,
// one `parseKey`: the picker, the streak wall and the term grid cannot
// disagree about which day a Sunday is.
export {
  WEEKDAY_LABELS, WEEKDAY_NAMES, MONTH_NAMES, DAY_MS,
  parseKey, formatKey, isoWeekday, monthLabel, dayLabel,
};

const LOOKBACK_DAYS = 20;

/**
 * Rows of seven cells, Monday first, from the Monday on or before
 * `window end − 20 days` through the window end. The default window ends
 * today; `offsetDays` moves it into the past. Later cells are `null`.
 *
 * `minDay` blanks the OTHER end, and it is `null` in exactly the same way a
 * future cell is: the server refuses a finish dated before its backdate floor
 * (`earliestFinishDay` on the shelf view), and a grid that still drew those
 * days would invite a child to tap one and be told no. Absent or unreadable,
 * there is no floor — a server that said nothing must not silently shrink the
 * window a child has always had.
 *
 * @param {string} todayKey - `YYYY-MM-DD`; the caller's clock, never ours.
 * @param {{offsetDays?: number, minDay?: string|null}} [options] - move the
 *   rolling window into the past without changing which day is the real
 *   `today`; `minDay` is the oldest selectable day.
 * @returns {Array<Array<{key: string, day: number, weekday: number, monthStart: boolean, isToday: boolean} | null>>}
 */
export function buildDayGrid(todayKey, { offsetDays = 0, minDay = null } = {}) {
  const todayMs = parseKey(todayKey);
  const safeOffset = Number.isInteger(offsetDays) && offsetDays > 0 ? offsetDays : 0;
  const endMs = todayMs - safeOffset * DAY_MS;
  const lookbackMs = endMs - LOOKBACK_DAYS * DAY_MS;
  const startMs = lookbackMs - (isoWeekday(lookbackMs) - 1) * DAY_MS;
  // Tolerated, not thrown: `minDay` arrives over the wire, and a malformed one
  // must not take down the control a child needs. `parseKey` throws, so this is
  // the one place in this module that catches.
  let minMs = null;
  if (typeof minDay === 'string' && minDay) {
    try { minMs = parseKey(minDay); } catch { minMs = null; }
  }

  const rows = [];
  for (let rowStart = startMs; rowStart <= endMs; rowStart += 7 * DAY_MS) {
    const row = [];
    for (let i = 0; i < 7; i += 1) {
      const ms = rowStart + i * DAY_MS;
      if (ms > endMs) { row.push(null); continue; }
      if (minMs !== null && ms < minMs) { row.push(null); continue; }
      const day = new Date(ms).getUTCDate();
      row.push({
        key: formatKey(ms),
        day,
        weekday: i + 1,
        monthStart: day === 1,
        isToday: ms === todayMs,
      });
    }
    // A row with nothing selectable on it is not a row. Before `minDay` only
    // TRAILING cells were ever null, so every row was guaranteed a real cell
    // and DayPicker keys each row off `row.find(Boolean).key`. A floor can
    // blank a whole leading week, which made that read `undefined.key`. Dropping
    // the row keeps that contract true instead of pushing the guard onto every
    // consumer — and with no `minDay` this cannot fire, since `rowStart <= endMs`
    // already guarantees the row's first cell.
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}
