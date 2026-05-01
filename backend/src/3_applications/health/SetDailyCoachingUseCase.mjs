/**
 * SetDailyCoachingUseCase
 *
 * Application-layer use case that persists the `coaching` field on a daily
 * health entry (PRD F-001 / F2-A). Validation goes through `DailyCoachingEntry`
 * which is now schema-driven — the dimensions are declared in the user's
 * playbook YAML rather than hardcoded.
 *
 * Behaviour:
 *  - Validates `userId` + `date` (YYYY-MM-DD).
 *  - Lazily loads the user's playbook to obtain the `coaching_dimensions`
 *    schema (when `personalContextLoader` is wired). Without a schema, the
 *    entity runs in trust mode (accepts any plain-object shape).
 *  - Builds a `DailyCoachingEntry` from the raw input + schema (throws on
 *    bad shape).
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
  #personalContextLoader;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.healthStore - IHealthDataDatastore implementation
   *   (must implement loadHealthData / saveHealthData)
   * @param {Object} [config.personalContextLoader] - PersonalContextLoader
   *   used to resolve the per-user `coaching_dimensions` schema. Optional;
   *   when absent the entity runs in trust mode.
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config = {}) {
    if (!config.healthStore) {
      throw new Error('SetDailyCoachingUseCase requires healthStore');
    }
    this.#healthStore = config.healthStore;
    this.#personalContextLoader = config.personalContextLoader || null;
    this.#logger = config.logger || console;
  }

  async #resolveDimensionsSchema(userId) {
    if (!this.#personalContextLoader
      || typeof this.#personalContextLoader.loadPlaybook !== 'function') {
      return null;
    }
    try {
      const playbook = await this.#personalContextLoader.loadPlaybook(userId);
      const dims = playbook?.coaching_dimensions;
      if (Array.isArray(dims) && dims.length > 0) return dims;
      return null;
    } catch (err) {
      this.#logger.warn?.('set_daily_coaching.schema_load_failed', {
        userId,
        error: err?.message || String(err),
      });
      return null;
    }
  }

  /**
   * Set (or clear) the coaching field for a given user + date.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.date - YYYY-MM-DD
   * @param {Object|null} params.coaching - Raw coaching object
   *   (matches the playbook's declared `coaching_dimensions` shape) or
   *   `null` to clear.
   * @returns {Promise<void>}
   */
  async execute({ userId, date, coaching } = {}) {
    if (!userId) throw new Error('SetDailyCoachingUseCase: userId required');
    if (!date || !DATE_PATTERN.test(date)) {
      throw new Error(`SetDailyCoachingUseCase: invalid date "${date}" (expected YYYY-MM-DD)`);
    }

    let serialized = null;
    if (coaching !== null && coaching !== undefined) {
      const dimensionsSchema = await this.#resolveDimensionsSchema(userId);
      const entry = new DailyCoachingEntry(coaching, dimensionsSchema, {
        logger: this.#logger,
      });
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
