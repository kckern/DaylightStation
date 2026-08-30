import { sendInternalError } from '#api/utils/internalError.mjs';
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
 * @param {Object} config.feedReaderService - Semantic reader and dismissal service
 * @param {Object} config.headlineService - HeadlineService instance
 * @param {Object} config.feedAssemblyService - FeedAssemblyService for scroll endpoint
 * @param {Object} config.feedContentService - FeedContentService for icon/readable endpoints
 * @param {Object} config.feedPrincipalResolver - Request-subject fallback policy
 * @param {Object} config.feedReaderTimelineService - Vendor-neutral reader projection
 * @param {Object} config.feedScrollSessionService - Scroll lifecycle and persistence
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createFeedRouter(config) {
  const { feedReaderService, headlineService, feedAssemblyService, feedContentService,
    feedStateService = null, feedPrincipalResolver, feedReaderTimelineService,
    feedScrollSessionService, logger = console } = config;
  const required = {
    feedReaderService,
    headlineService,
    feedAssemblyService,
    feedContentService,
    feedPrincipalResolver,
    feedReaderTimelineService,
    feedScrollSessionService,
  };
  for (const [name, dependency] of Object.entries(required)) {
    if (!dependency) throw new TypeError(`createFeedRouter requires ${name}`);
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
    return feedPrincipalResolver.resolve(req?.user?.sub || null);
  };

  // =========================================================================
  // Reader (FreshRSS proxy)
  // =========================================================================

  router.get('/reader/categories', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const categories = await feedReaderService.getCategories(username);
    res.json(categories);
  }));

  router.get('/reader/feeds', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const feeds = await feedReaderService.getFeeds(username);
    res.json(feeds);
  }));

  router.get('/reader/items', asyncHandler(async (req, res) => {
    const { feed, count, continuation, excludeRead } = req.query;
    if (!feed) {
      return res.status(400).json({ error: 'feed parameter required' });
    }
    const username = getUsername(req);
    const { items, continuation: nextContinuation } = await feedReaderService.getItems(feed, username, {
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
      await feedReaderService.markItems(feedItemIds, username, action);
    } else if (action === 'unread') {
      await feedReaderService.markItems(feedItemIds, username, action);
    } else {
      return res.status(400).json({ error: 'action must be "read" or "unread"' });
    }

    res.json({ ok: true });
  }));

  router.get('/reader/stream', asyncHandler(async (req, res) => {
    const { days: daysParam, count, continuation, excludeRead, feeds } = req.query;
    const username = getUsername(req);
    const result = await feedReaderTimelineService.getTimeline(username, {
      feedIds: feeds ? feeds.split(',') : [],
      count: count === undefined ? null : toBoundedInt(count, { min: 1, max: 500, def: 50 }),
      continuation,
      excludeRead: excludeRead === 'true',
      days: daysParam === undefined ? 3 : toBoundedInt(daysParam, { min: 1, max: 30, def: 3 }),
    });
    res.json({ ...result, nextCursor: result.continuation });
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

    let result = await headlineService.getAllHeadlines(username, pageId);
    if (!result) return res.status(404).json({ error: 'Page not found', page: pageId });
    if (feedStateService) result = feedStateService.enrichHeadlinePage(username, result);
    res.json(result);
  }));

  // =========================================================================
  // Unified item state and history
  // =========================================================================

  router.patch('/items/state', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed state service unavailable' });
    const { itemIds, action } = req.body || {};
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 200) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array (max 200)' });
    }
    if (!itemIds.every(isValidItemId)) {
      return res.status(400).json({ error: 'itemIds must be strings of at most 512 chars' });
    }
    const allowed = new Set(['read', 'unread', 'save', 'unsave', 'archive', 'unarchive']);
    if (!allowed.has(action)) return res.status(400).json({ error: 'invalid state action' });
    const items = await feedStateService.mutate(getUsername(req), itemIds, action);
    res.json({ items, failed: [] });
  }));

  router.get('/items/state/summary', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed state service unavailable' });
    res.json(feedStateService.summary(getUsername(req)));
  }));

  router.post('/items/state/retry', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed state service unavailable' });
    const username = getUsername(req);
    await feedStateService.retryPending(username, { force: true });
    res.json(feedStateService.summary(username));
  }));

  router.get('/workspace', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed workspace unavailable' });
    res.json(feedStateService.getWorkspace(getUsername(req)));
  }));

  router.patch('/workspace/preferences', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed workspace unavailable' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Preference object required' });
    }
    const preferences = await feedStateService.updatePreferences(getUsername(req), req.body);
    res.json({ preferences });
  }));

  router.put('/workspace/checkpoints/:mode', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed workspace unavailable' });
    if (!['reader', 'headlines', 'scroll', 'search'].includes(req.params.mode)) {
      return res.status(400).json({ error: 'Invalid feed mode' });
    }
    const checkpoint = await feedStateService.recordCheckpoint(getUsername(req), req.params.mode, req.body || {});
    res.json({ checkpoint });
  }));

  router.put('/workspace/sources/:sourceKey', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed workspace unavailable' });
    const sourceKey = String(req.params.sourceKey || '');
    if (!sourceKey || sourceKey.length > 256) return res.status(400).json({ error: 'Invalid source key' });
    if (!['more', 'less', 'mute', 'normal'].includes(req.body?.level)) return res.status(400).json({ error: 'Invalid source preference' });
    const sourcePreferences = await feedStateService.updateSourcePreference(getUsername(req), sourceKey, req.body.level);
    res.json({ sourcePreferences });
  }));

  router.get('/annotations', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed annotations unavailable' });
    const itemId = req.query.itemId === undefined ? null : String(req.query.itemId);
    if (itemId !== null && !isValidItemId(itemId)) return res.status(400).json({ error: 'Invalid itemId' });
    res.json({ annotations: feedStateService.listAnnotations(getUsername(req), itemId) });
  }));

  router.post('/annotations', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed annotations unavailable' });
    if (!isValidItemId(req.body?.itemId)) return res.status(400).json({ error: 'Valid itemId required' });
    try {
      const annotation = await feedStateService.createAnnotation(getUsername(req), req.body);
      res.status(201).json({ annotation });
    } catch (error) {
      if (error.message === 'Feed item not found') return res.status(404).json({ error: error.message });
      if (error.message === 'Annotation requires a note or quote') return res.status(400).json({ error: error.message });
      throw error;
    }
  }));

  router.patch('/annotations/:annotationId', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed annotations unavailable' });
    if (!req.params.annotationId || req.params.annotationId.length > 128) return res.status(400).json({ error: 'Invalid annotation id' });
    try {
      const annotation = await feedStateService.updateAnnotation(getUsername(req), req.params.annotationId, req.body || {});
      res.json({ annotation });
    } catch (error) {
      if (error.message === 'Annotation not found') return res.status(404).json({ error: error.message });
      if (error.message === 'Annotation requires a note or quote') return res.status(400).json({ error: error.message });
      throw error;
    }
  }));

  router.delete('/annotations/:annotationId', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed annotations unavailable' });
    if (!req.params.annotationId || req.params.annotationId.length > 128) return res.status(400).json({ error: 'Invalid annotation id' });
    const removed = await feedStateService.deleteAnnotation(getUsername(req), req.params.annotationId);
    if (!removed) return res.status(404).json({ error: 'Annotation not found' });
    res.json({ removed: true });
  }));

  router.get('/data/export', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed export unavailable' });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="daylight-feed-${date}.json"`);
    res.json(feedStateService.exportData(getUsername(req)));
  }));

  router.post('/data/import', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed import unavailable' });
    try {
      const imported = await feedStateService.importData(getUsername(req), req.body);
      res.json({ imported });
    } catch (error) {
      if (error.message === 'Unsupported feed export format') return res.status(400).json({ error: error.message });
      throw error;
    }
  }));

  router.get('/search', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed search unavailable' });
    const limit = toBoundedInt(req.query.limit, { min: 1, max: 100, def: 30 });
    const offset = req.query.cursor
      ? toBoundedInt(Buffer.from(String(req.query.cursor), 'base64url').toString('utf8'), { min: 0, max: 1_000_000, def: 0 })
      : 0;
    const username = getUsername(req);
    feedStateService.ensureHistoryBackfill(username);
    const result = feedStateService.search(username, {
      query: String(req.query.q || '').slice(0, 200),
      state: req.query.state || null,
      mode: req.query.mode || null,
      source: req.query.source || null,
      from: req.query.from || null,
      to: req.query.to || null,
      limit,
      offset,
    });
    res.json({
      items: result.items,
      total: result.total,
      nextCursor: result.nextOffset === null ? null : Buffer.from(String(result.nextOffset)).toString('base64url'),
      coverage: { retentionMonths: 12, ...feedStateService.historyBackfillStatus(username) },
    });
  }));

  router.get('/items/:slug', asyncHandler(async (req, res) => {
    if (!feedStateService) return res.status(503).json({ error: 'Feed history unavailable' });
    let id;
    try { id = Buffer.from(req.params.slug, 'base64url').toString('utf8'); }
    catch { return res.status(400).json({ error: 'Invalid slug' }); }
    const item = feedStateService.find(getUsername(req), id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const detail = feedAssemblyService
      ? await feedAssemblyService.getDetail(item.id, item.meta || {}, getUsername(req))
      : null;
    res.json({ item, sections: detail?.sections || [], ogImage: detail?.ogImage || null, ogDescription: detail?.ogDescription || null });
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

  router.post('/scroll/sessions', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const { limit, focus, sources, filter } = req.body || {};
    const result = await feedScrollSessionService.create(username, {
      limit: limit === undefined ? undefined : toBoundedInt(limit, { min: 1, max: 100, def: 15 }),
      focus: focus || null,
      sources: Array.isArray(sources) ? sources : null,
      filter: filter || null,
    });
    res.status(201).json(result);
  }));

  router.get('/scroll/sessions/:sessionId', asyncHandler(async (req, res) => {
    const username = getUsername(req);
    const continuation = await feedScrollSessionService.continue(username, req.params.sessionId, {
      resume: req.query.resume === '1',
      limit: req.query.limit === undefined ? undefined : toBoundedInt(req.query.limit, { min: 1, max: 100, def: 15 }),
      cursor: req.query.cursor || 'continue',
      filter: req.query.filter || null,
      focus: req.query.focus || null,
    });
    if (continuation.kind === 'expired') {
      return res.status(404).json({ error: 'Scroll session expired' });
    }
    res.json(continuation.result);
  }));

  router.get('/scroll', asyncHandler(async (req, res) => {
    const start = Date.now();
    const username = getUsername(req);
    const { cursor, limit, focus, source, nocache, filter, session } = req.query;
    const parsedLimit = limit === undefined ? undefined : toBoundedInt(limit, { min: 1, max: 100, def: 15 });

    const result = await feedScrollSessionService.getBatch(username, {
      limit: parsedLimit,
      cursor,
      focus: focus || null,
      sources: source ? source.split(',').map(s => s.trim()) : null,
      nocache: nocache === '1',
      filter: filter || null,
      sessionId: session || null,
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

    const body = await feedReaderService.dismiss(feedItemIds, username);
    const { dismissed, failed } = body;
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
    sendInternalError(res, { error: 'Internal error' });
  });

  return router;
}

export default createFeedRouter;
