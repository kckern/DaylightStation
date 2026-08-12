import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { isValidFen } from '#shared/gaming/chess/engine.mjs';

/**
 * Chess API: one move endpoint and the config pair.
 *
 * One request per move — there is nothing to stream until a live eval bar
 * exists, and adding one later does not disturb this contract.
 */
export function createChessRouter({ engine, configService, logger = null }) {
  const router = express.Router();

  router.post('/move', asyncHandler(async (req, res) => {
    const { fen, rung: rungId, gameId } = req.body || {};
    if (!isValidFen(fen)) return res.status(400).json({ error: 'invalid_fen' });
    const config = await configService.read(req.query.user || null);
    const rung = configService.resolveRung(config, rungId || config.default_rung);
    const move = await engine.chooseMove({ fen, rung, gameId: gameId || 'default' });
    if (!move) return res.json({ move: null });
    return res.json(move);
  }));

  router.get('/config', asyncHandler(async (req, res) => {
    res.json(await configService.read(req.query.user || null));
  }));

  router.put('/config', asyncHandler(async (req, res) => {
    const userId = req.query.user;
    if (!userId) return res.status(400).json({ error: 'user_required' });
    await configService.writeUserLayer(userId, req.body || {});
    res.json(await configService.read(userId));
  }));

  return router;
}

export default createChessRouter;
