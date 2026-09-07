import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/** Household kiosk capability boundary. Only scanner ingress can create intentions. */
export function createSchoolBookScansRouter({ bookScans }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/pending', (req, res) => res.json({ intent: bookScans.pending(req.query.screenId) }));
  router.post('/:id/claim', express.json(), asyncHandler(async (req, res) => {
    res.json(await bookScans.claim({ id: req.params.id, screenId: req.body?.screenId, learnerId: req.body?.learnerId }));
  }));
  router.post('/:id/dismiss', express.json(), asyncHandler(async (req, res) => {
    res.json(await bookScans.dismiss({ id: req.params.id, screenId: req.body?.screenId }));
  }));
  return router;
}
