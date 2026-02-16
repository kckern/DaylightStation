/**
 * HeadlineHarvesterAdapter
 *
 * Wraps HeadlineService.harvestAll() as an IHarvester so headline
 * harvesting can run through the unified scheduler.
 *
 * @module adapters/feed/HeadlineHarvesterAdapter
 */

import { IHarvester, HarvesterCategory } from '../harvester/ports/IHarvester.mjs';

export class HeadlineHarvesterAdapter extends IHarvester {
  #headlineService;
  #logger;
  #lastRun = null;
  #lastError = null;

  constructor({ headlineService, logger = console }) {
    super();
    if (!headlineService) throw new Error('HeadlineHarvesterAdapter requires headlineService');
    this.#headlineService = headlineService;
    this.#logger = logger;
  }

  get serviceId() { return 'feed-headlines'; }
  get category() { return HarvesterCategory.OTHER; }

  async harvest(username, options = {}) {
    this.#logger.info?.('headline-harvester-adapter.start', { username });
    try {
      const result = await this.#headlineService.harvestAll(username);
      this.#lastRun = Date.now();
      this.#lastError = null;
      return {
        count: result.totalItems,
        status: result.errors > 0 ? 'partial' : 'success',
      };
    } catch (error) {
      this.#lastError = error.message;
      throw error;
    }
  }

  getStatus() {
    return {
      state: this.#lastError ? 'open' : 'closed',
      failures: this.#lastError ? 1 : 0,
      lastFailure: this.#lastError ? Date.now() : null,
      cooldownUntil: null,
    };
  }
}

export default HeadlineHarvesterAdapter;
