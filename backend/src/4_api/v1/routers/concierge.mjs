import express from 'express';
import { OpenAIChatCompletionsTranslator } from '../translators/OpenAIChatCompletionsTranslator.mjs';

/**
 * Mounts the OpenAI-compatible concierge endpoint at /v1.
 *
 * Routes:
 *   POST /v1/chat/completions  — single-turn chat or SSE stream
 *   GET  /v1/models            — advertised model list (for HA discovery)
 *
 * Auth: Bearer token resolved against ISatelliteRegistry.
 */
export function createConciergeRouter({
  satelliteRegistry,
  chatCompletionRunner,
  logger = console,
  advertisedModels = ['daylight-house', 'gpt-4o-mini'],
  mediaLogsDir = null,
}) {
  if (!satelliteRegistry?.findByToken) throw new Error('createConciergeRouter: satelliteRegistry required');
  if (!chatCompletionRunner?.runChat) throw new Error('createConciergeRouter: chatCompletionRunner required');

  const router = express.Router();
  const translator = new OpenAIChatCompletionsTranslator({ runner: chatCompletionRunner, logger, mediaLogsDir });

  router.use(async (req, res, next) => {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      logger.warn?.('concierge.auth.failed', { code: 'missing_token', ip: req.ip });
      return res.status(401).json({ error: { message: 'missing_token', type: 'auth', code: 'missing_token' } });
    }
    const token = auth.slice(7).trim();
    const satellite = await satelliteRegistry.findByToken(token);
    if (!satellite) {
      const tokenPrefix = token.slice(0, 6);
      logger.warn?.('concierge.auth.failed', { code: 'invalid_token', ip: req.ip, token_prefix: tokenPrefix });
      return res.status(401).json({ error: { message: 'invalid_token', type: 'auth', code: 'invalid_token' } });
    }
    req.satellite = satellite;
    next();
  });

  router.post('/chat/completions', async (req, res) => {
    await translator.handle(req, res, req.satellite);
  });

  router.get('/models', (_req, res) => {
    const created = Math.floor(Date.now() / 1000);
    res.status(200).json({
      object: 'list',
      data: advertisedModels.map((id) => ({
        id,
        object: 'model',
        created,
        owned_by: 'daylight',
      })),
    });
  });

  return router;
}

export default createConciergeRouter;
