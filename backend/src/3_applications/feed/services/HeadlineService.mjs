// backend/src/3_applications/feed/services/HeadlineService.mjs
/**
 * HeadlineService
 *
 * Orchestrates headline harvesting, caching, and retrieval.
 * Reads user config for headline pages (multi-page, config-driven).
 *
 * @module applications/feed/services
 */

import { GOOGLE_NEWS_BLOCKED_IMAGE_PATTERNS } from '#adapters/feed/sources/GoogleNewsFeedAdapter.mjs';
import { SOURCE_BLOCKED_IMAGE_URLS } from '#adapters/feed/RssHeadlineHarvester.mjs';

export class HeadlineService {
  #headlineStore;
  #harvester;
  #dataService;
  #configPath;
  #defaults;
  #webContentGateway;
  #logger;

  constructor({ headlineStore, harvester, dataService, config = {}, webContentGateway, logger = console }) {
    this.#headlineStore = headlineStore;
    this.#harvester = harvester;
    this.#dataService = dataService;
    this.#configPath = config.configPath || 'config/feed';
    this.#defaults = {
      retentionHours: 48,
      maxPerSource: 10,
      dedupeWordCount: 8,
      ...config.defaults,
    };
    this.#webContentGateway = webContentGateway || null;
    this.#logger = logger;
  }

  /**
   * Get user's feed config
   * @param {string} username
   * @returns {Object}
   */
  #getUserConfig(username) {
    return this.#dataService.user.read(this.#configPath, username) || {};
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
    const retentionHours = config.headlines?.retention_hours || this.#defaults.retentionHours;
    const minItems = config.headlines?.max_per_source || this.#defaults.maxPerSource;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    let errors = 0;
    let totalItems = 0;

    for (const source of sources) {
      try {
        const result = await this.#harvester.harvest(source);

        // Strip generic placeholder images from RSS harvest
        this.#stripGenericImages(result.items);

        // Enrich new imageless items with og:image
        const cached = await this.#headlineStore.loadSource(source.id, username);
        const existingIds = new Set((cached?.items || []).map(i => i.id));
        await this.#enrichImages(result.items, existingIds);

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
    const maxPerSource = headlineConfig.max_per_source || this.#defaults.maxPerSource;
    const dedupeWordCount = headlineConfig.dedupe_word_count || this.#defaults.dedupeWordCount;
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
   * Enrich imageless items by fetching og:image from their article pages.
   * Skips items that already have an image or already exist in the cache.
   * Runs with limited concurrency to avoid overwhelming upstream servers.
   *
   * @param {Array} items - Harvested items (mutated in-place)
   * @param {Set<string>} existingIds - IDs already present in the cache
   * @returns {Promise<void>}
   */
  async #enrichImages(items, existingIds) {
    if (!this.#webContentGateway) return;
    const CONCURRENCY = 3;

    const candidates = items.filter(i => !i.image && i.link && !existingIds.has(i.id));
    if (candidates.length === 0) return;

    let active = 0;
    let idx = 0;

    await new Promise((resolve) => {
      const next = () => {
        while (active < CONCURRENCY && idx < candidates.length) {
          const item = candidates[idx++];
          active++;
          this.#webContentGateway.extractReadableContent(item.link)
            .then(result => {
              if (result?.ogImage && !this.#isGenericImage(result.ogImage)) item.image = result.ogImage;
            })
            .catch(err => {
              this.#logger.debug?.('headline.enrich.skip', { link: item.link, error: err.message });
            })
            .finally(() => {
              active--;
              if (idx >= candidates.length && active === 0) resolve();
              else next();
            });
        }
      };
      next();
    });
  }

  /**
   * Check whether a URL is a known generic placeholder image.
   * @param {string} url
   * @returns {boolean}
   */
  #isGenericImage(url) {
    if (!url) return false;
    if (SOURCE_BLOCKED_IMAGE_URLS.has(url)) return true;
    return GOOGLE_NEWS_BLOCKED_IMAGE_PATTERNS.some(re => re.test(url));
  }

  /**
   * Strip generic placeholder images from harvest items (mutates in-place).
   * @param {Array} items
   */
  #stripGenericImages(items) {
    for (const item of items) {
      if (item.image && this.#isGenericImage(item.image)) {
        delete item.image;
        delete item.imageWidth;
        delete item.imageHeight;
      }
    }
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
    const retentionHours = config.headlines?.retention_hours || this.#defaults.retentionHours;
    const minItems = config.headlines?.max_per_source || this.#defaults.maxPerSource;
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    const result = await this.#harvester.harvest(source);

    // Strip generic placeholder images from RSS harvest
    this.#stripGenericImages(result.items);

    // Enrich new imageless items with og:image
    const cached = await this.#headlineStore.loadSource(source.id, username);
    const existingIds = new Set((cached?.items || []).map(i => i.id));
    await this.#enrichImages(result.items, existingIds);

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
