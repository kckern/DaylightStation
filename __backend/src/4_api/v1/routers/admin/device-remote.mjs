import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const STATUS_BY_CODE = Object.freeze({
  INVALID_DEVICE_ID: 400,
  INVALID_REMOTE_DEVICE_INPUT: 400,
  INVALID_ACTION: 400,
  DEVICE_NOT_FOUND: 404,
  NOT_FULLY_KIOSK: 422,
  FKB_CONFIGURATION_ERROR: 503,
  FKB_TIMEOUT: 504,
  FKB_UNREACHABLE: 502,
  FKB_AUTH_REJECTED: 502,
  FKB_COMMAND_REJECTED: 502,
  FKB_INVALID_RESPONSE: 502,
  NOT_DAYLIGHT_ANDROID: 422,
  DAYLIGHT_ANDROID_UNSUPPORTED: 501,
  DAYLIGHT_ANDROID_CONFIGURATION_ERROR: 503,
  DAYLIGHT_ANDROID_TIMEOUT: 504,
  DAYLIGHT_ANDROID_UNREACHABLE: 502,
  DAYLIGHT_ANDROID_AUTH_REJECTED: 502,
  DAYLIGHT_ANDROID_COMMAND_REJECTED: 502,
  DAYLIGHT_ANDROID_INVALID_RESPONSE: 502,
  // The device is in a state where the command cannot run; its message is
  // plain words for the operator and is passed through (status below 500).
  DAYLIGHT_ANDROID_CONFLICT: 409,
  DAYLIGHT_ANDROID_DEPENDENCY_FAILED: 502,
  DAYLIGHT_ANDROID_DEVICE_TIMEOUT: 504,
});

const SAFE_MESSAGE_BY_CODE = Object.freeze({
  FKB_CONFIGURATION_ERROR: 'Fully Kiosk is not configured correctly for this device.',
  FKB_TIMEOUT: 'Fully Kiosk did not respond in time.',
  FKB_UNREACHABLE: 'The Fully Kiosk device is unreachable.',
  FKB_AUTH_REJECTED: 'Fully Kiosk rejected the configured credentials.',
  FKB_COMMAND_REJECTED: 'Fully Kiosk rejected the command.',
  FKB_INVALID_RESPONSE: 'Fully Kiosk returned an unexpected response.',
  DAYLIGHT_ANDROID_UNSUPPORTED: 'This device cannot perform that action.',
  DAYLIGHT_ANDROID_CONFIGURATION_ERROR: 'The kiosk app is not configured correctly for this device.',
  DAYLIGHT_ANDROID_TIMEOUT: 'The kiosk app did not respond in time.',
  DAYLIGHT_ANDROID_UNREACHABLE: 'The kiosk app is unreachable.',
  DAYLIGHT_ANDROID_AUTH_REJECTED: 'The kiosk app rejected the configured token.',
  DAYLIGHT_ANDROID_COMMAND_REJECTED: 'The kiosk app rejected the command.',
  DAYLIGHT_ANDROID_INVALID_RESPONSE: 'The kiosk app returned an unexpected response.',
  DAYLIGHT_ANDROID_DEPENDENCY_FAILED: 'The kiosk answered, and something it depends on (a page or a download) failed.',
  DAYLIGHT_ANDROID_DEVICE_TIMEOUT: 'The kiosk answered, and gave up waiting on a page or a download.',
});

export function createAdminDeviceRemoteRouter({ service, logger = console } = {}) {
  if (!service) throw new Error('createAdminDeviceRemoteRouter requires service');
  const router = express.Router({ mergeParams: true });

  router.get('/status', asyncHandler(async (req, res) => {
    res.json(await service.getStatus(req.params.deviceId));
  }));

  router.get('/screenshot', asyncHandler(async (req, res) => {
    const screenshot = await service.getScreenshot(req.params.deviceId);
    res.set({
      'Content-Type': screenshot.contentType || 'image/png',
      'Cache-Control': 'no-store',
      'X-Captured-At': screenshot.capturedAt,
      'Content-Disposition': `inline; filename="${req.params.deviceId}-screenshot.png"`,
    });
    res.send(screenshot.buffer);
  }));

  router.get('/settings', asyncHandler(async (req, res) => {
    res.json(await service.getSettings(req.params.deviceId));
  }));

  router.post('/actions/:action', asyncHandler(async (req, res) => {
    res.json(await service.performAction(req.params.deviceId, req.params.action, req.body || {}));
  }));

  router.put('/settings/:key', asyncHandler(async (req, res) => {
    res.json(await service.updateSetting(req.params.deviceId, req.params.key, req.body?.value));
  }));

  router.use((error, req, res, _next) => {
    const status = STATUS_BY_CODE[error?.code] || (error?.name === 'ValidationError' ? 400 : 500);
    let safeMessage = status < 500
      ? error.message
      : (SAFE_MESSAGE_BY_CODE[error?.code] || 'Internal server error');
    // The device's own reason for not supporting an action is a fixed phrase
    // ("device owner required"), so the operator gets to see it. Anything
    // that does not look like one short line is left out.
    const reason = error?.code === 'DAYLIGHT_ANDROID_UNSUPPORTED' ? error.reason : null;
    if (typeof reason === 'string' && /^[\w ,.'()/-]{1,120}$/.test(reason)) {
      safeMessage = `${safeMessage.replace(/\.$/, '')}: ${reason}.`;
    }
    const level = status >= 500 ? 'error' : 'warn';
    logger[level]?.('admin.deviceRemote.httpError', {
      deviceId: req.params.deviceId,
      code: error?.code || 'INTERNAL',
      status,
    });
    res.status(status).json({
      ok: false,
      error: safeMessage,
      code: error?.code || 'INTERNAL',
    });
  });

  return router;
}

export default createAdminDeviceRemoteRouter;
