import express from 'express';

export function createGamingRouter({ gamingService, assetCatalog = null, logger = null }) {
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

  router.get('/assets/:packId', handle((req, res) => {
    if (!assetCatalog) return res.status(404).json({ error: 'asset_catalog_unavailable' });
    const catalog = assetCatalog.get(req.params.packId);
    if (!catalog) return res.status(404).json({ error: 'asset_pack_not_found' });
    const assets = Object.fromEntries(Object.entries(catalog.assets)
      .filter(([, asset]) => asset.status === 'approved')
      .map(([id, asset]) => {
        const { source, source_sha256: sourceSha256, provenance, distribution, ...publicAsset } = asset;
        void source; void sourceSha256; void provenance; void distribution;
        return [id, { ...publicAsset, image_url: `/api/v1/gaming/assets/${encodeURIComponent(req.params.packId)}/${encodeURIComponent(id)}/image` }];
      }));
    res.json({ schema_version: catalog.schema_version, pack: catalog.pack, assets });
  }));

  router.get('/assets/:packId/:assetId/image', handle((req, res) => {
    if (!assetCatalog) return res.status(404).json({ error: 'asset_catalog_unavailable' });
    const asset = assetCatalog.getAsset(req.params.packId, req.params.assetId);
    if (!asset) return res.status(404).json({ error: 'asset_not_found' });
    const etag = `"${asset.source_sha256}"`;
    res.set({ ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
    if (req.headers?.['if-none-match'] === etag) return res.status(304).end();
    res.type('png').sendFile(asset.file);
  }));

  router.get('/definitions/:gameId', handle((req, res) => {
    const loaded = gamingService.getDefinition(req.params.gameId);
    res.json({ game_id: req.params.gameId, definition_hash: loaded.hash, definition: loaded.definition });
  }));

  router.get('/games/:gameId/progress', handle((req, res) => {
    res.json(gamingService.getProgress(req.params.gameId, req.query.user_id || null));
  }));

  router.get('/games/:gameId/active-session', handle((req, res) => {
    res.json(gamingService.getActiveSession(req.params.gameId, req.query.user_id || null));
  }));

  router.get('/games/:gameId/leaderboard', handle((req, res) => {
    res.json(gamingService.getLeaderboard(
      req.params.gameId,
      req.query.user_id || null,
      req.query.week || null,
    ));
  }));

  router.post('/sessions', handle((req, res) => {
    const body = req.body || {};
    if (typeof body.game_id !== 'string') return res.status(400).json({ error: 'game_id_required' });
    if (body.participants !== undefined && !Array.isArray(body.participants)) {
      return res.status(400).json({ error: 'participants_must_be_array' });
    }
    if (body.setup !== undefined && (!body.setup || typeof body.setup !== 'object' || Array.isArray(body.setup))) {
      return res.status(400).json({ error: 'setup_must_be_object' });
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
