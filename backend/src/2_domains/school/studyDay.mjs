import { studyDayIndex } from './language/rollover.mjs';

export { studyDayIndex };

/**
 * Local UTC offset for an instant, in minutes.
 *
 * Computed per call rather than once at boot because the offset is not a
 * constant: a household on a DST-observing timezone would drift by an hour
 * twice a year, and a 4am study-day boundary computed with a stale offset
 * rolls the day at 3am or 5am — silently handing out tomorrow's sentences
 * early, or refusing them for an hour.
 */
export function offsetMinutesFor(timezone, epochMs) {
  if (!timezone) return 0;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]),
    );
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    return Math.round((asUTC - epochMs) / 60000);
  } catch {
    return 0;
  }
}

const DAY_MS = 86_400_000;
const STUDY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar key for the study day containing an instant. */
export function studyDayForInstant(epochMs, { timezone = null, boundaryHour = 4 } = {}) {
  if (!Number.isFinite(epochMs)) return null;
  const offsetMinutes = offsetMinutesFor(timezone, epochMs);
  return new Date(epochMs + offsetMinutes * 60_000 - boundaryHour * 3_600_000)
    .toISOString().slice(0, 10);
}

/**
 * Resolve an explicit local study-day key to its real UTC interval. The offset
 * is resolved at the boundary itself (and checked once more) so DST changes do
 * not make a selected historical day borrow an hour from its neighbour.
 */
export function studyDayWindowForDate(studyDay, { timezone = null, boundaryHour = 4 } = {}) {
  const midnight = Date.parse(`${studyDay}T00:00:00.000Z`);
  if (!STUDY_DAY_RE.test(studyDay ?? '') || !Number.isFinite(midnight)
      || new Date(midnight).toISOString().slice(0, 10) !== studyDay) return null;
  const localBoundary = midnight + boundaryHour * 3_600_000;
  let startAtMs = localBoundary - offsetMinutesFor(timezone, localBoundary) * 60_000;
  startAtMs = localBoundary - offsetMinutesFor(timezone, startAtMs) * 60_000;
  const nextLocalBoundary = localBoundary + DAY_MS;
  let endAtMs = nextLocalBoundary - offsetMinutesFor(timezone, nextLocalBoundary) * 60_000;
  endAtMs = nextLocalBoundary - offsetMinutesFor(timezone, endAtMs) * 60_000;
  return { studyDay, startAtMs, endAtMs };
}

/**
 * The current study day as a window of real UTC instants, `[startAtMs,
 * endAtMs)`. The household's UTC offset is resolved ONCE, at `nowMs`, and
 * held constant across the window — matching the documented DST caveat above
 * (a boundary computed with a stale offset can drift by an hour around a
 * transition); a window that straddled a DST change would need the offset
 * re-resolved per edge, which no current consumer does.
 *
 * One copy of this math, here, on purpose: `GetTeacherToday`'s digest and
 * the lifecycle sessions `?window=today` filter must never disagree about
 * what "today" means.
 */
export function studyDayWindow(nowMs, { timezone = null, boundaryHour = 4 } = {}) {
  const offsetMinutes = offsetMinutesFor(timezone, nowMs);
  const localMs = nowMs + offsetMinutes * 60_000;
  const boundaryMs = boundaryHour * 3_600_000;
  // The local calendar day the boundary-shifted instant falls on, as a whole
  // multiple of DAY_MS — floor, not round, so we always land on the most
  // recent boundary crossing at or before "now".
  const dayIndex = Math.floor((localMs - boundaryMs) / DAY_MS);
  const startLocalMs = dayIndex * DAY_MS + boundaryMs;
  const startAtMs = startLocalMs - offsetMinutes * 60_000;
  return { startAtMs, endAtMs: startAtMs + DAY_MS };
}

/** Whether an ISO timestamp falls inside `[startAtMs, endAtMs)`. */
export function withinStudyWindow(iso, { startAtMs, endAtMs }) {
  if (typeof iso !== 'string') return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= startAtMs && t < endAtMs;
}

/**
 * Same 4am→4am study day, offset computed per instant so DST transitions
 * cannot split the pair. Invalid input is "not the same day", never a throw:
 * a bad timestamp must not take the agenda down.
 */
export function isSameStudyDay(aMs, bMs, { timezone = null, boundaryHour = 4 } = {}) {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  const dayA = studyDayIndex(aMs, { boundaryHour, offsetMinutes: offsetMinutesFor(timezone, aMs) });
  const dayB = studyDayIndex(bMs, { boundaryHour, offsetMinutes: offsetMinutesFor(timezone, bMs) });
  return dayA === dayB;
}
