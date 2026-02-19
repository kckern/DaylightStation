// backend/src/3_applications/feed/services/FeedAssemblyService.mjs
/**
 * FeedAssemblyService
 *
 * Orchestrator for mixed-content feed assembly.
 * Delegates source fetching to FeedPoolManager and uses TierAssemblyService
 * for four-tier interleaving (wire, library, scrapbook, compass).
 *
 * Source-specific logic lives in FeedPoolManager and adapters (1_adapters/feed/sources/).
 *
 * @module applications/feed/services
 */

import { ScrollConfigLoader } from './ScrollConfigLoader.mjs';
import { FeedFilterResolver } from './FeedFilterResolver.mjs';
import { probeImageDimensions } from '#system/utils/probeImageDimensions.mjs';

export class FeedAssemblyService {
  #feedPoolManager;
  #sourceAdapters;
  #scrollConfigLoader;
  #tierAssemblyService;
  #feedContentService;
  #selectionTrackingStore;
  #feedFilterResolver;
  #spacingEnforcer;
  #contentPluginRegistry;
  #logger;

  /** LRU cache of recently-served items (keyed by item.id) */
  #itemCache = new Map();
  static #CACHE_MAX = 500;

  /** Assembled-list cache for cursor pagination (keyed by username) */
  #assembledCache = new Map();
  static #ASSEMBLED_TTL = 60_000; // 1 minute

  /**
   * @param {Object} deps
   * @param {FeedPoolManager} deps.feedPoolManager - Pool manager for source fetching (required)
   * @param {Object} [deps.scrollConfigLoader=null] - Scroll config loader; without it batch_size defaults to 15 with minimal spacing/tier config
   * @param {Object} [deps.tierAssemblyService=null] - Tier interleaver; without it items are not sorted into wire/library/scrapbook/compass tiers
   * @param {Object} [deps.feedContentService=null] - Article content extractor; without it article detail view returns null for link-based items
   * @param {Object} [deps.selectionTrackingStore=null] - Selection tracking store; without it headline sort bias and selection counts are skipped
   * @param {FeedFilterResolver} [deps.feedFilterResolver=null] - Filter resolver for ?filter= param; without it filter queries are ignored
   * @param {Object} [deps.spacingEnforcer=null] - Consecutive-subsource spacing enforcer; without it no max_consecutive spacing rules are applied
   * @param {Object} [deps.logger=console] - Logger instance; falls back to console
   * @param {Object[]} [deps.sourceAdapters=null] - Source adapters for getDetail(); without them detail requests fall back to generic article extraction only
   */
  constructor({
    feedPoolManager,
    scrollConfigLoader = null,
    tierAssemblyService = null,
    feedContentService = null,
    selectionTrackingStore = null,
    feedFilterResolver = null,
    spacingEnforcer = null,
    contentPluginRegistry = null,
    logger = console,
    // Keep sourceAdapters for getDetail()
    sourceAdapters = null,
    // Legacy params accepted but unused (kept for bootstrap compat)
    dataService,
    configService,
    freshRSSAdapter,
    headlineService,
    entropyService,
    contentQueryService,
    contentRegistry,
    userDataService,
    queryConfigs,
    feedCacheService,
  }) {
    this.#feedPoolManager = feedPoolManager;
    this.#scrollConfigLoader = scrollConfigLoader;
    this.#tierAssemblyService = tierAssemblyService;
    this.#feedContentService = feedContentService || null;
    this.#selectionTrackingStore = selectionTrackingStore;
    this.#feedFilterResolver = feedFilterResolver;
    this.#spacingEnforcer = spacingEnforcer;
    this.#contentPluginRegistry = contentPluginRegistry;
    this.#logger = logger;

    this.#sourceAdapters = new Map();
    if (sourceAdapters) {
      for (const adapter of (Array.isArray(sourceAdapters) ? sourceAdapters : [])) {
        this.#sourceAdapters.set(adapter.sourceType, adapter);
      }
    }
  }

  /**
   * Get next batch of mixed feed items.
   *
   * @param {string} username
   * @param {Object} options
   * @param {number} [options.limit] - Max items to return (defaults to scroll config batch_size)
   * @param {string} [options.cursor] - ID of last item seen; slices into cached assembled list
   * @param {string} [options.focus] - Focus source key (e.g. 'reddit:science')
   * @param {string[]} [options.sources] - Filter to specific source types (e.g. ['komga','reddit'])
   * @returns {Promise<{ items: FeedItem[], hasMore: boolean }>}
   */
  async getNextBatch(username, { limit, cursor, focus, sources, nocache, filter } = {}) {
    const scrollConfig = this.#scrollConfigLoader?.load(username)
      || { batch_size: 15, spacing: { max_consecutive: 1 }, tiers: {} };

    const effectiveLimit = limit ?? scrollConfig.batch_size ?? 15;

    // Resolve ?filter= param (takes precedence over ?source= and ?focus=)
    if (filter && this.#feedFilterResolver) {
      const resolved = this.#feedFilterResolver.resolve(filter);
      if (resolved) {
        return this.#getFilteredBatch(username, resolved, scrollConfig, effectiveLimit, cursor);
      }
    }

    // Fresh load: reset pool manager
    if (!cursor) {
      this.#feedPoolManager.reset(username);
    }

    // Get available items from pool
    const freshPool = await this.#feedPoolManager.getPool(username, scrollConfig);

    // Post-process: content-type enrichment
    if (this.#contentPluginRegistry) {
      this.#contentPluginRegistry.enrich(freshPool);
    }

    // Source filter: bypass tier assembly
    if (sources && sources.length > 0) {
      let filtered = freshPool
        .filter(item => sources.includes(item.source))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      if (this.#spacingEnforcer) {
        filtered = this.#spacingEnforcer.enforce(filtered, scrollConfig);
      }
      const batch = filtered.slice(0, effectiveLimit);
      for (const item of batch) this.#cacheItem(item);
      this.#feedPoolManager.markSeen(username, batch.map(i => i.id));
      return {
        items: batch,
        hasMore: this.#feedPoolManager.hasMore(username),
        colors: ScrollConfigLoader.extractColors(scrollConfig),
      };
    }

    // Load selection tracking for sort bias
    const selectionCounts = this.#selectionTrackingStore
      ? await this.#selectionTrackingStore.getAll(username)
      : null;

    // Primary pass: tier assembly (with wire decay based on batch number)
    const batchNumber = this.#feedPoolManager.getBatchNumber(username);
    const { items: primary, feed_assembly } = this.#tierAssemblyService.assemble(
      freshPool, scrollConfig, { effectiveLimit, focus, selectionCounts, batchNumber }
    );

    let batch = primary.slice(0, effectiveLimit);

    // Padding pass: fill remaining slots from padding sources
    if (batch.length < effectiveLimit) {
      const paddingSources = ScrollConfigLoader.getPaddingSources(scrollConfig);
      if (paddingSources.size > 0) {
        const batchIds = new Set(batch.map(i => i.id));
        const padding = freshPool.filter(i => paddingSources.has(i.source) && !batchIds.has(i.id));
        // Shuffle padding
        for (let i = padding.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [padding[i], padding[j]] = [padding[j], padding[i]];
        }
        batch = [...batch, ...padding.slice(0, effectiveLimit - batch.length)];
      }
    }

    // Cycling pass: last resort — duplicate existing items to fill the batch.
    // Only cycles when the pool is truly exhausted (not the first batch, and
    // no more sources can provide fresh items).
    if (batch.length < effectiveLimit && batch.length > 0 && batchNumber > 1) {
      const originals = [...batch];
      let dupIndex = 1;
      while (batch.length < effectiveLimit) {
        const source = originals[batch.length % originals.length];
        batch.push({ ...source, id: `${source.id}:dup${dupIndex++}` });
      }
    }

    // Guardrail: probe dimensions for any items with images but no dims
    await FeedAssemblyService.#probeMissingDimensions(batch);

    // Mark seen + cache
    const batchIds = batch.map(i => i.id);
    this.#feedPoolManager.markSeen(username, batchIds);
    for (const item of batch) this.#cacheItem(item);

    // Increment selection tracking for headline items
    if (this.#selectionTrackingStore) {
      const trackableIds = batch
        .filter(i => i.id?.startsWith('headline:'))
        .map(i => i.id.replace(/^headline:/, ''));
      if (trackableIds.length) {
        await this.#selectionTrackingStore.incrementBatch(trackableIds, username);
      }
    }

    this.#logger.info?.('feed.assembly.batch', feed_assembly);

    return {
      items: batch,
      hasMore: this.#feedPoolManager.hasMore(username),
      colors: ScrollConfigLoader.extractColors(scrollConfig),
      feed_assembly,
    };
  }

  /**
   * Fetch detail sections for a specific feed item.
   * @param {string} itemId - Full item ID (e.g. "reddit:abc123")
   * @param {Object} itemMeta - The item's meta object (passed from frontend)
   * @param {string} username
   * @returns {Promise<{ sections: Array } | null>}
   */
  async getDetail(itemId, itemMeta, username, opts = {}) {
    const colonIdx = itemId.indexOf(':');
    if (colonIdx === -1) return null;

    const source = itemId.slice(0, colonIdx);
    const localId = itemId.slice(colonIdx + 1);

    // Check registered source adapters first
    const adapter = this.#sourceAdapters.get(source);
    if (adapter && typeof adapter.getDetail === 'function') {
      const result = await adapter.getDetail(localId, itemMeta || {}, username, opts);
      if (result) return result;
    }

    // Generic fallback: any item with a link gets article extraction
    if (itemMeta?.link) {
      return this.#getArticleDetail(itemMeta.link);
    }

    return null;
  }

  /**
   * Retrieve a cached item and its detail in one call (for deep-link resolution).
   * @param {string} itemId - Full item ID (e.g. "reddit:abc123")
   * @param {string} username
   * @returns {Promise<{ item: FeedItem, sections, ogImage, ogDescription } | null>}
   */
  async getItemWithDetail(itemId, username) {
    const item = this.#itemCache.get(itemId);
    if (!item) return null;

    const detail = await this.getDetail(itemId, item.meta || {}, username);
    return {
      item,
      sections: detail?.sections || [],
      ogImage: detail?.ogImage || null,
      ogDescription: detail?.ogDescription || null,
    };
  }

  /**
   * Return a filtered batch — bypasses tier assembly.
   * Items are sorted by timestamp (newest first).
   */
  async #getFilteredBatch(username, resolved, scrollConfig, effectiveLimit, cursor) {
    if (!cursor) {
      this.#feedPoolManager.reset(username);
    }

    const freshPool = await this.#feedPoolManager.getPool(username, scrollConfig, { stripLimits: true });

    let filtered;
    switch (resolved.type) {
      case 'tier':
        filtered = freshPool.filter(item => item.tier === resolved.tier);
        break;
      case 'source':
        filtered = freshPool.filter(item => item.source === resolved.sourceType);
        if (resolved.subsources) {
          const subs = new Set(resolved.subsources.map(s => s.toLowerCase()));
          filtered = filtered.filter(item => {
            const itemSub = (item.meta?.subreddit || item.meta?.sourceName || '').toLowerCase();
            return subs.has(itemSub);
          });
        }
        break;
      case 'query':
        filtered = freshPool.filter(item =>
          item.meta?.queryName === resolved.queryName
        );
        break;
      default:
        filtered = freshPool;
    }

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (this.#spacingEnforcer) {
      filtered = this.#spacingEnforcer.enforce(filtered, scrollConfig);
    }
    const batch = filtered.slice(0, effectiveLimit);

    for (const item of batch) this.#cacheItem(item);
    this.#feedPoolManager.markSeen(username, batch.map(i => i.id));

    return {
      items: batch,
      hasMore: this.#feedPoolManager.hasMore(username),
      colors: ScrollConfigLoader.extractColors(scrollConfig),
    };
  }

  /**
   * Guardrail: probe image dimensions for batch items that have an image URL
   * but are missing meta.imageWidth / meta.imageHeight.
   * Runs concurrently with a 3s timeout per probe (default in probeImageDimensions).
   */
  static async #probeMissingDimensions(items) {
    await Promise.all(items.map(async item => {
      if (!item.image || (item.meta?.imageWidth && item.meta?.imageHeight)) return;
      const dims = await probeImageDimensions(item.image);
      if (dims) {
        if (!item.meta) item.meta = {};
        item.meta.imageWidth = dims.width;
        item.meta.imageHeight = dims.height;
      }
    }));
  }

  #cacheItem(item) {
    if (!item?.id) return;
    this.#itemCache.delete(item.id);
    this.#itemCache.set(item.id, item);
    if (this.#itemCache.size > FeedAssemblyService.#CACHE_MAX) {
      const oldest = this.#itemCache.keys().next().value;
      this.#itemCache.delete(oldest);
    }
  }

  async #getArticleDetail(url) {
    if (!this.#feedContentService) {
      this.#logger.warn?.('feed.detail.no_content_service');
      return null;
    }
    try {
      const result = await this.#feedContentService.extractReadableContent(url);
      return {
        ogImage: result.ogImage || null,
        ogDescription: result.ogDescription || null,
        sections: [
          { type: 'article', data: { title: result.title, html: result.content, wordCount: result.wordCount } },
        ],
      };
    } catch (err) {
      this.#logger.warn?.('feed.detail.article.error', { url, error: err.message });
      return null;
    }
  }
}

export default FeedAssemblyService;
