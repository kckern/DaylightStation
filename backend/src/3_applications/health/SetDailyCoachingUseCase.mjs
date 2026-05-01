/**
 * SetDailyCoachingUseCase
 *
 * Application-layer use case that persists the `coaching` field on a daily
 * health entry (PRD F-001). Validation goes through `DailyCoachingEntry`
 * (Task 18) so the datastore stays a dumb persistence layer.
 *
 * Behaviour:
 *  - Validates `userId` + `date` (YYYY-MM-DD).
 *  - Builds a `DailyCoachingEntry` from the raw input (throws on bad shape).
 *  - Loads existing health data, merges `coaching` onto the date entry
 *    (creating the entry if missing) without clobbering sibling fields,
 *    and saves the updated map back.
 *  - Passing `coaching: null` clears the coaching field (sibling fields kept).
 *
 * @module applications/health
 */

import { DailyCoachingEntry } from '#domains/health/entities/DailyCoachingEntry.mjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class SetDailyCoachingUseCase {
  #healthStore;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.healthStore - IHealthDataDatastore implementation
   *   (must implement loadHealthData / saveHealthData)
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config = {}) {
    if (!config.healthStore) {
      throw new Error('SetDailyCoachingUseCase requires healthStore');
    }
    this.#healthStore = config.healthStore;
    this.#logger = config.logger || console;
  }

  /**
   * Set (or clear) the coaching field for a given user + date.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.date - YYYY-MM-DD
   * @param {Object|null} params.coaching - Raw coaching object
   *   (matches `DailyCoachingEntry` shape) or `null` to clear.
   * @returns {Promise<void>}
   */
  async execute({ userId, date, coaching } = {}) {
    if (!userId) throw new Error('SetDailyCoachingUseCase: userId required');
    if (!date || !DATE_PATTERN.test(date)) {
      throw new Error(`SetDailyCoachingUseCase: invalid date "${date}" (expected YYYY-MM-DD)`);
    }

    // Validate up-front — throws before we touch the datastore.
    let serialized = null;
    if (coaching !== null && coaching !== undefined) {
      const entry = new DailyCoachingEntry(coaching);
      serialized = entry.serialize();
    }

    const allData = (await this.#healthStore.loadHealthData(userId)) || {};
    const dayEntry = allData[date] ? { ...allData[date] } : {};

    if (serialized === null) {
      delete dayEntry.coaching;
    } else {
      dayEntry.coaching = serialized;
    }

    allData[date] = dayEntry;

    await this.#healthStore.saveHealthData(userId, allData);

    this.#logger.info?.('set_daily_coaching.complete', {
      userId,
      date,
      fields: serialized ? Object.keys(serialized) : null,
    });
  }
}

export default SetDailyCoachingUseCase;
