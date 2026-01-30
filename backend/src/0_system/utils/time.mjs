/**
 * Time utilities
 * @module infrastructure/utils/time
 *
 * Timezone-aware timestamp formatting.
 */

import { configService } from '../config/index.mjs';

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

/**
 * TimestampService - Centralized timestamp formatting with system timezone support
 */
export class TimestampService {
  constructor(configService) {
    this.configService = configService;
  }

  /**
   * Get system timezone from config
   * @returns {string} IANA timezone
   */
  getTimezone() {
    try {
      return this.configService?.getTimezone?.() || 'America/Los_Angeles';
    } catch {
      return 'America/Los_Angeles';
    }
  }

  /**
   * Format date with custom options
   * @param {Date} [date=new Date()] - Date to format
   * @param {Object} [options] - Intl.DateTimeFormat options
   * @param {string} [timezone] - Override timezone
   * @returns {string}
   */
  format(date = new Date(), options = {}, timezone = null) {
    const tz = timezone || this.getTimezone();
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        ...options,
      }).format(date);
    } catch (err) {
      return date.toISOString();
    }
  }

  /**
   * Get current timestamp in 12-hour format
   * @returns {string} YYYY-MM-DD HH:MM:SS am/pm
   */
  now() {
    const tz = this.getTimezone();
    const date = new Date();
    
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).formatToParts(date);

      const asMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
      const year = asMap.year;
      const month = asMap.month;
      const day = asMap.day;
      const hour = asMap.hour;
      const minute = asMap.minute;
      const second = asMap.second;
      const dayPeriod = asMap.dayPeriod?.toLowerCase() || 'am';

      return `${year}-${month}-${day} ${hour}:${minute}:${second} ${dayPeriod}`;
    } catch (err) {
      // Fallback
      return formatLocalTimestamp(date, tz);
    }
  }

  /**
   * Get current timestamp in 24-hour format
   * @returns {string} YYYY-MM-DD HH:MM:SS
   */
  now24() {
    const tz = this.getTimezone();
    return formatLocalTimestamp(new Date(), tz);
  }

  /**
   * Get current date
   * @returns {string} YYYY-MM-DD
   */
  date() {
    return getCurrentDate(this.getTimezone());
  }

  /**
   * Get current month
   * @returns {string} YYYY-MM
   */
  month() {
    const tz = this.getTimezone();
    const date = new Date();
    
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(date);

      const asMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
      return `${asMap.year}-${asMap.month}`;
    } catch {
      return getCurrentDate(tz).slice(0, 7);
    }
  }
}

// Lazy-initialize singleton to avoid circular dependency
let _ts;
export const ts = new Proxy({}, {
  get(target, prop) {
    if (!_ts) {
      _ts = new TimestampService(configService);
    }
    return _ts[prop];
  }
});

// Convenience functions
export const nowTs = () => ts.now();
export const nowTs24 = () => ts.now24();
export const nowDate = () => ts.date();
export const nowMonth = () => ts.month();

export default {
  formatLocalTimestamp,
  parseToDate,
  getCurrentDate,
  getCurrentHour,
  TimestampService,
  ts,
  nowTs,
  nowTs24,
  nowDate,
  nowMonth,
};
