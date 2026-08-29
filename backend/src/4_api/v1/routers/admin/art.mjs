import express from 'express';
import { splatPath } from '#api/utils/wildcard.mjs';

function sendKnownError(res, error) {
  if (error?.code === 'ART_ADMIN_INVALID_SOURCE') {
    res.status(400).json({ error: 'Invalid source' });
    return true;
  }
  if (error?.code === 'ART_ADMIN_INVALID_WORK_ID') {
    res.status(400).json({ error: 'Invalid work id' });
    return true;
  }
  if (error?.code === 'ART_ADMIN_INVALID_PATCH') {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error?.code === 'ART_ADMIN_WORK_NOT_FOUND') {
    res.status(404).json({ error: 'Work not found' });
    return true;
  }
  return false;
}

/**
 * Admin Art HTTP translation.
 *
 * The injected application service owns collection filtering, validation,
 * pagination, and persistence orchestration. This router only translates
 * query/body values and maps application error codes to the established HTTP
 * contract.
 */
export function createAdminArtRouter({ artService, logger = console } = {}) {
  if (!artService
    || typeof artService.listWorks !== 'function'
    || typeof artService.patchWork !== 'function') {
    throw new Error('createAdminArtRouter requires artService');
  }
  const router = express.Router();

  router.get('/works', async (req, res) => {
    try {
      const { source, tag, hidden, flagged, q } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(2000, Math.max(1, parseInt(req.query.pageSize, 10) || 60));
      const result = await artService.listWorks({
        source,
        tag,
        hidden: hidden === 'true',
        flagged: flagged === 'true',
        q: q || undefined,
        page,
        pageSize,
      });
      res.json(result);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      logger.error?.('admin.art.list.failed', { error: error.message });
      throw error;
    }
  });

  router.patch('/works/*splat', async (req, res) => {
    const { source, ...patch } = req.body || {};
    const id = splatPath(req);
    try {
      const result = await artService.patchWork({ source, id, patch });
      res.json(result);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      logger.error?.('admin.art.patch.failed', { id, error: error.message });
      throw error;
    }
  });

  return router;
}

export default createAdminArtRouter;
