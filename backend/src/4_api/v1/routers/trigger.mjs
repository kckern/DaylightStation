/**
 * Trigger Router — maps GET /:location/:type/:value to
 * TriggerDispatchService.handleTrigger.
 * @module api/v1/routers/trigger
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const STATUS_BY_CODE = {
  LOCATION_NOT_FOUND: 404,
  TRIGGER_NOT_REGISTERED: 404,
  AUTH_FAILED: 401,
  UNKNOWN_MODALITY: 400,
  UNKNOWN_ACTION: 400,
  INVALID_INTENT: 400,
  DISPATCH_FAILED: 502,
  INVALID_NOTE: 400,
  UNSUPPORTED_MODALITY: 400,
  NOTE_WRITE_FAILED: 500,
};

export function createTriggerRouter({ triggerDispatchService, logger = console }) {
  const router = express.Router();

  router.get('/:location/:type/:value', asyncHandler(async (req, res) => {
    const { location, type, value } = req.params;
    const { token, dryRun } = req.query;
    const options = { token };
    if (dryRun === '1' || dryRun === 'true') options.dryRun = true;

    logger.debug?.('trigger.router.fire', { location, type, value, dryRun: !!options.dryRun });

    const result = await triggerDispatchService.handleTrigger(location, type, value, options);

    if (result.ok) return res.status(200).json(result);

    const status = STATUS_BY_CODE[result.code] || 500;
    return res.status(status).json(result);
  }));

  router.put('/:location/:type/:value/note', asyncHandler(async (req, res) => {
    const { location, type, value } = req.params;
    const { token } = req.query;
    const note = req.body?.note;

    logger.debug?.('trigger.router.set_note', { location, type, value, hasNote: typeof note === 'string' });

    const result = await triggerDispatchService.setNote(location, type, value, note, { token });

    if (result.ok) return res.status(200).json(result);
    const status = STATUS_BY_CODE[result.code] || 500;
    return res.status(status).json(result);
  }));

  return router;
}

export default createTriggerRouter;
