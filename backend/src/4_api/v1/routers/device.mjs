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
  const { deviceService, wakeAndLoadService, configService, logger = console } = config;

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
   * Power on + verify display + load content
   * Emits wake-progress events over WebSocket for real-time phone UI feedback.
   */
  router.get('/:deviceId/load', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const query = { ...req.query };

    logger.info?.('device.router.load.start', { deviceId, query });

    if (!wakeAndLoadService) {
      return res.status(500).json({ ok: false, error: 'WakeAndLoadService not configured' });
    }

    const result = await wakeAndLoadService.execute(deviceId, query);
    const status = result.error === 'Device not found' ? 404 : 200;

    logger.info?.('device.router.load.complete', {
      deviceId, ok: result.ok, failedStep: result.failedStep, totalElapsedMs: result.totalElapsedMs
    });

    res.status(status).json(result);
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
      return res.status(404).json({ ok: false, error: 'Device not found' });
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
      return res.status(404).json({ ok: false, error: 'Device not found' });
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
        return res.json({ ok: false, error: 'Recovery failed: ' + err.message, method: 'power-cycle' });
      }
    } else {
      // Wait for FKB to restart after ADB reboot
      await new Promise(r => setTimeout(r, 15_000));
    }

    // Step 3: Re-prepare and re-load content
    try {
      await device.prepareForContent();
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
