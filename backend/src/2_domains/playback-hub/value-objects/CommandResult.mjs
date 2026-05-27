/**
 * CommandResult Value Object
 * @module domains/playback-hub/value-objects/CommandResult
 *
 * Outcome of a hub command — { applied: color[], skipped: [{color, reason}] }.
 * The reason enum is closed and stable; new reasons must be added here AND in
 * the design's vocabulary table.
 *
 * The carrier convention is intentional: a 409 contention from the hub is NOT
 * thrown as an error but reported as skipped[{reason:'contention'}]. Callers
 * can safely retry.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';

const REASONS = Object.freeze([
  'not-found',
  'unreachable',
  'contention',
  'volume-out-of-bounds',
  'invalid-target'
]);

/**
 * CommandResult value object.
 */
export class CommandResult {
  /** @type {ReadonlyArray<string>} */ #applied;
  /** @type {ReadonlyArray<{color: string, reason: string}>} */ #skipped;

  /**
   * @param {{
   *   applied?: string[],
   *   skipped?: Array<{color: string, reason: string}>
   * }} args
   */
  constructor({ applied = [], skipped = [] } = {}) {
    if (!Array.isArray(applied)) {
      throw new ValidationError('CommandResult.applied must be an array', {
        code: 'INVALID_COMMAND_RESULT',
        field: 'applied',
        value: applied
      });
    }
    if (!Array.isArray(skipped)) {
      throw new ValidationError('CommandResult.skipped must be an array', {
        code: 'INVALID_COMMAND_RESULT',
        field: 'skipped',
        value: skipped
      });
    }
    for (const entry of skipped) {
      if (!entry || typeof entry !== 'object') {
        throw new ValidationError('CommandResult.skipped entries must be objects', {
          code: 'INVALID_COMMAND_RESULT',
          field: 'skipped',
          value: entry
        });
      }
      if (typeof entry.color !== 'string' || entry.color.length === 0) {
        throw new ValidationError('CommandResult.skipped[].color must be a non-empty string', {
          code: 'INVALID_COMMAND_RESULT',
          field: 'skipped.color',
          value: entry
        });
      }
      if (!REASONS.includes(entry.reason)) {
        throw new ValidationError(
          `CommandResult.skipped[].reason must be one of ${REASONS.join('|')}`,
          { code: 'INVALID_COMMAND_RESULT', field: 'skipped.reason', value: entry }
        );
      }
    }
    this.#applied = Object.freeze([...applied]);
    this.#skipped = Object.freeze(skipped.map(s => Object.freeze({ color: s.color, reason: s.reason })));
    Object.freeze(this);
  }

  /** @returns {ReadonlyArray<string>} */
  get applied() {
    return this.#applied;
  }

  /** @returns {ReadonlyArray<{color: string, reason: string}>} */
  get skipped() {
    return this.#skipped;
  }

  /** True iff applied is non-empty AND nothing was skipped. */
  allApplied() {
    return this.#applied.length > 0 && this.#skipped.length === 0;
  }

  /** True iff applied is empty. */
  allSkipped() {
    return this.#applied.length === 0;
  }

  /** Closed reason enum (read-only copy). */
  static get REASONS() {
    return [...REASONS];
  }
}

export default CommandResult;
