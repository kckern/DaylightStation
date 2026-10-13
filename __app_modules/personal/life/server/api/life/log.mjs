import { sendInternalError } from '#api/utils/internalError.mjs';
import { Router } from 'express';
import { createLogger } from '#system/logging/logger.mjs';

export default function createLogRouter(config) {
  const { lifeApi, usernameResolver } = config;
  const router = Router();
  const logger = createLogger({ source: 'backend', app: 'life', context: { router: 'log' } });

  // Validate path-param usernames against known profiles (when a resolver
  // with a user directory is provided by the parent router)
  router.param('username', (req, res, next, value) => {
    if (usernameResolver && !usernameResolver.isKnown(value)) {
      return res.status(404).json({ error: `Unknown user: ${value}` });
    }
    next();
  });

  // GET /sources — available extractors
  router.get('/sources', (req, res) => {
    res.json({ sources: lifeApi.sources() });
  });

  // GET /:username/range?start=&end= — date range
  router.get('/:username/range', async (req, res) => {
    try {
      const { username } = req.params;
      const { start, end } = req.query;

      const outcome = await lifeApi.range(username, start, end);
      if (outcome.kind === 'invalid_range') {
        return res.status(400).json({ error: 'Both start and end date params required (YYYY-MM-DD)' });
      }
      res.json(outcome.value);
    } catch (err) {
      logger.error('life.log.range-error', { error: err.message });
      sendInternalError(res, { error: err.message });
    }
  });

  // GET /:username/scope/:scope — week|month|season|year|decade
  router.get('/:username/scope/:scope', async (req, res) => {
    try {
      const { username, scope } = req.params;

      const outcome = await lifeApi.scope(username, scope, req.query.at);
      if (outcome.kind === 'invalid_scope') return res.status(400).json({ error: `Invalid scope. Must be one of: ${outcome.validScopes.join(', ')}` });
      res.json(outcome.value);
    } catch (err) {
      logger.error('life.log.scope-error', { scope, error: err.message });
      sendInternalError(res, { error: err.message });
    }
  });

  // GET /:username/category/:category — category filtered
  router.get('/:username/category/:category', async (req, res) => {
    try {
      const { username, category } = req.params;
      const { start, end, scope } = req.query;

      res.json(await lifeApi.category(username, category, { start, end, scope }));
    } catch (err) {
      sendInternalError(res, { error: err.message });
    }
  });

  // GET /:username/:date — single day
  router.get('/:username/:date', async (req, res) => {
    try {
      const { username, date } = req.params;

      const outcome = await lifeApi.day(username, date);
      if (outcome.kind === 'invalid_date') {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      res.json(outcome.value);
    } catch (err) {
      logger.error('life.log.day-error', { date, error: err.message });
      sendInternalError(res, { error: err.message });
    }
  });

  return router;
}
