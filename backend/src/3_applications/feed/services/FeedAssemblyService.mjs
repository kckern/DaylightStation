// backend/src/3_applications/feed/services/FeedAssemblyService.mjs
/**
 * FeedAssemblyService
 *
 * Orchestrator for mixed-content feed assembly.
 * Loads query configs, fans out to source adapters/handlers in parallel,
 * normalizes results to FeedItem shape, and delegates to TierAssemblyService
 * for four-tier interleaving (wire, library, scrapbook, compass).
 *
 * Source-specific logic lives in adapters (1_adapters/feed/sources/).
 * Only FreshRSS, Headlines, and Entropy remain inline (they depend on
 * application-layer services rather than external APIs).
 *
 * @module applications/feed/services
 */

import { ScrollConfigLoader } from './ScrollConfigLoader.mjs';
import { probeImageDimensions } from '#system/utils/probeImageDimensions.mjs';

export class FeedAssemblyService {
  #freshRSSAdapter;
  #headlineService;
  #entropyService;
  #queryConfigs;
  #sourceAdapters;
  #scrollConfigLoader;
  #tierAssemblyService;
  #feedContentService;
  #feedCacheService;
  #logger;
  #selectionTrackingStore;

  /** LRU cache of recently-served items (keyed by item.id) */
  #itemCache = new Map();
  static #CACHE_MAX = 500;

  /** Per-user seen-ID tracking (cleared on fresh load, populated each batch) */
  #seenIds = new Map();

  constructor({
    freshRSSAdapter,
    headlineService,
    entropyService = null,
    queryConfigs = null,
    sourceAdapters = null,
    scrollConfigLoader = null,
    tierAssemblyService = null,
    feedContentService = null,
    feedCacheService = null,
    selectionTrackingStore = null,
    logger = console,
    // Legacy params accepted but unused (kept for bootstrap compat)
    dataService,
    configService,
    contentQueryService,
    contentRegistry,
    userDataService,
    spacingEnforcer,
  }) {
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#headlineService = headlineService;
    this.#entropyService = entropyService;
    this.#queryConfigs = queryConfigs;
    this.#scrollConfigLoader = scrollConfigLoader;
    this.#tierAssemblyService = tierAssemblyService;
    this.#feedContentService = feedContentService || null;
    this.#feedCacheService = feedCacheService;
    this.#selectionTrackingStore = selectionTrackingStore;
    this.#logger = logger;

    this.#sourceAdapters = new Map();
    if (sourceAdapters) {
      for (const adapter of sourceAdapters) {
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
  async getNextBatch(username, { limit, cursor, focus, sources, nocache } = {}) {
    const scrollConfig = this.#scrollConfigLoader?.load(username)
      || { batch_size: 15, spacing: { max_consecutive: 1 }, tiers: {} };

    const effectiveLimit = limit ?? scrollConfig.batch_size ?? 15;

    // Fresh load: clear seen IDs
    if (!cursor) {
      this.#seenIds.delete(username);
    }
    const seenIds = this.#seenIds.get(username) || new Set();

    // Fetch all sources
    const allItems = await this.#fetchAllSources(scrollConfig, username, { nocache, sources });

    // Source filter: bypass tier assembly
    if (sources && sources.length > 0) {
      const filtered = allItems
        .filter(item => sources.includes(item.source) && !seenIds.has(item.id))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const batch = filtered.slice(0, effectiveLimit);
      for (const item of batch) {
        seenIds.add(item.id);
        this.#cacheItem(item);
      }
      this.#seenIds.set(username, seenIds);
      return { items: batch, hasMore: filtered.length > batch.length, colors: ScrollConfigLoader.extractColors(scrollConfig) };
    }

    // Remove already-seen items
    const freshPool = allItems.filter(i => !seenIds.has(i.id));

    // Load selection tracking for sort bias
    const selectionCounts = this.#selectionTrackingStore
      ? await this.#selectionTrackingStore.getAll(username)
      : null;

    // Primary pass: normal tier assembly
    const { items: primary } = this.#tierAssemblyService.assemble(
      freshPool, scrollConfig, { effectiveLimit, focus, selectionCounts }
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

    // Record seen IDs
    for (const item of batch) {
      seenIds.add(item.id);
      this.#cacheItem(item);
    }
    this.#seenIds.set(username, seenIds);

    // Increment selection tracking for headline items
    if (this.#selectionTrackingStore) {
      const trackableIds = batch
        .filter(i => i.id?.startsWith('headline:'))
        .map(i => i.id.replace(/^headline:/, ''));
      if (trackableIds.length) {
        await this.#selectionTrackingStore.incrementBatch(trackableIds, username);
      }
    }

    return {
      items: batch,
      hasMore: freshPool.length > seenIds.size,
      colors: ScrollConfigLoader.extractColors(scrollConfig),
    };
  }

  /**
   * Fetch detail sections for a specific feed item.
   * @param {string} itemId - Full item ID (e.g. "reddit:abc123")
   * @param {Object} itemMeta - The item's meta object (passed from frontend)
   * @param {string} username
   * @returns {Promise<{ sections: Array } | null>}
   */
  async getDetail(itemId, itemMeta, username) {
    const colonIdx = itemId.indexOf(':');
    if (colonIdx === -1) return null;

    const source = itemId.slice(0, colonIdx);
    const localId = itemId.slice(colonIdx + 1);

    // Check registered source adapters first
    const adapter = this.#sourceAdapters.get(source);
    if (adapter && typeof adapter.getDetail === 'function') {
      const result = await adapter.getDetail(localId, itemMeta || {}, username);
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

  // ======================================================================
  // Source Dispatch
  // ======================================================================

  async #fetchAllSources(scrollConfig, username, { nocache, sources } = {}) {
    const queries = this.#filterQueries(this.#queryConfigs || [], scrollConfig);

    if (nocache) {
      for (const q of queries) q._noCache = true;
    }

    const results = await Promise.allSettled(
      queries.map(query => this.#fetchSource(query, username))
    );

    const allItems = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        allItems.push(...results[i].value);
      } else {
        this.#logger.warn?.('feed.assembly.source.failed', {
          query: queries[i].type,
          error: results[i].reason?.message || 'Unknown error',
        });
      }
    }
    return allItems;
  }

  async #fetchSource(query, username) {
    const sourceKey = query._filename?.replace('.yml', '') || query.type;

    // If no cache service, fetch directly (backwards compat)
    if (!this.#feedCacheService) {
      return this.#fetchSourceDirect(query, username);
    }

    const noCache = query._noCache || false;
    return this.#feedCacheService.getItems(
      sourceKey,
      () => this.#fetchSourceDirect(query, username),
      username,
      { noCache }
    );
  }

  async #fetchSourceDirect(query, username) {
    // Check adapter registry first
    const adapter = this.#sourceAdapters.get(query.type);
    if (adapter) {
      const items = await adapter.fetchItems(query, username);
      return items.map(item => this.#normalizeToFeedItem(item));
    }

    // Built-in handlers (depend on application-layer services)
    switch (query.type) {
      case 'freshrss': return this.#fetchFreshRSS(query, username);
      case 'headlines': return this.#fetchHeadlines(query, username);
      case 'entropy': return this.#fetchEntropy(query, username);
      default:
        this.#logger.warn?.('feed.assembly.unknown.type', { type: query.type });
        return [];
    }
  }

  // ======================================================================
  // Built-in Handlers (application-layer service dependencies)
  // ======================================================================

  async #fetchFreshRSS(query, username) {
    if (!this.#freshRSSAdapter) return [];
    const items = await this.#freshRSSAdapter.getItems(
      'user/-/state/com.google/reading-list',
      username,
      { excludeRead: query.params?.excludeRead ?? true, count: query.limit || 20 }
    );
    const mapped = (items || []).map(item => this.#normalizeToFeedItem({
      id: `freshrss:${item.id}`,
      tier: query.tier || 'wire',
      source: 'freshrss',
      title: item.title,
      body: item.content ? item.content.replace(/<[^>]*>/g, '').slice(0, 200) : null,
      image: this.#extractImage(item.content),
      link: item.link,
      timestamp: item.published?.toISOString?.() || item.published || new Date().toISOString(),
      priority: query.priority || 0,
      meta: {
        feedTitle: item.feedTitle,
        author: item.author,
        sourceName: item.feedTitle || 'RSS',
        sourceIcon: this.#getFaviconUrl(item.link),
      },
    }));

    // Probe FreshRSS image dimensions in parallel
    await Promise.all(mapped.map(async (item) => {
      if (!item.image) return;
      try {
        const dims = await probeImageDimensions(item.image);
        if (dims) {
          item.meta = { ...item.meta, imageWidth: dims.width, imageHeight: dims.height };
        }
      } catch { /* ignore probe failures */ }
    }));

    return mapped;
  }

  async #fetchHeadlines(query, username) {
    if (!this.#headlineService) return [];
    const pages = this.#headlineService.getPageList(username);
    const firstPageId = pages[0]?.id;
    if (!firstPageId) return [];
    const result = await this.#headlineService.getAllHeadlines(username, firstPageId);
    const items = [];
    const totalLimit = query.limit || 30;
    const sourceEntries = Object.entries(result.sources || {});
    const perSourceLimit = Math.ceil(totalLimit / Math.max(1, sourceEntries.length));

    for (const [sourceId, source] of sourceEntries) {
      if (items.length >= totalLimit) break;
      const remaining = totalLimit - items.length;
      const sourceLimit = Math.min(perSourceLimit, remaining);

      for (const item of (source.items || []).slice(0, sourceLimit)) {
        items.push(this.#normalizeToFeedItem({
          id: `headline:${sourceId}:${item.link}`,
          tier: query.tier || 'wire',
          source: 'headline',
          title: item.title,
          body: item.desc || null,
          image: item.image || null,
          link: item.link,
          timestamp: item.timestamp || new Date().toISOString(),
          priority: query.priority || 0,
          meta: {
            sourceId,
            sourceLabel: source.label,
            sourceName: source.label || sourceId,
            sourceIcon: this.#getFaviconUrl(item.link),
            paywall: source.paywall || false,
            paywallProxy: source.paywall ? result.paywallProxy : null,
            ...(item.imageWidth && item.imageHeight
              ? { imageWidth: item.imageWidth, imageHeight: item.imageHeight }
              : {}),
          },
        }));
      }
    }
    return items;
  }

  async #fetchEntropy(query, username) {
    if (!this.#entropyService) return [];
    const report = await this.#entropyService.getReport(username);
    let items = report.items || [];
    if (query.params?.onlyYellowRed) {
      items = items.filter(item => item.status === 'yellow' || item.status === 'red');
    }
    return items.map(item => this.#normalizeToFeedItem({
      id: `entropy:${item.source}`,
      tier: query.tier || 'compass',
      source: 'entropy',
      title: item.name || item.source,
      body: item.label || `${item.value} since last update`,
      image: null,
      link: item.url || null,
      timestamp: item.lastUpdate || new Date().toISOString(),
      priority: query.priority || 20,
      meta: { status: item.status, icon: item.icon, value: item.value, weight: item.weight, sourceName: 'Data Freshness', sourceIcon: null },
    }));
  }

  // ======================================================================
  // Helpers
  // ======================================================================

  static #stripInlineMarkdown(text) {
    if (!text) return { text: text || '', firstUrl: null };
    let firstUrl = null;
    const stripped = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label, url) => {
      if (!firstUrl) firstUrl = url;
      return label;
    });
    const cleaned = stripped
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1');
    return { text: cleaned, firstUrl };
  }

  #normalizeToFeedItem(raw) {
    const { text: title, firstUrl: titleUrl } = FeedAssemblyService.#stripInlineMarkdown(raw.title);
    const { text: body, firstUrl: bodyUrl } = FeedAssemblyService.#stripInlineMarkdown(raw.body);
    const link = raw.link || titleUrl || bodyUrl || null;

    return {
      id: raw.id,
      tier: raw.tier,
      source: raw.source,
      title,
      body: body || null,
      image: raw.image || null,
      link,
      timestamp: raw.timestamp || new Date().toISOString(),
      priority: raw.priority || 0,
      meta: {
        ...raw.meta,
        sourceName: raw.meta?.sourceName || raw.source,
        sourceIcon: raw.meta?.sourceIcon || null,
      },
    };
  }

  #getFaviconUrl(link) {
    if (!link) return null;
    try {
      return new URL(link).origin;
    } catch { return null; }
  }

  /**
   * Filter query configs to sources enabled in scroll config tiers.
   * When no sources are configured across any tier, all queries pass.
   */
  #filterQueries(queries, scrollConfig) {
    const enabledSources = ScrollConfigLoader.getEnabledSources(scrollConfig);
    if (enabledSources.size === 0) return queries;

    return queries.filter(query => {
      const key = query._filename?.replace('.yml', '');
      return key && enabledSources.has(key);
    });
  }

  #extractImage(html) {
    if (!html) return null;
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }
}

export default FeedAssemblyService;
