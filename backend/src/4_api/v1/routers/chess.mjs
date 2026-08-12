import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { isValidFen } from '#shared/gaming/chess/engine.mjs';
import { safeSegment } from './lib/emulatorPaths.mjs';

/**
 * Chess API: one move endpoint and the config pair.
 *
 * One request per move — there is nothing to stream until a live eval bar
 * exists, and adding one later does not disturb this contract.
 */
export function createChessRouter({ engine, configService, recordStore = null, logger = null }) {
  const router = express.Router();

  /**
   * `?user=` becomes a path segment under data/users/<user>/ in DataService, so
   * an unvalidated value is a read/write primitive anywhere on disk. Same guard
   * and convention as the emulator router: safeSegment or nothing.
   * Returns the validated id, null when absent, or responds 400 and returns
   * undefined — callers must bail when the result is undefined.
   */
  const resolveUser = (req, res) => {
    if (req.query.user === undefined || req.query.user === '') return null;
    try {
      return safeSegment(String(req.query.user));
    } catch {
      logger?.warn?.('chess.config.unsafe-user-rejected', { user: String(req.query.user) });
      res.status(400).json({ error: 'invalid_user' });
      return undefined;
    }
  };

  router.post('/move', asyncHandler(async (req, res) => {
    const user = resolveUser(req, res);
    if (user === undefined) return undefined;
    const { fen, rung: rungId, gameId } = req.body || {};
    if (!isValidFen(fen)) return res.status(400).json({ error: 'invalid_fen' });
    const config = await configService.read(user);
    const rung = configService.resolveRung(config, rungId || config.default_rung);
    const move = await engine.chooseMove({ fen, rung, gameId: gameId || 'default' });
    if (!move) return res.json({ move: null });
    return res.json(move);
  }));

  router.get('/config', asyncHandler(async (req, res) => {
    const user = resolveUser(req, res);
    if (user === undefined) return;
    res.json(await configService.read(user));
  }));

  router.put('/config', asyncHandler(async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === undefined) return;
    if (!userId) return res.status(400).json({ error: 'user_required' });
    await configService.writeUserLayer(userId, req.body || {});
    return res.json(await configService.read(userId));
  }));

  router.post('/games', asyncHandler(async (req, res) => {
    const userId = resolveUser(req, res);
    if (userId === undefined) return undefined; // resolveUser already answered
    if (!userId) return res.status(400).json({ error: 'user_required' });
    await recordStore.save(userId, req.body || {});
    logger?.info?.('chess.game.recorded', { userId, result: req.body?.result, moves: req.body?.moves });
    return res.status(201).json({ saved: true });
  }));

  return router;
}

export default createChessRouter;
