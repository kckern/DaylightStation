import express from 'express';

export function createPresentationRouter({ catalog, logger = null }) {
  if (!catalog) throw new Error('createPresentationRouter: catalog required');
  const router = express.Router();
  const handle = (operation) => (req, res) => {
    try { operation(req, res); } catch (error) {
      const status = Number(error.status) || 500;
      logger?.[status >= 500 ? 'error' : 'warn']?.('presentation.api.error', { code: error.code || 'internal_error', status, message: error.message });
      res.status(status).json({ error: error.code || 'internal_error', message: status >= 500 ? 'Presentation request failed' : error.message });
    }
  };
  router.get('/catalogs/:packId', handle((req, res) => {
    const loaded = catalog.get(req.params.packId);
    if (!loaded) return res.status(404).json({ error: 'presentation_catalog_not_found' });
    const assets = Object.fromEntries(Object.entries(loaded.assets).filter(([, asset]) => asset.status === 'approved').map(([id, asset]) => {
      const { source, source_sha256: sourceSha256, provenance, distribution, ...publicAsset } = asset;
      void source; void sourceSha256; void provenance; void distribution;
      return [id, { ...publicAsset, image_url: `/api/v1/presentation/catalogs/${encodeURIComponent(req.params.packId)}/assets/${encodeURIComponent(id)}/image` }];
    }));
    res.json({ ...loaded, assets, asset_templates: undefined, imports: undefined });
  }));
  router.get('/catalogs/:packId/assets/:assetId/image', handle((req, res) => {
    const asset = catalog.getAsset(req.params.packId, req.params.assetId);
    if (!asset) return res.status(404).json({ error: 'presentation_asset_not_found' });
    const etag = `"${asset.source_sha256}"`; res.set({ ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' });
    if (req.headers?.['if-none-match'] === etag) return res.status(304).end();
    res.type('png').sendFile(asset.file);
  }));
  return router;
}

export default createPresentationRouter;
