/**
 * Time utilities (system layer)
 * @module infrastructure/utils/time
 *
 * Thin system-layer facade over the domain shared-kernel time utilities
 * (#domains/core/utils/time.mjs, the SSOT). Adds `new Date()` defaults and the
 * household-default-timezone convenience wrappers (nowTs / nowTs24 / nowDate /
 * nowMonth). These format directly against DEFAULT_TIMEZONE (the household
 * default) — no dependency on any config singleton (S-4).
 */

import {
  formatLocalTimestamp as _formatLocalTimestamp,
  parseToDate,
  getDateInTimezone,
} from '#domains/core/utils/time.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

export { parseToDate };

/**
 * Format a date as a local timestamp string (24-hour)
 * @param {Date} [date=new Date()] - Date to format
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {string} Formatted timestamp (YYYY-MM-DD HH:mm:ss)
 */
export function formatLocalTimestamp(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  return _formatLocalTimestamp(date, timezone);
}

/**
 * Get the current date in a timezone
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {string} Date in YYYY-MM-DD format
 */
export function getCurrentDate(timezone = DEFAULT_TIMEZONE) {
  return getDateInTimezone(new Date(), timezone);
}

/**
 * Get current hour in a specific timezone
 * @param {string} [timezone=DEFAULT_TIMEZONE] - IANA timezone
 * @returns {number} Hour (0-23)
 */
export function getCurrentHour(timezone = DEFAULT_TIMEZONE) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(timeStr, 10);
}

/**
 * Current timestamp in 12-hour format, in the household default timezone.
 * @returns {string} YYYY-MM-DD HH:MM:SS am/pm
 */
export function nowTs() {
  const date = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).formatToParts(date);

    const asMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const dayPeriod = asMap.dayPeriod?.toLowerCase() || 'am';
    return `${asMap.year}-${asMap.month}-${asMap.day} ${asMap.hour}:${asMap.minute}:${asMap.second} ${dayPeriod}`;
  } catch (err) {
    return formatLocalTimestamp(date, DEFAULT_TIMEZONE);
  }
}

/**
 * Current timestamp in 24-hour format, in the household default timezone.
 * @returns {string} YYYY-MM-DD HH:MM:SS
 */
export function nowTs24() {
  return formatLocalTimestamp(new Date(), DEFAULT_TIMEZONE);
}

/**
 * Current date (YYYY-MM-DD) in the household default timezone.
 * @returns {string}
 */
export function nowDate() {
  return getCurrentDate(DEFAULT_TIMEZONE);
}

/**
 * Current month (YYYY-MM) in the household default timezone.
 * @returns {string}
 */
export function nowMonth() {
  const date = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);

    const asMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${asMap.year}-${asMap.month}`;
  } catch {
    return getCurrentDate(DEFAULT_TIMEZONE).slice(0, 7);
  }
}

export default {
  formatLocalTimestamp,
  parseToDate,
  getCurrentDate,
  getCurrentHour,
  nowTs,
  nowTs24,
  nowDate,
  nowMonth,
};
