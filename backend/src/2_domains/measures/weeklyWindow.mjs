/**
 * The school week, as a measure window.
 *
 * Monday 04:00 → the following Monday 04:00 local, on the SAME 4am study-day boundary
 * school already uses (`domains/school/timing.mjs#studyDate`). One definition
 * of "day" in the house, not two.
 *
 * Monday is the hard weekly reset. Saturday and Sunday remain in the week that
 * began six/five days earlier; nothing changes buckets merely because a
 * rolling seven-day window moved forward by one day.
 *
 * Pure: the caller injects `now`. No clock is read here, so a preview and a
 * printed figure cannot disagree about which week they are describing.
 */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in the given IANA zone, for an absolute instant. */
function localDay(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Local wall-clock hour (0-23) in the given zone. */
function localHour(instant, timezone) {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', hour12: false,
  }).formatToParts(instant).find((p) => p.type === 'hour')?.value;
  return Number(h);
}

/** ISO weekday 0=Sun … 6=Sat for a `YYYY-MM-DD`. */
function weekdayOf(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)
  .toISOString().slice(0, 10);

/**
 * The study day an instant belongs to: the local date, shifted back by the 4am
 * boundary. A workout at 01:00 Monday belongs to Sunday, which is how the rest
 * of School already reasons and why a late-night session lands in the day it
 * felt like.
 */
export function studyDayFor(instant, { timezone = 'UTC', boundaryHour = 4 } = {}) {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  const day = localDay(at, timezone);
  return localHour(at, timezone) < boundaryHour ? addDays(day, -1) : day;
}

/**
 * The Monday→Sunday window containing `day`.
 *
 * @param {string} day `YYYY-MM-DD`, already a STUDY day (see studyDayFor)
 * @returns {{from: string, to: string}} inclusive study-day bounds
 */
export function weekWindowFor(day) {
  const back = (weekdayOf(day) + 6) % 7; // Monday 0 … Sunday 6
  const from = addDays(day, -back);
  return { from, to: addDays(from, 6) };
}

/** Is this study day inside the window? Both bounds inclusive. */
export function isInWindow(day, { from, to }) {
  return typeof day === 'string' && day >= from && day <= to;
}

/**
 * What the week currently is, relative to a target.
 *
 * v1 renders none of these — the board shows only a number. They are derived
 * anyway because this is the vocabulary the eventual gate needs, and adding it
 * later would mean revisiting every layer above. `target` of null (no quota
 * configured, which is every learner today) yields `untargeted` rather than a
 * fake verdict.
 */
export function weekState({ value = 0, target = null, day, window: win } = {}) {
  if (target == null) return 'untargeted';
  if (value >= target) return 'met';
  // Friday is the deadline. Saturday and Sunday are catch-up days; before
  // Friday closes, being short is not yet "behind".
  const friday = addDays(win.from, 4);
  return day > friday ? 'behind' : 'on_track';
}

export default weekWindowFor;
