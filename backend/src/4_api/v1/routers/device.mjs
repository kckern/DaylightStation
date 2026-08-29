import { sendInternalError } from '#api/utils/internalError.mjs';
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { buildErrorBody, ERROR_CODES } from '#shared-contracts/media/errors.mjs';
import { validateSessionSnapshot } from '#shared-contracts/media/shapes.mjs';
import { TRANSPORT_ACTIONS, QUEUE_OPS, REPEAT_MODES, isTransportAction, isQueueOp, isRepeatMode } from '#shared-contracts/media/commands.mjs';

const nonEmpty = value => typeof value === 'string' && value.length > 0;
const parseLoadQuery = (query = {}) => {
  const content = { ...query };
  if (content.volume != null) {
    const value = Number(content.volume);
    content.volume = Number.isFinite(value) ? value : content.volume;
  }
  // Keep the legacy `shuffle` query value intact for the receiving player,
  // while translating its HTTP spelling into the application command needed
  // by pre-warming.
  if (content.shuffle !== undefined) content.prewarmShuffle = content.shuffle === '1' || content.shuffle === 'true';
  return content;
};
const parseRequestedMinutes = value => Number(value) > 0 ? Number(value) : undefined;
const notFound = res => res.status(404).json(buildErrorBody({ error: 'Device not found', code: ERROR_CODES.DEVICE_NOT_FOUND }));

function mapCommand(result, res) {
  if (result?.ok === true) return res.status(200).json(result);
  const code = result?.code;
  const error = result?.error || 'Command failed';
  if (code === 'INVALID_ENVELOPE') return res.status(400).json(buildErrorBody({ error, code }));
  if (code === ERROR_CODES.DEVICE_NOT_FOUND) return res.status(404).json(buildErrorBody({ error, code }));
  if (code === ERROR_CODES.DEVICE_OFFLINE) {
    const body = buildErrorBody({ error, code });
    if (result.lastKnown !== undefined) body.lastKnown = result.lastKnown;
    return res.status(409).json(body);
  }
  if (code === ERROR_CODES.IDEMPOTENCY_CONFLICT) return res.status(409).json(buildErrorBody({ error, code }));
  return res.status(502).json(buildErrorBody({ error, code }));
}

function requireSessions(service, res) {
  if (service.configured()) return true;
  res.status(501).json(buildErrorBody({ error: 'Session control not configured' }));
  return false;
}

export function createDeviceRouter({ fleetService, presenceService, sessionService, screenService,
  dispatchService, recoveryService } = {}) {
  const router = express.Router();

  router.get('/config', (req, res) => res.json(fleetService.configuration(req.query.householdId)));

  router.get('/', (req, res) => {
    const devices = fleetService.list();
    res.json({ ok: true, count: devices.length, devices });
  });

  router.post('/:deviceId/presence', (req, res) => {
    if (!presenceService.configured()) return res.status(503).json({ error: 'presence not configured' });
    const body = req.body || {};
    if (!Array.isArray(body.devices)) return res.status(400).json({ error: 'devices must be an array' });
    const result = presenceService.record(req.params.deviceId, body);
    if (!result) return res.status(403).json({ error: 'device not allowed' });
    return res.json(result);
  });

  router.get('/:deviceId/presence', (req, res) => {
    if (!presenceService.configured()) return res.status(503).json({ error: 'presence not configured' });
    return res.json(presenceService.get(req.params.deviceId));
  });

  router.post('/audio-bridge/heal', asyncHandler(async (req, res) => {
    return res.status(200).json(await fleetService.healAudioBridge({
      force: !!req.body?.force, deviceId: req.body?.deviceId,
    }));
  }));

  router.get('/:deviceId', asyncHandler(async (req, res) => {
    const result = await fleetService.state(req.params.deviceId);
    if (result.kind === 'not_found') return notFound(res);
    return res.json({ ok: true, ...result.state });
  }));

  router.get('/:deviceId/session', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const result = sessionService.snapshot(req.params.deviceId);
    if (result === null || result === undefined) return notFound(res);
    if (!result.online) return res.status(503).json({ offline: true, lastKnown: result.snapshot, lastSeenAt: result.lastSeenAt });
    const snap = result.snapshot;
    if (snap && snap.state === 'idle' && snap.currentItem === null
      && Array.isArray(snap.queue?.items) && snap.queue.items.length === 0) return res.status(204).end();
    return res.status(200).json(snap);
  }));

  router.post('/:deviceId/session/transport', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { action, value, commandId } = req.body || {};
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    if (!isTransportAction(action)) return res.status(400).json(buildErrorBody({ error: `action must be one of: ${TRANSPORT_ACTIONS.join(', ')}` }));
    if ((action === 'seekAbs' || action === 'seekRel') && !(typeof value === 'number' && Number.isFinite(value))) {
      return res.status(400).json(buildErrorBody({ error: `value must be a finite number for action "${action}"` }));
    }
    return mapCommand(await sessionService.transport(req.params.deviceId, { action, value, commandId }), res);
  }));

  router.post('/:deviceId/session/queue/:op', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { deviceId, op } = req.params;
    const { contentId, queueItemId, from, to, items, clearRest, commandId } = req.body || {};
    if (!isQueueOp(op)) return res.status(400).json(buildErrorBody({ error: `Unknown queue op "${op}"; must be one of: ${QUEUE_OPS.join(', ')}`, code: 'VALIDATION' }));
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    if (['play-now', 'play-next', 'add-up-next', 'add'].includes(op) && !nonEmpty(contentId)) {
      return res.status(400).json(buildErrorBody({ error: `contentId required (non-empty string) for op "${op}"` }));
    }
    if (['remove', 'jump'].includes(op) && !nonEmpty(queueItemId)) {
      return res.status(400).json(buildErrorBody({ error: `queueItemId required (non-empty string) for op "${op}"` }));
    }
    if (op === 'reorder') {
      const hasFromTo = nonEmpty(from) && nonEmpty(to);
      const hasItems = Array.isArray(items) && items.length > 0 && items.every(nonEmpty);
      if (!hasFromTo && !hasItems) return res.status(400).json(buildErrorBody({ error: 'reorder requires either (from + to) or a non-empty items array of strings' }));
    }
    const params = { op };
    if (contentId !== undefined) params.contentId = contentId;
    if (queueItemId !== undefined) params.queueItemId = queueItemId;
    if (from !== undefined) params.from = from;
    if (to !== undefined) params.to = to;
    if (items !== undefined) params.items = items;
    if (clearRest !== undefined) params.clearRest = clearRest;
    return mapCommand(await sessionService.queue(deviceId, commandId, params), res);
  }));

  router.put('/:deviceId/session/shuffle', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { enabled, commandId } = req.body || {};
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    if (typeof enabled !== 'boolean') return res.status(400).json(buildErrorBody({ error: 'enabled must be a boolean' }));
    return mapCommand(await sessionService.config(req.params.deviceId, { setting: 'shuffle', value: enabled, commandId }), res);
  }));

  router.put('/:deviceId/session/repeat', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { mode, commandId } = req.body || {};
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    if (!isRepeatMode(mode)) return res.status(400).json(buildErrorBody({ error: `mode must be one of: ${REPEAT_MODES.join(', ')}` }));
    return mapCommand(await sessionService.config(req.params.deviceId, { setting: 'repeat', value: mode, commandId }), res);
  }));

  router.put('/:deviceId/session/shader', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const body = req.body || {}; const { commandId } = body;
    const hasShader = Object.prototype.hasOwnProperty.call(body, 'shader'); const shader = body.shader;
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    if (!hasShader || (shader !== null && typeof shader !== 'string')) return res.status(400).json(buildErrorBody({ error: 'shader must be a string or null' }));
    return mapCommand(await sessionService.config(req.params.deviceId, { setting: 'shader', value: shader, commandId }), res);
  }));

  router.post('/:deviceId/session/claim', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { commandId } = req.body || {};
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)', code: 'VALIDATION' }));
    const result = await sessionService.claim(req.params.deviceId, commandId);
    if (result?.ok === true) return res.status(200).json({ ok: true, commandId: result.commandId ?? commandId,
      snapshot: result.snapshot, stoppedAt: result.stoppedAt });
    return mapCommand(result, res);
  }));

  router.put('/:deviceId/session/volume', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { level, commandId } = req.body || {};
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 100) {
      return res.status(400).json(buildErrorBody({ error: 'level must be an integer between 0 and 100' }));
    }
    return mapCommand(await sessionService.config(req.params.deviceId, { setting: 'volume', value: level, commandId }), res);
  }));

  router.get('/:deviceId/on', asyncHandler(async (req, res) => {
    const result = await fleetService.powerOn(req.params.deviceId, req.query.display);
    return result.kind === 'not_found' ? notFound(res) : res.json(result.result);
  }));

  router.get('/:deviceId/off', asyncHandler(async (req, res) => {
    const result = await fleetService.powerOff(req.params.deviceId, {
      display: req.query.display,
      force: req.query.force === 'true',
    });
    if (result.kind === 'not_found') return notFound(res);
    if (result.kind === 'busy') {
      const body = buildErrorBody({ error: 'Active videocall in progress', code: ERROR_CODES.DEVICE_BUSY });
      body.hint = 'Use ?force=true to override'; return res.status(409).json(body);
    }
    return res.json(result.result);
  }));

  router.get('/:deviceId/toggle', asyncHandler(async (req, res) => {
    const result = await fleetService.toggle(req.params.deviceId, req.query.display);
    return result.kind === 'not_found' ? notFound(res) : res.json(result.result);
  }));

  router.get('/:deviceId/screen/toggle', asyncHandler(async (req, res) => {
    const result = await screenService.toggle(req.params.deviceId);
    return result.kind === 'not_found' ? notFound(res) : res.json(result.body);
  }));

  router.get('/:deviceId/screen/override', asyncHandler(async (req, res) => res.json(screenService.override(req.params.deviceId))));

  router.post('/:deviceId/screen/override', asyncHandler(async (req, res) => {
    const state = req.body?.state;
    if (state !== 'on' && state !== 'off') return res.status(400).json(buildErrorBody({ error: `Invalid override state '${state}' (expected 'on'|'off')` }));
    const result = await screenService.setOverride(req.params.deviceId, state, parseRequestedMinutes(req.body?.minutes));
    return result.kind === 'not_found' ? notFound(res) : res.json(result.body);
  }));

  router.get('/:deviceId/screen/:state', asyncHandler(async (req, res) => {
    const { deviceId, state } = req.params;
    if (state !== 'on' && state !== 'off') return res.status(400).json(buildErrorBody({ error: `Invalid screen state '${state}' (expected 'on' or 'off')` }));
    const result = await screenService.setScreen(deviceId, state);
    return result.kind === 'not_found' ? notFound(res) : res.json(result.result);
  }));

  router.post('/:deviceId/screen/suppress-wake', asyncHandler(async (req, res) => {
    return res.json(screenService.suppressWake(req.params.deviceId, parseRequestedMinutes(req.body?.minutes)));
  }));

  router.get('/:deviceId/load', asyncHandler(async (req, res) => {
    const { deviceId } = req.params; const query = parseLoadQuery(req.query);
    dispatchService.logLoadStart(deviceId, query);
    if (!dispatchService.configured()) return sendInternalError(res, buildErrorBody({ error: 'WakeAndLoadService not configured' }));
    const input = dispatchService.checkInput(deviceId);
    if (!input.ok) {
      dispatchService.logInputFailure(deviceId, input);
      return res.status(503).json({ ok: false, deviceId, failedStep: 'input', error: input.error, keyboardId: input.keyboardId });
    }
    const result = await dispatchService.load(deviceId, query);
    let status = 200; let extra = null;
    if (result.error === 'Device not found') status = 404;
    else if (result.failedStep === 'prewarm' && result.permanent === true) {
      status = 422; extra = { code: ERROR_CODES.CONTENT_NOT_FOUND };
    }
    return res.status(status).json(extra ? { ...result, ...extra } : result);
  }));

  router.post('/:deviceId/load', asyncHandler(async (req, res) => {
    const { deviceId } = req.params; const body = req.body || {};
    if (body.mode !== 'adopt') return res.status(400).json(buildErrorBody({
      error: 'POST /device/:id/load currently only supports mode: "adopt"', code: 'VALIDATION' }));
    if (!dispatchService.configured()) return sendInternalError(res, buildErrorBody({ error: 'WakeAndLoadService not configured' }));
    const { snapshot, dispatchId } = body;
    if (!nonEmpty(dispatchId)) return res.status(400).json(buildErrorBody({ error: 'dispatchId required (non-empty string)', code: 'VALIDATION' }));
    const validation = validateSessionSnapshot(snapshot);
    if (!validation.valid) return res.status(400).json(buildErrorBody({ error: `Invalid snapshot: ${validation.errors[0]}`,
      code: 'VALIDATION', details: validation.errors }));
    try {
      const cached = await dispatchService.adopt(deviceId, snapshot, dispatchId);
      const status = cached.kind === 'device_not_found' ? 404 : (cached.kind === 'adopted' ? 200 : 502);
      return res.status(status).json({
        ...cached.result,
        adopted: cached.result?.ok === true,
        dispatchId: cached.dispatchId,
      });
    } catch (err) {
      if (err?.code === ERROR_CODES.IDEMPOTENCY_CONFLICT) {
        dispatchService.logConflict(deviceId, dispatchId);
        return res.status(409).json(buildErrorBody({ error: err.message, code: ERROR_CODES.IDEMPOTENCY_CONFLICT }));
      }
      throw err;
    }
  }));

  router.post('/:deviceId/reboot', asyncHandler(async (req, res) => {
    const result = await fleetService.reboot(req.params.deviceId);
    return result.kind === 'not_found' ? notFound(res) : res.json(result.result);
  }));

  router.post('/:deviceId/recover', asyncHandler(async (req, res) => {
    const result = await recoveryService.recover(req.params.deviceId, (req.body || {}).reloadQuery);
    if (result.kind === 'not_found') return notFound(res);
    if (result.kind === 'failed') {
      const body = buildErrorBody({ error: result.error }); body.method = result.method;
      return res.status(502).json(body);
    }
    return res.json(result.body);
  }));

  router.get('/:deviceId/volume/:level', asyncHandler(async (req, res) => {
    const parsedLevel = parseInt(req.params.level, 10);
    const result = await fleetService.volume(req.params.deviceId,
      Number.isNaN(parsedLevel) ? req.params.level : parsedLevel);
    if (result.kind === 'not_found') return notFound(res);
    if (result.kind === 'unsupported') return res.status(400).json(buildErrorBody({ error: 'Device does not support volume control' }));
    return res.json(result.result);
  }));

  router.get('/:deviceId/audio/:audioDevice', asyncHandler(async (req, res) => {
    const result = await fleetService.audio(req.params.deviceId, req.params.audioDevice);
    if (result.kind === 'not_found') return notFound(res);
    if (result.kind === 'unsupported') return res.status(400).json(buildErrorBody({ error: 'Device does not support audio device control' }));
    return res.json(result.result);
  }));

  return router;
}

export default createDeviceRouter;
