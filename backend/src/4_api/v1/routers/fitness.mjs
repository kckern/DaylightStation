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
 * - POST /api/fitness/debug/voice-memo - Debug: save raw audio to data/_debug/
 * - POST /api/fitness/unlock - Request a fingerprint unlock for a named lock
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
 * - POST /api/fitness/cycle-races - Save a cycle-game race record
 * - GET  /api/fitness/cycle-races/:raceId - Get one cycle-game race record
 * - GET  /api/fitness/cycle-races - List cycle-game races (by date, course/win-condition, or dates)
 * - GET  /api/fitness/cycle-races/ladder - Get the current week's cycle-game ladder
 * - GET  /api/fitness/cycle-races/personal-bests - Get a user's personal best for a course
 */
import express from 'express';
import { writeBinary, deleteFile } from '#system/utils/FileIO.mjs';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { toListItem } from './list.mjs';
import { ScreenshotValidationError } from '#apps/fitness/services/ScreenshotService.mjs';
import { QuerySessions } from '#apps/fitness/usecases/QuerySessions.mjs';
import { ManageAccess } from '#apps/fitness/usecases/ManageAccess.mjs';
import { getUnlockService } from '#apps/fitness/unlockService.mjs';
import { getManageService } from '#apps/fitness/manageService.mjs';
import { shouldSendExerciseReaction } from '#apps/fitness/webhookCoachingPolicy.mjs';

// Commit (locking down) is the safe direction, so the admin-press pending may be
// consumed within a generous window that covers the on-screen ceremony. Un-locking
// (/abort, /release) keeps the tight default TTL.
const COMMIT_PENDING_MAX_AGE_MS = 120000; // 2 min

/**
 * Create fitness API router
 *
 * @param {Object} config
 * @param {Object} config.sessionService - SessionService instance
 * @param {Object} config.zoneLedController - AmbientLedAdapter instance
 * @param {Object} [config.danceLightingController] - DanceLightingController instance
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
 * @param {Object} [config.sessionLockService] - SessionLockService (constructed at composition root)
 * @param {Object} [config.simulationService] - FitnessSimulationService (constructed at composition root)
 * @param {Object} [config.querySessions] - QuerySessions use case (defaults to one wired from sessionService)
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createFitnessRouter(config) {
  const {
    sessionService,
    zoneLedController,
    danceLightingController,
    equipmentFanController,
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
    cycleRaceService = null,
    sessionGroupingService = null,
    // Session lock + simulation supervision are constructed at the composition
    // root and injected here — they must NOT be module-scope in this router
    // (shared-state-across-requests bug).
    sessionLockService = null,
    simulationService = null,
    querySessions = null,
    // Test seam: defaults to the process-level unlock service singleton.
    // Tests inject a fake so the endpoint can be exercised without a live eventbus.
    resolveUnlockService = getUnlockService,
    triggerEmergencyLockdown = null,
    releaseEmergencyLockdown = null,
    getLockdownState = null,
    identityRelay = null,
    generateSessionTimelapse = null,
    fingerprintProfileWriter = null,
    resolveManageService = getManageService,
    // Direct-FS operations are moved behind injected providers (wired at the
    // composition root) so this router keeps no filesystem access of its own.
    menuMusicProvider = null,
    voiceMemoDebugStore = null,
    logger = console
  } = config;

  const router = express.Router();

  // Resolve the default household id ONCE — handlers read `req.query.household ||
  // defaultHouseholdId` rather than each re-calling configService.
  const defaultHouseholdId = configService?.getDefaultHouseholdId?.() ?? null;

  // QuerySessions use case: prefer the injected instance (composition root);
  // otherwise wire it here from the already-injected session services so the
  // router is self-sufficient for direct-construction tests.
  const sessionsUseCase = querySessions
    || (sessionService ? new QuerySessions({ sessionService, sessionGroupingService, logger }) : null);

  // ManageAccess use case: the fingerprint / manage-access AUTHORIZATION policy.
  // Constructed from already-injected deps so security decisions live in the
  // application layer, not in the request handlers below.
  const manageAccess = new ManageAccess({
    userService,
    fitnessConfigService,
    identityRelay,
    resolveUnlockService,
    resolveManageService,
    fingerprintProfileWriter,
    logger,
  });

  /**
   * GET /api/fitness - Get fitness config (hydrated with user profiles)
   */
  router.get('/', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    const fitnessData = fitnessConfigService?.loadRawConfig(householdId);

    if (!fitnessData) {
      return res.status(404).json({ error: 'Fitness configuration not found' });
    }

    // Hydrate users from profile files
    const hydratedData = userService.hydrateFitnessConfig(fitnessData, householdId);
    hydratedData._household = householdId;

    // Enrich music playlists with thumbnails from content source
    // Use a timeout so the config endpoint still returns when the content source is unreachable
    const playlists = hydratedData?.plex?.music_playlists;
    if (Array.isArray(playlists) && playlists.length > 0 && contentRegistry) {
      const contentSource = hydratedData?.content_source || 'plex';
      const adapter = contentRegistry.get(contentSource);
      const ENRICH_TIMEOUT_MS = 1500;
      try {
        hydratedData.plex.music_playlists = await Promise.race([
          fitnessConfigService.enrichPlaylistThumbnails(playlists, adapter),
          new Promise((_, reject) => setTimeout(() => reject(new Error('thumbnail enrichment timeout')), ENRICH_TIMEOUT_MS))
        ]);
      } catch (err) {
        logger.warn?.('fitness.config.thumbnail-enrichment-failed', { error: err.message });
      }
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

    const householdId = req.query.household || defaultHouseholdId;

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
    const householdId = req.query.household || defaultHouseholdId;

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
  router.get('/sessions/dates', asyncHandler(async (req, res) => {
    const { household } = req.query;
    const dates = await sessionService.listDates(household);
    return res.json({
      dates,
      household: sessionService.resolveHouseholdId(household)
    });
  }));

  /**
   * GET /api/fitness/sessions - List sessions for a specific date or date range
   * Query params:
   * - date: YYYY-MM-DD (list sessions for this date)
   * - since: YYYY-MM-DD (list sessions from this date to today, sorted desc)
   * - limit: number (max sessions to return when using since, default: 20)
   */
  router.get('/sessions', asyncHandler(async (req, res) => {
    const { date, since, limit, household, group } = req.query;
    const body = await sessionsUseCase.execute({ date, since, limit, household, group });
    // Null = neither date nor since provided.
    if (!body) {
      return res.status(400).json({ error: 'Either date or since query param required (YYYY-MM-DD)' });
    }
    return res.json(body);
  }));

  /**
   * GET /api/fitness/sessions/:sessionId - Get session detail
   */
  router.get('/sessions/:sessionId', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { household } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (sessionId.startsWith('group:') && sessionGroupingService) {
      const group = await sessionGroupingService.getGroupDetail(sessionId, household);
      if (!group) return res.status(404).json({ error: 'Session not found' });
      return res.json({ session: group });
    }
    const session = await sessionService.getSession(sessionId, household, {
      decodeTimeline: true
    });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const json = session.toJSON();
    // Enrich a standalone session with overlapping game activities (e.g. cycle
    // races) so the detail header/timeline match the session list, which runs the
    // same enrichment. Best-effort: a failure here must not break session detail.
    // KEEP this catch — degraded-response product fallback (return the session
    // without activities rather than failing the whole detail request).
    if (sessionGroupingService) {
      try {
        const activities = await sessionGroupingService.enrichSession(sessionId, household);
        if (Array.isArray(activities) && activities.length) json.activities = activities;
      } catch (err) {
        logger.warn?.('fitness.sessions.detail.enrich.error', { sessionId, error: err?.message });
      }
    }
    return res.json({ session: json });
  }));

  // -------------------- Cycle Game races --------------------
  router.post('/cycle-races', async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const { record, household } = req.body || {};
    if (!record?.race?.id) return res.status(400).json({ error: 'record.race.id required' });
    try {
      const file = await cycleRaceService.save(record, household);
      // null = the service refused a zero-distance race; report it as skipped, not saved.
      if (!file) return res.json({ ok: true, raceId: record.race.id, saved: false, skipped: 'zero_distance' });
      return res.json({ ok: true, raceId: record.race.id, saved: true, file });
    } catch (err) {
      logger.error?.('fitness.cycle_races.save.error', { error: err?.message });
      return res.status(400).json({ error: err?.message || 'save failed' });
    }
  });

  // NOTE: /ladder and /personal-bests MUST precede /cycle-races/:raceId or
  // Express matches them as raceIds.
  router.get('/cycle-races/ladder', asyncHandler(async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const householdId = req.query.household || defaultHouseholdId;
    const cycleGameConfig = fitnessConfigService?.loadRawConfig(householdId)?.cycle_game || {};
    try {
      const ladder = await cycleRaceService.getLadder({ cycleGameConfig, week: req.query.week ?? null, householdId });
      if (!ladder) return res.status(404).json({ error: 'no featured courses configured' });
      return res.json(ladder);
    } catch (err) {
      // Expected-error mapping product fallback: a malformed ?week is a client
      // error, not a 500. Everything else propagates to the error middleware.
      if (err?.code === 'BAD_WEEK') return res.status(400).json({ error: 'invalid week (expected YYYY-Www)' });
      throw err;
    }
  }));

  router.get('/cycle-races/personal-bests', asyncHandler(async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const { userId, courseId } = req.query;
    if (!userId || !courseId) return res.status(400).json({ error: 'userId and courseId required' });
    const householdId = req.query.household || defaultHouseholdId;
    const cycleGameConfig = fitnessConfigService?.loadRawConfig(householdId)?.cycle_game || {};
    return res.json(await cycleRaceService.getPersonalBest({ cycleGameConfig, userId, courseId, householdId }));
  }));

  router.get('/cycle-races/:raceId', asyncHandler(async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const race = await cycleRaceService.get(req.params.raceId, req.query.household);
    if (!race) return res.status(404).json({ error: 'not found' });
    return res.json({ race });
  }));

  router.get('/cycle-races', asyncHandler(async (req, res) => {
    if (!cycleRaceService) return res.status(503).json({ error: 'cycle races unavailable' });
    const { date, courseId, winCondition, goalM, timeCapS, household } = req.query;
    if (date) return res.json({ races: await cycleRaceService.listByDate(date, household) });
    if (courseId || winCondition) {
      return res.json({ races: await cycleRaceService.findGhostCandidates({
        courseId: courseId || null,
        winCondition: winCondition || null,
        goalM: goalM != null ? Number(goalM) : null,
        timeCapS: timeCapS != null ? Number(timeCapS) : null,
        householdId: household
      }) });
    }
    return res.json({ dates: await cycleRaceService.listDates(household) });
  }));

  /**
   * DELETE /api/fitness/sessions/:sessionId - Delete a session and its media
   */
  router.delete('/sessions/:sessionId', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { household } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    const session = await sessionService.getSession(sessionId, household);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await sessionService.deleteSession(sessionId, household);
    logger.info?.('fitness.sessions.deleted', { sessionId });
    return res.json({ deleted: true, sessionId });
  }));

  // ─── Suggestions Grid ────────────────────────────────────
  router.get('/suggestions', asyncHandler(async (req, res) => {
    const { gridSize, household } = req.query;
    const t0 = Date.now();
    const result = await fitnessSuggestionService.getSuggestions({
      gridSize: gridSize ? parseInt(gridSize, 10) : undefined,
      householdId: household,
    });
    logger.info?.('fitness.suggestions.timing', {
      gridSize: gridSize ? parseInt(gridSize, 10) : undefined,
      returned: Array.isArray(result?.suggestions) ? result.suggestions.length : null,
      totalMs: Date.now() - t0
    });
    return res.json(result);
  }));

  /**
   * POST /api/fitness/sessions/:sessionId/end - Explicitly end a session.
   *
   * A "clean split" — marks the session finalized so it won't be offered
   * for resume or auto-merged with a subsequent workout. Any HR readings
   * after this call belong to a new session.
   *
   * Body (optional): { endTime?: number, household?: string }
   */
  router.post('/sessions/:sessionId/end', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { household } = req.body || {};
    const endTime = Number.isFinite(req.body?.endTime) ? req.body.endTime : Date.now();
    // EntityNotFoundError → 404 is mapped by name in the error middleware.
    const session = await sessionService.endSession(sessionId, household, endTime);
    logger.info?.('fitness.sessions.finalized', {
      sessionId,
      endTime,
      durationMs: session.durationMs
    });
    // Fire-and-forget the time-lapse recap render (background; never blocks the end response).
    if (generateSessionTimelapse) {
      Promise.resolve(generateSessionTimelapse.execute({ sessionId: session.sessionId?.toString() || sessionId, householdId: household }))
        .then((r) => logger.info?.('fitness.timelapse.trigger_done', { sessionId, status: r?.status }))
        .catch((err) => logger.error?.('fitness.timelapse.trigger_failed', { sessionId, error: err?.message }));
    }
    return res.json({
      finalized: true,
      sessionId: session.sessionId?.toString(),
      endTime: session.endTime,
      durationMs: session.durationMs
    });
  }));

  /**
   * POST /api/fitness/sessions/:sessionId/timelapse - Manually (re)generate the
   * session time-lapse recap. Runs in the background; returns 202 immediately.
   */
  router.post('/sessions/:sessionId/timelapse', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const householdId = req.body?.household;
    if (!generateSessionTimelapse) {
      return res.status(501).json({ ok: false, error: 'timelapse not configured' });
    }
    Promise.resolve(generateSessionTimelapse.execute({ sessionId, householdId, force: true }))
      .then((r) => logger.info?.('fitness.timelapse.manual_done', { sessionId, status: r?.status }))
      .catch((err) => logger.error?.('fitness.timelapse.manual_failed', { sessionId, error: err?.message }));
    return res.status(202).json({ ok: true, status: 'processing', sessionId });
  }));

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
    const result = await sessionService.findResumable(contentId, household);
    return res.json(result);
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
    // EntityNotFoundError → 404 is mapped by name in the error middleware.
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
  }));

  /**
   * GET /api/fitness/receipt/:sessionId - Get fitness receipt as PNG
   */
  router.get('/receipt/:sessionId', asyncHandler(async (req, res) => {
    if (!createReceiptCanvas) {
      return res.status(501).json({ error: 'Receipt renderer not configured' });
    }
    const { sessionId } = req.params;
    const upsidedown = req.query.upsidedown === 'true';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    const result = await createReceiptCanvas(sessionId, upsidedown);
    if (!result) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const buffer = result.canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Content-Length', buffer.length);
    return res.send(buffer);
  }));

  /**
   * GET /api/fitness/receipt/:sessionId/print - Generate and print fitness receipt
   * Query params:
   *   - upsidedown: 'true'/'false' (default: true for print)
   */
  router.get('/receipt/:sessionId/print{/:location}', asyncHandler(async (req, res) => {
    if (!createReceiptCanvas) {
      return res.status(501).json({ error: 'Receipt renderer not configured' });
    }
    let printerAdapter;
    try {
      // Expected-error mapping product fallback: an unknown printer location is a
      // 404, not a 500. Other failures below propagate to the error middleware.
      printerAdapter = printerRegistry.resolve(req.params.location);
    } catch (err) {
      return res.status(404).json({ error: err.message });
    }
    const { sessionId } = req.params;
    const upsidedown = req.query.upsidedown !== 'false'; // default true for print
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
  }));

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
  router.post('/save_screenshot', asyncHandler(async (req, res) => {
    const { sessionId, imageBase64, mimeType, index, timestamp, household, role } = req.body || {};
    if (!sessionId || !imageBase64) {
      return res.status(400).json({ ok: false, error: 'sessionId and imageBase64 are required' });
    }

    try {
      const result = await screenshotService.saveScreenshot({
        sessionId,
        imageBase64,
        mimeType,
        index,
        timestamp,
        householdId: household,
        role
      });

      return res.json({ ok: true, ...result });
    } catch (error) {
      // Expected-error mapping product fallback: a validation failure is a 400.
      // Everything else propagates to the error middleware.
      if (error instanceof ScreenshotValidationError) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      throw error;
    }
  }));

  /**
   * POST /api/fitness/voice_memo - Transcribe voice memo
   */
  router.post('/voice_memo', asyncHandler(async (req, res) => {
    if (!transcriptionService) {
      return res.status(503).json({ ok: false, error: 'Transcription service not configured' });
    }

    const { audioBase64, mimeType, sessionId, startedAt, endedAt, context: sessionContext = {} } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ ok: false, error: 'audioBase64 required' });
    }

    const householdId = sessionContext.householdId || defaultHouseholdId;

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

      // Retroactive persistence: when the memo targets a session that has
      // already ended, write it into the session YAML so it shows up in the
      // session-list API. For active sessions we SKIP this — the frontend's
      // voiceMemoManager persists on the next tick save and a backend write
      // here would race / double up.
      if (sessionId && memo?.transcriptClean && memo.transcriptClean !== '[No Memo]' && sessionService?.appendVoiceMemo) {
        try {
          const existing = await sessionService.getSession(sessionId, householdId, { decodeTimeline: false });
          const endMs = existing?.endTime
            || (existing?.session?.end ? Date.parse(existing.session.end) : null);
          const isEnded = Boolean(endMs) && endMs < Date.now();
          if (isEnded) {
            const appended = await sessionService.appendVoiceMemo(sessionId, householdId, {
              transcriptClean: memo.transcriptClean,
              transcriptRaw: memo.transcriptRaw,
              durationSeconds: memo.durationSeconds,
              createdAt: memo.createdAt,
              memoId: memo.memoId,
            });
            logger.info?.('fitness.voice_memo.retroactive_persisted', {
              sessionId,
              householdId,
              success: Boolean(appended),
            });
            // Persist was attempted but the memo was not written (e.g. session
            // record not found). Do NOT report success to the client — return
            // an error so the UI can surface/retry instead of silently losing
            // the transcribed memo.
            if (!appended) {
              logger.error?.('fitness.voice_memo.retroactive_persist_dropped', {
                sessionId,
                householdId,
              });
              return res.status(500).json({
                ok: false,
                error: 'Voice memo transcribed but could not be saved to the session',
                memo,
              });
            }
          }
        } catch (persistErr) {
          // Degraded-response product fallback: transcription succeeded but the
          // retroactive persist failed — return the transcribed `memo` payload
          // (500) so the UI can surface/retry without losing the transcription,
          // rather than letting a generic middleware 500 drop it.
          logger.warn?.('fitness.voice_memo.retroactive_persist_failed', {
            sessionId,
            error: persistErr?.message,
          });
          return res.status(500).json({
            ok: false,
            error: 'Voice memo transcribed but could not be saved to the session',
            memo,
          });
        }
      }

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
  }));

  /**
   * POST /api/fitness/debug/voice-memo — Developer-only raw audio memo dump.
   *
   * DEBUG ONLY. Saves the raw webm blob under <dataDir>/_debug/voice_memos/
   * using an ISO timestamp as the filename. Intentionally independent of
   * the workout voice-memo system: NO transcription, NO sessionId linkage,
   * NO Strava enrichment, NO session context capture.
   */
  router.post('/debug/voice-memo', asyncHandler(async (req, res) => {
    if (!voiceMemoDebugStore) {
      return res.status(503).json({ ok: false, error: 'Debug voice-memo store not configured' });
    }
    const { audioBase64 } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ ok: false, error: 'audioBase64 required' });
    }

    const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ ok: false, error: 'Failed to decode audio data' });
    }

    // Filesystem write lives behind the injected store (composition root).
    const saved = await voiceMemoDebugStore.save(buffer);

    logger.debug?.('fitness.debug_voice_memo.saved', { filename: saved.filename, size: saved.size });

    return res.json({ ok: true, ...saved });
  }));

  // =============================================================================
  // Zone LED Endpoints (require Home Assistant configuration)
  // =============================================================================

  /**
   * POST /api/fitness/zone_led - Sync ambient LED with zone state
   */
  router.post('/zone_led', asyncHandler(async (req, res) => {
    if (!zoneLedController) {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured (Home Assistant required)' });
    }
    const { zones = [], sessionEnded = false, householdId } = req.body;
    const result = await zoneLedController.syncZone({ zones, sessionEnded, householdId });

    // Degraded-response product fallback: the controller reports a HANDLED sync
    // failure as { ok:false, ... } with diagnostics (failureCount) the LED state
    // machine consumes — surface that as 500 rather than throwing. Unexpected
    // exceptions still propagate to the error middleware.
    if (result.ok) {
      return res.json(result);
    }
    return res.status(500).json(result);
  }));

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
  // Dance Party Lighting Endpoints (require Home Assistant configuration)
  // =============================================================================

  /**
   * Dance Party lighting — POST /dance/{start,accent,stop}
   * Gracefully no-ops when no controller is wired (HA disabled / not configured).
   */
  const danceAction = (action) => asyncHandler(async (req, res) => {
    if (!danceLightingController || typeof danceLightingController[action] !== 'function') {
      return res.json({ ok: true, skipped: true, reason: 'dance_lighting_unavailable' });
    }
    const householdId = req.query.householdId || req.body?.householdId;
    const result = await danceLightingController[action](householdId);
    return res.json(result);
  });
  router.post('/dance/start', danceAction('start'));
  router.post('/dance/accent', danceAction('accent'));
  router.post('/dance/stop', danceAction('stop'));

  /**
   * POST /dance/bpm {bpm} — mirror the live music BPM into the configured HA
   * input_number (controller clamps + rate-caps; see DanceLightingController.setBpm).
   */
  router.post('/dance/bpm', asyncHandler(async (req, res) => {
    if (!danceLightingController || typeof danceLightingController.setBpm !== 'function') {
      return res.json({ ok: true, skipped: true, reason: 'dance_lighting_unavailable' });
    }
    const householdId = req.query.householdId || req.body?.householdId;
    const result = await danceLightingController.setBpm(householdId, req.body?.bpm);
    return res.json(result);
  }));

  // =============================================================================
  // Equipment Fan Endpoints (require Home Assistant configuration)
  // =============================================================================

  /**
   * POST /api/fitness/equipment_fan - Evaluate fan trigger conditions and fire
   */
  router.post('/equipment_fan', asyncHandler(async (req, res) => {
    if (!equipmentFanController) {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured (Home Assistant required)' });
    }
    const { rpm = {}, zones = [], sessionEnded = false, householdId } = req.body;
    const result = await equipmentFanController.evaluate({ rpm, zones, sessionEnded, householdId });
    return res.json(result);
  }));

  /**
   * GET /api/fitness/equipment_fan/status
   */
  router.get('/equipment_fan/status', (req, res) => {
    if (!equipmentFanController) {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured' });
    }
    res.json(equipmentFanController.getStatus(req.query.householdId));
  });

  /**
   * POST /api/fitness/equipment_fan/reset
   */
  router.post('/equipment_fan/reset', (req, res) => {
    if (!equipmentFanController) {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured' });
    }
    res.json(equipmentFanController.reset());
  });

  // =============================================================================
  // Simulation Endpoints
  // =============================================================================

  /**
   * POST /api/fitness/simulate - Start fitness simulation
   * Body: { duration?: number, users?: number, rpm?: number }
   */
  router.post('/simulate', (req, res) => {
    const { duration = 120, users = 0, rpm = 0 } = req.body || {};
    return res.json(simulationService.start({ duration, users, rpm }));
  });

  /**
   * DELETE /api/fitness/simulate - Stop running simulation
   */
  router.delete('/simulate', (req, res) => {
    return res.json(simulationService.stop());
  });

  /**
   * GET /api/fitness/simulate/status - Get current simulation status
   */
  router.get('/simulate/status', (req, res) => {
    return res.json(simulationService.status());
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

        // Trigger coaching exercise reaction (fire-and-forget). The calorie
        // threshold is a fitness domain rule (webhookCoachingPolicy).
        if (shouldEnrich && shouldSendExerciseReaction(event)) {
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

  /**
   * GET /api/fitness/menu-music
   * Returns list of menu music track paths + configured volume.
   * Track paths are relative to the media root (media/apps/fitness/ux/menus/).
   * Frontend passes them through DaylightMediaPath() to get full URLs.
   */
  router.get('/menu-music', asyncHandler(async (req, res) => {
    // Directory listing lives behind the injected provider (composition root);
    // it returns media-relative track paths and swallows a missing dir as [].
    const tracks = menuMusicProvider ? menuMusicProvider() : [];

    const householdId = req.query.household || defaultHouseholdId;
    const fitnessConfig = fitnessConfigService?.loadRawConfig?.(householdId) || {};
    const volume = fitnessConfig?.menu_music?.volume ?? 0.05;

    res.json({ tracks, volume });
  }));

  // =============================================================================
  // Emergency Lockdown
  // =============================================================================

  /**
   * GET /api/fitness/emergency — current lockdown state (self-clears when expired).
   *
   * - 200 { locked:false }
   * - 200 { locked:true, lockedUntil, lockedBy }
   */
  router.get('/emergency', asyncHandler(async (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const state = getLockdownState ? await getLockdownState.execute({ now }) : null;
    logger?.debug?.('emergency.state_query', { locked: !!state, lockedUntil: state?.lockedUntil ?? null });
    res.json(state
      ? { locked: true, lockedUntil: state.lockedUntil, lockedBy: state.lockedBy }
      : { locked: false });
  }));

  /**
   * POST /api/fitness/emergency/commit — finalize a lockdown after the browser
   * ceremony. Gated on a recent pending detection so arbitrary clients can't
   * trigger a shutdown.
   *
   * - 409 { error:'no-pending-detection' }  — no recent detection to commit
   * - 503 { error:'emergency-unavailable' } — lockdown use case not wired
   * - 200 { locked:true, lockedUntil, lockedBy }
   */
  router.post('/emergency/commit', asyncHandler(async (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    // Idempotent: if a lockdown is already active (e.g. the server-side abuse
    // fallback already committed), return the current state instead of 409 — so a
    // late browser commit never trips the client's failure path and unlocks.
    const existing = getLockdownState ? await getLockdownState.execute({ now }) : null;
    if (existing) {
      logger?.info?.('emergency.commit_idempotent', { lockedBy: existing.lockedBy });
      return res.json({ locked: true, lockedUntil: existing.lockedUntil, lockedBy: existing.lockedBy });
    }
    // Abuse trips arm a server-authoritative commit token; admin presses stamp a
    // (generously-aged) pending detection. Either authorizes this commit.
    const pending = identityRelay?.consumeArmedCommit?.(Date.now())
      || identityRelay?.consumePendingDetection?.(Date.now(), COMMIT_PENDING_MAX_AGE_MS);
    if (!pending) {
      logger?.warn?.('emergency.commit_rejected', { reason: 'no-pending-detection' });
      return res.status(409).json({ error: 'no-pending-detection' });
    }
    if (!triggerEmergencyLockdown) {
      logger?.warn?.('emergency.commit_rejected', { reason: 'unavailable', lockedBy: pending.userId });
      return res.status(503).json({ error: 'emergency-unavailable' });
    }
    logger?.info?.('emergency.commit_accepted', { lockedBy: pending.userId });
    const state = await triggerEmergencyLockdown.execute({ lockedBy: pending.userId, now });
    logger.info?.('emergency.committed', { lockedBy: pending.userId, lockedUntil: state.lockedUntil });

    // An emergency lockdown is still a session end. The normal
    // POST /sessions/:id/end path never runs during a lockdown (the kiosk is
    // locked out), so without this an emergency-ended workout would capture
    // camera + player frames yet never finalize the session or render its mp4.
    // Finalize every active session and fire its recap — fire-and-forget so it
    // never delays the lockdown response (screens must flip to LOCKED promptly).
    if (sessionService) {
      const householdId = req.query.household || defaultHouseholdId;
      Promise.resolve()
        .then(async () => {
          const active = await sessionService.getActiveSessions(householdId);
          for (const session of active) {
            const sid = session.sessionId?.toString();
            if (!sid) continue;
            await sessionService.endSession(sid, householdId, Date.now());
            logger?.info?.('emergency.session_finalized', { sessionId: sid, lockedBy: pending.userId });
            if (generateSessionTimelapse) {
              Promise.resolve(generateSessionTimelapse.execute({ sessionId: sid, householdId }))
                .then((r) => logger?.info?.('fitness.timelapse.trigger_done', { sessionId: sid, status: r?.status, via: 'emergency' }))
                .catch((err) => logger?.error?.('fitness.timelapse.trigger_failed', { sessionId: sid, error: err?.message, via: 'emergency' }));
            }
          }
        })
        .catch((err) => logger?.error?.('emergency.session_finalize_failed', { error: err?.message, lockedBy: pending.userId }));
    }

    res.json({ locked: true, lockedUntil: state.lockedUntil, lockedBy: state.lockedBy });
  }));

  /**
   * POST /api/fitness/emergency/abort — confirm a cancel with an admin scan.
   *
   * - 200 { confirmed:boolean }
   */
  router.post('/emergency/abort', asyncHandler(async (req, res) => {
    const pending = identityRelay?.consumePendingDetection?.(Date.now());
    if (pending) {
      identityRelay?.disarmCommit?.(); // cancel any armed abuse server-commit
      logger?.info?.('emergency.cancelled', { userId: pending.userId });
    } else {
      logger?.info?.('emergency.cancel_denied', { reason: 'no-pending-detection' });
    }
    res.json({ confirmed: !!pending });
  }));

  /**
   * POST /api/fitness/emergency/release — release an active lockdown with an
   * admin scan.
   *
   * Unlike commit/abort (which ride the ceremony's just-stamped detection), the
   * LOCKED screen sits idle: nothing keeps the garage reader armed during a
   * lockdown (the detector stands down on `lockdown-active`), so a passive consume
   * would always miss and the press-and-hold would be useless. This endpoint
   * therefore ACTIVELY re-arms the reader for an admin fingerprint, scoped to
   * emergency-admin candidates only, then releases on a match.
   *
   * - 200 { released:boolean }
   * - 503 { error:'unlock-service-unavailable', released:false } — no reader wired
   */
  router.post('/emergency/release', asyncHandler(async (req, res) => {
    const now = Math.floor(Date.now() / 1000);

    // Fast path: an admin scan already left a fresh pending detection (e.g. the
    // abuse detector's arm window was briefly open). Honor it without re-arming.
    let pending = identityRelay?.consumePendingDetection?.(Date.now());

    if (!pending) {
      const unlockService = resolveUnlockService?.();
      if (!unlockService) {
        logger?.warn?.('emergency.release_denied', { reason: 'unlock-service-unavailable' });
        return res.status(503).json({ error: 'unlock-service-unavailable', released: false });
      }
      const householdId = req.query.household || defaultHouseholdId;
      const gallery = manageAccess.emergencyAdminGallery(householdId);
      if (gallery.length === 0) {
        logger?.warn?.('emergency.release_denied', { reason: 'no-admin-candidates' });
        return res.json({ released: false });
      }
      logger?.info?.('emergency.release_scan_start', { candidates: gallery.length });
      let verdict;
      try {
        verdict = await unlockService.requestUnlock('emergency:release', gallery);
      } catch (err) {
        // Degraded-response product fallback: a reader failure must return the
        // explicit released:false contract (lockdown persists) with a stable code,
        // not a generic 500 — the LOCKED screen depends on the released flag.
        logger?.error?.('emergency.release_scan_error', { message: err?.message ?? null });
        return res.status(500).json({ error: 'release-scan-failed', released: false });
      }
      if (!verdict?.matched) {
        logger?.info?.('emergency.release_denied', { reason: verdict?.reason || 'no-match' });
        return res.json({ released: false });
      }
      pending = { userId: verdict.userId, at: Date.now() };
    }

    if (releaseEmergencyLockdown) await releaseEmergencyLockdown.execute({ by: pending.userId, now });
    logger?.info?.('emergency.released', { userId: pending.userId });
    res.json({ released: true });
  }));

  // ── Fingerprint / manage-access ─────────────────────────────
  // All authorization DECISIONS (eligibility, the self/admin gate, enroll/delete
  // domain rules) live in the ManageAccess use case. These handlers only parse
  // the request and shape the response.

  /**
   * GET /api/fitness/fingerprints — list every ELIGIBLE user (admins first, then
   * primary, deduped) with their admin flag and enrolled fingers (finger + date
   * only). Never returns uuids; never lists inline family/friends.
   */
  router.get('/fingerprints', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    res.json(manageAccess.listFingerprints(householdId));
  }));

  /**
   * POST /api/fitness/fingerprints/enroll { username, finger, clientToken }
   * Eligibility, duplicate-finger guard, self/admin gate, provider round-trip and
   * profile.yml persistence are all enforced by ManageAccess.enroll.
   */
  router.post('/fingerprints/enroll', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    const { status, body } = await manageAccess.enroll(householdId, req.body || {});
    return res.status(status).json(body);
  }));

  /**
   * DELETE /api/fitness/fingerprints { username, finger }
   * Finger→uuid resolution, self/admin gate, on-box delete and profile.yml removal
   * are all enforced by ManageAccess.remove.
   */
  router.delete('/fingerprints', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    const { status, body } = await manageAccess.remove(householdId, req.body || {});
    return res.status(status).json(body);
  }));

  // Shared error middleware: expected errors (mapped by err.name/err.status) →
  // { error:'<message>', code } ; unexpected 500s → { error:'Internal server error',
  // code:'INTERNAL' } with the real error logged, not leaked to the client.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createFitnessRouter;
