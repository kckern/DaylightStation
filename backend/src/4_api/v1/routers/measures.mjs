/**
 * `/api/v1/measures` — weekly measures for the whole school roster.
 *
 * ROSTER-WIDE, NOT PER-LEARNER, on purpose. The school status board draws one
 * card per child and already follows this pattern for the teacher day digest;
 * four cards must not mean four round trips on a wall panel that repaints
 * every five minutes.
 *
 * Read-only and `no-store`. It mints nothing, opens no session and writes no
 * evidence — it is a view over facts fitness already recorded.
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createMeasuresRouter({ weeklyMeasures } = {}) {
  if (!weeklyMeasures || typeof weeklyMeasures.execute !== 'function') {
    throw new Error('createMeasuresRouter requires a weeklyMeasures use case');
  }
  const router = express.Router();

  // The use case arrives already built, it is not imported. Both layer rules
  // this router is ratcheted against — `api-no-domains` and `api-no-apps` —
  // are about IMPORTS, and the house pattern for a router that needs a use
  // case is the one `createReadingRouter` uses: take the instance as a
  // dependency and let the composition root wire it.

  /**
   * GET /weekly?week=YYYY-MM-DD
   *
   * `week` is any day inside the wanted week; the Monday-to-Sunday window
   * containing it is returned. Omitted means the current week.
   */
  router.get('/weekly', asyncHandler(async (req, res) => {
    const week = typeof req.query.week === 'string' ? req.query.week : null;
    const body = await weeklyMeasures.execute({ week });
    res.set('Cache-Control', 'no-store').json(body);
  }));

  return router;
}

export default createMeasuresRouter;
