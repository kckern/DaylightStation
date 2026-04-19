/**
 * Fitness API Router
 *
 * Endpoints:
 * - GET  /api/fitness - Get fitness config
 * - GET  /api/fitness/governed-content - Get content with governance labels
 * - GET  /api/fitness/show/:id - Get show info (assumes plex source)
 * - GET  /api/fitness/show/:id/playable - Get playable episodes (assumes plex source)
 * - GET  /api/fitness/sessions/dates - List all session dates
 * - GET  /api/fitness/sessions - List sessions for a date
 * - GET  /api/fitness/sessions/:sessionId - Get session detail
 * - POST /api/fitness/session_lock - Acquire or renew session lock
 * - DELETE /api/fitness/session_lock - Release session lock
 * - GET  /api/fitness/session_lock/:sessionId - Check lock status
 * - POST /api/fitness/save_session - Save session data
 * - POST /api/fitness/save_screenshot - Save session screenshot
 * - POST /api/fitness/voice_memo - Transcribe voice memo
 * - POST /api/fitness/zone_led - Sync ambient LED state
 * - GET  /api/fitness/zone_led/status - Get LED controller status
 * - GET  /api/fitness/zone_led/metrics - Get LED controller metrics
 * - POST /api/fitness/zone_led/reset - Reset LED controller state
 * - GET  /api/fitness/resumable - Check for resumable session by contentId
 * - POST /api/fitness/sessions/merge - Merge two sessions into one
 * - GET  /api/fitness/receipt/:sessionId - Get fitness receipt PNG
 * - POST /api/fitness/simulate - Start fitness simulation
 * - DELETE /api/fitness/simulate - Stop running simulation
 * - GET  /api/fitness/simulate/status - Get simulation status
 * - GET  /api/fitness/provider/webhook - Provider subscription validation
 * - POST /api/fitness/provider/webhook - Provider webhook events
 */
import express from 'express';
import path from 'path';
import { spawn } from 'child_process';
import { writeBinary, deleteFile } from '#system/utils/FileIO.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { toListItem } from './list.mjs';
import { ScreenshotValidationError } from '#apps/fitness/services/ScreenshotService.mjs';
import { SessionLockService } from '#apps/fitness/services/SessionLockService.mjs';

// Module-level session lock (shared across all router instances)
const sessionLockService = new SessionLockService();

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
 * @param {Object} config.configService - ConfigService
 * @param {Object} config.contentRegistry - Content source registry (for show endpoint)
 * @param {Object} [config.fitnessConfigService] - FitnessConfigService for config + playlist enrichment
 * @param {Object} [config.fitnessPlayableService] - FitnessPlayableService for show/playable orchestration
 * @param {Object} [config.fitnessContentAdapter] - Pre-resolved content adapter for fitness (default: plex)
 * @param {Object} config.transcriptionService - OpenAI transcription service (optional)
 * @param {Object} [config.screenshotService] - ScreenshotService for saving session screenshots
 * @param {Function} [config.createReceiptCanvas] - async (sessionId, upsidedown) => { canvas, width, height }
 * @param {Object} [config.providerWebhookAdapters] - Map of provider webhook adapters (e.g. { strava: StravaWebhookAdapter })
 * @param {Object} [config.enrichmentService] - StravaEnrichmentService instance
 * @param {Object} [config.agentOrchestrator] - AgentOrchestrator for triggering agent assignments (optional)
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createFitnessRouter(config) {
  const {
    sessionService,
    zoneLedController,
    userService,
    configService,
    contentRegistry,
    fitnessConfigService,
    fitnessPlayableService,
    fitnessContentAdapter,
    transcriptionService,
    screenshotService,
    createReceiptCanvas,
    printerRegistry,
    providerWebhookAdapters = {},
    enrichmentService = null,
    agentOrchestrator = null,
    fitnessSuggestionService = null,
    logger = console
  } = config;

  const router = express.Router();

  /**
   * GET /api/fitness - Get fitness config (hydrated with user profiles)
   */
  router.get('/', asyncHandler(async (req, res) => {
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const fitnessData = fitnessConfigService?.loadRawConfig(householdId);

    if (!fitnessData) {
      return res.status(404).json({ error: 'Fitness configuration not found' });
    }

    // Hydrate users from profile files
    const hydratedData = userService.hydrateFitnessConfig(fitnessData, householdId);
    hydratedData._household = householdId;

    // Enrich music playlists with thumbnails from content source
    const playlists = hydratedData?.plex?.music_playlists;
    if (Array.isArray(playlists) && playlists.length > 0 && contentRegistry) {
      const contentSource = hydratedData?.content_source || 'plex';
      const adapter = contentRegistry.get(contentSource);
      hydratedData.plex.music_playlists = await fitnessConfigService.enrichPlaylistThumbnails(playlists, adapter);
    }

    res.json(hydratedData);
  }));

  /**
   * GET /api/fitness/governed-content - Get content with governance labels
   * Returns shows/movies that have labels matching the fitness governance config.
   * Used by tests to dynamically find content for governance testing.
   */
  router.get('/governed-content', asyncHandler(async (req, res) => {
    if (!contentRegistry) {
      return res.status(503).json({ error: 'Content registry not configured' });
    }

    const householdId = req.query.household || configService.getDefaultHouseholdId();

    // Use FitnessConfigService for normalized config access (encapsulates Plex-specific structure)
    const normalizedConfig = fitnessConfigService?.getNormalizedConfig(householdId);

    if (!normalizedConfig) {
      return res.status(404).json({ error: 'Fitness configuration not found' });
    }

    // Extract governed labels and types from normalized config
    const { governedLabels, governedTypes } = normalizedConfig;

    if (!governedLabels || governedLabels.length === 0) {
      return res.json({
        items: [],
        governanceConfig: { labels: [], types: governedTypes },
        message: 'No governed labels configured'
      });
    }

    // Use pre-resolved fitness content adapter
    const adapter = fitnessContentAdapter;
    if (!adapter) {
      return res.status(503).json({ error: 'Fitness content adapter not configured' });
    }

    // Query for items with matching labels
    const limit = parseInt(req.query.limit, 10) || 50;
    const items = await adapter.getItemsByLabel(governedLabels, {
      types: governedTypes,
      limit
    });

    res.json({
      items,
      governanceConfig: {
        labels: governedLabels,
        types: governedTypes
      },
      total: items.length
    });
  }));

  // =============================================================================
  // Show Endpoints (assumes plex source - fitness content is always from plex)
  // =============================================================================

  /**
   * GET /api/fitness/show/:id/playable - Get playable episodes for a show
   * Assumes plex source - no need to specify source in URL
   */
  router.get('/show/:id/playable', asyncHandler(async (req, res) => {
    if (!fitnessPlayableService) {
      return res.status(503).json({ error: 'Fitness playable service not configured' });
    }

    const { id } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    const result = await fitnessPlayableService.getPlayableEpisodes(id, householdId);

    res.json({
      id: result.compoundId,
      plex: id,
      title: result.containerItem?.title || id,
      label: result.containerItem?.title || id,
      image: result.containerItem?.thumbnail,
      info: result.info,
      parents: result.parents,
      items: result.items.map(toListItem)
    });
  }));

  /**
   * GET /api/fitness/show/:id - Get show info
   * Assumes plex source - no need to specify source in URL
   */
  router.get('/show/:id', asyncHandler(async (req, res) => {
    if (!contentRegistry) {
      return res.status(503).json({ error: 'Content registry not configured' });
    }

    const { id } = req.params;
    const adapter = fitnessContentAdapter;
    if (!adapter) {
      return res.status(503).json({ error: 'Fitness content adapter not configured' });
    }

    const compoundId = id.includes(':') ? id : `plex:${id}`;
    const item = adapter.getItem ? await adapter.getItem(compoundId) : null;

      if (!item) {
        return res.status(404).json({ error: 'Show not found' });
      }

      let info = null;
      if (adapter.getContainerInfo) {
        info = await adapter.getContainerInfo(compoundId);
      }

    res.json({
      id: compoundId,
      plex: id,
      title: item.title,
      label: item.title,
      type: item.type || null,
      image: item.thumbnail,
      labels: item.labels || null,
      info
    });
  }));

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
   * GET /api/fitness/sessions - List sessions for a specific date or date range
   * Query params:
   * - date: YYYY-MM-DD (list sessions for this date)
   * - since: YYYY-MM-DD (list sessions from this date to today, sorted desc)
   * - limit: number (max sessions to return when using since, default: 20)
   */
  router.get('/sessions', async (req, res) => {
    const { date, since, limit, household } = req.query;
    
    // Mode 1: Single date query (backwards compat)
    if (date && !since) {
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
    }
    
    // Mode 2: Date range query (since -> today)
    if (since) {
      try {
        const endDate = new Date().toISOString().split('T')[0]; // Today
        // Parse relative date notation (e.g. "30d" = 30 days ago)
        let startDate = since;
        const relMatch = since.match(/^(\d+)d$/);
        if (relMatch) {
          const d = new Date();
          d.setDate(d.getDate() - parseInt(relMatch[1], 10));
          startDate = d.toISOString().split('T')[0];
        }
        const sessions = await sessionService.listSessionsInRange(startDate, endDate, household);
        const maxLimit = parseInt(limit) || 20;
        const limited = sessions.slice(0, maxLimit);
        
        return res.json({
          sessions: limited,
          since,
          endDate,
          total: sessions.length,
          returned: limited.length,
          household: sessionService.resolveHouseholdId(household)
        });
      } catch (err) {
        logger.error?.('fitness.sessions.range.error', { since, error: err?.message });
        return res.status(500).json({ error: 'Failed to list sessions in range' });
      }
    }
    
    // Neither date nor since provided
    return res.status(400).json({ error: 'Either date or since query param required (YYYY-MM-DD)' });
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
   * DELETE /api/fitness/sessions/:sessionId - Delete a session and its media
   */
  router.delete('/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { household } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    try {
      const session = await sessionService.getSession(sessionId, household);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      await sessionService.deleteSession(sessionId, household);
      logger.info?.('fitness.sessions.deleted', { sessionId });
      return res.json({ deleted: true, sessionId });
    } catch (err) {
      logger.error?.('fitness.sessions.delete.error', { sessionId, error: err?.message });
      return res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  // ─── Suggestions Grid ────────────────────────────────────
  router.get('/suggestions', async (req, res) => {
    const { gridSize, household } = req.query;
    try {
      const result = await fitnessSuggestionService.getSuggestions({
        gridSize: gridSize ? parseInt(gridSize, 10) : undefined,
        householdId: household,
      });
      return res.json(result);
    } catch (err) {
      logger.error?.('fitness.suggestions.error', { error: err?.message });
      return res.status(500).json({ error: 'Failed to generate suggestions' });
    }
  });

  /**
   * GET /api/fitness/resumable - Check if a resumable session exists
   * Query params:
   * - contentId: media content ID (required)
   * - household: household ID
   */
  router.get('/resumable', asyncHandler(async (req, res) => {
    const { contentId, household } = req.query;
    if (!contentId) {
      return res.status(400).json({ error: 'contentId query param required' });
    }
    try {
      const result = await sessionService.findResumable(contentId, household);
      return res.json(result);
    } catch (err) {
      logger.error?.('fitness.resumable.error', { contentId, error: err?.message });
      return res.status(500).json({ error: 'Failed to check resumable session' });
    }
  }));

  /**
   * POST /api/fitness/sessions/merge - Merge two sessions
   * Body: { sourceSessionId, targetSessionId, household }
   */
  router.post('/sessions/merge', asyncHandler(async (req, res) => {
    const { sourceSessionId, targetSessionId, household } = req.body;
    if (!sourceSessionId || !targetSessionId) {
      return res.status(400).json({ error: 'sourceSessionId and targetSessionId are required' });
    }
    try {
      const merged = await sessionService.mergeSessions(sourceSessionId, targetSessionId, household);
      logger.info?.('fitness.sessions.merged', {
        sourceSessionId,
        targetSessionId,
        mergedId: merged.sessionId?.toString()
      });
      return res.json({
        merged: true,
        sessionId: merged.sessionId?.toString(),
        startTime: merged.startTime,
        endTime: merged.endTime,
        durationMs: merged.durationMs
      });
    } catch (err) {
      logger.error?.('fitness.sessions.merge.error', {
        sourceSessionId, targetSessionId, error: err?.message
      });
      const status = err.name === 'EntityNotFoundError' ? 404 : 500;
      return res.status(status).json({ error: err.message || 'Failed to merge sessions' });
    }
  }));

  /**
   * GET /api/fitness/receipt/:sessionId - Get fitness receipt as PNG
   */
  router.get('/receipt/:sessionId', async (req, res) => {
    if (!createReceiptCanvas) {
      return res.status(501).json({ error: 'Receipt renderer not configured' });
    }
    const { sessionId } = req.params;
    const upsidedown = req.query.upsidedown === 'true';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    try {
      const result = await createReceiptCanvas(sessionId, upsidedown);
      if (!result) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const buffer = result.canvas.toBuffer('image/png');
      res.set('Content-Type', 'image/png');
      res.set('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      logger.error?.('fitness.receipt.error', { sessionId, error: err?.message });
      return res.status(500).json({ error: 'Failed to generate receipt' });
    }
  });

  /**
   * GET /api/fitness/receipt/:sessionId/print - Generate and print fitness receipt
   * Query params:
   *   - upsidedown: 'true'/'false' (default: true for print)
   */
  router.get('/receipt/:sessionId/print/:location?', async (req, res) => {
    if (!createReceiptCanvas) {
      return res.status(501).json({ error: 'Receipt renderer not configured' });
    }
    let printerAdapter;
    try {
      printerAdapter = printerRegistry.resolve(req.params.location);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
    const { sessionId } = req.params;
    const upsidedown = req.query.upsidedown !== 'false'; // default true for print
    try {
      const result = await createReceiptCanvas(sessionId, upsidedown);
      if (!result) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const buffer = result.canvas.toBuffer('image/png');
      const tempPath = `/tmp/fitness_receipt_${sessionId}_${Date.now()}.png`;
      writeBinary(tempPath, buffer);

      const printJob = printerAdapter.createImagePrint(tempPath, {
        width: result.width,
        height: result.height,
        align: 'left',
        threshold: 128
      });
      const success = await printerAdapter.print(printJob);

      try { deleteFile(tempPath); } catch {}

      return res.json({
        success,
        message: success ? 'Fitness receipt printed' : 'Print failed',
        sessionId
      });
    } catch (err) {
      logger.error?.('fitness.receipt.print.error', { sessionId, error: err?.message });
      return res.status(500).json({ error: 'Failed to print receipt' });
    }
  });

  // ── Session Lock (leader protocol) ──────────────────────────

  /**
   * POST /api/fitness/session_lock - Acquire or renew session lock
   */
  router.post('/session_lock', (req, res) => {
    const { sessionId, clientId } = req.body;
    if (!sessionId || !clientId) {
      return res.status(400).json({ error: 'sessionId and clientId required' });
    }
    const result = sessionLockService.acquire(sessionId, clientId);
    res.json(result);
  });

  /**
   * DELETE /api/fitness/session_lock - Release session lock
   */
  router.delete('/session_lock', (req, res) => {
    const { sessionId, clientId } = req.body;
    if (!sessionId || !clientId) {
      return res.status(400).json({ error: 'sessionId and clientId required' });
    }
    const released = sessionLockService.release(sessionId, clientId);
    res.json({ released });
  });

  /**
   * GET /api/fitness/session_lock/:sessionId - Check lock status
   */
  router.get('/session_lock/:sessionId', (req, res) => {
    const lock = sessionLockService.check(req.params.sessionId);
    res.json({ locked: !!lock, ...(lock || {}) });
  });

  /**
   * POST /api/fitness/save_session - Save session data
   * Respects session_write_whitelist in fitness config — if set, only matching
   * user-agent substrings are allowed to write. Empty or absent = allow all.
   */
  router.post('/save_session', async (req, res) => {
    const { sessionData, household } = req.body;
    if (!sessionData) {
      return res.status(400).json({ error: 'Session data is required' });
    }

    // Check session write whitelist
    const fitnessConfig = fitnessConfigService?.loadRawConfig?.(household);
    const whitelist = fitnessConfig?.session_write_whitelist;
    if (Array.isArray(whitelist) && whitelist.length > 0) {
      const ua = req.headers['user-agent'] || '';
      const allowed = whitelist.some(pattern => ua.includes(pattern));
      if (!allowed) {
        logger.warn?.('fitness.sessions.save.blocked', {
          reason: 'client not in session_write_whitelist',
          userAgent: ua,
          sessionId: sessionData?.sessionId,
        });
        return res.status(403).json({ error: 'Client not authorized to write sessions' });
      }
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

      const result = await screenshotService.saveScreenshot({
        sessionId,
        imageBase64,
        mimeType,
        index,
        timestamp,
        householdId: household
      });

      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof ScreenshotValidationError) {
        return res.status(400).json({ ok: false, error: error.message });
      }
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

      // Get household member names for transcription hints (via FitnessConfigService)
      const householdMembers = fitnessConfigService?.getHouseholdMemberNames(householdId) || [];

      const memo = await transcriptionService.transcribeVoiceMemo({
        audioBase64,
        mimeType,
        sessionId,
        startedAt,
        endedAt,
        context: {
          ...sessionContext,
          householdMembers
        }
      });

      // Fire-and-forget: backfill Strava description with the new voice memo
      if (sessionId && memo?.transcriptClean && memo.transcriptClean !== '[No Memo]' && enrichmentService) {
        enrichmentService.reEnrichDescription(sessionId, memo).catch(err => {
          logger.warn?.('strava.voice_memo_backfill.failed', {
            sessionId,
            error: err?.message,
          });
        });
      }

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

  // ── Provider Webhook (vendor-agnostic) ──────────────────────────

  /**
   * GET /api/fitness/provider/webhook - Subscription validation
   * Dispatches to the correct adapter based on query params.
   */
  router.get('/provider/webhook', (req, res) => {
    logger.info?.('fitness.provider.webhook.challenge_request', {
      query: req.query,
      adapterCount: Object.keys(providerWebhookAdapters).length,
    });

    for (const adapter of Object.values(providerWebhookAdapters)) {
      const identified = adapter.identify?.(req);
      if (identified === 'challenge') {
        const result = adapter.handleChallenge(req.query);
        if (result.ok) {
          return res.status(200).json(result.response);
        }
        return res.status(result.status || 400).json({ error: result.reason });
      }
    }
    return res.status(400).json({ error: 'unrecognized-provider' });
  });

  /**
   * POST /api/fitness/provider/webhook - Event receiver
   * Dispatches to the correct adapter based on payload shape.
   * Returns 200 immediately — enrichment is async.
   */
  router.post('/provider/webhook', (req, res) => {
    logger.info?.('fitness.provider.webhook.received', {
      bodyKeys: Object.keys(req.body || {}),
      objectType: req.body?.object_type,
      aspectType: req.body?.aspect_type,
      objectId: req.body?.object_id,
    });

    for (const [name, adapter] of Object.entries(providerWebhookAdapters)) {
      if (adapter.identify?.(req) === 'event') {
        const event = adapter.parseEvent(req.body);
        if (!event) {
          logger.warn?.('fitness.provider.webhook.parse_failed', { provider: name });
          return res.status(200).json({ ok: true, skipped: true, reason: 'parse-failed' });
        }

        logger.info?.('fitness.provider.webhook.identified', {
          provider: name,
          objectType: event.objectType,
          objectId: event.objectId,
          aspectType: event.aspectType,
        });

        const shouldEnrich = adapter.shouldEnrich?.(event);
        if (!shouldEnrich) {
          logger.info?.('fitness.provider.webhook.skip_enrich', {
            provider: name,
            objectId: event.objectId,
            reason: `${event.objectType}/${event.aspectType} not enrichable`,
          });
        } else if (!enrichmentService) {
          logger.warn?.('fitness.provider.webhook.no_enrichment_service', {
            provider: name,
            objectId: event.objectId,
          });
        } else {
          enrichmentService.handleEvent(event);
        }

        // Trigger coaching exercise reaction (fire-and-forget)
        if (adapter.shouldEnrich?.(event) && event.calories > 200) {
          const userId = event.ownerId;
          const coachingOrchestrator = router.coachingOrchestrator;
          const coachingConversationId = configService?.getNutribotConversationId?.() || null;
          if (coachingOrchestrator && coachingConversationId) {
            coachingOrchestrator.sendExerciseReaction({
              userId,
              conversationId: coachingConversationId,
              activity: {
                type: event.type || 'Workout',
                durationMin: Math.round((event.duration || 0) / 60),
                caloriesBurned: event.calories || 0,
              },
            }).catch(err => logger.warn?.('strava.exerciseReaction.error', { error: err.message }));
          }
        }

        return res.status(200).json({ ok: true });
      }
    }

    // Unknown provider — still return 200 to avoid retries
    logger.warn?.('fitness.provider.webhook.unknown', { bodyKeys: Object.keys(req.body || {}) });
    return res.status(200).json({ ok: true, skipped: true, reason: 'unknown-provider' });
  });

  return router;
}

export default createFitnessRouter;
