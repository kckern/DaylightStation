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
 * @param {Object} config.userDataService - UserDataService for reading user lifelog files
 * @param {Object} config.configService - ConfigService for user lookups
 * @returns {express.Router}
 */
export function createLifelogRouter(config) {
  const { aggregator, userDataService, configService } = config;
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

  /**
   * GET /api/lifelog/weight - Get weight data for current user
   *
   * Returns weight entries from user's lifelog/weight.yml
   */
  router.get('/weight', async (req, res) => {
    try {
      // Get current user from session or use default
      const username = req.user?.username || configService?.getHeadOfHousehold?.() || 'kckern';
      
      console.log('[lifelog] Weight request for user:', username);
      
      // Read weight data from user's lifelog directory
      const weightData = userDataService?.readUserLifelogData?.(username, 'weight');
      
      console.log('[lifelog] Weight data loaded:', weightData ? Object.keys(weightData).length + ' entries' : 'null');
      
      // Return empty array if no data, otherwise return as-is
      res.json(weightData || []);
    } catch (err) {
      console.error('[lifelog] Weight error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createLifelogRouter;
