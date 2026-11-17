/** Local calendar arithmetic with explicit instants; never reads the clock. */
import moment from 'moment-timezone';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
export function isLocalDate(value) { return typeof value === 'string' && DAY.test(value) && moment.utc(value, 'YYYY-MM-DD', true).isValid(); }
export function addDays(day, count) { return isLocalDate(day) ? moment.utc(day, 'YYYY-MM-DD', true).add(count, 'days').format('YYYY-MM-DD') : null; }
export function daysBetween(from, to) { return isLocalDate(from) && isLocalDate(to) ? moment.utc(to, 'YYYY-MM-DD', true).diff(moment.utc(from, 'YYYY-MM-DD', true), 'days') : NaN; }
export function localDateFor(asOf, timezone) {
  if (!Number.isFinite(asOf) || !moment.tz.zone(timezone)) throw new TypeError('A finite instant and valid timezone are required');
  return moment.tz(asOf, timezone).format('YYYY-MM-DD');
}
export function resolveDueDate({ text, entryDate, timezone }) {
  if (!isLocalDate(entryDate) || !moment.tz.zone(timezone) || typeof text !== 'string') return null;
  const value = text.trim().toLowerCase().replace(/^on\s+/, '');
  if (isLocalDate(value)) return value;
  if (value === 'today' || value === 'tonight') return entryDate;
  if (value === 'tomorrow') return addDays(entryDate, 1);
  const weekday = WEEKDAYS.indexOf(value.replace(/^next\s+/, ''));
  if (weekday < 0) return null;
  const today = moment.utc(entryDate, 'YYYY-MM-DD', true).day();
  return addDays(entryDate, (weekday - today + 7) % 7 || 7);
}
export function nextLocalTime({ asOf, timezone, hour, minute = 0, weekday = null }) {
  localDateFor(asOf, timezone);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59 || (weekday != null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6))) throw new TypeError('Invalid local schedule');
  const next = moment.tz(asOf, timezone).startOf('day').hour(hour).minute(minute);
  if (weekday != null) next.add((weekday - next.day() + 7) % 7, 'days');
  if (next.valueOf() <= asOf) next.add(weekday == null ? 1 : 7, 'days').hour(hour).minute(minute);
  return next.valueOf();
}
