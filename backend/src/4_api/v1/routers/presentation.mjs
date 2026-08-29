import express from 'express';
import { sendLocalFileResource } from '#system/http/streamFile.mjs';

export function createPresentationRouter({ catalog, getPublicCatalog, logger = null, sendFileResource = sendLocalFileResource }) {
  if (!catalog) throw new Error('createPresentationRouter: catalog required');
  if (!getPublicCatalog?.execute) throw new Error('createPresentationRouter: getPublicCatalog required');
  const router = express.Router();
  const handle = (operation) => (req, res) => {
    try { operation(req, res); } catch (error) {
      const status = Number(error.status) || 500;
      logger?.[status >= 500 ? 'error' : 'warn']?.('presentation.api.error', { code: error.code || 'internal_error', status, message: error.message });
      res.status(status).json({ error: error.code || 'internal_error', message: status >= 500 ? 'Presentation request failed' : error.message });
    }
  };
  router.get('/catalogs/:packId', handle((req, res) => {
    const loaded = getPublicCatalog.execute(req.params.packId);
    if (!loaded) return res.status(404).json({ error: 'presentation_catalog_not_found' });
    const assets = Object.fromEntries(Object.entries(loaded.assets).map(([id, asset]) => [id, {
      ...asset,
      image_url: `/api/v1/presentation/catalogs/${encodeURIComponent(req.params.packId)}/assets/${encodeURIComponent(id)}/image`,
    }]));
    res.json({ ...loaded, assets });
  }));
  router.get('/catalogs/:packId/scenes', handle((req, res) => {
    const index = catalog.listScenes?.(req.params.packId);
    if (!index) return res.status(404).json({ error: 'presentation_scene_index_not_found' });
    res.json(index);
  }));
  router.get('/catalogs/:packId/scenes/:sceneId', handle((req, res) => {
    const scene = catalog.getScene?.(req.params.packId, req.params.sceneId);
    if (!scene) return res.status(404).json({ error: 'presentation_scene_not_found' });
    res.json(scene);
  }));
  router.get('/catalogs/:packId/assets/:assetId/image', handle((req, res) => {
    const asset = catalog.getAsset(req.params.packId, req.params.assetId);
    if (!asset) return res.status(404).json({ error: 'presentation_asset_not_found' });
    const etag = `"${asset.sourceSha256}"`; res.set({ ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
    if (req.headers?.['if-none-match'] === etag) return res.status(304).end();
    res.type('png'); return sendFileResource(req, res, asset.resource);
  }));
  return router;
}

export default createPresentationRouter;
