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

/**
 * Create device router
 * @param {Object} config
 * @param {import('#apps/devices/services/DeviceService.mjs').DeviceService} config.deviceService
 * @param {import('#system/config/index.mjs').ConfigService} [config.configService]
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createDeviceRouter(config) {
  const router = express.Router();
  const { deviceService, configService, logger = console } = config;

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
      return res.status(404).json({
        ok: false,
        error: 'Device not found',
        deviceId
      });
    }

    const state = await device.getState();
    res.json({
      ok: true,
      ...state
    });
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
      return res.status(404).json({
        ok: false,
        error: 'Device not found',
        deviceId
      });
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
      return res.status(404).json({
        ok: false,
        error: 'Device not found',
        deviceId
      });
    }

    // Guard: block power-off during active videocall unless ?force=true
    if (hasActiveCall(deviceId) && force !== 'true') {
      logger.info?.('device.router.powerOff.blocked', { deviceId, reason: 'active-videocall' });
      return res.status(409).json({
        ok: false,
        error: 'Active videocall in progress',
        hint: 'Use ?force=true to override'
      });
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
      return res.status(404).json({
        ok: false,
        error: 'Device not found',
        deviceId
      });
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
   * Power on + load content
   * Query params passed to content (e.g., ?play=12345, ?queue=morning+program)
   */
  router.get('/:deviceId/load', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const query = { ...req.query };
    const device = deviceService.get(deviceId);
    const startTime = Date.now();

    logger.info?.('device.router.load.start', { deviceId, query, timestamp: new Date().toISOString() });

    if (!device) {
      logger.warn?.('device.router.load.notFound', { deviceId });
      return res.status(404).json({
        ok: false,
        error: 'Device not found',
        deviceId
      });
    }

    // Power on device
    logger.debug?.('device.router.load.powerOn.start', { deviceId });
    const powerResult = await device.powerOn();
    logger.debug?.('device.router.load.powerOn.done', { deviceId, result: powerResult, elapsedMs: Date.now() - startTime });
    if (!powerResult.ok) {
      logger.error?.('device.router.load.powerOn.failed', { deviceId, error: powerResult.error });
      return res.json({
        ok: false,
        step: 'powerOn',
        error: powerResult.error
      });
    }

    // Extract display verification result
    const displayVerified = powerResult.verified === true;
    const displayVerifyFailed = powerResult.verifyFailed === true;

    if (displayVerifyFailed) {
      logger.warn?.('device.router.load.displayNotVerified', {
        deviceId,
        attempts: powerResult.attempts,
        elapsedMs: Date.now() - startTime
      });
    }

    // Prepare for content (screen wake, foreground, etc.)
    logger.debug?.('device.router.load.prepare.start', { deviceId });
    const prepResult = await device.prepareForContent();
    logger.debug?.('device.router.load.prepare.done', { deviceId, result: prepResult, elapsedMs: Date.now() - startTime });
    if (!prepResult.ok) {
      logger.error?.('device.router.load.prepare.failed', { deviceId, error: prepResult.error });
      return res.json({
        ok: false,
        step: 'prepare',
        error: prepResult.error
      });
    }

    // Load content
    logger.debug?.('device.router.load.content.start', { deviceId, path: '/tv', query });
    const loadResult = await device.loadContent('/tv', query);
    logger.debug?.('device.router.load.content.done', { deviceId, result: loadResult, elapsedMs: Date.now() - startTime });

    const response = {
      ok: loadResult.ok,
      deviceId,
      displayVerified,
      displayVerifyFailed,
      power: powerResult,
      prepare: prepResult,
      load: loadResult,
      totalElapsedMs: Date.now() - startTime
    };

    logger.info?.('device.router.load.complete', { deviceId, ok: loadResult.ok, totalElapsedMs: response.totalElapsedMs });
    res.json(response);
  }));

  // ===========================================================================
  // Volume Control
  // ===========================================================================

  /**
   * GET /device/:deviceId/volume/:level
   * Set volume (0-100, +, -, mute, unmute)
   */
  router.get('/:deviceId/volume/:level', asyncHandler(async (req, res) => {
    const { deviceId, level } = req.params;
    const device = deviceService.get(deviceId);

    if (!device) {
      return res.status(404).json({
        ok: false,
        error: 'Device not found',
        deviceId
      });
    }

    if (!device.hasCapability('volume')) {
      return res.status(400).json({
        ok: false,
        error: 'Device does not support volume control',
        deviceId
      });
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
      return res.status(404).json({
        ok: false,
        error: 'Device not found',
        deviceId
      });
    }

    if (!device.hasCapability('audioDevice')) {
      return res.status(400).json({
        ok: false,
        error: 'Device does not support audio device control',
        deviceId
      });
    }

    logger.info?.('device.router.audio', { deviceId, audioDevice });
    const result = await device.setAudioDevice(audioDevice);
    res.json(result);
  }));

  return router;
}

export default createDeviceRouter;
