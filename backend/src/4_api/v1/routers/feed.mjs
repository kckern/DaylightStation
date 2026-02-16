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
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createFeedRouter(config) {
  const { freshRSSAdapter, headlineService, configService, logger = console } = config;
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

  // =========================================================================
  // Scroll (merged feed -- skeleton)
  // =========================================================================

  router.get('/scroll', asyncHandler(async (req, res) => {
    const username = getUsername();
    const { cursor, limit = 20 } = req.query;

    // Phase 1: merge FreshRSS unread + headline cache chronologically
    const [rssItems, headlines] = await Promise.all([
      freshRSSAdapter.getItems('user/-/state/com.google/reading-list', username, {
        count: Number(limit),
        continuation: cursor,
        excludeRead: true,
      }),
      headlineService.getAllHeadlines(username),
    ]);

    // Flatten headline items with source metadata
    const headlineItems = Object.values(headlines.sources || {}).flatMap(src =>
      (src.items || []).map(item => ({
        id: `headline:${src.source}:${item.link}`,
        type: 'headline',
        source: src.source,
        sourceLabel: src.label,
        title: item.title,
        desc: item.desc || null,
        link: item.link,
        timestamp: item.timestamp,
      }))
    );

    // Map RSS items to common format
    const rssItemsMapped = rssItems.map(item => ({
      id: item.id,
      type: 'article',
      source: 'freshrss',
      sourceLabel: item.feedTitle,
      title: item.title,
      desc: null,
      link: item.link,
      content: item.content,
      timestamp: item.published?.toISOString() || new Date().toISOString(),
    }));

    // Merge and sort by timestamp descending
    const merged = [...rssItemsMapped, ...headlineItems]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, Number(limit));

    res.json({
      items: merged,
      hasMore: rssItems.length >= Number(limit),
    });
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
