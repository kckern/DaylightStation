/**
 * Time utilities
 * @module infrastructure/utils/time
 *
 * Timezone-aware timestamp formatting.
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
 * @param {Date} [date=new Date()] - Date to format
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {string} Formatted timestamp (YYYY-MM-DD HH:mm:ss)
 */
export function formatLocalTimestamp(date = new Date(), timezone = 'America/Los_Angeles') {
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
    return new Date(date).toISOString().replace('T', ' ').split('.')[0];
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
 * Get the current date in a timezone
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getCurrentDate(timezone = 'America/Los_Angeles') {
  return formatLocalTimestamp(new Date(), timezone).split(' ')[0];
}

/**
 * Get current hour in a specific timezone
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {number} Hour (0-23)
 */
export function getCurrentHour(timezone = 'America/Los_Angeles') {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  return parseInt(timeStr, 10);
}

export default {
  formatLocalTimestamp,
  parseToDate,
  getCurrentDate,
  getCurrentHour,
};
