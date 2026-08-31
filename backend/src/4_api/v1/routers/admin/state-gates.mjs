import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

export function createAdminStateGatesRouter({ operations, actorFromRequest }) {
  if (!operations || !actorFromRequest) throw new Error('createAdminStateGatesRouter requires operations and actorFromRequest');
  const router = express.Router();
  router.post('/policy/activate', asyncHandler(async (req, res) => {
    res.json(await operations.activatePolicyGraph(req.householdId, actorFromRequest(req)));
  }));
  router.get('/assertions', asyncHandler(async (req, res) => {
    const result = await operations.getDiagnostics(req.householdId, actorFromRequest(req));
    res.json({ currentRevision: result.currentRevision, assertions: result.assertions });
  }));
  router.get('/policy', asyncHandler(async (req, res) => {
    const result = await operations.getDiagnostics(req.householdId, actorFromRequest(req));
    res.json({ currentRevision: result.currentRevision, ...result.policy });
  }));
  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createAdminStateGatesRouter;
