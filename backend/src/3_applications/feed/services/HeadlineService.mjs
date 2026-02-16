// backend/src/3_applications/feed/services/HeadlineService.mjs
/**
 * HeadlineService
 *
 * Orchestrates headline harvesting, caching, and retrieval.
 * Reads user config for source list, delegates to harvester and store.
 *
 * @module applications/feed/services
 */

const FEED_CONFIG_PATH = 'config/feed';

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
   * Get all cached headlines grouped by source, with grid layout metadata
   * @param {string} username
   * @returns {Promise<{ grid: Object, sources: Object, lastHarvest: string|null }>}
   */
  async getAllHeadlines(username) {
    const config = this.#getUserConfig(username);
    const configSources = config.headline_sources || [];
    const cached = await this.#headlineStore.loadAllSources(username);

    const headlineConfig = config.headlines || {};
    const maxPerSource = headlineConfig.max_per_source || 10;
    const dedupeWordCount = headlineConfig.dedupe_word_count || 8;
    const excludePatterns = (headlineConfig.exclude_patterns || []).map(p => new RegExp(p, 'i'));

    const paywallConfig = config.paywall_proxy || {};
    const paywallSources = new Set(paywallConfig.sources || []);

    // Merge row/col/url from config into cached data, then filter
    const sources = {};
    for (const src of configSources) {
      const data = cached[src.id] || { label: src.label, items: [], lastHarvest: null };
      const filtered = this.#filterItems(data.items || [], excludePatterns, dedupeWordCount, maxPerSource);
      sources[src.id] = {
        ...data,
        items: filtered,
        row: src.row,
        col: src.col,
        url: src.url,
        siteUrl: src.site_url || null,
        paywall: paywallSources.has(src.id),
      };
    }

    const lastHarvest = Object.values(sources)
      .map(s => s.lastHarvest)
      .filter(Boolean)
      .sort()
      .pop() || null;

    return {
      grid: config.headline_grid || null,
      sources,
      lastHarvest,
      paywallProxy: paywallConfig.url_prefix || null,
    };
  }

  /**
   * Filter, dedupe, and limit headline items
   * @param {Array} items
   * @param {RegExp[]} excludePatterns - regex patterns to exclude
   * @param {number} dedupeWordCount - number of leading words to use for dedup
   * @param {number} max - max items to return
   * @returns {Array}
   */
  #filterItems(items, excludePatterns, dedupeWordCount, max) {
    let filtered = items;

    // Exclude by regex patterns
    if (excludePatterns.length > 0) {
      filtered = filtered.filter(item =>
        !excludePatterns.some(re => re.test(item.title))
      );
    }

    // Dedupe by first N words
    if (dedupeWordCount > 0) {
      const seen = new Set();
      filtered = filtered.filter(item => {
        const key = (item.title || '').split(/\s+/).slice(0, dedupeWordCount).join(' ').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Limit
    return filtered.slice(0, max);
  }

  /**
   * Harvest a single source by ID
   * @param {string} sourceId
   * @param {string} username
   * @returns {Promise<{ items: number, error: boolean }>}
   */
  async harvestSource(sourceId, username) {
    const sources = this.#getSources(username);
    const source = sources.find(s => s.id === sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);

    const config = this.#getUserConfig(username);
    const retentionHours = config.headlines?.retention_hours || 48;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    const result = await this.#harvester.harvest(source);
    await this.#headlineStore.saveSource(source.id, result, username);
    await this.#headlineStore.pruneOlderThan(source.id, cutoff, username);

    return { items: result.items.length, error: !!result.error };
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
