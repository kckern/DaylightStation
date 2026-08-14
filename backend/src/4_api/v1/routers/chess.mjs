import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { isValidFen } from '#shared/gaming/chess/engine.mjs';
import { safeSegment } from './lib/emulatorPaths.mjs';

/**
 * Chess API: one move endpoint and the config pair.
 *
 * One request per move — there is nothing to stream until a live eval bar
 * exists, and adding one later does not disturb this contract.
 *
 * Mounted twice in `app.mjs`: at `/api/v1/chess` directly, and a second time
 * — the SAME router instance — as a `compatibilityRouters` entry inside
 * `pianoGames.mjs`'s composition, which is what actually answers
 * `/api/v1/piano-games/chess/*`. That second mount is registered before the
 * generic `:gameId` routes in `pianoGames.mjs` (the router), so it intercepts
 * every chess request there and this file's fen-trusting contract is what the
 * kiosk gets either way — chess is not yet running through
 * `PianoGamesContainer` for real traffic. `chessApi.js` was pointed at the
 * unified path so the client is already on the URL every game is meant to
 * converge on; this file is unchanged and stays the actual implementation
 * until a later task cuts traffic over to the container (see
 * `ChessEngineAdapter.mjs`, which exists today only so the container CAN run
 * chess, and is exercised by tests rather than by either mount).
 */
export function createChessRouter({
  engine, configService, recordStore = null, archiveStore = null, ladderService = null, logger = null,
}) {
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
    const { fen, rung: rungId, level, gameId } = req.body || {};
    if (!isValidFen(fen)) return res.status(400).json({ error: 'invalid_fen' });
    const config = await configService.read(user);
    // A ladder level takes precedence over a named rung when one is asked for.
    // The service clamps it to what this player has unlocked — the only place
    // "no skipping ahead" is actually enforced, since anything on the client
    // can be bypassed with a crafted request.
    let rung;
    let effectiveOpponent;
    if (level !== undefined && level !== null && ladderService) {
      const resolved = await ladderService.rungFor(user, level);
      rung = resolved.rung;
      effectiveOpponent = { source: 'ladder', level: resolved.level, name: resolved.opponent?.name || null };
    } else {
      rung = configService.resolveRung(config, rungId || config.default_rung);
      effectiveOpponent = { source: 'rung', level: null, name: null };
    }
    effectiveOpponent.rung = {
      id: rung?.id || null,
      label: rung?.label || null,
      skill: rung?.skill ?? null,
      elo: rung?.elo ?? null,
      movetime_ms: rung?.movetime_ms ?? null,
    };
    logger?.info?.('chess.move.requested', {
      userId: user,
      gameId: gameId || 'default',
      requested: { rung: rungId || null, level: level ?? null },
      effective: effectiveOpponent,
    });
    const move = await engine.chooseMove({ fen, rung, gameId: gameId || 'default' });
    if (!move) return res.json({ move: null, opponent: effectiveOpponent });
    return res.json({ ...move, opponent: effectiveOpponent });
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
    // dataService.user.write (behind recordStore.save) returns false rather than
    // throwing on a write failure (e.g. EACCES). This is the one record this task
    // exists to make truthful — never answer 201 for a save that didn't happen.
    const saved = await recordStore.save(userId, req.body || {});
    if (!saved) {
      logger?.warn?.('chess.game.record-failed', { userId, result: req.body?.result, moves: req.body?.moves });
      return res.status(500).json({ error: 'save_failed' });
    }
    logger?.info?.('chess.game.recorded', {
      userId, result: req.body?.result, moves: req.body?.moves, opponent: req.body?.opponent || null,
    });
    // Promotion is decided here, on the server, not by the kiosk: a reloaded tab
    // mid-write would otherwise lose a rung the child had earned.
    const ladder = ladderService ? await ladderService.recordGame(userId, req.body || {}) : null;
    return res.status(201).json({ saved: true, ladder });
  }));

  /**
   * The household game archive: every game played on this piano, finished or
   * not, filed by the day it was played.
   *
   * Distinct from POST /games in three ways that matter. It accepts an
   * unfinished game, because walking away is data. It accepts a guest, because
   * the archive is about what happened on the instrument rather than about
   * whose profile it belongs to. And it never fails the caller: a child leaving
   * the screen must not be held there by a disk error, so a failed write is
   * logged and answered 202 rather than 500 — the client has already navigated
   * away and has nothing it could do with the failure.
   */
  router.post('/history', asyncHandler(async (req, res) => {
    if (!archiveStore) return res.status(501).json({ error: 'archive_unavailable' });
    const record = req.body || {};
    if (!Array.isArray(record.moves) || record.moves.length === 0) {
      return res.status(400).json({ error: 'no_moves' });
    }
    // The user id lands in a filename, so it gets the same guard as a path
    // segment even though it is not a directory here.
    let userSegment = 'guest';
    if (record.user_id) {
      try {
        userSegment = safeSegment(String(record.user_id));
      } catch {
        logger?.warn?.('chess.history.unsafe-user-rejected', { user: String(record.user_id) });
        return res.status(400).json({ error: 'invalid_user' });
      }
    }
    const saved = await archiveStore.save({ ...record, user_id: record.user_id || null }, userSegment);
    if (!saved) {
      logger?.warn?.('chess.history.archive-failed', {
        user: userSegment, moves: record.moves.length, completed: !!record.completed,
      });
      return res.status(202).json({ archived: false });
    }
    logger?.info?.('chess.history.archived', {
      user: userSegment,
      played_on: record.played_on,
      moves: record.moves.length,
      completed: !!record.completed,
      ended_by: record.ended_by,
      addressing: record.addressing,
      opponent: record.opponent || null,
    });
    return res.status(201).json({ archived: true });
  }));

  /**
   * Where this player stands on the ladder: who they may face, who they are
   * climbing, and how close they are. A guest gets the bottom of the roster and
   * an honest `persisted: false` rather than a bar that resets on reload.
   */
  router.get('/ladder', asyncHandler(async (req, res) => {
    if (!ladderService) return res.status(501).json({ error: 'ladder_unavailable' });
    const user = resolveUser(req, res);
    if (user === undefined) return undefined;
    return res.json(await ladderService.read(user));
  }));

  return router;
}

export default createChessRouter;
