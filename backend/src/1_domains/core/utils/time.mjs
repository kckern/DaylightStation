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

/**
 * Get a date formatter for a specific timezone
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {Intl.DateTimeFormat}
 */
function getFormatter(timezone = 'America/Los_Angeles') {
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
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {string} Formatted timestamp (YYYY-MM-DD HH:mm:ss)
 * @throws {Error} If date is not provided or invalid
 */
export function formatLocalTimestamp(date, timezone = 'America/Los_Angeles') {
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
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getDateInTimezone(date, timezone = 'America/Los_Angeles') {
  return formatLocalTimestamp(date, timezone).split(' ')[0];
}

/**
 * Get hour from a Date in a specific timezone
 *
 * Pure function - requires explicit date parameter.
 *
 * @param {Date} date - Date to get hour from (required)
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {number} Hour (0-23)
 * @throws {Error} If date is not provided or invalid
 */
export function getHourInTimezone(date, timezone = 'America/Los_Angeles') {
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
  parseToDate,
  getDateInTimezone,
  getHourInTimezone,
};

export default TimeUtils;
