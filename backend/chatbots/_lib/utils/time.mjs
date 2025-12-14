/**
 * Timezone and time utilities
 * @module _lib/utils/time
 */

/**
 * Default timezone
 */
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Get the configured timezone
 * @param {object} [config] - Config object with timezone property
 * @returns {string}
 */
export function getTimezone(config) {
  return config?.timezone || process.env.TZ || DEFAULT_TIMEZONE;
}

/**
 * Get current time in the configured timezone
 * @param {string} [timezone] - Timezone string
 * @returns {Date}
 */
export function now(timezone = DEFAULT_TIMEZONE) {
  // Returns a Date object; the timezone affects formatting, not the underlying UTC time
  return new Date();
}

/**
 * Format a date in the configured timezone
 * @param {Date|number|string} date - Date to format
 * @param {string} [format='iso'] - Format type: 'iso', 'date', 'time', 'datetime'
 * @param {string} [timezone] - Timezone string
 * @returns {string}
 */
export function formatDate(date, format = 'iso', timezone = DEFAULT_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  
  const options = { timeZone: timezone };
  
  switch (format) {
    case 'date':
      return d.toLocaleDateString('en-CA', { ...options }); // YYYY-MM-DD
    case 'time':
      return d.toLocaleTimeString('en-US', { 
        ...options, 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false,
      });
    case 'datetime':
      return d.toLocaleString('en-US', {
        ...options,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    case 'iso':
    default:
      return d.toISOString();
  }
}

/**
 * Get today's date string in YYYY-MM-DD format
 * @param {string} [timezone] - Timezone string
 * @returns {string}
 */
export function today(timezone = DEFAULT_TIMEZONE) {
  return formatDate(now(), 'date', timezone);
}

/**
 * Get yesterday's date string in YYYY-MM-DD format
 * @param {string} [timezone] - Timezone string
 * @returns {string}
 */
export function yesterday(timezone = DEFAULT_TIMEZONE) {
  const d = now();
  d.setDate(d.getDate() - 1);
  return formatDate(d, 'date', timezone);
}

/**
 * Parse a date string in YYYY-MM-DD format
 * @param {string} dateStr - Date string
 * @returns {Date}
 */
export function parseDate(dateStr) {
  // Parse YYYY-MM-DD as local date (not UTC)
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get time of day category
 * @param {Date|number|string} [date] - Date to check (default: now)
 * @param {string} [timezone] - Timezone string
 * @returns {'morning'|'midday'|'evening'|'night'}
 */
export function getTimeOfDay(date = now(), timezone = DEFAULT_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  
  // Get hour in the specified timezone
  const hour = parseInt(d.toLocaleString('en-US', { 
    timeZone: timezone, 
    hour: 'numeric', 
    hour12: false 
  }));
  
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'midday';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Check if a date is today
 * @param {Date|number|string} date - Date to check
 * @param {string} [timezone] - Timezone string
 * @returns {boolean}
 */
export function isToday(date, timezone = DEFAULT_TIMEZONE) {
  return formatDate(date, 'date', timezone) === today(timezone);
}

/**
 * Get the start of a day in the specified timezone
 * @param {Date|number|string} [date] - Date (default: today)
 * @param {string} [timezone] - Timezone string
 * @returns {Date}
 */
export function startOfDay(date = now(), timezone = DEFAULT_TIMEZONE) {
  const dateStr = formatDate(date, 'date', timezone);
  return parseDate(dateStr);
}

/**
 * Add days to a date
 * @param {Date|number|string} date - Base date
 * @param {number} days - Days to add (can be negative)
 * @returns {Date}
 */
export function addDays(date, days) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Get an array of date strings for the past N days
 * @param {number} days - Number of days
 * @param {string} [timezone] - Timezone string
 * @returns {string[]} - Array of YYYY-MM-DD strings, most recent first
 */
export function getPastDays(days, timezone = DEFAULT_TIMEZONE) {
  const result = [];
  const base = now();
  
  for (let i = 0; i < days; i++) {
    result.push(formatDate(addDays(base, -i), 'date', timezone));
  }
  
  return result;
}

/**
 * Calculate the difference in days between two dates
 * @param {Date|string} date1 - First date
 * @param {Date|string} date2 - Second date
 * @returns {number} - Number of days (positive if date1 > date2)
 */
export function daysDiff(date1, date2) {
  const d1 = date1 instanceof Date ? date1 : new Date(date1);
  const d2 = date2 instanceof Date ? date2 : new Date(date2);
  
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((d1 - d2) / msPerDay);
}

export default {
  getTimezone,
  now,
  formatDate,
  today,
  yesterday,
  parseDate,
  getTimeOfDay,
  isToday,
  startOfDay,
  addDays,
  getPastDays,
  daysDiff,
};
