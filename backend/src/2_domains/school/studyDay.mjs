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
