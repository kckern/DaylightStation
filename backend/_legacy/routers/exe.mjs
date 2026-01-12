/**
 * Exe Router - Bridge to new Home Automation infrastructure
 *
 * This module provides backward-compatible routing while delegating
 * to the new adapters in 2_adapters/home-automation.
 *
 * @module routers/exe
 */

import express from 'express';
import { loadFile, saveFile } from '../lib/io.mjs';
import { configService } from '../lib/config/index.mjs';
import { broadcastToWebsockets, restartWebsocketServer } from './websocket.mjs';
import { createLogger } from '../lib/logging/logger.js';
import { serializeError } from '../lib/logging/utils.js';

// Import new adapters
import { TVControlAdapter } from '../../src/2_adapters/home-automation/tv/index.mjs';
import { KioskAdapter } from '../../src/2_adapters/home-automation/kiosk/index.mjs';
import { TaskerAdapter } from '../../src/2_adapters/home-automation/tasker/index.mjs';
import { RemoteExecAdapter } from '../../src/2_adapters/home-automation/remote-exec/index.mjs';

const exeLogger = createLogger({ source: 'backend', app: 'exe' });
const exeRouter = express.Router();

exeRouter.use(express.json({ limit: '50mb' }));
exeRouter.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================================================
// Lazy-initialized adapters
// ============================================================================

let tvAdapter = null;
let kioskAdapter = null;
let taskerAdapter = null;
let remoteExecAdapter = null;

/**
 * Get or create TV control adapter
 * @returns {TVControlAdapter}
 */
function getTVAdapter() {
  if (tvAdapter) return tvAdapter;

  const auth = configService.getHouseholdAuth('homeassistant') || {};
  tvAdapter = new TVControlAdapter({
    host: auth.host || auth.base_url || process.env.home_assistant?.host,
    port: auth.port || process.env.home_assistant?.port,
    token: auth.token
  }, { logger: exeLogger });

  exeLogger.info('exe.tvAdapter.initialized');
  return tvAdapter;
}

/**
 * Get or create Kiosk adapter
 * @returns {KioskAdapter}
 */
function getKioskAdapter() {
  if (kioskAdapter) return kioskAdapter;

  const auth = configService.getHouseholdAuth('fullykiosk') || {};
  kioskAdapter = new KioskAdapter({
    host: process.env.tv?.host,
    port: process.env.tv?.port_kiosk,
    password: auth.password,
    daylightHost: process.env.tv?.daylight_host
  }, { logger: exeLogger });

  exeLogger.info('exe.kioskAdapter.initialized');
  return kioskAdapter;
}

/**
 * Get or create Tasker adapter
 * @returns {TaskerAdapter}
 */
function getTaskerAdapter() {
  if (taskerAdapter) return taskerAdapter;

  taskerAdapter = new TaskerAdapter({
    host: process.env.tv?.host,
    port: process.env.tv?.port_tasker
  }, { logger: exeLogger });

  exeLogger.info('exe.taskerAdapter.initialized');
  return taskerAdapter;
}

/**
 * Get or create Remote Exec adapter
 * @returns {RemoteExecAdapter}
 */
function getRemoteExecAdapter() {
  if (remoteExecAdapter) return remoteExecAdapter;

  const cmdConfig = process.env.cmd || {};
  remoteExecAdapter = new RemoteExecAdapter({
    host: cmdConfig.host,
    user: cmdConfig.user,
    port: cmdConfig.port,
    privateKey: cmdConfig.private_key,
    knownHostsPath: cmdConfig.known_hosts
  }, { logger: exeLogger });

  exeLogger.info('exe.remoteExecAdapter.initialized');
  return remoteExecAdapter;
}

// ============================================================================
// TV Control Routes
// ============================================================================

exeRouter.get('/tv/:state(on|off|toggle)', async (req, res) => {
  const { state } = req.params;
  exeLogger.info('exe.tv.request', { state });

  try {
    let result;
    const adapter = getTVAdapter();
    if (state === 'toggle') result = await adapter.toggle();
    else if (state === 'on') result = await adapter.turnOn();
    else result = await adapter.turnOff();

    res.json(result);
  } catch (error) {
    exeLogger.error('exe.tv.failed', { state, error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

exeRouter.get('/office_tv/:state(on|off|toggle)', async (req, res) => {
  const { state } = req.params;
  exeLogger.info('exe.officeTv.request', { state });

  try {
    let result;
    const adapter = getTVAdapter();
    if (state === 'toggle') result = await adapter.toggle('office');
    else if (state === 'on') result = await adapter.turnOn('office');
    else result = await adapter.turnOff('office');

    res.json(result);
  } catch (error) {
    exeLogger.error('exe.officeTv.failed', { state, error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

exeRouter.get('/tv', async (req, res) => {
  try {
    const tvResult = await getTVAdapter().turnOn();
    const taskerResult = await getTaskerAdapter().showBlank();
    const blankResult = await getKioskAdapter().waitForBlank();
    const loadResult = await getKioskAdapter().loadUrl('/tv', req.query);

    res.json({
      status: 'ok',
      secondsToTurnOnTV: tvResult.seconds,
      secondsToOpenKiosk: taskerResult.seconds,
      secondsToPrepareKiosk: blankResult.seconds,
      secondsToLoadKiosk: loadResult.secondsToLoadKiosk,
      secondsToLoadUrl: loadResult.secondsToLoadUrl
    });
  } catch (error) {
    exeLogger.error('exe.tv.loadFailed', { error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// ============================================================================
// Volume Control Routes
// ============================================================================

exeRouter.get('/vol/:level', handleVolumeRequest);
exeRouter.get('/volume/:level', handleVolumeRequest);

async function handleVolumeRequest(req, res) {
  const { level } = req.params;
  const cycleLevels = [70, 50, 30, 20, 10, 0];
  const hid = process.env.household_id || 'default';
  const volumeStateFile = `households/${hid}/history/hardware/volLevel`;
  const increment = 12;

  try {
    let result;
    const beforeState = loadFile(volumeStateFile) || { volume: 70, muted: false };
    let { volume, muted } = beforeState;
    const adapter = getRemoteExecAdapter();

    // Handle mute operations
    if (level === 'mute') {
      saveFile(volumeStateFile, { volume, muted: true });
      result = await adapter.setVolume('mute');
    } else if (level === 'unmute') {
      saveFile(volumeStateFile, { volume, muted: false });
      result = await adapter.setVolume('unmute');
    } else if (level === 'togglemute') {
      if (muted) {
        saveFile(volumeStateFile, { volume, muted: false });
        await adapter.setVolume('unmute');
        result = await adapter.setVolume(volume);
      } else {
        saveFile(volumeStateFile, { volume, muted: true });
        result = await adapter.setVolume('mute');
      }
    } else {
      // For all other operations, unmute first if muted
      if (muted) {
        await adapter.setVolume('unmute');
        muted = false;
      }

      if (level === '+') {
        const nextLevel = Math.min(volume + increment, 100);
        saveFile(volumeStateFile, { volume: nextLevel, muted });
        result = await adapter.setVolume(nextLevel);
      } else if (level === '-') {
        const nextLevel = Math.max(volume - increment, 0);
        saveFile(volumeStateFile, { volume: nextLevel, muted });
        result = await adapter.setVolume(nextLevel);
      } else if (parseInt(level) === 0) {
        saveFile(volumeStateFile, { volume: 0, muted: true });
        result = await adapter.setVolume('mute');
      } else if (!isNaN(parseInt(level))) {
        saveFile(volumeStateFile, { volume: parseInt(level), muted });
        result = await adapter.setVolume(parseInt(level));
      } else if (level === 'cycle') {
        const nextIndex = (cycleLevels.indexOf(volume) + 1) % cycleLevels.length;
        const nextLevel = cycleLevels[nextIndex];
        saveFile(volumeStateFile, { volume: nextLevel, muted });
        result = await adapter.setVolume(nextLevel);
      }
    }

    const afterState = loadFile(volumeStateFile) || { volume, muted };
    res.json({ stout: result?.stdout, beforeState, afterState });
  } catch (error) {
    exeLogger.error('exe.volume.failed', { level, error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}

// ============================================================================
// Audio Device Route
// ============================================================================

exeRouter.get('/audio/:device', async (req, res) => {
  const { device } = req.params;

  try {
    const result = await getRemoteExecAdapter().setAudioDevice(device);
    res.json({ device, ...result });
  } catch (error) {
    exeLogger.error('exe.audio.failed', { device, error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// ============================================================================
// WebSocket Routes (unchanged - still uses legacy websocket.mjs)
// ============================================================================

exeRouter.all("/ws", async (req, res) => {
  try {
    const payload = Object.keys(req.body || {}).length
      ? req.body
      : (Object.keys(req.query || {}).length
        ? req.query
        : (req.params || {}));

    const message = {
      timestamp: new Date().toISOString(),
      ...payload
    };

    broadcastToWebsockets(message);

    res.json({
      status: 'payload broadcasted',
      message,
      description: 'Frontend will receive the raw payload data'
    });
  } catch (error) {
    exeLogger.error('exe.ws.broadcast.failed', { error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

exeRouter.post("/ws/restart", async (req, res) => {
  try {
    exeLogger.info('exe.ws.restart.requested');
    const success = restartWebsocketServer();

    if (success) {
      res.json({
        status: 'WebSocket server restarted successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        error: 'Failed to restart WebSocket server',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    exeLogger.error('exe.ws.restart.failed', { error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// ============================================================================
// Remote Command Route
// ============================================================================

exeRouter.post('/cmd', async (req, res) => {
  const { cmd } = { ...req.body, ...req.query, ...req.params };

  if (!cmd) {
    return res.status(400).json({ error: 'Command required' });
  }

  try {
    const result = await getRemoteExecAdapter().execute(cmd);
    res.json({ stout: result.stdout });
  } catch (error) {
    exeLogger.error('exe.cmd.failed', { error: serializeError(error) });
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

export default exeRouter;
