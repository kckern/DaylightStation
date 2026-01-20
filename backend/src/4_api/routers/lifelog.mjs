/**
 * Lifelog API Router
 *
 * Endpoints:
 * - GET /api/lifelog/aggregate/:username/:date - Get aggregated data by path params
 * - GET /api/lifelog/sources - List available extractor sources
 *
 * @module api/routers/lifelog
 */

import express from 'express';

/**
 * Validate date format (YYYY-MM-DD)
 * @param {string} dateStr
 * @returns {boolean}
 */
function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

/**
 * Create lifelog API router
 *
 * @param {Object} config
 * @param {import('../../1_domains/lifelog/services/LifelogAggregator.mjs').LifelogAggregator} config.aggregator
 * @returns {express.Router}
 */
export function createLifelogRouter(config) {
  const { aggregator } = config;
  const router = express.Router();

  /**
   * GET /api/lifelog/aggregate/:username/:date - Aggregate lifelog data by path params
   *
   * Path params:
   * - username: System username
   * - date: ISO date YYYY-MM-DD
   */
  router.get('/aggregate/:username/:date', async (req, res) => {
    try {
      const { username, date } = req.params;

      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      const result = await aggregator.aggregate(username, date);
      res.json(result);
    } catch (err) {
      console.error('[lifelog] Aggregate error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/lifelog/sources - List available extractor sources
   *
   * Returns the list of configured extractors and their categories.
   */
  router.get('/sources', (req, res) => {
    const sources = aggregator.getAvailableSources?.() || [];
    res.json({ sources });
  });

  return router;
}

export default createLifelogRouter;
