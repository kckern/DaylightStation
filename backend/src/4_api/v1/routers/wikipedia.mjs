// backend/src/4_api/v1/routers/wikipedia.mjs

import express from 'express';

/**
 * Wikipedia router — thin proxy over the self-hosted Wikipedia service
 * (kiwix-backed, plain-text output) via WikipediaAdapter.
 *
 * GET /search?q=&limit=   full-text search
 * GET /article/:title     article as plain text (fuzzy fallback upstream)
 * GET /random             random article
 * GET /health             service health
 *
 * @module api/v1/routers/wikipedia
 */
export function createWikipediaRouter({ adapter, logger = console }) {
  const router = express.Router();

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.error('wikipedia.request-failed', { path: req.path, error: err.message });
      res.status(502).json({ error: err.message });
    }
  };

  router.get('/search', handle(async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'q query parameter is required' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    res.json(await adapter.search(q, { limit }));
  }));

  router.get('/article/:title', handle(async (req, res) => {
    const article = await adapter.getArticle(req.params.title);
    if (!article) return res.status(404).json({ error: 'article not found' });
    res.json(article);
  }));

  router.get('/random', handle(async (req, res) => {
    res.json(await adapter.random());
  }));

  router.get('/health', handle(async (req, res) => {
    res.json(await adapter.health());
  }));

  return router;
}
