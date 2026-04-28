/**
 * Device Router
 *
 * API endpoints for device control:
 * - GET /device - List all devices
 * - GET /device/:deviceId - Device info + capabilities
 * - GET /device/:deviceId/on - Power on
 * - GET /device/:deviceId/off - Power off
 * - GET /device/:deviceId/load - Load content
 * - GET /device/:deviceId/volume/:level - Set volume
 * - GET /device/:deviceId/audio/:device - Set audio output
 *
 * @module api/v1/routers
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { hasActiveCall, forceEndCall } from '#apps/homeline/CallStateService.mjs';
import { buildErrorBody, ERROR_CODES } from '#shared-contracts/media/errors.mjs';
import { buildCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';
import { validateSessionSnapshot } from '#shared-contracts/media/shapes.mjs';
import {
  TRANSPORT_ACTIONS,
  QUEUE_OPS,
  REPEAT_MODES,
  isTransportAction,
  isQueueOp,
  isRepeatMode,
} from '#shared-contracts/media/commands.mjs';
import {
  DispatchIdempotencyService,
  IdempotencyConflictError,
} from '#apps/devices/services/DispatchIdempotencyService.mjs';
import { contentRequiresCamera } from '#apps/devices/services/contentRequiresCamera.mjs';

/**
 * Map a SessionControlService.sendCommand result to an HTTP response.
 *
 * - ok: true                         → 200 pass-through of the ack payload
 * - INVALID_ENVELOPE                 → 400
 * - DEVICE_NOT_FOUND                 → 404
 * - DEVICE_OFFLINE                   → 409 (includes lastKnown)
 * - IDEMPOTENCY_CONFLICT             → 409
 * - DEVICE_REFUSED                   → 502
 * - any other ok:false               → 502
 *
 * @param {Object} result - The sendCommand result envelope.
 * @param {import('express').Response} res
 */
function mapSendCommandResult(result, res) {
  if (result && result.ok === true) {
    return res.status(200).json(result);
  }
  const code = result?.code;
  const error = result?.error || 'Command failed';

  if (code === 'INVALID_ENVELOPE') {
    return res.status(400).json(buildErrorBody({ error, code }));
  }
  if (code === ERROR_CODES.DEVICE_NOT_FOUND) {
    return res.status(404).json(buildErrorBody({ error, code }));
  }
  if (code === ERROR_CODES.DEVICE_OFFLINE) {
    const body = buildErrorBody({ error, code });
    if (result.lastKnown !== undefined) body.lastKnown = result.lastKnown;
    return res.status(409).json(body);
  }
  if (code === ERROR_CODES.IDEMPOTENCY_CONFLICT) {
    return res.status(409).json(buildErrorBody({ error, code }));
  }
  if (code === ERROR_CODES.DEVICE_REFUSED) {
    return res.status(502).json(buildErrorBody({ error, code }));
  }
  return res.status(502).json(buildErrorBody({ error, code }));
}

function requireSessionControl(sessionControlService, res) {
  if (!sessionControlService) {
    res.status(501).json(buildErrorBody({
      error: 'Session control not configured',
    }));
    return false;
  }
  return true;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Create device router
 * @param {Object} config
 * @param {import('#apps/devices/services/DeviceService.mjs').DeviceService} config.deviceService
 * @param {Object} [config.wakeAndLoadService]
 * @param {Object} [config.sessionControlService] - ISessionControl implementation
 * @param {import('#apps/devices/services/DispatchIdempotencyService.mjs').DispatchIdempotencyService} [config.dispatchIdempotencyService]
 *   - Dispatch-level idempotency cache. One is constructed per router instance
 *     if not injected (useful for tests; bootstrap should inject a shared one).
 * @param {import('#system/config/index.mjs').ConfigService} [config.configService]
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createDeviceRouter(config) {
  const router = express.Router();
  const {
    deviceService,
    wakeAndLoadService,
    sessionControlService,
    dispatchIdempotencyService = new DispatchIdempotencyService({
      logger: config?.logger || undefined,
    }),
    configService,
    loadFile,
    logger = console,
  } = config;

  /**
   * Pre-flight guard for `GET /:deviceId/load`.
   *
   * A device may declare `input: { keyboard_id, required: true }` to insist the
   * corresponding keymap is non-empty before we dispatch content. If that
   * guard is set and the keymap has zero entries, we refuse the load — the
   * user would otherwise be served a video they have no way to stop (the
   * frontend NumpadAdapter silently drops keystrokes when the keymap is
   * empty). The check is cheap (one YAML read already cached by loadFile).
   *
   * Returns `{ ok: true }` when the load may proceed, or
   * `{ ok: false, error, keyboardId }` when it must not.
   */
  function checkInputPrecondition(deviceId) {
    if (!configService?.getDeviceConfig) return { ok: true };
    const deviceConfig = configService.getDeviceConfig(deviceId);
    const inputCfg = deviceConfig?.input;
    if (!inputCfg?.required || !inputCfg?.keyboard_id) return { ok: true };

    if (typeof loadFile !== 'function') {
      return {
        ok: false,
        error: 'input precondition cannot be verified (loadFile not wired)',
        keyboardId: inputCfg.keyboard_id,
      };
    }

    const keyboardData = loadFile('config/keyboard') || [];
    const normalize = (s) => s?.replace(/\s+/g, '').toLowerCase();
    const target = normalize(inputCfg.keyboard_id);
    const entries = keyboardData.filter(k => normalize(k.folder) === target && k.key && k.function);
    if (entries.length === 0) {
      return {
        ok: false,
        error: `input device '${inputCfg.keyboard_id}' has no keymap entries`,
        keyboardId: inputCfg.keyboard_id,
      };
    }
    return { ok: true, keymapSize: entries.length };
  }

  // ===========================================================================
  // Device Config
  // ===========================================================================

  /**
   * GET /device/config
   * Get raw devices config (for frontend module initialization)
   */
  router.get('/config', (req, res) => {
    const { householdId } = req.query;
    const config = configService.getHouseholdDevices(householdId);
    res.json(config);
  });

  // ===========================================================================
  // Device Listing
  // ===========================================================================

  /**
   * GET /device
   * List all devices
   */
  router.get('/', (req, res) => {
    const devices = deviceService.listDevices();
    res.json({
      ok: true,
      count: devices.length,
      devices
    });
  });

  /**
   * GET /device/:deviceId
   * Get device info and capabilities
   */
  router.get('/:deviceId', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const device = deviceService.get(deviceId);

    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    const state = await device.getState();
    res.json({
      ok: true,
      ...state
    });
  }));

  // ===========================================================================
  // Session
  // ===========================================================================

  /**
   * GET /device/:deviceId/session
   * Return the current SessionSnapshot for a device.
   *
   *   - 200 with the SessionSnapshot when online + non-idle
   *   - 204 (no content) when online + idle + empty queue
   *   - 503 with { offline: true, lastKnown, lastSeenAt } when offline
   *   - 404 when no record / unknown device
   *   - 501 when sessionControlService isn't configured
   */
  router.get('/:deviceId/session', asyncHandler(async (req, res) => {
    if (!sessionControlService) {
      return res.status(501).json(buildErrorBody({
        error: 'Session control not configured',
      }));
    }

    const { deviceId } = req.params;
    const result = sessionControlService.getSnapshot(deviceId);

    if (result === null || result === undefined) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    if (!result.online) {
      return res.status(503).json({
        offline: true,
        lastKnown: result.snapshot,
        lastSeenAt: result.lastSeenAt,
      });
    }

    const snap = result.snapshot;
    const isIdle = snap
      && snap.state === 'idle'
      && snap.currentItem === null
      && Array.isArray(snap.queue?.items)
      && snap.queue.items.length === 0;

    if (isIdle) {
      return res.status(204).end();
    }

    return res.status(200).json(snap);
  }));

  /**
   * POST /device/:deviceId/session/transport
   * Drive transport on the remote session (§4.3).
   *
   *   Body: { action, value?, commandId }
   */
  router.post('/:deviceId/session/transport', asyncHandler(async (req, res) => {
    if (!requireSessionControl(sessionControlService, res)) return;

    const { deviceId } = req.params;
    const body = req.body || {};
    const { action, value, commandId } = body;

    if (!isNonEmptyString(commandId)) {
      return res.status(400).json(buildErrorBody({
        error: 'commandId required (non-empty string)',
      }));
    }
    if (!isTransportAction(action)) {
      return res.status(400).json(buildErrorBody({
        error: `action must be one of: ${TRANSPORT_ACTIONS.join(', ')}`,
      }));
    }
    if ((action === 'seekAbs' || action === 'seekRel')
        && !(typeof value === 'number' && Number.isFinite(value))) {
      return res.status(400).json(buildErrorBody({
        error: `value must be a finite number for action "${action}"`,
      }));
    }

    const envelope = buildCommandEnvelope({
      targetDevice: deviceId,
      command: 'transport',
      commandId,
      params: { action, ...(value !== undefined ? { value } : {}) },
    });

    logger.info?.('device.router.session.transport', { deviceId, action, commandId });
    const result = await sessionControlService.sendCommand(envelope);
    return mapSendCommandResult(result, res);
  }));

  /**
   * POST /device/:deviceId/session/queue/:op
   * Mutate the remote session's queue (§4.4).
   *
   *   :op ∈ QUEUE_OPS
   *   Body varies per op — validated here, then the envelope validator
   *   double-checks via SessionControlService.
   */
  router.post('/:deviceId/session/queue/:op', asyncHandler(async (req, res) => {
    if (!requireSessionControl(sessionControlService, res)) return;

    const { deviceId, op } = req.params;
    const body = req.body || {};
    const { contentId, queueItemId, from, to, items, clearRest, commandId } = body;

    if (!isQueueOp(op)) {
      return res.status(400).json(buildErrorBody({
        error: `Unknown queue op "${op}"; must be one of: ${QUEUE_OPS.join(', ')}`,
        code: 'VALIDATION',
      }));
    }
    if (!isNonEmptyString(commandId)) {
      return res.status(400).json(buildErrorBody({
        error: 'commandId required (non-empty string)',
      }));
    }

    switch (op) {
      case 'play-now':
      case 'play-next':
      case 'add-up-next':
      case 'add':
        if (!isNonEmptyString(contentId)) {
          return res.status(400).json(buildErrorBody({
            error: `contentId required (non-empty string) for op "${op}"`,
          }));
        }
        break;
      case 'remove':
      case 'jump':
        if (!isNonEmptyString(queueItemId)) {
          return res.status(400).json(buildErrorBody({
            error: `queueItemId required (non-empty string) for op "${op}"`,
          }));
        }
        break;
      case 'reorder': {
        const hasFromTo = isNonEmptyString(from) && isNonEmptyString(to);
        const hasItems = Array.isArray(items) && items.length > 0
          && items.every(isNonEmptyString);
        if (!hasFromTo && !hasItems) {
          return res.status(400).json(buildErrorBody({
            error: 'reorder requires either (from + to) or a non-empty items array of strings',
          }));
        }
        break;
      }
      case 'clear':
        // No additional fields required.
        break;
      default:
        // isQueueOp already gated this; guard-rail only.
        return res.status(400).json(buildErrorBody({
          error: `Unhandled queue op "${op}"`,
        }));
    }

    // Build params with only the fields relevant to this op. The envelope
    // validator will ignore unknown fields, but keeping the envelope tight
    // makes idempotency fingerprints stable + debuggable.
    const params = { op };
    if (contentId !== undefined) params.contentId = contentId;
    if (queueItemId !== undefined) params.queueItemId = queueItemId;
    if (from !== undefined) params.from = from;
    if (to !== undefined) params.to = to;
    if (items !== undefined) params.items = items;
    if (clearRest !== undefined) params.clearRest = clearRest;

    const envelope = buildCommandEnvelope({
      targetDevice: deviceId,
      command: 'queue',
      commandId,
      params,
    });

    logger.info?.('device.router.session.queue', { deviceId, op, commandId });
    const result = await sessionControlService.sendCommand(envelope);
    return mapSendCommandResult(result, res);
  }));

  /**
   * PUT /device/:deviceId/session/shuffle
   * Toggle shuffle mode on the remote session (§4.5).
   *
   *   Body: { enabled: bool, commandId }
   */
  router.put('/:deviceId/session/shuffle', asyncHandler(async (req, res) => {
    if (!requireSessionControl(sessionControlService, res)) return;

    const { deviceId } = req.params;
    const { enabled, commandId } = req.body || {};

    if (!isNonEmptyString(commandId)) {
      return res.status(400).json(buildErrorBody({
        error: 'commandId required (non-empty string)',
      }));
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json(buildErrorBody({
        error: 'enabled must be a boolean',
      }));
    }

    const envelope = buildCommandEnvelope({
      targetDevice: deviceId,
      command: 'config',
      commandId,
      params: { setting: 'shuffle', value: enabled },
    });

    logger.info?.('device.router.session.shuffle', { deviceId, enabled, commandId });
    const result = await sessionControlService.sendCommand(envelope);
    return mapSendCommandResult(result, res);
  }));

  /**
   * PUT /device/:deviceId/session/repeat
   * Set repeat mode on the remote session (§4.5).
   *
   *   Body: { mode: "off" | "one" | "all", commandId }
   */
  router.put('/:deviceId/session/repeat', asyncHandler(async (req, res) => {
    if (!requireSessionControl(sessionControlService, res)) return;

    const { deviceId } = req.params;
    const { mode, commandId } = req.body || {};

    if (!isNonEmptyString(commandId)) {
      return res.status(400).json(buildErrorBody({
        error: 'commandId required (non-empty string)',
      }));
    }
    if (!isRepeatMode(mode)) {
      return res.status(400).json(buildErrorBody({
        error: `mode must be one of: ${REPEAT_MODES.join(', ')}`,
      }));
    }

    const envelope = buildCommandEnvelope({
      targetDevice: deviceId,
      command: 'config',
      commandId,
      params: { setting: 'repeat', value: mode },
    });

    logger.info?.('device.router.session.repeat', { deviceId, mode, commandId });
    const result = await sessionControlService.sendCommand(envelope);
    return mapSendCommandResult(result, res);
  }));

  /**
   * PUT /device/:deviceId/session/shader
   * Set the playback shader (§4.5).
   *
   *   Body: { shader: string | null, commandId }
   */
  router.put('/:deviceId/session/shader', asyncHandler(async (req, res) => {
    if (!requireSessionControl(sessionControlService, res)) return;

    const { deviceId } = req.params;
    const body = req.body || {};
    const { commandId } = body;
    // Distinguish null (clear) from missing. `hasOwnProperty` stays true
    // for explicit nulls but false for omitted keys.
    const hasShader = Object.prototype.hasOwnProperty.call(body, 'shader');
    const shader = body.shader;

    if (!isNonEmptyString(commandId)) {
      return res.status(400).json(buildErrorBody({
        error: 'commandId required (non-empty string)',
      }));
    }
    if (!hasShader || (shader !== null && typeof shader !== 'string')) {
      return res.status(400).json(buildErrorBody({
        error: 'shader must be a string or null',
      }));
    }

    const envelope = buildCommandEnvelope({
      targetDevice: deviceId,
      command: 'config',
      commandId,
      params: { setting: 'shader', value: shader },
    });

    logger.info?.('device.router.session.shader', { deviceId, shader, commandId });
    const result = await sessionControlService.sendCommand(envelope);
    return mapSendCommandResult(result, res);
  }));

  /**
   * POST /device/:deviceId/session/claim
   * Atomic "Take Over" — stops the current session and captures the
   * snapshot for later "Restore" (§4.6).
   *
   *   Body: { commandId }
   *
   *   200: { ok: true, commandId, snapshot, stoppedAt }
   *   400: missing/invalid commandId
   *   409: device offline (body has lastKnown)
   *   502: device refused / ack timeout
   *   501: session control not configured
   */
  router.post('/:deviceId/session/claim', asyncHandler(async (req, res) => {
    if (!requireSessionControl(sessionControlService, res)) return;

    const { deviceId } = req.params;
    const { commandId } = req.body || {};

    if (!isNonEmptyString(commandId)) {
      return res.status(400).json(buildErrorBody({
        error: 'commandId required (non-empty string)',
        code: 'VALIDATION',
      }));
    }

    logger.info?.('device.router.session.claim', { deviceId, commandId });
    const result = await sessionControlService.claim(deviceId, { commandId });

    if (result && result.ok === true) {
      return res.status(200).json({
        ok: true,
        commandId: result.commandId ?? commandId,
        snapshot: result.snapshot,
        stoppedAt: result.stoppedAt,
      });
    }
    return mapSendCommandResult(result, res);
  }));

  /**
   * PUT /device/:deviceId/session/volume
   * Set playback volume (§4.5).
   *
   *   Body: { level: int 0-100, commandId }
   */
  router.put('/:deviceId/session/volume', asyncHandler(async (req, res) => {
    if (!requireSessionControl(sessionControlService, res)) return;

    const { deviceId } = req.params;
    const { level, commandId } = req.body || {};

    if (!isNonEmptyString(commandId)) {
      return res.status(400).json(buildErrorBody({
        error: 'commandId required (non-empty string)',
      }));
    }
    if (typeof level !== 'number'
        || !Number.isInteger(level)
        || level < 0 || level > 100) {
      return res.status(400).json(buildErrorBody({
        error: 'level must be an integer between 0 and 100',
      }));
    }

    const envelope = buildCommandEnvelope({
      targetDevice: deviceId,
      command: 'config',
      commandId,
      params: { setting: 'volume', value: level },
    });

    logger.info?.('device.router.session.volume', { deviceId, level, commandId });
    const result = await sessionControlService.sendCommand(envelope);
    return mapSendCommandResult(result, res);
  }));

  // ===========================================================================
  // Power Control
  // ===========================================================================

  /**
   * GET /device/:deviceId/on
   * Power on device (all displays or specific via ?display=)
   */
  router.get('/:deviceId/on', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { display } = req.query;
    const device = deviceService.get(deviceId);

    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    logger.info?.('device.router.powerOn', { deviceId, display });
    const result = await device.powerOn(display);
    res.json(result);
  }));

  /**
   * GET /device/:deviceId/off
   * Power off device (all displays or specific via ?display=)
   */
  router.get('/:deviceId/off', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { display, force } = req.query;
    const device = deviceService.get(deviceId);

    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    // Guard: block power-off during active videocall unless ?force=true
    if (hasActiveCall(deviceId) && force !== 'true') {
      logger.info?.('device.router.powerOff.blocked', { deviceId, reason: 'active-videocall' });
      const body = buildErrorBody({
        error: 'Active videocall in progress',
        code: ERROR_CODES.DEVICE_BUSY,
      });
      body.hint = 'Use ?force=true to override';
      return res.status(409).json(body);
    }

    if (force === 'true' && hasActiveCall(deviceId)) {
      logger.info?.('device.router.powerOff.forced', { deviceId });
      forceEndCall(deviceId);
    }

    logger.info?.('device.router.powerOff', { deviceId, display });
    const result = await device.powerOff(display);
    res.json(result);
  }));

  /**
   * GET /device/:deviceId/toggle
   * Toggle device power
   */
  router.get('/:deviceId/toggle', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { display } = req.query;
    const device = deviceService.get(deviceId);

    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    logger.info?.('device.router.toggle', { deviceId, display });
    const result = await device.toggle(display);
    res.json(result);
  }));

  // ===========================================================================
  // Content Loading
  // ===========================================================================

  /**
   * GET /device/:deviceId/load
   * Power on + verify display + load content
   * Emits wake-progress events over WebSocket for real-time phone UI feedback.
   */
  router.get('/:deviceId/load', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const query = { ...req.query };

    logger.info?.('device.router.load.start', { deviceId, query });

    if (!wakeAndLoadService) {
      return res.status(500).json(buildErrorBody({
        error: 'WakeAndLoadService not configured',
      }));
    }

    const inputCheck = checkInputPrecondition(deviceId);
    if (!inputCheck.ok) {
      logger.error?.('device.router.load.input-precondition-failed', {
        deviceId, keyboardId: inputCheck.keyboardId, error: inputCheck.error,
      });
      return res.status(503).json({
        ok: false,
        deviceId,
        failedStep: 'input',
        error: inputCheck.error,
        keyboardId: inputCheck.keyboardId,
      });
    }

    const result = await wakeAndLoadService.execute(deviceId, query);

    let status = 200;
    if (result.error === 'Device not found') {
      status = 404;
    } else if (result.failedStep === 'prewarm' && result.permanent === true) {
      status = 422;
      // Tag with a code so callers can branch deterministically. The body
      // already carries failedStep/permanent/error from the orchestrator.
      result.code = ERROR_CODES.CONTENT_NOT_FOUND;
    }

    logger.info?.('device.router.load.complete', {
      deviceId, ok: result.ok, failedStep: result.failedStep, totalElapsedMs: result.totalElapsedMs
    });

    res.status(status).json(result);
  }));

  /**
   * POST /device/:deviceId/load
   *
   * Accepts an adopt-snapshot Hand Off payload (§4.7):
   *   Body: { mode: 'adopt', snapshot: SessionSnapshot, dispatchId: string }
   *
   *   200: { ...wakeResult, adopted: true, dispatchId }
   *   400: missing/invalid dispatchId or snapshot
   *   409: same dispatchId previously observed with a different body (conflict)
   *   500: WakeAndLoadService not configured
   *
   * Idempotency: the same dispatchId with the same body within 60s returns
   * the cached prior result without re-running the wake orchestration. A
   * same-dispatchId, different-body request within the window is a
   * conflict (IDEMPOTENCY_CONFLICT). Callers generate fresh dispatchIds
   * per intent. Delegated to DispatchIdempotencyService.
   */
  router.post('/:deviceId/load', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const body = req.body || {};

    if (body.mode !== 'adopt') {
      return res.status(400).json(buildErrorBody({
        error: 'POST /device/:id/load currently only supports mode: "adopt"',
        code: 'VALIDATION',
      }));
    }

    if (!wakeAndLoadService) {
      return res.status(500).json(buildErrorBody({
        error: 'WakeAndLoadService not configured',
      }));
    }

    const { snapshot, dispatchId } = body;

    if (!isNonEmptyString(dispatchId)) {
      return res.status(400).json(buildErrorBody({
        error: 'dispatchId required (non-empty string)',
        code: 'VALIDATION',
      }));
    }

    const validation = validateSessionSnapshot(snapshot);
    if (!validation.valid) {
      return res.status(400).json(buildErrorBody({
        error: `Invalid snapshot: ${validation.errors[0]}`,
        code: 'VALIDATION',
        details: validation.errors,
      }));
    }

    logger.info?.('device.router.load.adopt.start', { deviceId, dispatchId });

    let cached;
    try {
      cached = await dispatchIdempotencyService.runWithIdempotency(
        dispatchId,
        { snapshot, deviceId },
        async () => {
          const result = await wakeAndLoadService.execute(
            deviceId,
            {},
            { dispatchId, adoptSnapshot: snapshot },
          );

          const statusCode = result.error === 'Device not found'
            ? 404
            : (result.ok ? 200 : 502);

          const responseBody = {
            ...result,
            adopted: result.ok === true,
            dispatchId,
          };

          logger.info?.('device.router.load.adopt.complete', {
            deviceId, dispatchId, ok: result.ok, failedStep: result.failedStep,
          });

          return { statusCode, body: responseBody };
        },
      );
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        logger.warn?.('device.router.load.adopt.conflict', { deviceId, dispatchId });
        return res.status(409).json(buildErrorBody({
          error: err.message,
          code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
        }));
      }
      throw err;
    }

    return res.status(cached.statusCode).json(cached.body);
  }));

  /**
   * POST /device/:deviceId/reboot
   * Reboot the device via ADB. Fire-and-forget — device disconnects during reboot.
   */
  router.post('/:deviceId/reboot', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;

    logger.info?.('device.router.reboot.start', { deviceId });

    const device = deviceService.get(deviceId);
    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    const result = await device.reboot();

    logger.info?.('device.router.reboot.complete', { deviceId, ok: result.ok });

    res.json(result);
  }));

  /**
   * POST /device/:deviceId/recover
   * Attempt to recover an unresponsive device (FKB restart, then power cycle).
   * Called by CallApp when TV heartbeat doesn't arrive after load.
   */
  router.post('/:deviceId/recover', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { reloadQuery } = req.body || {};

    logger.info?.('device.router.recover.start', { deviceId });

    const device = deviceService.get(deviceId);
    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    // Step 1: Try FKB force-stop + restart via ADB
    let adbOk = false;
    try {
      const rebootResult = await device.reboot();
      adbOk = rebootResult.ok;
      logger.info?.('device.router.recover.adb', { deviceId, ok: adbOk });
    } catch (err) {
      logger.warn?.('device.router.recover.adb.failed', { deviceId, error: err.message });
    }

    // Step 2: If ADB failed, power cycle via HA
    if (!adbOk) {
      logger.info?.('device.router.recover.power-cycle', { deviceId });
      try {
        await device.powerOff();
        await new Promise(r => setTimeout(r, 10_000));
        await device.powerOn();
        // Wait for FKB to boot after power cycle
        await new Promise(r => setTimeout(r, 60_000));
      } catch (err) {
        logger.error?.('device.router.recover.power-cycle.failed', { deviceId, error: err.message });
        const body = buildErrorBody({
          error: 'Recovery failed: ' + err.message,
        });
        body.method = 'power-cycle';
        return res.status(502).json(body);
      }
    } else {
      // Wait for FKB to restart after ADB reboot
      await new Promise(r => setTimeout(r, 15_000));
    }

    // Step 3: Re-prepare and re-load content
    try {
      // Skip the ~4s FKB camera check unless the reload query actually needs
      // the camera. If there's no reloadQuery (generic recovery), default to
      // skipping — the cautious path is to leave the camera unprobed and let
      // the next content request set up what it needs.
      const skipCameraCheck = reloadQuery ? !contentRequiresCamera(reloadQuery) : true;
      await device.prepareForContent({ skipCameraCheck });
      if (reloadQuery) {
        const screenPath = device.screenPath || '/tv';
        await device.loadContent(screenPath, reloadQuery);
      }
    } catch (err) {
      logger.warn?.('device.router.recover.reload.failed', { deviceId, error: err.message });
    }

    const method = adbOk ? 'adb-restart' : 'power-cycle';
    logger.info?.('device.router.recover.complete', { deviceId, method });
    res.json({ ok: true, method });
  }));

  // ===========================================================================
  // Volume Control
  // ===========================================================================

  /**
   * GET /device/:deviceId/volume/:level
   * Set volume (0-100, +, -, mute, unmute)
   *
   * @deprecated Use `PUT /api/v1/device/:id/session/volume` (§4.5) — this
   * legacy endpoint bypasses the session control layer and cannot produce
   * an ack or a structured session snapshot update. Kept for backward
   * compatibility; emits `device.volume.deprecated` on every call.
   */
  router.get('/:deviceId/volume/:level', asyncHandler(async (req, res) => {
    const { deviceId, level } = req.params;
    logger.warn?.('device.volume.deprecated', {
      deviceId,
      note: 'Use PUT /api/v1/device/:id/session/volume instead',
    });
    const device = deviceService.get(deviceId);

    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    if (!device.hasCapability('volume')) {
      return res.status(400).json(buildErrorBody({
        error: 'Device does not support volume control',
      }));
    }

    logger.info?.('device.router.volume', { deviceId, level });

    // Parse level
    let volumeLevel = level;
    if (!isNaN(parseInt(level))) {
      volumeLevel = parseInt(level);
    }

    const result = await device.setVolume(volumeLevel);
    res.json(result);
  }));

  // ===========================================================================
  // Audio Device Control
  // ===========================================================================

  /**
   * GET /device/:deviceId/audio/:audioDevice
   * Set audio output device
   */
  router.get('/:deviceId/audio/:audioDevice', asyncHandler(async (req, res) => {
    const { deviceId, audioDevice } = req.params;
    const device = deviceService.get(deviceId);

    if (!device) {
      return res.status(404).json(buildErrorBody({
        error: 'Device not found',
        code: ERROR_CODES.DEVICE_NOT_FOUND,
      }));
    }

    if (!device.hasCapability('audioDevice')) {
      return res.status(400).json(buildErrorBody({
        error: 'Device does not support audio device control',
      }));
    }

    logger.info?.('device.router.audio', { deviceId, audioDevice });
    const result = await device.setAudioDevice(audioDevice);
    res.json(result);
  }));

  return router;
}

export default createDeviceRouter;
