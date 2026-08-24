import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

function safeSegment(value) {
  const text = String(value || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) throw new Error('unsafe_segment');
  return text;
}

export function createPianoGamesRouter({ container, logger = null, nativeRouters = {} }) {
  const router = express.Router({ mergeParams: true });
  const userFrom = (req) => req.query.user ? safeSegment(req.query.user) : null;

  // A Piano family may own a richer native API than the generic opponent and
  // record endpoints. It still lives exclusively under the Piano namespace.
  for (const [gameId, nativeRouter] of Object.entries(nativeRouters)) {
    router.use(`/${safeSegment(gameId)}`, nativeRouter);
  }

  router.post('/:gameId/move', asyncHandler(async (req, res) => {
    try {
      const gameId = safeSegment(req.params.gameId);
      const result = await container.chooseMove(gameId, {
        transcript: req.body?.transcript,
        level: req.body?.level,
        gameSessionId: req.body?.gameId || 'default',
        userId: userFrom(req),
      });
      return res.json(result);
    } catch (error) {
      if (error.code === 'unknown_game' || error.message === 'unsafe_segment') return res.status(404).json({ error: 'unknown_game' });
      throw error;
    }
  }));

  router.get('/:gameId/config', asyncHandler(async (req, res) => {
    res.json(await container.readConfig(safeSegment(req.params.gameId), userFrom(req)));
  }));

  router.put('/:gameId/config', asyncHandler(async (req, res) => {
    const userId = userFrom(req);
    if (!userId) return res.status(400).json({ error: 'user_required' });
    return res.json(await container.writeConfig(safeSegment(req.params.gameId), userId, req.body || {}));
  }));

  router.get('/:gameId/ladder', asyncHandler(async (req, res) => {
    res.json(await container.ladder(safeSegment(req.params.gameId), userFrom(req)));
  }));

  router.post('/:gameId/games', asyncHandler(async (req, res) => {
    const gameId = safeSegment(req.params.gameId);
    const userId = userFrom(req);
    if (!userId) return res.status(400).json({ error: 'user_required' });
    const result = await container.recordGame(gameId, userId, req.body || {});
    if (!result.saved) return res.status(503).json({ error: 'save_failed' });
    logger?.info?.('piano-game.recorded', { gameId, userId, result: req.body?.result });
    return res.status(201).json(result);
  }));

  router.post('/:gameId/history', asyncHandler(async (req, res) => {
    const gameId = safeSegment(req.params.gameId);
    const record = req.body || {};
    if (!Array.isArray(record.moves) || record.moves.length === 0) return res.status(400).json({ error: 'no_moves' });
    const userSegment = record.user_id ? safeSegment(record.user_id) : 'guest';
    const archived = await container.archiveGame(gameId, userSegment, record);
    return res.status(archived ? 201 : 202).json({ archived: !!archived });
  }));

  return router;
}

export default createPianoGamesRouter;
