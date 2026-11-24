/**
 * NewsReporter Router (/api/v1/newsreporter)
 *
 *   GET  /                               reporters [{ id, kind, title, enabled }]
 *   POST /:id/run                        body { date?, printer?, dryRun?, force? }
 *        report kind: NewsReporterService.run; edition kind: compose
 *
 * Edition reporters (the office paper), spec §6:
 *   GET  /:id/editions?limit=30           summaries, newest first
 *   GET  /:id/editions/:date              the full edition (404 when none)
 *   GET  /:id/editions/:date/image.png    the stored PNG
 *   POST /:id/compose  { date?, dryRun? } → { status, edition, png? }   (png: base64, dry run only)
 *   POST /:id/deliver  { date?, printer?, force?, trigger? } → { status, edition }
 *        always 200: printed | already_delivered | expired | composed_then_printed | print_failed | compose_failed
 *   GET  /:id/printers                    printer names
 *
 * An unknown, disabled or wrong-kind reporter id is a 404.
 *
 * @module api/v1/routers/newsreporter
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {Object} config
 * @param {{ run: Function }} config.newsReporterService
 * @param {import('../application/EditionService.mjs').EditionService} [config.editionService]
 * @param {{ list: () => Array<{ id, kind, title, enabled }> }} [config.reporterDirectory]
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createNewsReporterRouter(config) {
  const router = express.Router();
  const { newsReporterService, editionService = null, reporterDirectory = null, logger = console } = config;

  const notFound = (res, id) => {
    logger.warn?.('newsreporter.api.not_found', { id });
    return res.status(404).json({ status: 'error', error: `newsreporter ${id} not found` });
  };
  const isNotFound = (err) => err?.name === 'EntityNotFoundError';
  const badDate = (res, date) => res.status(400).json({ status: 'error', error: `bad date: ${date}` });

  /** Guards an edition route: 404 unless `id` is an enabled edition reporter. */
  const edition = (handler) => asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!editionService?.handles(id)) return notFound(res, id);
    try {
      return await handler(req, res, id);
    } catch (err) {
      if (isNotFound(err)) return notFound(res, id);
      throw err;
    }
  });

  router.get('/', asyncHandler(async (_req, res) => {
    res.json(reporterDirectory?.list?.() ?? []);
  }));

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
      if (isNotFound(err)) return notFound(res, id);
      throw err;
    }
  }));

  router.get('/:id/editions', edition(async (req, res, id) => {
    const limit = Math.min(365, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    res.json(await editionService.listEditions(id, { limit }));
  }));

  router.get('/:id/editions/:date', edition(async (req, res, id) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) return badDate(res, date);
    const found = await editionService.getEdition(id, date);
    if (!found) return res.status(404).json({ status: 'error', error: `no edition for ${date}` });
    return res.json(found);
  }));

  router.get('/:id/editions/:date/image.png', edition(async (req, res, id) => {
    const { date } = req.params;
    if (!DATE_RE.test(date)) return badDate(res, date);
    const png = await editionService.getImage(id, date);
    if (!png) return res.status(404).json({ status: 'error', error: `no image for ${date}` });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    return res.send(png);
  }));

  router.post('/:id/compose', edition(async (req, res, id) => {
    const { date, dryRun } = req.body || {};
    if (date !== undefined && date !== null && !DATE_RE.test(date)) return badDate(res, date);
    logger.info?.('newsreporter.api.compose', { id, date: date ?? null, dryRun: !!dryRun });
    const result = await editionService.compose(id, { date: date || null, dryRun: !!dryRun, trigger: 'api' });
    return res.json(result);
  }));

  router.post('/:id/deliver', edition(async (req, res, id) => {
    const { date, printer, force, trigger } = req.body || {};
    if (date !== undefined && date !== null && !DATE_RE.test(date)) return badDate(res, date);
    logger.info?.('newsreporter.api.deliver', { id, date: date ?? null, printer: printer ?? null, force: !!force, trigger: trigger ?? 'api' });
    const result = await editionService.deliver(id, {
      date: date || null, printer: printer || null, force: !!force, trigger: typeof trigger === 'string' && trigger ? trigger.slice(0, 40) : 'api',
    });
    return res.json(result);
  }));

  router.get('/:id/printers', edition(async (_req, res) => {
    res.json(editionService.printers());
  }));

  return router;
}

export default createNewsReporterRouter;
