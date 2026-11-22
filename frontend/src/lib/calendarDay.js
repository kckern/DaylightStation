/** A timestamp's local calendar date, in YYYY-MM-DD form. */
export function localDateKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Shift a YYYY-MM-DD calendar key without applying the browser's time zone. */
export function addCalendarDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The calendar week containing an ISO day, aligned to Sunday (0) through Saturday (6). */
export function startOfCalendarWeek(isoDate, weekStartsOn = 0) {
  const firstDay = Number.isInteger(weekStartsOn) && weekStartsOn >= 0 && weekStartsOn <= 6 ? weekStartsOn : 0;
  const date = new Date(`${isoDate}T12:00:00Z`);
  const offset = (date.getUTCDay() - firstDay + 7) % 7;
  return addCalendarDays(isoDate, -offset);
}
