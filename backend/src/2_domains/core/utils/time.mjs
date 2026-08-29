/** Pure, dependency-free shared-kernel time formatting primitives. */
import { DEFAULT_TIMEZONE } from './timezone.mjs';

function getFormatter(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

export function formatLocalTimestamp(date, timezone = DEFAULT_TIMEZONE) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatLocalTimestamp requires a valid Date parameter');
  }
  try {
    const parts = getFormatter(timezone).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  } catch {
    return date.toISOString().replace('T', ' ').split('.')[0];
  }
}

function offsetMinutes(date, timezone = DEFAULT_TIMEZONE) {
  const parts = getFormatter(timezone).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const wallAsUtc = Date.UTC(+values.year, +values.month - 1, +values.day,
    +values.hour, +values.minute, +values.second);
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

export function formatIsoLocal(date, timezone = DEFAULT_TIMEZONE) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatIsoLocal requires a valid Date parameter');
  }
  try {
    const [day, clock] = formatLocalTimestamp(date, timezone).split(' ');
    const total = offsetMinutes(date, timezone);
    const sign = total < 0 ? '-' : '+';
    const absolute = Math.abs(total);
    return `${day}T${clock}${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  } catch {
    return date.toISOString();
  }
}

export function parseToDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getDateInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  return formatLocalTimestamp(date, timezone).split(' ')[0];
}

export function getHourInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('getHourInTimezone requires a valid Date parameter');
  }
  return Number.parseInt(date.toLocaleTimeString('en-US', {
    timeZone: timezone, hour: 'numeric', hour12: false,
  }), 10);
}

export const TimeUtils = {
  formatLocalTimestamp, formatIsoLocal, parseToDate, getDateInTimezone, getHourInTimezone,
};

export default TimeUtils;
