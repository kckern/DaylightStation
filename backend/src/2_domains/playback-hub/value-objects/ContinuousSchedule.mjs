/**
 * ContinuousSchedule Value Object
 * @module domains/playback-hub/value-objects/ContinuousSchedule
 *
 * Continuous (always-on within window) playback schedule:
 *   { start: 'HH:MM', end: 'HH:MM', queue: QueueRef, shuffle: boolean }
 *
 * activeAt(date) handles wrap-around (e.g. start=21:00, end=07:00 covers the
 * overnight window). Start is inclusive, end is exclusive.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';
import { QueueRef } from './QueueRef.mjs';

const TIME_RX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** @param {string} hhmm @returns {number} minutes since midnight */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** @param {*} value @param {string} field */
function validateTime(value, field) {
  if (typeof value !== 'string' || !TIME_RX.test(value)) {
    throw new ValidationError(`ContinuousSchedule.${field} must be 'HH:MM' (00:00-23:59)`, {
      code: 'INVALID_CONTINUOUS_SCHEDULE',
      field,
      value
    });
  }
}

/**
 * ContinuousSchedule value object.
 */
export class ContinuousSchedule {
  /** @type {string} */ #start;
  /** @type {string} */ #end;
  /** @type {QueueRef} */ #queue;
  /** @type {boolean} */ #shuffle;
  /** @type {number} */ #startMinutes;
  /** @type {number} */ #endMinutes;

  /**
   * @param {{start: string, end: string, queue: QueueRef, shuffle?: boolean}} args
   */
  constructor({ start, end, queue, shuffle = false } = {}) {
    validateTime(start, 'start');
    validateTime(end, 'end');
    if (!(queue instanceof QueueRef)) {
      throw new ValidationError('ContinuousSchedule.queue must be a QueueRef', {
        code: 'INVALID_CONTINUOUS_SCHEDULE',
        field: 'queue',
        value: queue
      });
    }
    if (typeof shuffle !== 'boolean') {
      throw new ValidationError('ContinuousSchedule.shuffle must be a boolean', {
        code: 'INVALID_CONTINUOUS_SCHEDULE',
        field: 'shuffle',
        value: shuffle
      });
    }
    if (start === end) {
      throw new ValidationError('ContinuousSchedule.start and end must differ', {
        code: 'INVALID_CONTINUOUS_SCHEDULE',
        field: 'end',
        value: end
      });
    }
    this.#start = start;
    this.#end = end;
    this.#queue = queue;
    this.#shuffle = shuffle;
    this.#startMinutes = toMinutes(start);
    this.#endMinutes = toMinutes(end);
    Object.freeze(this);
  }

  /** @returns {string} */
  get start() {
    return this.#start;
  }

  /** @returns {string} */
  get end() {
    return this.#end;
  }

  /** @returns {QueueRef} */
  get queue() {
    return this.#queue;
  }

  /** @returns {boolean} */
  get shuffle() {
    return this.#shuffle;
  }

  /**
   * Whether the given Date falls inside the window. Wrap-around supported:
   * if start > end the window covers [start..24:00) U [00:00..end).
   * Start is inclusive, end is exclusive.
   * @param {Date} date
   * @returns {boolean}
   */
  activeAt(date) {
    const m = date.getHours() * 60 + date.getMinutes();
    const s = this.#startMinutes;
    const e = this.#endMinutes;
    if (s < e) {
      return m >= s && m < e;
    }
    // wrap-around
    return m >= s || m < e;
  }
}

export default ContinuousSchedule;
