/**
 * Time Utilities for Domain Layer
 * @module core/utils/time
 *
 * Pure functions for timezone-aware timestamp formatting.
 * Moved to domain layer as these are shared kernel utilities
 * used across domain entities.
 *
 * These functions are pure - they take all required inputs as parameters
 * and have no external dependencies or side effects.
 */

import { DEFAULT_TIMEZONE } from './timezone.mjs';

/**
 * Get a date formatter for a specific timezone
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {Intl.DateTimeFormat}
 */
function getFormatter(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * Format a date as a local timestamp string
 *
 * Pure function - requires explicit date parameter, no implicit new Date().
 *
 * @param {Date} date - Date to format (required)
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {string} Formatted timestamp (YYYY-MM-DD HH:mm:ss)
 * @throws {Error} If date is not provided or invalid
 */
export function formatLocalTimestamp(date, timezone = DEFAULT_TIMEZONE) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('formatLocalTimestamp requires a valid Date parameter');
  }

  try {
    const parts = getFormatter(timezone).formatToParts(date);
    const asMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const year = asMap.year;
    const month = asMap.month;
    const day = asMap.day;
    const hour = asMap.hour;
    const minute = asMap.minute;
    const second = asMap.second;
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  } catch (err) {
    // Fallback to ISO without timezone formatting
    return date.toISOString().replace('T', ' ').split('.')[0];
  }
}

/**
 * The zone's UTC offset, in minutes, at a given instant (DST-aware).
 * @param {Date} date - Instant to measure at (offsets shift across DST)
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {number} Minutes east of UTC (e.g. -420 for PDT)
 */
function offsetMinutes(date, timezone = DEFAULT_TIMEZONE) {
  const parts = getFormatter(timezone).formatToParts(date);
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const wallAsUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  // Drop sub-second precision from the instant: wallAsUtc has none, and the
  // difference of the two is the offset only once both share a resolution.
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Format a date as ISO-8601 with an explicit UTC offset, in the given zone.
 *
 * Unlike `toISOString()` (always Z) this keeps the reading anchored to the wall
 * clock a human would have seen, while staying unambiguous for machines —
 * the format to persist when a record's local day matters.
 *
 * @param {Date} date - Date to format (required)
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {string} e.g. 2026-08-11T17:30:00-07:00
 */
export function formatIsoLocal(date, timezone = DEFAULT_TIMEZONE) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('formatIsoLocal requires a valid Date parameter');
  }

  try {
    const [day, clock] = formatLocalTimestamp(date, timezone).split(' ');
    const total = offsetMinutes(date, timezone);
    const sign = total < 0 ? '-' : '+';
    const abs = Math.abs(total);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `${day}T${clock}${sign}${hh}:${mm}`;
  } catch {
    return date.toISOString();
  }
}

/**
 * Parse a value to a Date object
 * @param {any} value - Value to parse
 * @returns {Date|null}
 */
export function parseToDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

/**
 * Get the date portion from a Date in a timezone
 *
 * Pure function - requires explicit date parameter.
 *
 * @param {Date} date - Date to format (required)
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getDateInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  return formatLocalTimestamp(date, timezone).split(' ')[0];
}

/**
 * Get hour from a Date in a specific timezone
 *
 * Pure function - requires explicit date parameter.
 *
 * @param {Date} date - Date to get hour from (required)
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {number} Hour (0-23)
 * @throws {Error} If date is not provided or invalid
 */
export function getHourInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('getHourInTimezone requires a valid Date parameter');
  }

  const timeStr = date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(timeStr, 10);
}

export const TimeUtils = {
  formatLocalTimestamp,
  formatIsoLocal,
  parseToDate,
  getDateInTimezone,
  getHourInTimezone,
};

export default TimeUtils;
