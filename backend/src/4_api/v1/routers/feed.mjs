// backend/src/4_api/v1/routers/feed.mjs
/**
 * Feed API Router
 *
 * Three sub-groups:
 * - /reader/*  -- FreshRSS Google Reader API proxy
 * - /headlines/* -- Cached headline data
 * - /scroll/*  -- Merged chronological feed (boonscrolling skeleton)
 *
 * @module api/v1/routers/feed
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * @param {Object} config
 * @param {Object} config.freshRSSAdapter - FreshRSSFeedAdapter instance
 * @param {Object} config.headlineService - HeadlineService instance
 * @param {Object} config.feedAssemblyService - FeedAssemblyService for scroll endpoint
 * @param {Object} config.feedContentService - FeedContentService for icon/readable endpoints
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createFeedRouter(config) {
  const { freshRSSAdapter, headlineService, feedAssemblyService, feedContentService, dismissedItemsStore, sourceAdapters = [], configService, logger = console } = config;

  // Build adapter lookup map by sourceType for dismiss routing
  const adapterMap = new Map();
  for (const adapter of sourceAdapters) {
    if (adapter.sourceType && typeof adapter.markRead === 'function') {
      adapterMap.set(adapter.sourceType, adapter);
    }
  }
  const router = express.Router();

  const getUsername = () => {
    return configService?.getHeadOfHousehold?.() || 'default';
  };

  // =========================================================================
  // Reader (FreshRSS proxy)
  // =========================================================================

  router.get('/reader/categories', asyncHandler(async (req, res) => {
    const username = getUsername();
    const categories = await freshRSSAdapter.getCategories(username);
    res.json(categories);
  }));

  router.get('/reader/feeds', asyncHandler(async (req, res) => {
    const username = getUsername();
    const feeds = await freshRSSAdapter.getFeeds(username);
    res.json(feeds);
  }));

  router.get('/reader/items', asyncHandler(async (req, res) => {
    const { feed, count, continuation, excludeRead } = req.query;
    if (!feed) {
      return res.status(400).json({ error: 'feed parameter required' });
    }
    const username = getUsername();
    const { items, continuation: nextContinuation } = await freshRSSAdapter.getItems(feed, username, {
      count: count ? Number(count) : undefined,
      continuation,
      excludeRead: excludeRead === 'true',
    });
    res.json({ items, continuation: nextContinuation });
  }));

  router.post('/reader/items/mark', asyncHandler(async (req, res) => {
    const { itemIds, action } = req.body;
    const username = getUsername();

    if (action === 'read') {
      await freshRSSAdapter.markRead(itemIds, username);
    } else if (action === 'unread') {
      await freshRSSAdapter.markUnread(itemIds, username);
    } else {
      return res.status(400).json({ error: 'action must be "read" or "unread"' });
    }

    res.json({ ok: true });
  }));

  router.get('/reader/stream', asyncHandler(async (req, res) => {
    const { count, continuation, excludeRead, feeds } = req.query;
    const username = getUsername();
    const streamId = 'user/-/state/com.google/reading-list';
    const { items, continuation: nextContinuation } = await freshRSSAdapter.getItems(streamId, username, {
      count: count ? Number(count) : 50,
      continuation,
      excludeRead: excludeRead === 'true',
    });

    // Add isRead flag and plain-text preview to each item
    const READ_TAG = 'user/-/state/com.google/read';
    const enriched = items.map(item => {
      const isRead = (item.categories || []).some(c => c.includes(READ_TAG));
      // Strip HTML for preview
      const preview = item.content
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      // Extract category labels (user/-/label/Foo → Foo)
      const tags = (item.categories || [])
        .filter(c => c.includes('/label/'))
        .map(c => c.split('/label/').pop());
      return { ...item, isRead, preview, tags };
    });

    // Filter by feed IDs if specified
    let filtered = enriched;
    if (feeds) {
      const feedSet = new Set(feeds.split(','));
      filtered = enriched.filter(item => feedSet.has(item.feedId));
    }

    res.json({ items: filtered, continuation: nextContinuation });
  }));

  // =========================================================================
  // Headlines (cached, multi-page config-driven)
  // =========================================================================

  // Page list — returns [{id, label}] for all configured headline pages
  router.get('/headlines/pages', asyncHandler(async (req, res) => {
    const username = getUsername();
    res.json(headlineService.getPageList(username));
  }));

  // Harvest all pages (or one page via ?page=ID)
  router.post('/headlines/harvest', asyncHandler(async (req, res) => {
    const username = getUsername();
    const pageId = req.query.page || undefined;
    const result = await headlineService.harvestAll(username, pageId);
    res.json(result);
  }));

  // Harvest a single source by ID
  router.post('/headlines/harvest/:source', asyncHandler(async (req, res) => {
    const username = getUsername();
    const result = await headlineService.harvestSource(req.params.source, username);
    res.json(result);
  }));

  // Get headlines for a page — ?page=ID (defaults to first page)
  router.get('/headlines', asyncHandler(async (req, res) => {
    const username = getUsername();
    const pages = headlineService.getPageList(username);
    const pageId = req.query.page || pages[0]?.id;

    if (!pageId) return res.json({ grid: null, sources: {}, lastHarvest: null });

    const result = await headlineService.getAllHeadlines(username, pageId);
    if (!result) return res.status(404).json({ error: 'Page not found', page: pageId });
    res.json(result);
  }));

  // Get headlines for a single source
  router.get('/headlines/:source', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const username = getUsername();
    const result = await headlineService.getSourceHeadlines(source, username);

    if (!result) {
      return res.status(404).json({ error: 'Source not found', source });
    }

    res.json(result);
  }));

  // =========================================================================
  // Scroll (merged feed -- skeleton)
  // =========================================================================

  router.get('/scroll', asyncHandler(async (req, res) => {
    const username = getUsername();
    const { cursor, limit, focus, source, nocache, filter } = req.query;

    const result = await feedAssemblyService.getNextBatch(username, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      focus: focus || null,
      sources: source ? source.split(',').map(s => s.trim()) : null,
      nocache: nocache === '1',
      filter: filter || null,
    });

    res.json(result);
  }));

  // Single-item lookup (deep-link resolution — returns item + detail)
  // Accepts base64url-encoded item ID slug (same encoding used in frontend URLs)
  router.get('/scroll/item/:slug', asyncHandler(async (req, res) => {
    const { slug } = req.params;
    if (!slug) return res.status(400).json({ error: 'slug required' });

    // Decode base64url → original item ID
    let itemId;
    try {
      let s = slug.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      itemId = Buffer.from(s, 'base64').toString('utf-8');
    } catch {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    const username = getUsername();
    const result = await feedAssemblyService.getItemWithDetail(itemId, username);
    if (!result) return res.status(404).json({ error: 'Item not found or expired' });

    res.json(result);
  }));

  // Dismiss / mark-read items (removes from future scroll batches)
  router.post('/scroll/dismiss', asyncHandler(async (req, res) => {
    const { itemIds } = req.body;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }

    const username = getUsername();

    // Partition by source type: route to adapter.markRead() or YAML dismiss store
    const bySource = new Map(); // sourceType → [prefixedIds]
    const otherIds = [];

    for (const id of itemIds) {
      const colonIdx = id.indexOf(':');
      if (colonIdx > 0) {
        const sourceType = id.slice(0, colonIdx);
        if (adapterMap.has(sourceType)) {
          if (!bySource.has(sourceType)) bySource.set(sourceType, []);
          bySource.get(sourceType).push(id);
          continue;
        }
      }
      otherIds.push(id);
    }

    const promises = [];

    for (const [sourceType, ids] of bySource) {
      const adapter = adapterMap.get(sourceType);
      promises.push(
        adapter.markRead(ids, username).catch(err => {
          logger.warn?.('feed.dismiss.adapter.error', { sourceType, error: err.message, count: ids.length });
        })
      );
    }

    if (otherIds.length > 0 && dismissedItemsStore) {
      dismissedItemsStore.add(otherIds);
    }

    await Promise.all(promises);

    res.json({ dismissed: itemIds.length });
  }));

  // =========================================================================
  // Detail (level 2 expanded content)
  // =========================================================================

  router.get('/detail/:itemId', asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    if (!itemId) return res.status(400).json({ error: 'itemId required' });

    const username = getUsername();
    let meta = {};
    if (req.query.meta) {
      try { meta = JSON.parse(req.query.meta); } catch { /* ignore */ }
    }
    if (req.query.link) meta.link = req.query.link;

    const result = await feedAssemblyService.getDetail(itemId, meta, username);
    if (!result) return res.status(404).json({ error: 'No detail available' });

    res.json(result);
  }));

  // =========================================================================
  // Icon proxy (favicon/subreddit icons — avoids CORS)
  // =========================================================================

  router.get('/icon', asyncHandler(async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required' });

    const result = await feedContentService.resolveIcon(url);
    if (!result) return res.status(404).json({ error: 'Icon not found' });

    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result.data);
  }));

  // =========================================================================
  // Image proxy (hero images — avoids CORS, SVG placeholder on failure)
  // =========================================================================

  router.get('/image', asyncHandler(async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required' });

    const result = await feedContentService.proxyImage(url);
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result.data);
  }));

  // =========================================================================
  // Readable content extraction (for content drawer)
  // =========================================================================

  router.get('/readable', asyncHandler(async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required' });

    try {
      const result = await feedContentService.extractReadableContent(url);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Failed to extract content' });
    }
  }));

  // =========================================================================
  // Error handler
  // =========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('feed.router.error', { error: err.message, url: req.url });
    res.status(500).json({ error: err.message });
  });

  return router;
}

export default createFeedRouter;
