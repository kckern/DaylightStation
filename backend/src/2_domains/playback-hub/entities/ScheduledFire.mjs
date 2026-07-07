/**
 * ScheduledFire Entity
 * @module domains/playback-hub/entities/ScheduledFire
 *
 * A scheduled playback fire — { id, time, days, target, queue, durationMin?,
 * volumeOverride? }. Member of the HubConfig aggregate.
 *
 * The constructor checks internal validity only. Cross-aggregate validation
 * (does `target` reference a known device color? does `volumeOverride` respect
 * the target device's bounds?) lives in `validate(slotsByColor)` and is called
 * by the SaveScheduledFire use case.
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { DayPattern } from '../value-objects/DayPattern.mjs';
import { QueueRef } from '../value-objects/QueueRef.mjs';

const TIME_RX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * ScheduledFire entity.
 */
export class ScheduledFire {
  /** @type {string} */ #id;
  /** @type {string} */ #time;
  /** @type {DayPattern} */ #days;
  /** @type {string} */ #target;
  /** @type {QueueRef} */ #queue;
  /** @type {number|null} */ #durationMin;
  /** @type {number|null} */ #volumeOverride;

  /**
   * @param {{
   *   id: string, time: string, days: DayPattern, target: string,
   *   queue: QueueRef, durationMin?: number|null, volumeOverride?: number|null
   * }} args
   */
  constructor({ id, time, days, target, queue, durationMin = null, volumeOverride = null } = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError('ScheduledFire.id must be a non-empty string', {
        code: 'INVALID_SCHEDULED_FIRE', field: 'id', value: id
      });
    }
    if (typeof time !== 'string' || !TIME_RX.test(time)) {
      throw new ValidationError('ScheduledFire.time must be "HH:MM" (00:00-23:59)', {
        code: 'INVALID_SCHEDULED_FIRE', field: 'time', value: time
      });
    }
    if (!(days instanceof DayPattern)) {
      throw new ValidationError('ScheduledFire.days must be a DayPattern instance', {
        code: 'INVALID_SCHEDULED_FIRE', field: 'days', value: days
      });
    }
    if (typeof target !== 'string' || target.length === 0) {
      throw new ValidationError('ScheduledFire.target must be a non-empty color string', {
        code: 'INVALID_SCHEDULED_FIRE', field: 'target', value: target
      });
    }
    if (!(queue instanceof QueueRef)) {
      throw new ValidationError('ScheduledFire.queue must be a QueueRef instance', {
        code: 'INVALID_SCHEDULED_FIRE', field: 'queue', value: queue
      });
    }
    if (durationMin !== null) {
      if (typeof durationMin !== 'number' || !Number.isInteger(durationMin) || durationMin < 1) {
        throw new ValidationError('ScheduledFire.durationMin must be null or positive integer', {
          code: 'INVALID_SCHEDULED_FIRE', field: 'durationMin', value: durationMin
        });
      }
    }
    if (volumeOverride !== null) {
      if (typeof volumeOverride !== 'number' || !Number.isFinite(volumeOverride)
          || volumeOverride < 0 || volumeOverride > 100) {
        throw new ValidationError('ScheduledFire.volumeOverride must be null or 0-100', {
          code: 'INVALID_SCHEDULED_FIRE', field: 'volumeOverride', value: volumeOverride
        });
      }
    }
    this.#id = id;
    this.#time = time;
    this.#days = days;
    this.#target = target;
    this.#queue = queue;
    this.#durationMin = durationMin;
    this.#volumeOverride = volumeOverride;
    Object.freeze(this);
  }

  /** @returns {string} */
  get id() { return this.#id; }
  /** @returns {string} */
  get time() { return this.#time; }
  /** @returns {DayPattern} */
  get days() { return this.#days; }
  /** @returns {string} */
  get target() { return this.#target; }
  /** @returns {QueueRef} */
  get queue() { return this.#queue; }
  /** @returns {number|null} */
  get durationMin() { return this.#durationMin; }
  /** @returns {number|null} */
  get volumeOverride() { return this.#volumeOverride; }

  /**
   * Cross-aggregate validation. Called by SaveScheduledFire before persisting.
   *
   * @param {Map<string, {color: string, volumeBounds: {max: number}}>} slotsByColor
   *   Map keyed by device color string; each value exposes a `volumeBounds.max`.
   * @throws {EntityNotFoundError} if `target` color is not in the map
   * @throws {DomainInvariantError} if `volumeOverride` exceeds target's bounds max
   */
  validate(slotsByColor) {
    const targetDevice = slotsByColor.get(this.#target);
    if (!targetDevice) {
      throw new EntityNotFoundError('HubDevice', this.#target, {
        details: { scheduledFireId: this.#id, code: 'SCHEDULED_FIRE_TARGET_UNKNOWN' }
      });
    }
    if (this.#volumeOverride !== null) {
      const max = targetDevice.volumeBounds?.max;
      if (typeof max === 'number' && this.#volumeOverride > max) {
        throw new DomainInvariantError(
          `volumeOverride ${this.#volumeOverride} exceeds target '${this.#target}' max ${max}`,
          {
            code: 'VOLUME_OVERRIDE_EXCEEDS_BOUNDS',
            details: { scheduledFireId: this.#id, volumeOverride: this.#volumeOverride, max }
          }
        );
      }
    }
  }
}

export default ScheduledFire;
