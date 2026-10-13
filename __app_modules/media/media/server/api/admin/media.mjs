import { sendInternalError } from '#api/utils/internalError.mjs';
import express from 'express';

export function createAdminMediaRouter({ adminMediaService, logger = console }) {
  const router = express.Router();

  router.get('/freshvideo/sources', async (req, res) => {
    try {
      res.json(await adminMediaService.sources());
    } catch (error) {
      logger.error?.('admin.media.sources.error', { error: error.message });
      sendInternalError(res, { error: 'Failed to load sources' });
    }
  });

  router.post('/freshvideo/:provider/metadata', async (req, res) => {
    const { provider } = req.params;
    try {
      const result = await adminMediaService.metadata(provider);
      if (result.kind === 'not_configured') return res.status(404).json({ error: 'No freshvideo sources configured' });
      if (result.kind === 'not_found') return res.status(404).json({ error: `Source not found: ${provider}` });
      if (result.kind === 'failed') return sendInternalError(res, { error: result.error });
      res.json(result.body);
    } catch (error) {
      logger.error?.('admin.media.metadata.error', { provider, error: error.message });
      sendInternalError(res, { error: error.message });
    }
  });

  router.post('/freshvideo/metadata/all', async (req, res) => {
    try {
      res.json(await adminMediaService.metadataAll());
    } catch (error) {
      logger.error?.('admin.media.metadata.all.error', { error: error.message });
      sendInternalError(res, { error: error.message });
    }
  });

  return router;
}

export default createAdminMediaRouter;
