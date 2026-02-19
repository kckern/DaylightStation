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
  const { freshRSSAdapter, headlineService, feedAssemblyService, feedContentService, dismissedItemsStore, sourceAdapters = [], contentPluginRegistry = null, configService, logger = console } = config;

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
    const { days: daysParam, count, continuation, excludeRead, feeds } = req.query;
    const username = getUsername();
    const isFiltered = !!feeds;
    const feedIds = isFiltered ? feeds.split(',') : [];

    // Filtered mode:  fetch directly from feed stream(s), count-based, full backlog
    // Unfiltered mode: fetch from reading-list, day-based primer
    let streamId;
    let fetchCount;
    if (isFiltered && feedIds.length === 1) {
      // Single feed — fetch directly from that feed's stream
      streamId = feedIds[0];
      fetchCount = count ? Number(count) : 50;
    } else {
      streamId = 'user/-/state/com.google/reading-list';
      fetchCount = count ? Number(count) : (isFiltered ? 200 : 200);
    }

    const [{ items, continuation: freshCont }, allFeeds] = await Promise.all([
      freshRSSAdapter.getItems(streamId, username, {
        count: fetchCount,
        continuation,
        excludeRead: excludeRead === 'true',
      }),
      freshRSSAdapter.getFeeds(username),
    ]);

    // Build feedId → feed URL lookup (for site URL / icon resolution)
    const feedUrlMap = new Map();
    for (const f of allFeeds) {
      if (f.id && f.url) feedUrlMap.set(f.id, f.url);
    }

    // Enrich items
    const READ_TAG = 'user/-/state/com.google/read';
    const enriched = items.map(item => {
      const isRead = (item.categories || []).some(c => c === READ_TAG);
      const preview = (item.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      const tags = (item.categories || [])
        .filter(c => c.includes('/label/'))
        .map(c => c.split('/label/').pop());

      // Derive site URL for icon resolution (YouTube channel URL or feed origin)
      const feedUrl = feedUrlMap.get(item.feedId) || null;
      let feedSiteUrl = null;
      if (feedUrl) {
        const ytMatch = feedUrl.match(/youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]+)/);
        if (ytMatch) {
          feedSiteUrl = `https://www.youtube.com/channel/${ytMatch[1]}`;
        } else {
          try { feedSiteUrl = new URL(feedUrl).origin; } catch { /* ignore */ }
        }
      }

      return { ...item, isRead, preview, tags, feedSiteUrl };
    });

    // Multi-feed filter: post-filter by feedId (single-feed already fetched directly)
    let result = enriched;
    if (isFiltered && feedIds.length > 1) {
      const feedSet = new Set(feedIds);
      result = enriched.filter(item => feedSet.has(item.feedId));
    }

    let nextContinuation = freshCont;
    let exhausted = !freshCont && items.length < fetchCount;

    // Day-based trimming only in unfiltered mode
    if (!isFiltered) {
      const targetDays = daysParam ? Number(daysParam) : 3;
      const dayKey = (d) => d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : 'unknown';
      const distinctDays = new Set();
      const trimmed = [];
      for (const item of result) {
        const key = dayKey(item.published ? new Date(item.published) : null);
        if (distinctDays.size < targetDays || distinctDays.has(key)) {
          distinctDays.add(key);
          trimmed.push(item);
        } else {
          break;
        }
      }
      if (trimmed.length < result.length && trimmed.length > 0) {
        const oldest = trimmed[trimmed.length - 1];
        if (oldest?.published) {
          // FreshRSS continuation tokens are microsecond timestamps
          nextContinuation = String(Math.floor(new Date(oldest.published).getTime() * 1000));
        }
        // We trimmed — there's more data beyond this day window
        exhausted = false;
      }
      result = trimmed;
    }

    // Content-type enrichment (e.g., detect YouTube URLs in FreshRSS items)
    if (contentPluginRegistry) {
      contentPluginRegistry.enrich(result);
    }

    res.json({ items: result, continuation: nextContinuation, exhausted });
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
