import express from 'express';
import path from 'path';
import { splatPath } from '#api/utils/wildcard.mjs';

/**
 * Game Show API (mounted at /api/v1/gameshow).
 *
 *   GET  /config                    → merged gameshow.yml (presets hydrated)
 *   GET  /games                     → registered game types
 *   GET  /games/:game/sets          → { sets: [...] } incl. validation status
 *   GET  /games/:game/sets/:setId   → normalized game set (404 unknown, 422 invalid)
 *   POST /sessions                  → create ({ game, setId, teams }) → 201
 *   GET  /sessions/active           → { session } (null when none)
 *   POST /sessions/:id/checkpoint   → persist frontend snapshot ({ state })
 *   POST /sessions/:id/finish       → mark complete
 *   POST /buzz                      → debug buzz inject → WS broadcast (202)
 *   GET  /media/*splat              → sound packs + clue media from media/apps/
 */
const GAMES = [{ id: 'jeopardy', title: 'Jeopardy' }];

export function createGameshowRouter({ gameShowService, sessionStore, broadcastEvent, mediaAppsDir = null, logger = console }) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    try {
      res.json(gameShowService.getConfig());
    } catch (err) {
      logger.error?.('gameshow.config.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/games', (req, res) => res.json({ games: GAMES }));

  router.get('/games/:game/sets', (req, res) => {
    try {
      res.json({ sets: gameShowService.listSets(req.params.game) });
    } catch (err) {
      logger.error?.('gameshow.sets.error', { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/games/:game/sets/:setId', (req, res) => {
    try {
      res.json(gameShowService.getSet(req.params.game, req.params.setId));
    } catch (err) {
      const code = /not found/.test(err.message) ? 404 : 422;
      res.status(code).json({ error: err.message });
    }
  });

  router.post('/sessions', (req, res) => {
    const { game, setId, teams } = req.body || {};
    if (!game || !setId) return res.status(400).json({ error: 'game and setId required' });
    res.status(201).json(sessionStore.create({ game, setId, teams: teams || [] }));
  });

  router.get('/sessions/active', (req, res) => {
    res.json({ session: sessionStore.getActive() });
  });

  router.post('/sessions/:id/checkpoint', (req, res) => {
    const session = sessionStore.checkpoint(req.params.id, (req.body || {}).state ?? null);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  });

  router.post('/sessions/:id/finish', (req, res) => {
    const session = sessionStore.finish(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  });

  router.post('/buzz', (req, res) => {
    const { slot, buzzerId, action } = req.body || {};
    if (!slot) return res.status(400).json({ error: 'slot required' });
    broadcastEvent({ topic: 'gameshow', kind: 'buzz', buzzerId: buzzerId || 'debug', action: action || 'inject', slot, ts: Date.now() });
    res.status(202).json({ ok: true });
  });

  // Sound packs + clue media (media/apps/...). Raw /media/* is not served by
  // the app, so game assets flow through here with containment checks.
  router.get('/media/*splat', (req, res) => {
    if (!mediaAppsDir) return res.status(404).json({ error: 'media not configured' });
    const rel = splatPath(req);
    const filePath = path.resolve(mediaAppsDir, rel);
    if (!filePath.startsWith(path.resolve(mediaAppsDir) + path.sep)) {
      return res.status(404).json({ error: 'not found' });
    }
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
    });
  });

  return router;
}
