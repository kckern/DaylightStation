// backend/src/3_applications/feed/services/HeadlineService.mjs
import stringSimilarity from 'string-similarity';
import { canonicalizeFeedUrl } from '#domains/feed/feedItem.mjs';

/**
 * HeadlineService
 *
 * Orchestrates headline harvesting, caching, and retrieval.
 * Reads user config for headline pages (multi-page, config-driven).
 *
 * @module applications/feed/services
 */

export class HeadlineService {
  #headlineStore;
  #harvester;
  #dataService;
  #configPath;
  #defaults;
  #webContentGateway;
  #blockedImageUrls;
  #blockedImagePatterns;
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
    // Vendor-specific generic-placeholder image lists, injected as VALUES from
    // the composition root (they live with the feed adapters).
    this.#blockedImageUrls = config.blockedImageUrls instanceof Set
      ? config.blockedImageUrls
      : new Set(config.blockedImageUrls || []);
    this.#blockedImagePatterns = config.blockedImagePatterns || [];
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

        // Guard: never overwrite a populated cache with an empty harvest
        const cached = await this.#headlineStore.loadSource(source.id, username);
        if ((!result.items || result.items.length === 0) && cached?.items?.length > 0) {
          this.#logger.warn?.('headline.service.harvest.empty_guard', {
            source: source.id,
            cachedItems: cached.items.length,
            msg: 'Harvest returned empty — keeping existing cache',
          });
          errors++;
          continue;
        }

        // Enrich new imageless items with og:image
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
    const rowCount = page.grid?.rows?.length || 0;
    const colCount = page.grid?.cols?.length || 0;
    const placements = new Set();
    const configWarnings = [];

    // Merge row/col/url from config into cached data, then filter
    const sources = {};
    for (const src of configSources) {
      const placement = `${src.row}:${src.col}`;
      if (!Number.isInteger(src.row) || !Number.isInteger(src.col) || src.row < 0 || src.col < 0 || src.row >= rowCount || src.col >= colCount) {
        configWarnings.push({ source: src.id, code: 'OUT_OF_RANGE', row: src.row, col: src.col });
      } else if (placements.has(placement)) {
        configWarnings.push({ source: src.id, code: 'DUPLICATE_PLACEMENT', row: src.row, col: src.col });
      }
      placements.add(placement);
      const data = cached[src.id] || { label: src.label, items: [], lastHarvest: null };
      const filtered = this.#filterItems(data.items || [], excludePatterns, dedupeWordCount, maxPerSource);
      sources[src.id] = {
        ...data,
        label: src.label || data.label || src.id,
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
      briefing: this.#buildBriefing(sources),
      configWarnings,
    };
  }

  #buildBriefing(sources) {
    const candidates = Object.entries(sources).flatMap(([sourceId, source]) =>
      (source.items || []).map(item => ({
        ...item,
        sourceId,
        sourceLabel: source.label || sourceId,
        canonicalUrl: canonicalizeFeedUrl(item.link || item.url),
        publishedAt: item.publishedAt || item.timestamp || item.published || null,
      })),
    ).sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

    const clusters = [];
    const windowMs = 36 * 60 * 60 * 1000;
    for (const item of candidates) {
      const normalizedTitle = this.#normalizeClusterTitle(item.title);
      const match = clusters.find(cluster => {
        if (item.canonicalUrl && cluster.canonicalUrls.has(item.canonicalUrl)) return true;
        if (cluster.sourceIds.has(item.sourceId)) return false;
        const age = Math.abs(new Date(cluster.publishedAt || 0) - new Date(item.publishedAt || 0));
        return age <= windowMs
          && normalizedTitle.split(' ').length >= 5
          && stringSimilarity.compareTwoStrings(cluster.normalizedTitle, normalizedTitle) >= 0.72;
      });
      if (match) {
        match.coverage.push(item);
        match.sourceIds.add(item.sourceId);
        if (item.canonicalUrl) match.canonicalUrls.add(item.canonicalUrl);
      } else {
        clusters.push({
          id: item.canonicalUrl || `${item.sourceId}:${item.id || normalizedTitle}`,
          title: item.title,
          excerpt: item.desc || item.summary || '',
          publishedAt: item.publishedAt,
          leadSource: item.sourceLabel,
          normalizedTitle,
          canonicalUrls: new Set(item.canonicalUrl ? [item.canonicalUrl] : []),
          sourceIds: new Set([item.sourceId]),
          coverage: [item],
        });
      }
    }
    return clusters
      .sort((a, b) => b.sourceIds.size - a.sourceIds.size || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
      .slice(0, 40)
      .map(cluster => {
        const coverage = cluster.coverage.map(item => ({
          id: item.id,
          title: item.title,
          url: item.link || item.url,
          sourceId: item.sourceId,
          sourceLabel: item.sourceLabel,
          publishedAt: item.publishedAt,
        }));
        const timeline = [...coverage]
          .filter(item => item.publishedAt)
          .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
          .map(item => ({
            ...item,
            kind: /\b(correction|corrected)\b/i.test(item.title) ? 'correction'
              : /\b(update|updated|developing|live)\b/i.test(item.title) ? 'update'
                : 'report',
          }));
        return {
          id: cluster.id,
          title: cluster.title,
          excerpt: cluster.excerpt,
          publishedAt: cluster.publishedAt,
          leadSource: cluster.leadSource,
          sourceCount: cluster.sourceIds.size,
          coverage,
          timeline,
        };
      });
  }

  #normalizeClusterTitle(value) {
    const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'from']);
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !stop.has(word))
      .join(' ');
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
    if (this.#blockedImageUrls.has(url)) return true;
    return this.#blockedImagePatterns.some(re => re.test(url));
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

    // Guard: never overwrite a populated cache with an empty harvest
    const cached = await this.#headlineStore.loadSource(source.id, username);
    if ((!result.items || result.items.length === 0) && cached?.items?.length > 0) {
      this.#logger.warn?.('headline.service.harvest.empty_guard', {
        source: sourceId,
        cachedItems: cached.items.length,
        msg: 'Harvest returned empty — keeping existing cache',
      });
      return { items: 0, error: true };
    }

    // Enrich new imageless items with og:image
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
