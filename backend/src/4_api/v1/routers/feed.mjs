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

  // Build adapter lookup map by sourceType for dismiss routing.
  // Only register adapters that genuinely persist read-state — the base class
  // supplies a no-op markRead, so `typeof adapter.markRead === 'function'` is
  // always true and would route dismisses into a silent no-op (F-07).
  const adapterMap = new Map();
  for (const adapter of sourceAdapters) {
    if (adapter.sourceType && adapter.supportsMarkRead === true) {
      adapterMap.set(adapter.sourceType, adapter);
    }
  }
  const router = express.Router();

  // Clamp a query-param integer into [min, max]; returns `def` when absent/invalid.
  const toBoundedInt = (val, { min, max, def }) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  };

  // Validate a feed-item id: must be a non-empty string of bounded length.
  const isValidItemId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 512;

  // Resolve the request-scoped principal. Prefer the authenticated subject
  // (JWT `sub` is the username, see auth.mjs) so Feed reads/mutations act as
  // the actual caller — not always the head of household. Falls back to the
  // head only for unauthenticated LAN requests (explicit household-trust policy).
  const getUsername = (req) => {
    return req?.user?.sub || configService?.getHeadOfHousehold?.() || 'default';
  };

  // =========================================================================
  // Reader (FreshRSS proxy)
  // =========================================================================

  router.get('/reader/categories', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const categories = await freshRSSAdapter.getCategories(username);
    res.json(categories);
  }));

  router.get('/reader/feeds', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const feeds = await freshRSSAdapter.getFeeds(username);
    res.json(feeds);
  }));

  router.get('/reader/items', asyncHandler(async (req, res) => {
    const { feed, count, continuation, excludeRead } = req.query;
    if (!feed) {
      return res.status(400).json({ error: 'feed parameter required' });
    }
    const username = getUsername(req);
    const { items, continuation: nextContinuation } = await freshRSSAdapter.getItems(feed, username, {
      count: count === undefined ? undefined : toBoundedInt(count, { min: 1, max: 500, def: 50 }),
      continuation,
      excludeRead: excludeRead === 'true',
    });
    res.json({ items, continuation: nextContinuation });
  }));

  router.post('/reader/items/mark', asyncHandler(async (req, res) => {
    const { itemIds: feedItemIds, action } = req.body;
    if (!Array.isArray(feedItemIds) || feedItemIds.length === 0 || feedItemIds.length > 200) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array (max 200)' });
    }
    if (!feedItemIds.every(isValidItemId)) {
      return res.status(400).json({ error: 'itemIds must be strings of at most 512 chars' });
    }
    const username = getUsername(req);

    if (action === 'read') {
      await freshRSSAdapter.markRead(feedItemIds, username);
    } else if (action === 'unread') {
      await freshRSSAdapter.markUnread(feedItemIds, username);
    } else {
      return res.status(400).json({ error: 'action must be "read" or "unread"' });
    }

    res.json({ ok: true });
  }));

  router.get('/reader/stream', asyncHandler(async (req, res) => {
    const { days: daysParam, count, continuation, excludeRead, feeds } = req.query;
    const username = getUsername(req);
    const isFiltered = !!feeds;
    const feedIds = isFiltered ? feeds.split(',') : [];

    // Filtered mode:  fetch directly from feed stream(s), count-based, full backlog
    // Unfiltered mode: fetch from reading-list, day-based primer
    const boundedCount = count === undefined ? undefined : toBoundedInt(count, { min: 1, max: 500, def: 50 });
    let streamId;
    let fetchCount;
    if (isFiltered && feedIds.length === 1) {
      // Single feed — fetch directly from that feed's stream
      streamId = feedIds[0];
      fetchCount = boundedCount ?? 50;
    } else {
      streamId = 'user/-/state/com.google/reading-list';
      fetchCount = boundedCount ?? 200;
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

      // Resolve icon URL server-side so frontend is vendor-agnostic
      const feedUrl = feedUrlMap.get(item.feedId) || null;
      const articleUrl = item.canonical?.[0]?.href || item.alternate?.[0]?.href || null;
      const iconUrl = feedContentService.resolveIconPath(feedUrl, articleUrl);

      return { ...item, isRead, preview, tags, iconUrl };
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
      // Sort by published date descending so day trimming picks the N most
      // recent calendar days, not the first N days in FreshRSS crawl order.
      result.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));

      const targetDays = daysParam === undefined ? 3 : toBoundedInt(daysParam, { min: 1, max: 30, def: 3 });
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
    const username = getUsername(req);
    res.json(headlineService.getPageList(username));
  }));

  // Harvest all pages (or one page via ?page=ID)
  router.post('/headlines/harvest', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const pageId = req.query.page || undefined;
    const result = await headlineService.harvestAll(username, pageId);
    res.json(result);
  }));

  // Harvest a single source by ID
  router.post('/headlines/harvest/:source', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const result = await headlineService.harvestSource(req.params.source, username);
    res.json(result);
  }));

  // Get headlines for a page — ?page=ID (defaults to first page)
  router.get('/headlines', asyncHandler(async (req, res) => {
    const username = getUsername(req);
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
    const username = getUsername(req);
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
    const start = Date.now();
    const username = getUsername(req);
    const { cursor, limit, focus, source, nocache, filter } = req.query;
    const parsedLimit = limit === undefined ? undefined : toBoundedInt(limit, { min: 1, max: 100, def: 15 });

    const result = await feedAssemblyService.getNextBatch(username, {
      limit: parsedLimit,
      cursor,
      focus: focus || null,
      sources: source ? source.split(',').map(s => s.trim()) : null,
      nocache: nocache === '1',
      filter: filter || null,
    });

    logger.info?.('feed.scroll.served', {
      durationMs: Date.now() - start,
      cursor: cursor || null,
      itemCount: result.items?.length || 0,
      hasMore: result.hasMore,
    });

    // Strip internal tier-allocation internals from the HTTP response unless
    // explicitly requested via ?debug=1 (F-25). Still logged server-side above.
    const { feed_assembly, ...rest } = result;
    res.json(req.query.debug === '1' ? result : rest);
  }));

  // Single-item lookup (deep-link resolution — returns item + detail)
  // Accepts base64url-encoded item ID slug (same encoding used in frontend URLs)
  router.get('/scroll/item/:slug', asyncHandler(async (req, res) => {
    const start = Date.now();
    const { slug } = req.params;
    if (!slug) return res.status(400).json({ error: 'slug required' });

    // Decode base64url → original item ID
    let feedItemId;
    try {
      let s = slug.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      feedItemId = Buffer.from(s, 'base64').toString('utf-8');
    } catch {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    const username = getUsername(req);
    const result = await feedAssemblyService.getItemWithDetail(feedItemId, username);
    logger.info?.('feed.deeplink.served', {
      durationMs: Date.now() - start,
      slug,
      feedItemId,
      found: !!result,
    });
    if (!result) return res.status(404).json({ error: 'Item not found or expired' });

    res.json(result);
  }));

  // Dismiss / mark-read items (removes from future scroll batches)
  router.post('/scroll/dismiss', asyncHandler(async (req, res) => {
    const { itemIds: rawItemIds } = req.body;
    if (!Array.isArray(rawItemIds) || rawItemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array required' });
    }
    if (rawItemIds.length > 200) {
      return res.status(400).json({ error: 'itemIds exceeds max length of 200' });
    }
    // Drop non-string / overly long ids before processing (F-21)
    const feedItemIds = rawItemIds.filter(isValidItemId);
    if (feedItemIds.length === 0) {
      return res.status(400).json({ error: 'no valid itemIds provided' });
    }

    const username = getUsername(req);

    // Partition by source type: route to adapter.markRead() or YAML dismiss store
    const bySource = new Map(); // sourceType → [prefixedIds]
    const otherIds = [];

    for (const id of feedItemIds) {
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

    // Track truthful outcomes: count what actually persisted, collect failures.
    let dismissed = 0;
    const failed = [];

    const promises = [];
    for (const [sourceType, ids] of bySource) {
      const adapter = adapterMap.get(sourceType);
      promises.push(
        adapter.markRead(ids, username)
          .then(() => { dismissed += ids.length; })
          .catch(err => {
            logger.warn?.('feed.dismiss.adapter.error', { sourceType, error: err.message, count: ids.length });
            failed.push(...ids);
          })
      );
    }
    await Promise.all(promises);

    // Non-adapter ids always persist to the YAML dismiss store.
    if (otherIds.length > 0 && dismissedItemsStore) {
      dismissedItemsStore.add(otherIds);
      dismissed += otherIds.length;
    } else if (otherIds.length > 0) {
      // No store available — these could not be persisted.
      failed.push(...otherIds);
    }

    const body = { dismissed, failed };
    if (failed.length > 0 && dismissed === 0) {
      return res.status(502).json(body);
    }
    if (failed.length > 0) {
      return res.status(207).json(body);
    }
    res.json(body);
  }));

  // =========================================================================
  // Detail (level 2 expanded content)
  // =========================================================================

  router.get('/detail/:feedItemId', asyncHandler(async (req, res) => {
    const start = Date.now();
    const { feedItemId } = req.params;
    if (!isValidItemId(feedItemId)) return res.status(400).json({ error: 'feedItemId required' });

    const username = getUsername(req);
    let meta = {};
    if (req.query.meta) {
      try { meta = JSON.parse(req.query.meta); } catch { /* ignore */ }
    }
    if (req.query.link) meta.link = req.query.link;

    const quality = req.query.quality || undefined;
    const result = await feedAssemblyService.getDetail(feedItemId, meta, username, { quality });
    logger.info?.('feed.detail.served', {
      durationMs: Date.now() - start,
      feedItemId,
      quality: quality || null,
      sectionCount: result?.sections?.length || 0,
      found: !!result,
    });
    if (!result) return res.status(404).json({ error: 'No detail available' });

    res.json(result);
  }));

  // =========================================================================
  // Icon proxy (favicon/subreddit icons — avoids CORS)
  // =========================================================================

  router.get('/icon', asyncHandler(async (req, res) => {
    const start = Date.now();
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required' });

    const result = await feedContentService.resolveIcon(url);
    logger.debug?.('feed.icon.served', {
      durationMs: Date.now() - start,
      url,
      found: !!result,
      contentType: result?.contentType || null,
    });
    if (!result) return res.status(404).json({ error: 'Icon not found' });

    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result.data);
  }));

  // =========================================================================
  // Image proxy (hero images — avoids CORS, SVG placeholder on failure)
  // =========================================================================

  router.get('/image', asyncHandler(async (req, res) => {
    const start = Date.now();
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required' });

    const result = await feedContentService.proxyImage(url);
    logger.debug?.('feed.image.served', {
      durationMs: Date.now() - start,
      url,
      contentType: result.contentType,
      size: result.data?.length || 0,
      isFallback: result.contentType === 'image/svg+xml',
    });
    res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(result.data);
  }));

  // =========================================================================
  // Readable content extraction (for content drawer)
  // =========================================================================

  router.get('/readable', asyncHandler(async (req, res) => {
    const start = Date.now();
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required' });

    try {
      const result = await feedContentService.extractReadableContent(url);
      logger.debug?.('feed.readable.served', {
        durationMs: Date.now() - start,
        url,
        wordCount: result.wordCount,
        hasOgImage: !!result.ogImage,
      });
      res.json(result);
    } catch (err) {
      logger.warn?.('feed.readable.error', { url, error: err.message, durationMs: Date.now() - start });
      res.status(502).json({ error: err.message || 'Failed to extract content' });
    }
  }));

  // =========================================================================
  // Error handler
  // =========================================================================

  router.use((err, req, res, next) => {
    logger.error?.('feed.router.error', { error: err.message, url: req.url });
    res.status(500).json({ error: 'Internal error' });
  });

  return router;
}

export default createFeedRouter;
