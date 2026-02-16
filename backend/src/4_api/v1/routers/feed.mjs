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
  const { freshRSSAdapter, headlineService, feedAssemblyService, feedContentService, configService, logger = console } = config;
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
    const items = await freshRSSAdapter.getItems(feed, username, {
      count: count ? Number(count) : undefined,
      continuation,
      excludeRead: excludeRead === 'true',
    });
    res.json(items);
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

  // =========================================================================
  // Headlines (cached)
  // =========================================================================

  router.get('/headlines', asyncHandler(async (req, res) => {
    const username = getUsername();
    const result = await headlineService.getAllHeadlines(username);
    res.json(result);
  }));

  router.get('/headlines/:source', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const username = getUsername();
    const result = await headlineService.getSourceHeadlines(source, username);

    if (!result) {
      return res.status(404).json({ error: 'Source not found', source });
    }

    res.json(result);
  }));

  router.post('/headlines/harvest', asyncHandler(async (req, res) => {
    const username = getUsername();
    const result = await headlineService.harvestAll(username);
    res.json(result);
  }));

  router.post('/headlines/harvest/:source', asyncHandler(async (req, res) => {
    const username = getUsername();
    const result = await headlineService.harvestSource(req.params.source, username);
    res.json(result);
  }));

  // =========================================================================
  // Scroll (merged feed -- skeleton)
  // =========================================================================

  router.get('/scroll', asyncHandler(async (req, res) => {
    const username = getUsername();
    const { cursor, limit, session, focus } = req.query;

    const result = await feedAssemblyService.getNextBatch(username, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      sessionStartedAt: session || null,
      focus: focus || null,
    });

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
