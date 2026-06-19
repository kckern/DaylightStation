/**
 * Eink wake scheduling — pure functions that decide when a battery panel should
 * next wake itself.
 * @module 3_applications/eink/wakeSchedule
 *
 * A deep-sleeping panel has its radio off, so the server cannot push a wake. The
 * panel instead asks "when should I wake next?" on every pull: the /panel
 * response carries an X-Eink-Next-Wake header (seconds) that the firmware loads
 * into its RTC timer before sleeping. That moves the whole schedule server-side
 * — editing cadence is a SSOT edit + redeploy, never a reflash.
 *
 * The schedule is expressed in LOCAL time (the panel has no clock of its own;
 * the server is the timekeeper). A `refresh.schedule` is a list of time-of-day
 * windows; whichever contains "now" sets the cadence. With no schedule we fall
 * back to the flat `refresh.interval`. Results are clamped to a sane band so a
 * malformed SSOT can never brick the panel into a hot loop or a half-year sleep.
 */

const MIN_WAKE_SEC = 60;          // never hammer the server faster than once a minute
const MAX_WAKE_SEC = 24 * 3600;   // and never sleep past a day (always re-check the schedule)
const DEFAULT_WAKE_SEC = 30 * 60; // 30 min — matches the firmware's compiled fallback

/**
 * Parse a human duration ("15min", "4h", "30s", or a bare number = minutes) to
 * seconds. Returns `fallback` for null/unparseable input.
 * @param {string|number|null|undefined} v
 * @param {number|null} [fallback]
 * @returns {number|null}
 */
export function parseDurationSeconds(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 60); // bare number = minutes
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/i);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'min').toLowerCase();
  if (unit[0] === 's') return Math.round(n);
  if (unit[0] === 'h') return Math.round(n * 3600);
  return Math.round(n * 60); // minutes
}

/** Parse "HH:MM" (24h) to seconds-of-day, or null if malformed. */
function parseTimeOfDaySeconds(s) {
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 3600 + min * 60;
}

/**
 * Seconds the panel should sleep before its next timer wake, given the SSOT's
 * `refresh` block and the current local time.
 *
 * - With a `schedule` (list of {from,to,every}): the window containing `now`
 *   sets the cadence. The result is also clamped so the panel never sleeps PAST
 *   the end of its window — at 21:58 in a "06:00–22:00 every 15min" window it
 *   wakes at 22:00 and picks up the overnight cadence on that next wake, rather
 *   than overshooting to 22:13.
 * - With no schedule: the flat `interval`.
 * - With neither / anything malformed: a safe 30-minute default.
 *
 * @param {Object} [refresh] - the screen's `refresh` config block
 * @param {Date} [now]
 * @returns {number} seconds in [60, 86400]
 */
export function computeNextWakeSeconds(refresh = {}, now = new Date()) {
  const clamp = (s) => Math.max(MIN_WAKE_SEC, Math.min(MAX_WAKE_SEC, Math.round(s)));
  const fallback = parseDurationSeconds(refresh?.interval, DEFAULT_WAKE_SEC) ?? DEFAULT_WAKE_SEC;

  const schedule = Array.isArray(refresh?.schedule) ? refresh.schedule : null;
  if (!schedule || !schedule.length) return clamp(fallback);

  const sod = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  for (const w of schedule) {
    const from = parseTimeOfDaySeconds(w?.from);
    const to = parseTimeOfDaySeconds(w?.to);
    const every = parseDurationSeconds(w?.every, null);
    if (from == null || to == null || every == null) continue;

    // from<=to: a same-day window. from>to: wraps midnight (e.g. 22:00–06:00).
    const inWindow = from <= to ? (sod >= from && sod < to) : (sod >= from || sod < to);
    if (!inWindow) continue;

    let untilEnd = (((to - sod) % 86400) + 86400) % 86400; // seconds to window end
    if (untilEnd === 0) untilEnd = 86400;
    return clamp(Math.min(every, untilEnd));
  }

  // No window matched (a schedule with gaps) -> flat interval fallback.
  return clamp(fallback);
}

export default computeNextWakeSeconds;
