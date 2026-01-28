/**
 * Home Automation Router
 *
 * API endpoints for controlling home automation devices:
 * - TV power and volume
 * - Kiosk browser control
 * - Tasker commands
 * - Remote SSH commands (volume, audio device)
 *
 * @module api/routers
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create home automation router
 * @param {Object} config
 * @param {import('../../2_adapters/home-automation/tv/TVControlAdapter.mjs').TVControlAdapter} config.tvAdapter
 * @param {import('../../2_adapters/home-automation/kiosk/KioskAdapter.mjs').KioskAdapter} config.kioskAdapter
 * @param {import('../../2_adapters/home-automation/tasker/TaskerAdapter.mjs').TaskerAdapter} config.taskerAdapter
 * @param {import('../../2_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs').RemoteExecAdapter} config.remoteExecAdapter
 * @param {Function} [config.loadFile] - Function to load state files
 * @param {Function} [config.saveFile] - Function to save state files
 * @param {string} [config.householdId] - Household ID for state files
 * @param {Object} [config.entropyService] - Entropy service for data freshness
 * @param {Object} [config.configService] - Config service for user lookup
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createHomeAutomationRouter(config) {
  const router = express.Router();
  const {
    haGateway,
    tvAdapter,
    kioskAdapter,
    taskerAdapter,
    remoteExecAdapter,
    loadFile,
    saveFile,
    householdId = 'default',
    entropyService,
    configService,
    logger = console
  } = config;

  // ===========================================================================
  // TV Control Endpoints
  // ===========================================================================

  /**
   * GET /home-automation/tv/:state(on|off|toggle)
   * Control living room TV power
   */
  router.get('/tv/:state(on|off|toggle)', asyncHandler(async (req, res) => {
    if (!tvAdapter) {
      return res.status(503).json({ error: 'TV control not configured (Home Assistant required)' });
    }

    const { state } = req.params;
    logger.info?.('homeAutomation.tv.request', { state });

    let result;
    if (state === 'toggle') result = await tvAdapter.toggle();
    else if (state === 'on') result = await tvAdapter.turnOn();
    else result = await tvAdapter.turnOff();

    res.json(result);
  }));

  /**
   * GET /home-automation/office_tv/:state(on|off|toggle)
   * Control office TV power
   */
  router.get('/office_tv/:state(on|off|toggle)', asyncHandler(async (req, res) => {
    if (!tvAdapter) {
      return res.status(503).json({ error: 'TV control not configured (Home Assistant required)' });
    }

    const { state } = req.params;
    logger.info?.('homeAutomation.officeTv.request', { state });

    let result;
    if (state === 'toggle') result = await tvAdapter.toggle('office');
    else if (state === 'on') result = await tvAdapter.turnOn('office');
    else result = await tvAdapter.turnOff('office');

    res.json(result);
  }));

  /**
   * GET /home-automation/tv
   * Turn on TV and load Daylight TV app
   */
  router.get('/tv', asyncHandler(async (req, res) => {
    if (!tvAdapter) {
      return res.status(503).json({ error: 'TV control not configured (Home Assistant required)' });
    }
    if (!taskerAdapter) {
      return res.status(503).json({ error: 'Tasker adapter not configured' });
    }
    if (!kioskAdapter) {
      return res.status(503).json({ error: 'Kiosk adapter not configured' });
    }

    const tvResult = await tvAdapter.turnOn();
    const taskerResult = await taskerAdapter.showBlank();
    const blankResult = await kioskAdapter.waitForBlank();
    const loadResult = await kioskAdapter.loadUrl('/tv', req.query);

    res.json({
      status: 'ok',
      tv: tvResult,
      tasker: taskerResult,
      blank: blankResult,
      load: loadResult
    });
  }));

  // ===========================================================================
  // Volume Control Endpoints
  // ===========================================================================

  /**
   * GET /home-automation/vol/:level or /home-automation/volume/:level
   * Control audio volume on remote device
   * Levels: 0-100, +, -, mute, unmute, togglemute, cycle
   */
  const handleVolumeRequest = asyncHandler(async (req, res) => {
    if (!remoteExecAdapter) {
      return res.status(503).json({ error: 'Volume control not configured (Remote exec adapter required)' });
    }

    const { level } = req.params;
    // Path relative to household dir (loadFile/saveFile prepend householdDir)
    const volumeStateFile = `history/hardware/volLevel`;
    const cycleLevels = [70, 50, 30, 20, 10, 0];
    const increment = 12;

    let result;
    const beforeState = loadFile?.(volumeStateFile) || { volume: 70, muted: false };
    let { volume, muted } = beforeState;

    // Handle mute operations
    if (level === 'mute') {
      saveFile?.(volumeStateFile, { volume, muted: true });
      result = await remoteExecAdapter.setVolume('mute');
    } else if (level === 'unmute') {
      saveFile?.(volumeStateFile, { volume, muted: false });
      result = await remoteExecAdapter.setVolume('unmute');
    } else if (level === 'togglemute') {
      if (muted) {
        saveFile?.(volumeStateFile, { volume, muted: false });
        await remoteExecAdapter.setVolume('unmute');
        result = await remoteExecAdapter.setVolume(volume);
      } else {
        saveFile?.(volumeStateFile, { volume, muted: true });
        result = await remoteExecAdapter.setVolume('mute');
      }
    } else {
      // For all other operations, unmute first if muted
      if (muted) {
        await remoteExecAdapter.setVolume('unmute');
        muted = false;
      }

      if (level === '+') {
        const nextLevel = Math.min(volume + increment, 100);
        saveFile?.(volumeStateFile, { volume: nextLevel, muted });
        result = await remoteExecAdapter.setVolume(nextLevel);
      } else if (level === '-') {
        const nextLevel = Math.max(volume - increment, 0);
        saveFile?.(volumeStateFile, { volume: nextLevel, muted });
        result = await remoteExecAdapter.setVolume(nextLevel);
      } else if (parseInt(level) === 0) {
        saveFile?.(volumeStateFile, { volume: 0, muted: true });
        result = await remoteExecAdapter.setVolume('mute');
      } else if (!isNaN(parseInt(level))) {
        saveFile?.(volumeStateFile, { volume: parseInt(level), muted });
        result = await remoteExecAdapter.setVolume(parseInt(level));
      } else if (level === 'cycle') {
        const nextIndex = (cycleLevels.indexOf(volume) + 1) % cycleLevels.length;
        const nextLevel = cycleLevels[nextIndex];
        saveFile?.(volumeStateFile, { volume: nextLevel, muted });
        result = await remoteExecAdapter.setVolume(nextLevel);
      }
    }

    const afterState = loadFile?.(volumeStateFile) || { volume, muted };
    res.json({ result, beforeState, afterState });
  });

  router.get('/vol/:level', handleVolumeRequest);
  router.get('/volume/:level', handleVolumeRequest);

  /**
   * GET /home-automation/audio/:device
   * Set audio output device
   */
  router.get('/audio/:device', asyncHandler(async (req, res) => {
    if (!remoteExecAdapter) {
      return res.status(503).json({ error: 'Audio device control not configured (Remote exec adapter required)' });
    }

    const { device } = req.params;

    const result = await remoteExecAdapter.setAudioDevice(device);
    res.json({ device, ...result });
  }));

  // ===========================================================================
  // Remote Command Endpoint
  // ===========================================================================

  /**
   * POST /home-automation/cmd
   * Execute arbitrary command on remote host
   */
  router.post('/cmd', asyncHandler(async (req, res) => {
    if (!remoteExecAdapter) {
      return res.status(503).json({ error: 'Remote command not configured (Remote exec adapter required)' });
    }

    const { cmd } = { ...req.body, ...req.query };

    if (!cmd) {
      return res.status(400).json({ error: 'Command required' });
    }

    const result = await remoteExecAdapter.execute(cmd);
    res.json(result);
  }));

  // ===========================================================================
  // Keyboard Configuration Endpoint
  // ===========================================================================

  /**
   * GET /home-automation/keyboard/:keyboard_id?
   * Get keyboard configuration data for a specific keyboard
   * Returns key mappings with labels, functions, and parameters
   */
  router.get('/keyboard/:keyboard_id?', asyncHandler(async (req, res) => {
    if (!loadFile) {
      return res.status(503).json({ error: 'State file loading not configured' });
    }

    const { keyboard_id } = req.params;

    const keyboardData = loadFile('state/keyboard') || [];
    const filtered = keyboardData.filter(k =>
      k.folder?.replace(/\s+/g, '').toLowerCase() === keyboard_id?.replace(/\s+/g, '').toLowerCase()
    );

    if (!filtered?.length) {
      return res.status(404).json({ error: 'Keyboard not found', keyboard_id });
    }

    const result = filtered.reduce((acc, k) => {
      const { key, label, function: func, params, secondary } = k;
      if (key && !!func) {
        acc[key] = { label, function: func, params, secondary };
      }
      return acc;
    }, {});

    res.json(result);
  }));

  // ===========================================================================
  // Data Endpoints (weather, events, entropy)
  // ===========================================================================

  /**
   * GET /home/entropy
   * Get entropy report
   */
  router.get('/entropy', asyncHandler(async (req, res) => {
    if (!entropyService || !configService) {
      return res.status(503).json({ error: 'Entropy service not configured' });
    }

    const username = configService.getHeadOfHousehold();
    const report = await entropyService.getReport(username);
    res.json(report);
  }));

  /**
   * GET /home/weather
   * Get weather data from state files
   */
  router.get('/weather', asyncHandler(async (req, res) => {
    if (!loadFile) {
      return res.status(503).json({ error: 'State file loading not configured' });
    }

    // loadFile already prepends household path, just use relative path
    const weatherData = loadFile('shared/weather') || {};
    res.json(weatherData);
  }));

  /**
   * GET /home/events
   * Get events data from state files
   */
  router.get('/events', asyncHandler(async (req, res) => {
    if (!loadFile) {
      return res.status(503).json({ error: 'State file loading not configured' });
    }

    // loadFile already prepends household path, just use relative path
    const eventsData = loadFile('shared/events') || [];
    res.json(eventsData);
  }));

  // ===========================================================================
  // Home Assistant Script Execution
  // ===========================================================================

  /**
   * POST /home/ha/script/:scriptId
   * GET /home/ha/script/:scriptId
   * Run a Home Assistant script by entity ID
   */
  const haScriptHandler = asyncHandler(async (req, res) => {
    if (!haGateway) {
      return res.status(503).json({
        ok: false,
        error: 'Home Assistant not configured'
      });
    }

    const { scriptId } = req.params;
    const entityId = scriptId.startsWith('script.') ? scriptId : `script.${scriptId}`;

    logger.info?.('homeAutomation.ha.script.running', { entityId });

    const result = await haGateway.callService('script', 'turn_on', { entity_id: entityId });

    res.json({ ok: true, entityId, result });
  });

  router.get('/ha/script/:scriptId', haScriptHandler);
  router.post('/ha/script/:scriptId', haScriptHandler);

  // ===========================================================================
  // Status Endpoints
  // ===========================================================================

  /**
   * GET /home-automation/status
   * Get status of all home automation adapters
   */
  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      adapters: {
        tv: {
          configured: !!tvAdapter,
          locations: tvAdapter?.getLocations?.() || [],
          metrics: tvAdapter?.getMetrics?.()
        },
        kiosk: {
          configured: kioskAdapter?.isConfigured?.() || false,
          metrics: kioskAdapter?.getMetrics?.()
        },
        tasker: {
          configured: taskerAdapter?.isConfigured?.() || false,
          metrics: taskerAdapter?.getMetrics?.()
        },
        remoteExec: {
          configured: remoteExecAdapter?.isConfigured?.() || false,
          metrics: remoteExecAdapter?.getMetrics?.()
        }
      }
    });
  });

  return router;
}

export default createHomeAutomationRouter;
