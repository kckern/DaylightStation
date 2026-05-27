/**
 * PlayCommand Value Object
 * @module domains/playback-hub/value-objects/PlayCommand
 *
 * Describes one playback intent: { action, queue?, volume?, durationMin? }.
 * The hub adapter is responsible for marshaling into the wire format; this VO
 * just enforces shape correctness so impossible commands never reach the gateway.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';
import { QueueRef } from './QueueRef.mjs';

const ACTIONS = Object.freeze(['play', 'stop', 'pause', 'next', 'prev', 'volume']);

/**
 * PlayCommand value object.
 */
export class PlayCommand {
  /** @type {string} */ #action;
  /** @type {QueueRef|null} */ #queue;
  /** @type {number|null} */ #volume;
  /** @type {number|null} */ #durationMin;

  /**
   * @param {{
   *   action: 'play'|'stop'|'pause'|'next'|'prev'|'volume',
   *   queue?: QueueRef|null,
   *   volume?: number|null,
   *   durationMin?: number|null
   * }} args
   */
  constructor({ action, queue = null, volume = null, durationMin = null } = {}) {
    if (!ACTIONS.includes(action)) {
      throw new ValidationError(
        `PlayCommand.action must be one of ${ACTIONS.join('|')}`,
        { code: 'INVALID_PLAY_COMMAND', field: 'action', value: action }
      );
    }
    if (action === 'play' && !(queue instanceof QueueRef)) {
      throw new ValidationError('play action requires a QueueRef', {
        code: 'INVALID_PLAY_COMMAND',
        field: 'queue',
        value: queue
      });
    }
    if (action === 'volume' && (typeof volume !== 'number' || !Number.isFinite(volume))) {
      throw new ValidationError('volume action requires numeric volume', {
        code: 'INVALID_PLAY_COMMAND',
        field: 'volume',
        value: volume
      });
    }
    if (queue !== null && !(queue instanceof QueueRef)) {
      throw new ValidationError('queue must be a QueueRef or null', {
        code: 'INVALID_PLAY_COMMAND',
        field: 'queue',
        value: queue
      });
    }
    if (volume !== null) {
      if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) {
        throw new ValidationError('volume must be a number 0-100', {
          code: 'INVALID_PLAY_COMMAND',
          field: 'volume',
          value: volume
        });
      }
    }
    if (durationMin !== null) {
      if (typeof durationMin !== 'number' || !Number.isInteger(durationMin) || durationMin < 1) {
        throw new ValidationError('durationMin must be null or positive integer', {
          code: 'INVALID_PLAY_COMMAND',
          field: 'durationMin',
          value: durationMin
        });
      }
    }
    this.#action = action;
    this.#queue = queue;
    this.#volume = volume;
    this.#durationMin = durationMin;
    Object.freeze(this);
  }

  /** @returns {string} */
  get action() {
    return this.#action;
  }

  /** @returns {QueueRef|null} */
  get queue() {
    return this.#queue;
  }

  /** @returns {number|null} */
  get volume() {
    return this.#volume;
  }

  /** @returns {number|null} */
  get durationMin() {
    return this.#durationMin;
  }

  /** Allowed action enum (read-only copy). */
  static get ACTIONS() {
    return [...ACTIONS];
  }
}

export default PlayCommand;
