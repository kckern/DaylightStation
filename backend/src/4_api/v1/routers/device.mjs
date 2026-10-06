import { sendInternalError } from '#api/utils/internalError.mjs';
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { buildErrorBody, ERROR_CODES } from '#shared-contracts/media/errors.mjs';
import { validateHandoffCommandAck, validateHandoffParams } from '#shared-contracts/media/handoff.mjs';
import { validateSessionSnapshot } from '#shared-contracts/media/shapes.mjs';
import { buildCommandEnvelope, validateCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';
import { TRANSPORT_ACTIONS, QUEUE_OPS, REPEAT_MODES, isTransportAction, isKeepMusicParam, isQueueOp, isRepeatMode } from '#shared-contracts/media/commands.mjs';
import { END_OF_QUEUE_MODES, isEndOfQueueMode, validateSessionActionParams } from '#shared-contracts/media/sessionControls.mjs';

const nonEmpty = value => typeof value === 'string' && value.length > 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HANDOFF_TERMINAL_PHASES = new Set(['captured', 'started', 'stopped', 'cancelled', 'failed']);
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

/**
 * Who issued a session command (RQ-STEER-21, RQ-HOUSE-07). An explicit body
 * `origin` wins; otherwise a request that named itself with the fleet device
 * header is attributed to that device. Returns `{ origin }` or `{ error }`.
 * Validation reuses the envelope contract so the router and the screen agree.
 */
function commandOrigin(req) {
  const body = req.body || {};
  // A fleet device that names itself in the header IS the caller; a body
  // cannot claim to be another device. It may still supply a display name.
  if (req.deviceIdSource === 'header' && /^fleet:/.test(req.deviceId || '')) {
    const name = typeof body.origin?.name === 'string' && body.origin.name.length > 0 && body.origin.name.length <= 80
      ? body.origin.name : undefined;
    return { origin: { kind: 'device', id: req.deviceId, ...(name ? { name } : {}) } };
  }
  if (body.origin !== undefined) {
    const checked = validateCommandEnvelope(buildCommandEnvelope({
      targetDevice: 'origin-check', commandId: 'origin-check', command: 'system', params: { action: 'wake' }, origin: body.origin,
    }));
    if (!checked.valid) return { error: checked.errors[0] };
    return { origin: body.origin };
  }
  if (req.deviceIdSource === 'header' && nonEmpty(req.deviceId)) {
    return { origin: { kind: 'device', id: req.deviceId } };
  }
  return { origin: undefined };
}

const badRequest = (res, error, code = 'VALIDATION') => res.status(400).json(buildErrorBody({ error, code }));

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

function mapHandoffCommand(result, command, deviceId, res) {
  if (result?.handoff === undefined) {
    if (result?.ok === true) {
      return res.status(502).json(buildErrorBody({ error: 'Handoff result missing typed handoff evidence', code: 'INVALID_HANDOFF_RESULT' }));
    }
    return mapCommand(result, res);
  }
  const validation = validateHandoffCommandAck(command, result, { target: { kind: 'device', id: deviceId } });
  if (!validation.valid) {
    return res.status(502).json(buildErrorBody({ error: validation.errors[0] || 'Handoff result is not terminal', code: 'INVALID_HANDOFF_RESULT' }));
  }
  if (result.handoff.phase === 'starting') return res.status(202).json(result);
  if (!HANDOFF_TERMINAL_PHASES.has(result.handoff.phase)) {
    return res.status(502).json(buildErrorBody({ error: 'Handoff result is not terminal', code: 'INVALID_HANDOFF_RESULT' }));
  }
  return res.status(200).json(result);
}

function requireSessions(service, res) {
  if (service.configured()) return true;
  res.status(501).json(buildErrorBody({ error: 'Session control not configured' }));
  return false;
}

export function createDeviceRouter({ fleetService, presenceService, sessionService, screenService,
  dispatchService, recoveryService, kioskFrictionTracker, excursionGuard, startStatusService } = {}) {
  const router = express.Router();

  router.get('/config', (req, res) => res.json(fleetService.configuration(req.query.householdId)));

  /**
   * What input hardware the ASKING device is declared to have.
   *
   * The browser cannot answer this. There is no web API for "is a keyboard
   * attached"; the closest signal, `pointer: fine`, asks about a MOUSE. The
   * Portal is a touch panel with a bonded Bluetooth keyboard and no mouse, so
   * every keyboard-shaped question answered from media queries got it exactly
   * backwards there — School's Sentence Ladder hid its Dictation and
   * Interpretation rungs on the one device provisioned for them
   * (`data/household/hardware/devices.yml` has declared that keyboard since
   * 2026-09-09; nothing served it).
   *
   * Answers only for a device that named itself `fleet:<name>` — the header
   * `deviceResolver` stamps. `browser:<token>` and a bare User-Agent are not
   * fleet rows and are told so (`device: null`) rather than matched against
   * one: a wrong match here would claim hardware a learner does not have,
   * which is the failure the capability system exists to prevent.
   *
   * Deliberately NOT `/config`, which returns the whole registry — every
   * host, MAC and auth reference in the house. This is asked by a child-facing
   * kiosk page, so it answers one boolean about the asker and nothing else.
   */
  router.get('/self/input', (req, res) => {
    const declared = req.deviceIdSource === 'header' && /^fleet:/.test(req.deviceId || '')
      ? req.deviceId.slice('fleet:'.length)
      : null;
    const device = declared
      ? fleetService.configuration(req.query.householdId)?.devices?.[declared] ?? null
      : null;
    const keyboards = device?.bluetooth_input?.keyboards;
    res.json({
      ok: true,
      device: device ? declared : null,
      keyboard: Array.isArray(keyboards) && keyboards.length > 0,
    });
  });

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

  // The kiosk just opened another Android app itself (e.g. the menu's Settings
  // pairing screen). Fully lets the rest of that app's package through while it
  // is in front, so the backend watches the foreground until the kiosk is back
  // and pulls it home if the trip wanders. Only packages with a policy are
  // guarded; for anything else this answers `guarded: false` and does nothing.
  router.post('/:deviceId/excursion', (req, res) => {
    if (!excursionGuard) return res.status(503).json({ error: 'excursion guard not configured' });
    const { package: pkg, activity } = req.body || {};
    if (!nonEmpty(pkg)) return res.status(400).json({ error: 'package is required' });
    const result = excursionGuard.start({
      deviceId: req.params.deviceId, package: pkg, activity: nonEmpty(activity) ? activity : '',
    });
    return res.status(result.guarded ? 202 : 200).json({ ok: true, ...result });
  });

  router.get('/:deviceId/presence', (req, res) => {
    if (!presenceService.configured()) return res.status(503).json({ error: 'presence not configured' });
    return res.json(presenceService.get(req.params.deviceId));
  });

  // A kiosk (Portal, yellow-room tablet, …) reports a moment of unsupervised-
  // input "friction" (a stray press, a rejected code, a forced video restart).
  // KioskFrictionTracker keeps a short rolling count and republishes it to
  // State Gates as `kiosk.friction-score`, which the `kiosk.friction-ok` gate
  // (fail_open) reads. Fire-and-forget by design — recordFriction never
  // throws, so this route only validates the request shape.
  router.post('/:deviceId/friction-ping', asyncHandler(async (req, res) => {
    // Same-pattern guard as requireSessions/presenceService.configured()
    // above: not a live bug today (always wired in production), but an
    // absent optional collaborator should be a clear 503, not an
    // unhandled TypeError.
    if (!kioskFrictionTracker) {
      return res.status(503).json(buildErrorBody({ error: 'Kiosk friction tracking not configured', code: 'KIOSK_FRICTION_TRACKER_NOT_CONFIGURED' }));
    }
    const { deviceId } = req.params;
    const { kind } = req.body ?? {};
    if (typeof kind !== 'string' || !kind) {
      return res.status(400).json(buildErrorBody({ error: 'kind is required (non-empty string)', code: 'VALIDATION' }));
    }
    await kioskFrictionTracker.recordFriction({ deviceId, kind });
    return res.json({ ok: true });
  }));

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
    const { action, value, commandId, keepMusic } = req.body || {};
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    if (keepMusic !== undefined && !isKeepMusicParam(keepMusic)) return res.status(400).json(buildErrorBody({ error: 'keepMusic must be a boolean when present' }));
    if (!isTransportAction(action)) return res.status(400).json(buildErrorBody({ error: `action must be one of: ${TRANSPORT_ACTIONS.join(', ')}` }));
    if ((action === 'seekAbs' || action === 'seekRel') && !(typeof value === 'number' && Number.isFinite(value))) {
      return res.status(400).json(buildErrorBody({ error: `value must be a finite number for action "${action}"` }));
    }
    const { origin, error: originError } = commandOrigin(req);
    if (originError) return badRequest(res, originError);
    return mapCommand(await sessionService.transport(req.params.deviceId, { action, value, commandId, origin, ...(keepMusic !== undefined && action === 'stop' ? { keepMusic } : {}) }), res);
  }));

  // Cancellation is coordinated before a cold screen owns a session. A claim
  // is only a delivery gate, never a playback/queue confirmation receipt.
  router.post('/:deviceId/session/item-action/:operationId/:action', asyncHandler(async (req, res) => {
    const { deviceId, operationId, action } = req.params;
    if (!['claim', 'cancel'].includes(action) || !nonEmpty(operationId)) return res.status(400).json({ ok: false, code: 'VALIDATION' });
    if (!dispatchService?.claimItemAction) return res.status(503).json({ ok: false, code: 'ITEM_ACTION_UNSUPPORTED' });
    const result = action === 'claim' ? dispatchService.claimItemAction(deviceId, operationId) : dispatchService.cancelItemAction(deviceId, operationId);
    return res.json(result);
  }));

  router.post('/:deviceId/session/queue/:op', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { deviceId, op } = req.params;
    const { contentId, queueItemId, from, to, items, clearRest, commandId } = req.body || {};
    if (!isQueueOp(op)) return res.status(400).json(buildErrorBody({ error: `Unknown queue op "${op}"; must be one of: ${QUEUE_OPS.join(', ')}`, code: 'VALIDATION' }));
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)' }));
    const { origin, error: originError } = commandOrigin(req);
    if (originError) return badRequest(res, originError);
    if (op === 'item-action' || op === 'undo') {
      const { kind, item, collectionItems, operationId, tappedAt } = req.body;
      const params = { op, operationId, ...(op === 'item-action' ? { kind, item, collectionItems, tappedAt, clearRest, queueItemId } : {}) };
      const checked = validateCommandEnvelope(buildCommandEnvelope({ targetDevice: deviceId, commandId, command: 'queue', params }));
      if (!checked.valid) return res.status(400).json(buildErrorBody({ error: checked.errors.join('; '), code: 'VALIDATION' }));
      return mapCommand(await sessionService.queue(deviceId, commandId, params, origin), res);
    }
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
    return mapCommand(await sessionService.queue(deviceId, commandId, params, origin), res);
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

  // --- Screen session flags (RQ-PLAY-10, RQ-STEER-19, RQ-STEER-20) -------
  // Each is a `config` command; the screen publishes the result in
  // `snapshot.controls` (tech doc §6.6).
  const sessionFlag = (path, setting, field, isValid, describe) => {
    router.put(`/:deviceId/session/${path}`, asyncHandler(async (req, res) => {
      if (!requireSessions(sessionService, res)) return;
      const body = req.body || {};
      if (!nonEmpty(body.commandId)) return badRequest(res, 'commandId required (non-empty string)');
      if (!isValid(body[field])) return badRequest(res, `${field} ${describe}`);
      const { origin, error: originError } = commandOrigin(req);
      if (originError) return badRequest(res, originError);
      return mapCommand(await sessionService.config(req.params.deviceId, {
        setting, value: body[field], commandId: body.commandId, origin,
      }), res);
    }));
  };
  sessionFlag('add-only', 'addOnly', 'enabled', v => typeof v === 'boolean', 'must be a boolean');
  sessionFlag('end-of-queue', 'endOfQueue', 'mode', isEndOfQueueMode, `must be one of: ${END_OF_QUEUE_MODES.join(', ')}`);
  sessionFlag('stop-after-current', 'stopAfterCurrent', 'enabled', v => typeof v === 'boolean', 'must be a boolean');

  // --- Screen session actions (RQ-STEER-12, RQ-STEER-20, RQ-STEER-21) -----
  const sessionAction = (path, action, pickParams = () => ({})) => {
    router.post(`/:deviceId/session/${path}`, asyncHandler(async (req, res) => {
      if (!requireSessions(sessionService, res)) return;
      const body = req.body || {};
      if (!nonEmpty(body.commandId)) return badRequest(res, 'commandId required (non-empty string)');
      const params = pickParams(body);
      const checked = validateSessionActionParams({ action, ...params });
      if (!checked.valid) return badRequest(res, checked.errors.join('; '));
      const { origin, error: originError } = commandOrigin(req);
      if (originError) return badRequest(res, originError);
      return mapCommand(await sessionService.session(req.params.deviceId, {
        action, params, commandId: body.commandId, origin,
      }), res);
    }));
  };
  sessionAction('sleep-timer', 'sleep-timer', (body) => ({
    ...(body.minutes !== undefined ? { minutes: body.minutes } : {}),
    ...(body.atEnd !== undefined ? { atEnd: body.atEnd } : {}),
  }));
  sessionAction('sleep-timer/cancel', 'cancel-sleep-timer');
  sessionAction('sleep-timer/resume', 'resume-sleep');
  sessionAction('put-back', 'put-back', (body) => (nonEmpty(body.noteId) ? { noteId: body.noteId } : {}));
  sessionAction('countdown/cancel', 'cancel-countdown');
  sessionAction('countdown/start-now', 'start-next-now');
  // Player features (P2, tech doc §4.11): subtitles/audio language, Show
  // briefly, music behind a slideshow.
  sessionAction('tracks', 'set-tracks', (body) => ({
    ...(body.audio !== undefined ? { audio: body.audio } : {}),
    ...(body.subtitle !== undefined ? { subtitle: body.subtitle } : {}),
  }));
  sessionAction('brief/close', 'close-brief');
  sessionAction('music-behind', 'music-behind', (body) => ({
    op: body.op,
    ...(body.contentId !== undefined ? { contentId: body.contentId } : {}),
    ...(typeof body.title === 'string' ? { title: body.title.slice(0, 200) } : {}),
  }));

  // Start progress / last failure for one screen, readable by every device
  // (RQ-HOUSE-04). Live updates ride `device-start:<deviceId>`.
  router.get('/:deviceId/start-status', (req, res) => {
    if (!startStatusService?.get) {
      return res.status(503).json(buildErrorBody({ error: 'Start status not configured', code: 'START_STATUS_UNAVAILABLE' }));
    }
    return res.json({ ok: true, status: startStatusService.get(req.params.deviceId) ?? null });
  });

  router.post('/:deviceId/session/claim', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const { commandId } = req.body || {};
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)', code: 'VALIDATION' }));
    const { origin, error: originError } = commandOrigin(req);
    if (originError) return badRequest(res, originError);
    const result = await sessionService.claim(req.params.deviceId, commandId, origin);
    if (result?.ok === true) return res.status(200).json({ ok: true, commandId: result.commandId ?? commandId,
      snapshot: result.snapshot, stoppedAt: result.stoppedAt });
    return mapCommand(result, res);
  }));

  router.post('/:deviceId/session/handoff', asyncHandler(async (req, res) => {
    if (!requireSessions(sessionService, res)) return;
    const body = req.body;
    if (!isRecord(body) || Object.keys(body).some((key) => key !== 'commandId' && key !== 'params')) {
      return res.status(400).json(buildErrorBody({ error: 'handoff request must contain only commandId and params', code: 'VALIDATION' }));
    }
    const { commandId, params } = body;
    if (!nonEmpty(commandId)) return res.status(400).json(buildErrorBody({ error: 'commandId required (non-empty string)', code: 'VALIDATION' }));
    if (!isRecord(params)) return res.status(400).json(buildErrorBody({ error: 'params required (object)', code: 'VALIDATION' }));
    const validation = validateHandoffParams(params);
    if (!validation.valid) return res.status(400).json(buildErrorBody({ error: validation.errors[0], code: 'VALIDATION', details: validation.errors }));
    const deviceId = req.params.deviceId;
    const command = { targetDevice: deviceId, command: 'handoff', commandId, params };
    return mapHandoffCommand(await sessionService.handoff(deviceId, { commandId, params }), command, deviceId, res);
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

  router.delete('/:deviceId/screen/override', asyncHandler(async (req, res) => res.json(screenService.clearOverride(req.params.deviceId))));

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
    // Attribute the dispatch to the asking device (header). A caller that
    // names no device (Home Assistant, a script) gets the automation origin
    // WakeAndLoad stamps, which Add only exempts.
    const loadOrigin = req.deviceIdSource === 'header' && nonEmpty(req.deviceId)
      ? { origin: { kind: 'device', id: req.deviceId } } : {};
    const result = await dispatchService.load(deviceId, query, loadOrigin);
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

  // Read the panel's actual hardware level, plus the policy governing it. The
  // whole reason this exists: the software layers can all read 100 while the
  // hardware sits at 55, and nothing in the API used to say so.
  router.get('/:deviceId/volume', asyncHandler(async (req, res) => {
    const result = await fleetService.volumeState(req.params.deviceId);
    if (result.kind === 'not_found') return notFound(res);
    if (result.kind === 'unsupported') return res.status(400).json(buildErrorBody({ error: 'Device does not support volume control' }));
    return res.json(result.result);
  }));

  // Time-boxed permission to exceed the everyday cap. Never above the device's
  // boost_max, and it reverts on its own when the window closes.
  router.post('/:deviceId/volume/boost', asyncHandler(async (req, res) => {
    const { level, minutes } = req.body || {};
    if (!Number.isInteger(level) || level < 0 || level > 100) {
      return res.status(400).json(buildErrorBody({ error: 'level must be an integer between 0 and 100' }));
    }
    if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) {
      return res.status(400).json(buildErrorBody({ error: 'minutes must be a positive number' }));
    }
    const result = await fleetService.boostVolume(req.params.deviceId, { level, minutes: Number(minutes) });
    if (result.kind === 'not_found') return notFound(res);
    if (result.kind === 'unsupported') return res.status(400).json(buildErrorBody({ error: 'Device does not support volume control' }));
    if (result.kind === 'ungoverned') {
      return res.status(409).json(buildErrorBody({
        error: 'Device has no volume cap to boost past',
        code: 'NO_VOLUME_POLICY',
      }));
    }
    return res.json(result.result);
  }));

  router.delete('/:deviceId/volume/boost', asyncHandler(async (req, res) => {
    const result = await fleetService.clearVolumeBoost(req.params.deviceId);
    if (result.kind === 'not_found') return notFound(res);
    if (result.kind === 'unsupported') return res.status(400).json(buildErrorBody({ error: 'Device does not support volume control' }));
    return res.json(result.result);
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
