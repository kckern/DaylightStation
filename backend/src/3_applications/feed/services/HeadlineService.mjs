// backend/src/3_applications/feed/services/HeadlineService.mjs
/**
 * HeadlineService
 *
 * Orchestrates headline harvesting, caching, and retrieval.
 * Reads user config for headline pages (multi-page, config-driven).
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
   * Get all configured headline pages
   * @param {string} username
   * @returns {Array<{ id, label, grid, col_colors, sources }>}
   */
  #getPages(username) {
    const config = this.#getUserConfig(username);
    return config.headline_pages || [];
  }

  /**
   * Get a single headline page config by ID
   * @param {string} username
   * @param {string} pageId
   * @returns {{ id, label, grid, col_colors, sources }|null}
   */
  #getPage(username, pageId) {
    return this.#getPages(username).find(p => p.id === pageId) || null;
  }

  /**
   * Get all sources across all pages (or for a specific page)
   * @param {string} username
   * @param {string} [pageId]
   * @returns {Array<{ id, label, url }>}
   */
  #getSources(username, pageId) {
    const pages = pageId
      ? [this.#getPage(username, pageId)].filter(Boolean)
      : this.#getPages(username);
    return pages.flatMap(p => p.sources || []);
  }

  /**
   * Return page metadata (id + label) for all headline pages
   * @param {string} username
   * @returns {Array<{ id, label }>}
   */
  getPageList(username) {
    return this.#getPages(username).map(p => ({ id: p.id, label: p.label }));
  }

  /**
   * Harvest all configured headline sources (optionally filtered to one page)
   * @param {string} username
   * @param {string} [pageId]
   * @returns {Promise<{ harvested, errors, totalItems }>}
   */
  async harvestAll(username, pageId) {
    const sources = this.#getSources(username, pageId);
    const config = this.#getUserConfig(username);
    const retentionHours = config.headlines?.retention_hours || 48;
    const minItems = config.headlines?.max_per_source || 12;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    let errors = 0;
    let totalItems = 0;

    for (const source of sources) {
      try {
        const result = await this.#harvester.harvest(source);
        await this.#headlineStore.saveSource(source.id, result, username);
        // Only prune if enough items would survive — low-volume feeds keep all items
        const survivorCount = result.items.filter(i => new Date(i.timestamp).getTime() >= cutoff.getTime()).length;
        if (survivorCount >= minItems) {
          await this.#headlineStore.pruneOlderThan(source.id, cutoff, username);
        }

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
      pageId: pageId || 'all',
      harvested: sources.length,
      errors,
      totalItems,
    });

    return { harvested: sources.length, errors, totalItems };
  }

  /**
   * Get all cached headlines for a specific page, with grid layout metadata
   * @param {string} username
   * @param {string} pageId
   * @returns {Promise<{ grid, col_colors, sources, lastHarvest, paywallProxy }|null>}
   */
  async getAllHeadlines(username, pageId) {
    const page = this.#getPage(username, pageId);
    if (!page) return null;

    const config = this.#getUserConfig(username);
    const configSources = page.sources || [];
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
        url: src.url || null,
        urls: src.urls || null,
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
      grid: page.grid || null,
      col_colors: page.col_colors || null,
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
   * Harvest a single source by ID (searches all pages)
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
    const minItems = config.headlines?.max_per_source || 12;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    const result = await this.#harvester.harvest(source);
    await this.#headlineStore.saveSource(source.id, result, username);
    const survivorCount = result.items.filter(i => new Date(i.timestamp).getTime() >= cutoff.getTime()).length;
    if (survivorCount >= minItems) {
      await this.#headlineStore.pruneOlderThan(source.id, cutoff, username);
    }

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
