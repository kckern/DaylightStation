/**
 * Wall-clock "HH:MM → HH:MM" windows, shared by the kiosk's time-of-day rules
 * (screensaver quiet hours, curfew). Pure: the caller supplies `now`.
 *
 * Windows are read on the HOUSEHOLD clock, not the tablet's. On 2026-10-09 the
 * piano tablet's Android timezone was changed to America/Chicago from Settings;
 * the device clock ran two hours ahead of the house, curfew began at 17:00
 * Pacific and closed a child's lesson. The kiosk config carries the household
 * IANA zone (served by the backend) and every caller passes it through here.
 */

// One formatter per zone: the curfew hook polls every 30s and the screensaver
// on every MIDI note, so don't rebuild Intl state each call. `null` caches an
// invalid zone so a bad value costs one RangeError, not one per note.
const formatters = new Map();

function formatterFor(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return null;
  if (formatters.has(timeZone)) return formatters.get(timeZone);
  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    fmt = null; // RangeError: not an IANA zone this runtime knows
  }
  formatters.set(timeZone, fmt);
  return fmt;
}

/**
 * Minutes since midnight of `now` on the wall clock of `timeZone`. A missing
 * or invalid zone falls back to the device's local time — fail-open, the
 * behaviour before household zones existed — rather than throwing.
 *
 * @param {Date} now
 * @param {string} [timeZone] IANA zone, e.g. 'America/Los_Angeles'
 * @returns {number}
 */
export function wallClockMinutes(now, timeZone) {
  const fmt = formatterFor(timeZone);
  if (fmt) {
    let hour = null;
    let minute = null;
    for (const part of fmt.formatToParts(now)) {
      if (part.type === 'hour') hour = Number(part.value);
      else if (part.type === 'minute') minute = Number(part.value);
    }
    // Some engines still render midnight as "24" despite h23.
    if (Number.isFinite(hour) && Number.isFinite(minute)) return (hour % 24) * 60 + minute;
  }
  return now.getHours() * 60 + now.getMinutes();
}

/** Parse "HH:MM" → minutes-since-midnight, or null if malformed. */
export function parseHHMM(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `now` inside the window? Supports overnight ranges where start > end
 * (e.g. 19:00 → 06:00). Start is inclusive, end exclusive. Returns false when
 * the window is unset or malformed (fail-open: the rule simply doesn't apply,
 * rather than applying all day).
 *
 * @param {Date} now
 * @param {{start?: string, end?: string}|null} window
 * @param {string} [timeZone] household IANA zone; device-local when absent/invalid
 * @returns {boolean}
 */
export function isWithinWindow(now, window, timeZone) {
  if (!window) return false;
  const start = parseHHMM(window.start);
  const end = parseHHMM(window.end);
  if (start == null || end == null || start === end) return false;
  const cur = wallClockMinutes(now, timeZone);
  return start < end
    ? cur >= start && cur < end // same-day window
    : cur >= start || cur < end; // overnight window
}

export default isWithinWindow;
