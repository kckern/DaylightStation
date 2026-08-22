/**
 * Wall-clock "HH:MM → HH:MM" windows, shared by the kiosk's time-of-day rules
 * (screensaver quiet hours, curfew). Pure: the caller supplies `now`.
 */

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
 * @returns {boolean}
 */
export function isWithinWindow(now, window) {
  if (!window) return false;
  const start = parseHHMM(window.start);
  const end = parseHHMM(window.end);
  if (start == null || end == null || start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? cur >= start && cur < end // same-day window
    : cur >= start || cur < end; // overnight window
}

export default isWithinWindow;
