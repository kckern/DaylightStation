import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Household kiosk capability boundary. Only scanner ingress can create
 * intentions — there is no route that mints one, and that stays true.
 *
 * `POST /open` is NOT such a route. It creates no intention and knows about no
 * book; it is the panel's second door to a shelf the child will type into (see
 * `OpenBookShelfAtPanel`). It lives here because it shares this router's one
 * subject — a book reaching the shelf without a printed code.
 */
export function createSchoolBookScansRouter({ bookScans, openAtPanel = null }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/pending', (req, res) => res.json({ intent: bookScans.pending(req.query.screenId) }));
  if (openAtPanel) {
    router.post('/open', express.json(), asyncHandler(async (req, res) => {
      res.json(await openAtPanel.open({ screenId: req.body?.screenId, learnerId: req.body?.learnerId }));
    }));
  }
  router.post('/:id/claim', express.json(), asyncHandler(async (req, res) => {
    res.json(await bookScans.claim({ id: req.params.id, screenId: req.body?.screenId, learnerId: req.body?.learnerId }));
  }));
  router.post('/:id/dismiss', express.json(), asyncHandler(async (req, res) => {
    res.json(await bookScans.dismiss({ id: req.params.id, screenId: req.body?.screenId }));
  }));
  return router;
}
