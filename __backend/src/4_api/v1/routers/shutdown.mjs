import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
export function createShutdownRouter({ shutdownService } = {}) {
  const router = express.Router();
  router.get('/status', asyncHandler(async (req, res) => {
    const target = typeof req.query.target === 'string' ? req.query.target : '';
    if (!target) return res.status(400).json({ error: 'target required' });
    const result = shutdownService ? await shutdownService.status(target) : { locked: false, lockedUntil: null };
    res.set('Cache-Control', 'no-store').json(result);
  }));
  return router;
}
