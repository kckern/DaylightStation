import express from 'express';

export function createGamingRouter({ gamingService, logger = null }) {
  if (!gamingService) throw new Error('createGamingRouter: gamingService required');
  const router = express.Router();

  const handle = (operation) => (req, res) => {
    try {
      operation(req, res);
    } catch (error) {
      const status = Number(error.status) || 500;
      logger?.[status >= 500 ? 'error' : 'warn']?.('gaming.api.error', {
        code: error.code || 'internal_error',
        status,
        message: error.message,
      });
      res.status(status).json({
        error: error.code || 'internal_error',
        message: status >= 500 ? 'Gaming request failed' : error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }
  };

  router.get('/definitions/:gameId', handle((req, res) => {
    const loaded = gamingService.getDefinition(req.params.gameId);
    res.json({ game_id: req.params.gameId, definition_hash: loaded.hash, definition: loaded.definition });
  }));

  router.post('/sessions', handle((req, res) => {
    const body = req.body || {};
    if (typeof body.game_id !== 'string') return res.status(400).json({ error: 'game_id_required' });
    if (body.participants !== undefined && !Array.isArray(body.participants)) {
      return res.status(400).json({ error: 'participants_must_be_array' });
    }
    res.status(201).json(gamingService.createSession(body));
  }));

  router.get('/sessions/:sessionId', handle((req, res) => {
    res.json(gamingService.getSession(req.params.sessionId, req.query.viewer_id || null));
  }));

  router.put('/sessions/:sessionId', handle((req, res) => {
    const command = req.body?.command;
    if (!command) return res.status(400).json({ error: 'command_required' });
    res.json(gamingService.applyCommand(req.params.sessionId, command, req.body?.viewer_id || null));
  }));

  return router;
}

export default createGamingRouter;
