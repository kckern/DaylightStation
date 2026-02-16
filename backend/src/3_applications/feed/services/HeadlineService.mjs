// backend/src/3_applications/feed/services/HeadlineService.mjs
/**
 * HeadlineService
 *
 * Orchestrates headline harvesting, caching, and retrieval.
 * Reads user config for source list, delegates to harvester and store.
 *
 * @module applications/feed/services
 */

const FEED_CONFIG_PATH = 'apps/feed/config';

export class HeadlineService {
  #headlineStore;
  #harvester;
  #dataService;
  #configService;
  #logger;

  constructor({ headlineStore, harvester, dataService, configService, logger = console }) {
    this.#headlineStore = headlineStore;
    this.#harvester = harvester;
    this.#dataService = dataService;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Get user's feed config
   * @param {string} username
   * @returns {Object}
   */
  #getUserConfig(username) {
    return this.#dataService.user.read(FEED_CONFIG_PATH, username) || {};
  }

  /**
   * Get all headline sources from config (standalone + FreshRSS)
   * @param {string} username
   * @returns {Array<{ id, label, url }>}
   */
  #getSources(username) {
    const config = this.#getUserConfig(username);
    const sources = [];

    // Standalone RSS sources
    if (config.headline_sources) {
      sources.push(...config.headline_sources);
    }

    // FreshRSS headline feeds would be resolved here
    // (requires FreshRSS adapter to map feed_id to URL — future enhancement)

    return sources;
  }

  /**
   * Harvest all configured headline sources
   * @param {string} username
   * @returns {Promise<{ harvested, errors, totalItems }>}
   */
  async harvestAll(username) {
    const sources = this.#getSources(username);
    const config = this.#getUserConfig(username);
    const retentionHours = config.headlines?.retention_hours || 48;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    let errors = 0;
    let totalItems = 0;

    for (const source of sources) {
      try {
        const result = await this.#harvester.harvest(source);
        await this.#headlineStore.saveSource(source.id, result, username);
        await this.#headlineStore.pruneOlderThan(source.id, cutoff, username);

        if (result.error) errors++;
        totalItems += result.items.length;

        this.#logger.debug?.('headline.service.harvested', {
          source: source.id,
          items: result.items.length,
        });
      } catch (error) {
        errors++;
        this.#logger.error?.('headline.service.harvest.error', {
          source: source.id,
          error: error.message,
        });
      }
    }

    this.#logger.info?.('headline.service.harvestAll.complete', {
      username,
      harvested: sources.length,
      errors,
      totalItems,
    });

    return { harvested: sources.length, errors, totalItems };
  }

  /**
   * Get all cached headlines grouped by source
   * @param {string} username
   * @returns {Promise<{ sources: Object, lastHarvest: string|null }>}
   */
  async getAllHeadlines(username) {
    const sources = await this.#headlineStore.loadAllSources(username);
    const lastHarvest = Object.values(sources)
      .map(s => s.lastHarvest)
      .filter(Boolean)
      .sort()
      .pop() || null;

    return { sources, lastHarvest };
  }

  /**
   * Get headlines for a single source
   * @param {string} sourceId
   * @param {string} username
   * @returns {Promise<Object|null>}
   */
  async getSourceHeadlines(sourceId, username) {
    return this.#headlineStore.loadSource(sourceId, username);
  }
}

export default HeadlineService;
