import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

export function createFitnessPlaybackBudgetsRouter({ service, householdId }) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const boundary = operation => asyncHandler(async (req, res) => {
    try { res.json(await operation(req)); }
    catch (error) { if (error instanceof TypeError) error.status = 400; throw error; }
  });
  router.get('/', boundary(req => service.status({ householdId, deviceId: req.query.deviceId })));
  router.post('/observe', boundary(req => service.observe({ ...req.body, householdId })));
  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}
