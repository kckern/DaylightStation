import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

/**
 * /api/v1/fitness/remote-buttons
 *   GET            → { remotes: { ADDRESS: { buttons, positions, label, updatedAt, updatedBy } } }
 *   PUT /:address  { buttons?: { keyName: actionId }, positions?: { position: actionId },
 *                    label?, updatedBy? } → the same document
 */
export function createFitnessRemoteButtonsRouter({ service, householdId }) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const boundary = (operation) => asyncHandler(async (req, res) => {
    try { res.json(await operation(req)); }
    catch (error) { if (error instanceof TypeError) error.status = 400; throw error; }
  });
  router.get('/', boundary(() => service.get(householdId)));
  router.put('/:address', boundary((req) => service.save(householdId, {
    address: req.params.address,
    buttons: req.body?.buttons,
    positions: req.body?.positions,
    label: req.body?.label,
    updatedBy: req.body?.updatedBy,
  })));
  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}
export default createFitnessRemoteButtonsRouter;
