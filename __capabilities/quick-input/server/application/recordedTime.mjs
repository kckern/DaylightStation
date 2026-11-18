/**
 * When a quick input says it was captured, and whether to believe it.
 * @module quick-input/application/recordedTime
 */

import { formatLocalTimestamp } from '#system/utils/time.mjs';

// A phone clock may run a little ahead of this one.
const CLOCK_SKEW_MS = 5 * 60 * 1000;
// The upload queue gives up long before this; anything older is a wrong clock.
const OLDEST_CAPTURE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The time an input says it was captured, if it can be believed.
 * @param {number|null|undefined} recordedAt - Epoch ms, as the client sent it
 * @param {number} nowMs
 * @returns {{at: Date|null, ignored: 'not_a_time'|'in_the_future'|'too_old'|null}}
 */
export function recordedTime(recordedAt, nowMs) {
  if (recordedAt === null || recordedAt === undefined) return { at: null, ignored: null };
  if (typeof recordedAt !== 'number' || !Number.isFinite(recordedAt) || recordedAt <= 0) {
    return { at: null, ignored: 'not_a_time' };
  }
  if (recordedAt > nowMs + CLOCK_SKEW_MS) return { at: null, ignored: 'in_the_future' };
  if (recordedAt < nowMs - OLDEST_CAPTURE_MS) return { at: null, ignored: 'too_old' };
  return { at: new Date(recordedAt), ignored: null };
}

/**
 * A moment as the calendar and clock read where the user lives.
 * @param {Date|number} moment
 * @param {string} [timezone] - IANA zone; the household default when left out
 * @returns {{date: string, hour: number, secondsToMidnight: number}} `date` is YYYY-MM-DD
 */
export function localDayParts(moment, timezone) {
  // 'YYYY-MM-DD HH:mm:ss' in the zone.
  const local = formatLocalTimestamp(new Date(moment), timezone || undefined);
  const [date, time] = local.split(' ');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return { date, hour: hours, secondsToMidnight: Math.max(1, 86400 - (hours * 3600 + minutes * 60 + seconds)) };
}
