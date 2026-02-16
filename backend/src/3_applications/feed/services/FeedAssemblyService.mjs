// backend/src/3_applications/feed/services/FeedAssemblyService.mjs
/**
 * FeedAssemblyService
 *
 * Pure orchestrator for mixed-content feed assembly.
 * Loads query configs, fans out to source adapters/handlers in parallel,
 * normalizes results to FeedItem shape, and interleaves external
 * content with grounding content using a time-decay ratio.
 *
 * Source-specific logic lives in adapters (1_adapters/feed/sources/).
 * Only FreshRSS, Headlines, and Entropy remain inline (they depend on
 * application-layer services rather than external APIs).
 *
 * @module applications/feed/services
 */

export class FeedAssemblyService {
  #freshRSSAdapter;
  #headlineService;
  #entropyService;
  #queryConfigs;
  #sourceAdapters;
  #logger;

  constructor({
    freshRSSAdapter,
    headlineService,
    entropyService = null,
    queryConfigs = null,
    sourceAdapters = null,
    logger = console,
    // Legacy params accepted but unused (kept for bootstrap compat)
    dataService,
    configService,
    contentQueryService,
    contentRegistry,
    userDataService,
  }) {
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#headlineService = headlineService;
    this.#entropyService = entropyService;
    this.#queryConfigs = queryConfigs;
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
   * @param {number} [options.limit=15] - Max items to return
   * @param {string} [options.cursor] - Pagination cursor (unused in Phase 1)
   * @param {string} [options.sessionStartedAt] - ISO timestamp for grounding ratio calc
   * @returns {Promise<{ items: FeedItem[], hasMore: boolean }>}
   */
  async getNextBatch(username, { limit = 15, cursor, sessionStartedAt } = {}) {
    const queries = this.#queryConfigs || [];

    // Fan out to all source handlers in parallel
    const results = await Promise.allSettled(
      queries.map(query => this.#fetchSource(query, username))
    );

    // Collect successful results, log failures
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

    // Separate external vs grounding
    const external = allItems
      .filter(item => item.type === 'external')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const grounding = allItems
      .filter(item => item.type === 'grounding')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Calculate grounding ratio based on session duration
    const sessionMinutes = sessionStartedAt
      ? (Date.now() - new Date(sessionStartedAt).getTime()) / 60000
      : 0;
    const ratio = this.#calculateGroundingRatio(sessionMinutes);

    // Interleave
    const interleaved = this.#interleave(external, grounding, ratio);

    // Deduplicate by id
    const seen = new Set();
    const deduplicated = interleaved.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    // Paginate
    const items = deduplicated.slice(0, limit);
    const hasMore = deduplicated.length > limit || external.length >= 10;

    this.#logger.info?.('feed.assembly.batch', {
      username,
      total: allItems.length,
      external: external.length,
      grounding: grounding.length,
      ratio,
      returned: items.length,
    });

    return { items, hasMore };
  }

  // ======================================================================
  // Source Dispatch
  // ======================================================================

  async #fetchSource(query, username) {
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
    return (items || []).map(item => this.#normalizeToFeedItem({
      id: `freshrss:${item.id}`,
      type: query.feed_type || 'external',
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
  }

  async #fetchHeadlines(query, username) {
    if (!this.#headlineService) return [];
    const result = await this.#headlineService.getAllHeadlines(username);
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
          type: query.feed_type || 'external',
          source: 'headline',
          title: item.title,
          body: item.desc || null,
          image: null,
          link: item.link,
          timestamp: item.timestamp || new Date().toISOString(),
          priority: query.priority || 0,
          meta: {
            sourceId,
            sourceLabel: source.label,
            sourceName: source.label || sourceId,
            sourceIcon: this.#getFaviconUrl(item.link),
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
      type: query.feed_type || 'grounding',
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

  #normalizeToFeedItem(raw) {
    return {
      id: raw.id,
      type: raw.type,
      source: raw.source,
      title: raw.title || '',
      body: raw.body || null,
      image: raw.image || null,
      link: raw.link || null,
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

  #calculateGroundingRatio(sessionMinutes) {
    return Math.max(2, Math.floor(5 * Math.pow(0.85, sessionMinutes / 5)));
  }

  #interleave(external, grounding, ratio) {
    const result = [];
    let gIdx = 0;

    for (let i = 0; i < external.length; i++) {
      result.push(external[i]);
      if ((i + 1) % ratio === 0 && gIdx < grounding.length) {
        result.push(grounding[gIdx++]);
      }
    }

    while (gIdx < grounding.length) {
      result.push(grounding[gIdx++]);
    }

    return result;
  }

  #extractImage(html) {
    if (!html) return null;
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }
}

export default FeedAssemblyService;
