/**
 * Lifelog API Router
 *
 * Endpoints:
 * - GET /api/lifelog - Get aggregated lifelog data for a user and date
 * - GET /api/lifelog/sources - List available extractor sources
 *
 * @module api/routers/lifelog
 */

import express from 'express';

/**
 * Create lifelog API router
 *
 * @param {Object} config
 * @param {import('../../1_domains/lifelog/services/LifelogAggregator.mjs').LifelogAggregator} config.lifelogAggregator
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLifelogRouter(config) {
  const { lifelogAggregator, configService, logger = console } = config;
  const router = express.Router();

  /**
   * Get default username from config
   */
  const getDefaultUsername = () => {
    const householdId = configService.getDefaultHouseholdId?.();
    const users = configService.getHouseholdUsers?.(householdId) || [];
    return users[0] || 'default';
  };

  /**
   * GET /api/lifelog - Get aggregated lifelog data
   *
   * Query params:
   * - user: Username (defaults to head of household)
   * - date: ISO date YYYY-MM-DD (defaults to yesterday)
   */
  router.get('/', async (req, res) => {
    try {
      const username = req.query.user || getDefaultUsername();
      const date = req.query.date || null; // null = yesterday (default in aggregator)

      logger.info?.('lifelog.aggregate.request', { username, date });

      const data = await lifelogAggregator.aggregate(username, date);

      res.json({
        status: 'success',
        ...data
      });
    } catch (error) {
      logger.error?.('lifelog.aggregate.error', { error: error.message });
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  /**
   * GET /api/lifelog/sources - List available extractor sources
   *
   * Returns the list of configured extractors and their categories.
   */
  router.get('/sources', async (req, res) => {
    try {
      // Import extractors to get their metadata
      const { extractors } = await import('../../1_domains/lifelog/extractors/index.mjs');

      const sources = extractors.map(e => ({
        source: e.source,
        category: e.category,
        filename: e.filename
      }));

      res.json({
        status: 'success',
        count: sources.length,
        sources
      });
    } catch (error) {
      logger.error?.('lifelog.sources.error', { error: error.message });
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  /**
   * GET /api/lifelog/summary - Get just the summary text for AI prompts
   *
   * Query params:
   * - user: Username (defaults to head of household)
   * - date: ISO date YYYY-MM-DD (defaults to yesterday)
   */
  router.get('/summary', async (req, res) => {
    try {
      const username = req.query.user || getDefaultUsername();
      const date = req.query.date || null;

      const data = await lifelogAggregator.aggregate(username, date);

      res.json({
        status: 'success',
        date: data.date,
        username,
        summaryText: data.summaryText,
        sourceCount: data._meta?.availableSourceCount || 0,
        sources: data._meta?.sources || []
      });
    } catch (error) {
      logger.error?.('lifelog.summary.error', { error: error.message });
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });

  return router;
}

export default createLifelogRouter;
