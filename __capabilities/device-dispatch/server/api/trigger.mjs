/**
 * Trigger Router — maps GET /:location/:type/:value to
 * TriggerDispatchService.handleTrigger, plus POST /side-effect for end-of-queue
 * tail markers fired by the device Player when it advances onto a virtual
 * `mediaType: 'trigger/side-effect'` item. With a voiceTriggerService, also
 * POST /:location/voice {transcript} and POST /:location/voice/confirm {proposal}.
 * @module api/v1/routers/trigger
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const STATUS_BY_CODE = {
  LOCATION_NOT_FOUND: 404,
  TRIGGER_NOT_REGISTERED: 404,
  AUTH_FAILED: 401,
  AUTHORIZE_DENIED: 403,
  UNKNOWN_MODALITY: 400,
  UNKNOWN_ACTION: 400,
  INVALID_INTENT: 400,
  DISPATCH_FAILED: 502,
  INVALID_NOTE: 400,
  UNSUPPORTED_MODALITY: 400,
  NOTE_WRITE_FAILED: 500,
  INVALID_TRANSCRIPT: 400,
  VOICE_NO_MATCH: 404,
  PROPOSAL_NOT_FOUND: 410,
};

export function createTriggerRouter({
  triggerDispatchService,
  sideEffectExecutor,
  voiceTriggerService = null,
  isUnknownSideEffectError = (error) => error?.name === 'UnknownSideEffectError',
  logger = console,
}) {
  if (typeof sideEffectExecutor?.execute !== 'function') {
    throw new Error('createTriggerRouter: sideEffectExecutor required');
  }
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

  router.post('/side-effect', express.json(), asyncHandler(async (req, res) => {
    const { behavior, location, deviceId, markerId } = req.body || {};
    const baseLog = { behavior, location, deviceId, markerId };

    if (!behavior || typeof behavior !== 'string') {
      logger.warn?.('trigger.side-effect.fired', { ...baseLog, ok: false, error: 'missing-behavior' });
      return res.status(400).json({ ok: false, error: 'behavior required' });
    }

    try {
      const outcome = await sideEffectExecutor.execute({ behavior, location, deviceId, markerId });
      if (outcome.kind === 'deduped') {
        logger.info?.('trigger.side-effect.deduped', { ...baseLog });
        return res.status(200).json({ ok: true, deduped: true });
      }
      const { result, elapsedMs } = outcome;
      logger.info?.('trigger.side-effect.fired', { ...baseLog, ok: true, elapsedMs });
      return res.status(200).json({ ok: true, behavior, elapsedMs, result });
    } catch (err) {
      const elapsedMs = err.elapsedMs ?? 0;
      const status = isUnknownSideEffectError(err) ? 400 : 502;
      logger.error?.('trigger.side-effect.fired', { ...baseLog, ok: false, error: err.message, elapsedMs });
      return res.status(status).json({ ok: false, error: err.message, elapsedMs });
    }
  }));

  // Voice: a transcript, not a keyword. Mounted only when composition built a
  // VoiceTriggerService. GET /:location/voice/:keyword (above) stays the
  // exact-keyword path and never touches the decision model.
  if (voiceTriggerService) {
    const send = (res, result) => res.status(result.ok ? 200 : (STATUS_BY_CODE[result.code] || 500)).json(result);

    router.post('/:location/voice', express.json(), asyncHandler(async (req, res) => {
      const { location } = req.params;
      const token = req.query.token ?? req.body?.token;
      const options = { token };
      if (req.query.dryRun === '1' || req.query.dryRun === 'true') options.dryRun = true;
      logger.debug?.('trigger.router.voice', { location, chars: typeof req.body?.transcript === 'string' ? req.body.transcript.length : null });
      return send(res, await voiceTriggerService.handleTranscript(location, req.body?.transcript, options));
    }));

    router.post('/:location/voice/confirm', express.json(), asyncHandler(async (req, res) => {
      const { location } = req.params;
      const token = req.query.token ?? req.body?.token;
      return send(res, await voiceTriggerService.confirm(location, req.body?.proposal, { token }));
    }));
  }

  return router;
}

export default createTriggerRouter;
