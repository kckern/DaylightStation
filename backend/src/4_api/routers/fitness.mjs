/**
 * Fitness API Router
 *
 * Endpoints:
 * - GET  /api/fitness - Get fitness config
 * - GET  /api/fitness/sessions/dates - List all session dates
 * - GET  /api/fitness/sessions - List sessions for a date
 * - GET  /api/fitness/sessions/:sessionId - Get session detail
 * - POST /api/fitness/save_session - Save session data
 * - POST /api/fitness/save_screenshot - Save session screenshot
 * - POST /api/fitness/voice_memo - Transcribe voice memo
 * - POST /api/fitness/zone_led - Sync ambient LED state
 * - GET  /api/fitness/zone_led/status - Get LED controller status
 * - GET  /api/fitness/zone_led/metrics - Get LED controller metrics
 * - POST /api/fitness/zone_led/reset - Reset LED controller state
 * - POST /api/fitness/simulate - Start fitness simulation
 * - DELETE /api/fitness/simulate - Stop running simulation
 * - GET  /api/fitness/simulate/status - Get simulation status
 */
import express from 'express';
import path from 'path';
import { spawn } from 'child_process';
import { ensureDir, writeBinary } from '../../0_infrastructure/utils/FileIO.mjs';

// Module-level state for simulation process
const simulationState = {
  process: null,
  pid: null,
  startedAt: null,
  config: null
};

/**
 * Create fitness API router
 *
 * @param {Object} config
 * @param {Object} config.sessionService - SessionService instance
 * @param {Object} config.zoneLedController - AmbientLedAdapter instance
 * @param {Object} config.userService - UserService for hydrating config
 * @param {Object} config.userDataService - UserDataService for reading household data
 * @param {Object} config.configService - ConfigService
 * @param {Object} config.transcriptionService - OpenAI transcription service (optional)
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createFitnessRouter(config) {
  const {
    sessionService,
    zoneLedController,
    userService,
    userDataService,
    configService,
    transcriptionService,
    logger = console
  } = config;

  const router = express.Router();

  /**
   * Load fitness config from household-scoped path
   */
  function loadFitnessConfig(householdId) {
    const hid = householdId || configService.getDefaultHouseholdId();
    const householdConfig = userDataService.readHouseholdAppData(hid, 'fitness', 'config');

    if (!householdConfig) {
      logger.error?.('fitness.config.not-found', {
        householdId: hid,
        expectedPath: `households/${hid}/apps/fitness/config.yml`
      });
      return null;
    }

    return householdConfig;
  }

  /**
   * GET /api/fitness - Get fitness config (hydrated with user profiles)
   */
  router.get('/', (req, res) => {
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const fitnessData = loadFitnessConfig(householdId);

    if (!fitnessData) {
      return res.status(404).json({ error: 'Fitness configuration not found' });
    }

    // Hydrate users from profile files
    const hydratedData = userService.hydrateFitnessConfig(fitnessData, householdId);
    hydratedData._household = householdId;

    res.json(hydratedData);
  });

  /**
   * GET /api/fitness/sessions/dates - List all dates that have sessions
   */
  router.get('/sessions/dates', async (req, res) => {
    const { household } = req.query;
    try {
      const dates = await sessionService.listDates(household);
      return res.json({
        dates,
        household: sessionService.resolveHouseholdId(household)
      });
    } catch (err) {
      logger.error?.('fitness.sessions.dates.error', { error: err?.message });
      return res.status(500).json({ error: 'Failed to list session dates' });
    }
  });

  /**
   * GET /api/fitness/sessions - List sessions for a specific date
   */
  router.get('/sessions', async (req, res) => {
    const { date, household } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
    }
    try {
      const sessions = await sessionService.listSessionsByDate(date, household);
      return res.json({
        sessions,
        date,
        household: sessionService.resolveHouseholdId(household)
      });
    } catch (err) {
      logger.error?.('fitness.sessions.list.error', { date, error: err?.message });
      return res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  /**
   * GET /api/fitness/sessions/:sessionId - Get session detail
   */
  router.get('/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { household } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    try {
      const session = await sessionService.getSession(sessionId, household, {
        decodeTimeline: true
      });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      return res.json({ session: session.toJSON() });
    } catch (err) {
      logger.error?.('fitness.sessions.detail.error', { sessionId, error: err?.message });
      return res.status(500).json({ error: 'Failed to load session' });
    }
  });

  /**
   * POST /api/fitness/save_session - Save session data
   */
  router.post('/save_session', async (req, res) => {
    const { sessionData, household } = req.body;
    if (!sessionData) {
      return res.status(400).json({ error: 'Session data is required' });
    }

    try {
      const session = await sessionService.saveSession(sessionData, household);
      const paths = sessionService.getStoragePaths(session.sessionId, household);

      res.json({
        message: 'Session data saved successfully',
        filename: paths?.sessionFilePath,
        sessionData: session.toJSON()
      });
    } catch (err) {
      logger.error?.('fitness.sessions.save.error', { error: err?.message });
      return res.status(400).json({ error: err.message || 'Failed to save session' });
    }
  });

  /**
   * POST /api/fitness/save_screenshot - Save session screenshot
   */
  router.post('/save_screenshot', async (req, res) => {
    try {
      const { sessionId, imageBase64, mimeType, index, timestamp, household } = req.body || {};
      if (!sessionId || !imageBase64) {
        return res.status(400).json({ ok: false, error: 'sessionId and imageBase64 are required' });
      }

      const paths = sessionService.getStoragePaths(sessionId, household);
      if (!paths) {
        return res.status(400).json({ ok: false, error: 'Invalid sessionId' });
      }

      // Decode base64
      const trimmed = imageBase64.replace(/^data:[^;]+;base64,/, '');
      if (!trimmed) {
        return res.status(400).json({ ok: false, error: 'Invalid base64 payload' });
      }

      const buffer = Buffer.from(trimmed, 'base64');
      if (!buffer.length) {
        return res.status(400).json({ ok: false, error: 'Failed to decode image data' });
      }

      // Determine extension
      const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
      const extension = normalizedMime.includes('png') ? 'png'
        : normalizedMime.includes('webp') ? 'webp'
        : normalizedMime.includes('jpeg') || normalizedMime.includes('jpg') ? 'jpg'
        : 'jpg';

      // Build filename
      const indexValue = Number.isFinite(index) ? Number(index) : null;
      const indexFragment = indexValue != null
        ? String(indexValue).padStart(4, '0')
        : Date.now().toString(36);
      const filename = `${paths.sessionDate}_${indexFragment}.${extension}`;

      // Ensure directories exist
      ensureDir(paths.screenshotsDir);

      // Write file
      const filePath = path.join(paths.screenshotsDir, filename);
      writeBinary(filePath, buffer);

      const relativePath = `${paths.screenshotsRelativeBase}/${filename}`;

      const captureInfo = {
        index: indexValue,
        filename,
        path: relativePath,
        timestamp: timestamp || Date.now(),
        size: buffer.length
      };

      // Update session with snapshot
      await sessionService.addSnapshot(sessionId, captureInfo, household);

      return res.json({
        ok: true,
        sessionId: paths.sessionDate.replace(/-/g, '') + (sessionId.slice(8) || ''),
        ...captureInfo,
        mimeType: normalizedMime || 'image/jpeg'
      });
    } catch (error) {
      logger.error?.('fitness.screenshot.error', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Failed to save screenshot' });
    }
  });

  /**
   * POST /api/fitness/voice_memo - Transcribe voice memo
   */
  router.post('/voice_memo', async (req, res) => {
    if (!transcriptionService) {
      return res.status(500).json({ ok: false, error: 'Transcription service not configured' });
    }

    try {
      const { audioBase64, mimeType, sessionId, startedAt, endedAt, context: sessionContext = {} } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'audioBase64 required' });
      }

      const householdId = sessionContext.householdId || configService.getDefaultHouseholdId();
      const fitnessConfig = loadFitnessConfig(householdId);

      // Build household member names for transcription hints
      const householdMembers = [];
      if (fitnessConfig?.users) {
        if (Array.isArray(fitnessConfig.users.primary)) {
          householdMembers.push(...fitnessConfig.users.primary.map(u => typeof u === 'string' ? u : u.name));
        }
        if (Array.isArray(fitnessConfig.users.family)) {
          householdMembers.push(...fitnessConfig.users.family.map(u => u.name));
        }
      }

      const memo = await transcriptionService.transcribeVoiceMemo({
        audioBase64,
        mimeType,
        sessionId,
        startedAt,
        endedAt,
        context: {
          ...sessionContext,
          householdMembers: [...new Set(householdMembers)]
        }
      });

      return res.json({ ok: true, memo });
    } catch (e) {
      logger.error?.('fitness.voice_memo.error', { error: e.message });
      return res.status(500).json({ ok: false, error: e.message || 'voice memo failure' });
    }
  });

  // =============================================================================
  // Zone LED Endpoints (require Home Assistant configuration)
  // =============================================================================

  /**
   * POST /api/fitness/zone_led - Sync ambient LED with zone state
   */
  router.post('/zone_led', async (req, res) => {
    if (!zoneLedController) {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured (Home Assistant required)' });
    }
    try {
      const { zones = [], sessionEnded = false, householdId } = req.body;
      const result = await zoneLedController.syncZone({ zones, sessionEnded, householdId });

      if (result.ok) {
        return res.json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      logger.error?.('fitness.zone_led.error', { error: error.message });
      return res.status(500).json({
        ok: false,
        error: error.message,
        failureCount: zoneLedController?.failureCount
      });
    }
  });

  /**
   * GET /api/fitness/zone_led/status - Get LED controller status
   */
  router.get('/zone_led/status', (req, res) => {
    if (!zoneLedController) {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured' });
    }
    const { householdId } = req.query;
    res.json(zoneLedController.getStatus(householdId));
  });

  /**
   * GET /api/fitness/zone_led/metrics - Get LED controller metrics
   */
  router.get('/zone_led/metrics', (req, res) => {
    if (!zoneLedController) {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured' });
    }
    res.json(zoneLedController.getMetrics());
  });

  /**
   * POST /api/fitness/zone_led/reset - Reset LED controller state
   */
  router.post('/zone_led/reset', (req, res) => {
    if (!zoneLedController) {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured' });
    }
    const result = zoneLedController.reset();
    result.resetBy = req.ip || 'unknown';
    res.json(result);
  });

  // =============================================================================
  // Simulation Endpoints
  // =============================================================================

  /**
   * POST /api/fitness/simulate - Start fitness simulation
   * Body: { duration?: number, users?: number, rpm?: number }
   */
  router.post('/simulate', (req, res) => {
    // Check if already running
    if (simulationState.process && !simulationState.process.killed) {
      return res.json({
        started: false,
        alreadyRunning: true,
        pid: simulationState.pid,
        startedAt: simulationState.startedAt,
        config: simulationState.config
      });
    }

    const { duration = 120, users = 0, rpm = 0 } = req.body || {};

    const args = [`--duration=${duration}`];
    if (users > 0) args.push(String(users));
    if (rpm > 0) args.push(String(users > 0 ? users : 0), String(rpm));

    const scriptPath = path.join(process.cwd(), '_extensions/fitness/simulation.mjs');

    logger.info?.('fitness.simulate.start', { duration, users, rpm, scriptPath });

    try {
      const proc = spawn('node', [scriptPath, ...args], {
        detached: true,
        stdio: 'ignore'
      });
      proc.unref();

      simulationState.process = proc;
      simulationState.pid = proc.pid;
      simulationState.startedAt = Date.now();
      simulationState.config = { duration, users, rpm };

      // Auto-clear state when process exits
      proc.on('exit', () => {
        simulationState.process = null;
        simulationState.pid = null;
        simulationState.startedAt = null;
        simulationState.config = null;
        logger.info?.('fitness.simulate.exited');
      });

      return res.json({
        started: true,
        pid: proc.pid,
        config: { duration, users, rpm }
      });
    } catch (err) {
      logger.error?.('fitness.simulate.spawn-failed', { error: err.message });
      return res.status(500).json({ error: 'Failed to start simulation', message: err.message });
    }
  });

  /**
   * DELETE /api/fitness/simulate - Stop running simulation
   */
  router.delete('/simulate', (req, res) => {
    if (!simulationState.pid) {
      return res.json({ stopped: false, error: 'no simulation running' });
    }

    try {
      process.kill(simulationState.pid, 'SIGTERM');

      const stoppedPid = simulationState.pid;
      simulationState.process = null;
      simulationState.pid = null;
      simulationState.startedAt = null;
      simulationState.config = null;

      logger.info?.('fitness.simulate.stopped', { pid: stoppedPid });

      return res.json({ stopped: true, pid: stoppedPid });
    } catch (err) {
      logger.error?.('fitness.simulate.stop-failed', { error: err.message });
      return res.status(500).json({ error: 'Failed to stop simulation', message: err.message });
    }
  });

  /**
   * GET /api/fitness/simulate/status - Get current simulation status
   */
  router.get('/simulate/status', (req, res) => {
    const running = !!(simulationState.process && !simulationState.process.killed);

    return res.json({
      running,
      pid: running ? simulationState.pid : null,
      startedAt: running ? simulationState.startedAt : null,
      config: running ? simulationState.config : null,
      runningSince: running ? Date.now() - simulationState.startedAt : null
    });
  });

  return router;
}

export default createFitnessRouter;
