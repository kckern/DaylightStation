/**
 * NewsReporter Router
 *
 * Manual-run endpoint for the newsreporter framework. Drives the deployed
 * NewsReporterService so ad-hoc triggers (CLI/admin) reuse the exact wiring the
 * scheduler uses.
 *
 *   POST /newsreporter/:id/run   body: { date?, printer?, dryRun?, force? }
 *     → NewsReporterService.run(id, overrides)
 *     → 200 { status, sourceCounts, sinkResults, sections?, preview? }
 *     → 404 when the reporter id is unknown/disabled (EntityNotFoundError)
 *
 * @module api/v1/routers/newsreporter
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create the newsreporter router.
 * @param {Object} config
 * @param {{ run: (id: string, overrides?: object) => Promise<object> }} config.newsReporterService
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createNewsReporterRouter(config) {
  const router = express.Router();
  const { newsReporterService, logger = console } = config;

  router.post('/:id/run', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { date, printer, dryRun, force } = req.body || {};
    const overrides = {};
    if (date !== undefined) overrides.date = date;
    if (printer !== undefined) overrides.printer = printer;
    if (dryRun !== undefined) overrides.dryRun = dryRun;
    if (force !== undefined) overrides.force = force;

    logger.info?.('newsreporter.api.run', { id, overrides });

    try {
      const result = await newsReporterService.run(id, overrides);
      res.json(result);
    } catch (err) {
      // EntityNotFoundError (unknown/disabled reporter) → 404. It extends plain
      // Error (not the system NotFoundError the global handler maps), so map it
      // here, mirroring the scheduling router's not-found handling.
      if (err?.name === 'EntityNotFoundError') {
        logger.warn?.('newsreporter.api.not_found', { id });
        return res.status(404).json({ status: 'error', error: err.message });
      }
      throw err;
    }
  }));

  return router;
}

export default createNewsReporterRouter;
