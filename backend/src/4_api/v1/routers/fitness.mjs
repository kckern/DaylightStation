import { sendInternalError } from '#api/utils/internalError.mjs';
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
 * - POST /api/fitness/sessions/:sessionId/strength - Log a finished strength run onto a session
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
 * - GET  /api/fitness/workouts - List household workout summaries
 * - GET  /api/fitness/workouts/:id - Get one full workout
 * - POST /api/fitness/workouts - Create or update a workout (400 names unknown slugs)
 * - GET  /api/fitness/workouts/:id/run - Expanded steps + slug->display lookup for Run
 * - POST /api/fitness/workouts/run - The same, for an unsaved draft in the body
 * - DELETE /api/fitness/workouts/:id - Delete a workout
 * - GET  /api/fitness/exercises - Browse the exercise corpus (facets: group, muscle, equipment, q)
 * - GET  /api/fitness/exercises/taxonomy - Facet rails: groups, muscles, equipment
 * - GET  /api/fitness/exercises/:slug - One full exercise, 404 if unknown
 */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { toListItem } from './list.mjs';
import { presentPublicResources } from '../presenters/publicResourceRefs.mjs';

const EXERCISE_FACETS = Object.freeze(['group', 'muscle', 'equipment', 'q']);
function parseExerciseFacets(query = {}) {
  const filter = {};
  for (const key of EXERCISE_FACETS) if (Object.hasOwn(query, key)) filter[key] = query[key];
  return filter;
}
function parseSessionQuery(query = {}) {
  const parsedLimit = parseInt(query.limit, 10);
  return {
    date: query.date,
    since: query.since,
    household: query.household,
    group: query.group,
    limit: Number.isNaN(parsedLimit) ? undefined : parsedLimit,
  };
}

function serializeSession(session) {
  const hasV3Session = !!session.session;
  const hasV3Participants = Object.keys(session.participants).length > 0;
  const result = { version: session.version, sessionId: session.sessionId.toString() };
  if (hasV3Session) result.session = session.session;
  if (session.timezone) result.timezone = session.timezone;
  if (hasV3Participants) result.participants = session.participants;
  if (!hasV3Session) Object.assign(result, { startTime: session.startTime, endTime: session.endTime, durationMs: session.durationMs });
  if (!hasV3Participants) result.roster = session.roster;
  result.timeline = session.timeline;
  if (session.events.length > 0 && !(session.timeline?.events?.length > 0)) result.events = session.events;
  if (session.treasureBox) result.treasureBox = session.treasureBox;
  if (session.summary) result.summary = session.summary;
  if (session.strava) result.strava = session.strava;
  if (session.strava_notes) result.strava_notes = session.strava_notes;
  if (session.finalized) result.finalized = session.finalized;
  if (session.provisional) result.provisional = session.provisional;
  if (session.entities.length > 0) result.entities = session.entities;
  const hasSnapshots = session.snapshots && ((Array.isArray(session.snapshots.captures) && session.snapshots.captures.length > 0) || session.snapshots.updatedAt != null);
  if (hasSnapshots) result.snapshots = session.snapshots;
  if (session.metadata && Object.keys(session.metadata).length > 0) result.metadata = session.metadata;
  if (session.timelapse) result.timelapse = session.timelapse;
  if (session.strength?.runs?.length > 0) result.strength = session.strength;
  return result;
}

/** Map semantic fingerprint-management outcomes to the legacy HTTP contract. */
function sendFingerprintOutcome(res, outcome) {
  switch (outcome?.kind) {
    case 'enrolled':
      return res.status(200).json({ success: true, finger: outcome.finger });
    case 'removed':
      return res.status(200).json({ success: true });
    case 'unknown_user':
      return res.status(400).json({ error: 'unknown-user' });
    case 'not_eligible':
      return res.status(403).json({ error: 'not-eligible' });
    case 'missing_finger':
      return res.status(400).json({ error: 'missing-finger' });
    case 'finger_taken':
      return res.status(409).json({ error: 'finger-taken' });
    case 'unknown_fingerprint':
      return res.status(400).json({ error: 'unknown-fingerprint' });
    case 'ambiguous_finger':
      return res.status(409).json({ error: 'ambiguous-finger' });
    case 'unlock_unavailable':
      return res.status(503).json({ error: 'unlock-service-unavailable' });
    case 'authorization_failed':
      return sendInternalError(res, { error: 'auth-failed' });
    case 'denied':
      return res.status(403).json({ error: 'auth-denied' });
    case 'manage_unavailable':
      return res.status(503).json({ error: 'manage-service-unavailable' });
    case 'duplicate_finger':
      return res.status(409).json({ error: 'duplicate-finger', registeredTo: outcome.registeredTo });
    case 'enrollment_failed':
      return sendInternalError(res, { error: 'enroll-failed', ...(outcome.reason !== undefined && { reason: outcome.reason }) });
    case 'deletion_failed':
      return sendInternalError(res, { error: 'delete-failed', ...(outcome.reason !== undefined && { reason: outcome.reason }) });
    default:
      throw new Error(`Unknown fingerprint management outcome: ${outcome?.kind}`);
  }
}

/**
 * Create fitness API router
 *
 * @param {Object} config
 * @param {Object} config.sessionService - SessionService instance
 * @param {string|null} [config.defaultHouseholdId] - Default household selected at composition
 * @param {Object} config.fitnessContentService - Semantic content/config facade
 * @param {Object} config.fitnessHardwareService - Semantic room-hardware facade
 * @param {Object} config.fitnessWebhookService - Semantic provider-event facade
 * @param {Object} [config.fitnessConfigService] - FitnessConfigService for config + playlist enrichment
 * @param {Object} [config.fitnessPlayableService] - FitnessPlayableService for show/playable orchestration
 * @param {Object} [config.fitnessSchoolCourseService] - School-requested Fitness attempt authority
 * @param {Object} config.transcriptionService - OpenAI transcription service (optional)
 * @param {Object} [config.screenshotService] - ScreenshotService for saving session screenshots
 * @param {Object} config.fitnessSessionOperations - Cohesive session query/workflow facade
 * @param {Object} [config.printFitnessReceipt] - Semantic receipt-printing use case
 * @param {Object} [config.saveDebugVoiceMemo] - Semantic debug-capture use case
 * @param {Object} [config.getFitnessMenuMusic] - Semantic menu-music query
 * @param {Object} [config.emergencyAccessService] - Emergency identity authorization facade
 * @param {Object} [config.enrichmentService] - StravaEnrichmentService instance
 * @param {Object} [config.sessionLockService] - SessionLockService (constructed at composition root)
 * @param {Object} [config.simulationService] - FitnessSimulationService (constructed at composition root)
 * @param {Object} [config.querySessions] - QuerySessions use case (defaults to one wired from sessionService)
 * @param {Object} [config.workoutCatalog] - Semantic workout catalog service
 * @param {Object} [config.saveWorkout] - SaveWorkout use case (validates slugs before persisting)
 * @param {Object} [config.logStrengthRun] - LogStrengthRun use case (writes the session's strength block)
 * @param {Object} [config.browseExerciseLibrary] - BrowseExerciseLibrary use case (the /exercises routes)
 * @param {Object} [config.prepareWorkoutRun] - PrepareWorkoutRun use case (the run routes)
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createFitnessRouter(config) {
  const {
    sessionService,
    fitnessSessionOperations,
    defaultHouseholdId = null,
    fitnessContentService,
    fitnessHardwareService,
    fitnessWebhookService,
    fitnessConfigService,
    fitnessPlayableService,
    fitnessSchoolCourseService,
    voiceMemoOperations = null,
    screenshotService,
    printFitnessReceipt,
    fitnessSuggestionService = null,
    cycleRaceService = null,
    cycleRaceApi = null,
    // Session lock + simulation supervision are constructed at the composition
    // root and injected here — they must NOT be module-scope in this router
    // (shared-state-across-requests bug).
    sessionLockService = null,
    liveSessionAuthority = null,
    simulationService = null,
    querySessions = null,
    manageAccess = null,
    isScreenshotValidationError = (error) => error?.name === 'ScreenshotValidationError',
    emergencyOperations = null,
    generateSessionTimelapse = null,
    getFitnessMenuMusic = null,
    saveDebugVoiceMemo = null,
    // Workout persistence (Build/Run). Both are constructed at the composition root;
    // absent, the /workouts routes report 503 rather than half-working.
    workoutCatalog = null,
    saveWorkout = null,
    // Logging a finished run into the session record. Constructed at the composition
    // root (this layer may not reach into 3_applications to build one); absent, the
    // strength route reports 503 rather than half-working.
    logStrengthRun = null,
    // Browse (read side of the exercise corpus). Wraps the ONE library instance the
    // composition root loaded; absent, the /exercises routes report 503.
    browseExerciseLibrary = null,
    // Build -> Run: expands an authored workout into the runner's flat step list and
    // joins it against the corpus. Needs BOTH the workout catalog and the library, so
    // it is constructed at the composition root; absent, the run routes report 503.
    prepareWorkoutRun = null,
    logger = console
  } = config;

  const router = express.Router();

  // Resolve the default household id ONCE — handlers read `req.query.household ||
  // defaultHouseholdId` rather than reloading configuration in the API layer.
  const sessionsUseCase = querySessions;

  /**
   * GET /api/fitness - Get fitness config (hydrated with user profiles)
   */
  router.get('/', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    const hydratedData = await fitnessContentService.getConfig(householdId);
    if (!hydratedData) {
      return res.status(404).json({ error: 'Fitness configuration not found' });
    }
    res.json(hydratedData);
  }));

  /**
   * GET /api/fitness/governed-content - Get content with governance labels
   * Returns shows/movies that have labels matching the fitness governance config.
   * Used by tests to dynamically find content for governance testing.
   */
  router.get('/governed-content', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    const limit = parseInt(req.query.limit, 10) || 50;
    const result = await fitnessContentService.getGovernedContent(householdId, limit);
    if (result.kind === 'registry_unconfigured') {
      return res.status(503).json({ error: 'Content registry not configured' });
    }
    if (result.kind === 'config_not_found') {
      return res.status(404).json({ error: 'Fitness configuration not found' });
    }
    if (result.kind === 'adapter_unconfigured') {
      return res.status(503).json({ error: 'Fitness content adapter not configured' });
    }
    res.json(result.body);
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

    res.json(presentPublicResources({
      id: result.compoundId,
      plex: id,
      title: result.containerItem?.title || id,
      label: result.containerItem?.title || id,
      image: result.containerItem?.thumbnail,
      info: result.info,
      parents: result.parents,
      items: result.items.map(toListItem)
    }));
  }));

  // ── School-owned Fitness courses ─────────────────────────────────────────
  router.get('/school-attempts/:workSessionId/plan', asyncHandler(async (req, res) => {
    if (!fitnessSchoolCourseService) return res.status(503).json({ error: 'School Fitness courses unavailable' });
    const record = await fitnessSchoolCourseService.get(req.params.workSessionId, req.query.household || defaultHouseholdId);
    if (!record) return res.status(404).json({ error: 'School Fitness attempt not found' });
    return res.json(record);
  }));

  router.post('/school-attempts/:workSessionId/accept', asyncHandler(async (req, res) => {
    if (!fitnessSchoolCourseService) return res.status(503).json({ error: 'School Fitness courses unavailable' });
    const record = await fitnessSchoolCourseService.accept({
      workSessionId: req.params.workSessionId, learnerId: req.body?.learnerId,
      householdId: req.body?.household || defaultHouseholdId,
    });
    return res.json(record);
  }));

  router.post('/school-attempts/:workSessionId/decline', asyncHandler(async (req, res) => {
    if (!fitnessSchoolCourseService) return res.status(503).json({ error: 'School Fitness courses unavailable' });
    const record = await fitnessSchoolCourseService.decline({
      workSessionId: req.params.workSessionId, learnerId: req.body?.learnerId,
      householdId: req.body?.household || defaultHouseholdId,
    });
    return res.json(record);
  }));

  router.post('/school-attempts/:workSessionId/assess', asyncHandler(async (req, res) => {
    if (!fitnessSchoolCourseService) return res.status(503).json({ error: 'School Fitness courses unavailable' });
    const record = await fitnessSchoolCourseService.assess({
      workSessionId: req.params.workSessionId, learnerId: req.body?.learnerId,
      fitnessSessionIds: req.body?.fitnessSessionIds ?? [],
      clientObservations: req.body?.observations ?? {},
      householdId: req.body?.household || defaultHouseholdId,
    });
    return res.json(record);
  }));

  /**
   * GET /api/fitness/show/:id - Get show info
   * Assumes plex source - no need to specify source in URL
   */
  router.get('/show/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await fitnessContentService.getShow(id);
    if (result.kind === 'registry_unconfigured') {
      return res.status(503).json({ error: 'Content registry not configured' });
    }
    if (result.kind === 'adapter_unconfigured') {
      return res.status(503).json({ error: 'Fitness content adapter not configured' });
    }
    if (result.kind === 'not_found') return res.status(404).json({ error: 'Show not found' });
    const { compoundId, item, info } = result;

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
    return res.json(await fitnessSessionOperations.dates(household));
  }));

  /**
   * GET /api/fitness/sessions - List sessions for a specific date or date range
   * Query params:
   * - date: YYYY-MM-DD (list sessions for this date)
   * - since: YYYY-MM-DD (list sessions from this date to today, sorted desc)
   * - limit: number (max sessions to return when using since, default: 20)
   */
  router.get('/sessions', asyncHandler(async (req, res) => {
    const body = await sessionsUseCase.execute(parseSessionQuery(req.query));
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
    const result = await fitnessSessionOperations.detail(sessionId, household);
    if (result.kind === 'not_found') return res.status(404).json({ error: 'Session not found' });
    if (result.kind === 'group') return res.json({ session: result.session });
    const json = serializeSession(result.session);
    if (Array.isArray(result.activities) && result.activities.length) json.activities = result.activities;
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
    try {
      const ladder = await cycleRaceApi.ladder({ week: req.query.week ?? null, householdId });
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
    return res.json(await cycleRaceApi.personalBest({ userId, courseId, householdId }));
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
    const result = await fitnessSessionOperations.delete(sessionId, household);
    if (result.kind === 'not_found') return res.status(404).json({ error: 'Session not found' });
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
    return res.json(presentPublicResources(result));
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
    const session = await fitnessSessionOperations.end(sessionId, household, endTime);
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
    if (!fitnessSessionOperations.receiptAvailable) {
      return res.status(501).json({ error: 'Receipt renderer not configured' });
    }
    const { sessionId } = req.params;
    const upsidedown = req.query.upsidedown === 'true';
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    const result = await fitnessSessionOperations.receipt(sessionId, upsidedown);
    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'Session not found' });
    }
    const buffer = result.bytes;
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
    if (!printFitnessReceipt) {
      return res.status(501).json({ error: 'Receipt renderer not configured' });
    }
    const { sessionId } = req.params;
    const upsidedown = req.query.upsidedown !== 'false'; // default true for print
    const result = await printFitnessReceipt.execute({
      sessionId,
      location: req.params.location,
      upsidedown,
    });
    if (result.kind === 'printer_not_found') return res.status(404).json({ error: result.error });
    if (result.kind === 'session_not_found') {
      return res.status(404).json({ error: 'Session not found' });
    }
    return res.json({
      success: result.success,
      message: result.success ? 'Fitness receipt printed' : 'Print failed',
      sessionId
    });
  }));

  // ── Session Lock (leader protocol) ──────────────────────────

  // Claiming happens before a browser creates a local session ID. The
  // whitelist-approved kiosk becomes writer; every other screen joins as a
  // live mirror and therefore cannot fork persistence or play reward audio.
  router.post('/live-session/claim', (req, res) => {
    if (!liveSessionAuthority) return res.status(503).json({ error: 'Live session authority unavailable' });
    const { clientId, household } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    const householdId = household || req.householdId || defaultHouseholdId;
    const result = liveSessionAuthority.claim(householdId, clientId, {
      writerEligible: fitnessConfigService.mayWriteSession(householdId, req.headers['user-agent'] || ''),
    });
    res.json(result);
  });

  router.delete('/live-session', (req, res) => {
    if (!liveSessionAuthority) return res.status(503).json({ error: 'Live session authority unavailable' });
    const { clientId, household } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    const householdId = household || req.householdId || defaultHouseholdId;
    res.json({ released: liveSessionAuthority.release(householdId, clientId) });
  });

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

    const userAgent = req.headers['user-agent'] || '';
    try {
      const result = await fitnessSessionOperations.save({ sessionData, householdId: household, userAgent });
      if (result.kind === 'forbidden') return res.status(403).json({ error: 'Client not authorized to write sessions' });
      const { session, filename } = result;

      res.json({
        message: 'Session data saved successfully',
        filename,
        sessionData: serializeSession(session)
      });
    } catch (err) {
      logger.error?.('fitness.sessions.save.error', { error: err?.message });
      return res.status(400).json({ error: err.message || 'Failed to save session' });
    }
  });

  /**
   * POST /api/fitness/sessions/:sessionId/strength - Log a finished strength run.
   *
   * The run lands on the SAME session record a cycle ride does, so session detail,
   * recaps and the longitudinal widget pick it up with no new plumbing.
   *
   * Body: { workoutId, completedSteps: [{groupIndex, slug}, ...], completedAt?, household?,
   *         openSession?, startedAt? }
   *
   * `completedSteps` are the WORK steps the runner actually finished — a subset of what
   * `expandWorkout` handed it. Planned counts come from the stored workout, never from
   * the client, so a plan can never be filed as performance.
   *
   * `openSession: true` asks for `sessionId` to be OPENED if it does not exist — the case
   * where a strength workout was done with no fitness session running at all. It is opt-in
   * because posting an id the client believes already exists, and having it silently
   * created, would hide a real bug. See the header of LogStrengthRun.
   *
   * 404s an unknown session or workout; 422s a run with nothing completed (a definite
   * answer, so a client does not retry an empty run forever).
   */
  router.post('/sessions/:sessionId/strength', asyncHandler(async (req, res) => {
    if (!logStrengthRun) return res.status(503).json({ ok: false, error: 'strength logging unavailable' });

    const { sessionId } = req.params;
    const { workoutId, completedSteps, completedAt, household, openSession, startedAt } = req.body || {};

    const result = await logStrengthRun.execute({
      sessionId,
      workoutId,
      completedSteps,
      completedAt,
      openSession: openSession === true,
      startedAt,
      householdId: household || defaultHouseholdId,
    });

    if (!result.ok) {
      const status = result.reason === 'unknown_session' || result.reason === 'unknown_workout'
        ? 404
        : (result.reason === 'nothing_completed' ? 422 : 400);
      return res.status(status).json({ ok: false, error: result.error, reason: result.reason });
    }

    return res.json({
      ok: true,
      sessionId: result.sessionId,
      openedSession: result.openedSession === true,
      strength: result.strength,
    });
  }));

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
        image: imageBase64,
        mediaType: mimeType,
        index,
        timestamp,
        householdId: household,
        role
      });

      const capture = result.capture;
      return res.json({
        ok: true,
        sessionId: result.sessionRef,
        index: capture.order,
        filename: capture.resourceName,
        path: capture.resourceRef,
        timestamp: capture.capturedAt,
        size: capture.byteLength,
        role: capture.role,
        mimeType: capture.mediaType,
      });
    } catch (error) {
      // Expected-error mapping product fallback: a validation failure is a 400.
      // Everything else propagates to the error middleware.
      if (isScreenshotValidationError(error)) {
        const message = error.reason === 'decode_failed' ? 'Failed to decode image data'
          : (error.reason === 'empty' ? 'Invalid base64 payload' : error.message);
        return res.status(400).json({ ok: false, error: message });
      }
      throw error;
    }
  }));

  /**
   * POST /api/fitness/voice_memo - Transcribe voice memo
   */
  router.post('/voice_memo', asyncHandler(async (req, res) => {
    if (!voiceMemoOperations?.available) {
      return res.status(503).json({ ok: false, error: 'Transcription service not configured' });
    }

    const { audioBase64, mimeType, sessionId, startedAt, endedAt, context: sessionContext = {} } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ ok: false, error: 'audioBase64 required' });
    }

      const result = await voiceMemoOperations.transcribe({
        audioBase64,
        mimeType,
        sessionId,
        startedAt,
        endedAt,
        context: sessionContext,
      }, defaultHouseholdId);
      if (result.kind === 'persist_failed') {
        return sendInternalError(res, {
          ok: false,
          error: 'Voice memo transcribed but could not be saved to the session',
          memo: result.memo,
        });
      }
      return res.json({ ok: true, memo: result.memo });
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
    if (!saveDebugVoiceMemo) {
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

    const saved = await saveDebugVoiceMemo.execute(buffer);

    return res.json({ ok: true, ...saved });
  }));

  // =============================================================================
  // Zone LED Endpoints (require Home Assistant configuration)
  // =============================================================================

  /**
   * POST /api/fitness/zone_led - Sync ambient LED with zone state
   */
  router.post('/zone_led', asyncHandler(async (req, res) => {
    const { zones = [], sessionEnded = false, householdId } = req.body;
    const operation = await fitnessHardwareService.syncZone({ zones, sessionEnded, householdId });
    if (operation.kind === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured (Home Assistant required)' });
    }
    const result = operation.body;

    // Degraded-response product fallback: the controller reports a HANDLED sync
    // failure as { ok:false, ... } with diagnostics (failureCount) the LED state
    // machine consumes — surface that as 500 rather than throwing. Unexpected
    // exceptions still propagate to the error middleware.
    if (result.ok) {
      return res.json(result);
    }
    return sendInternalError(res, result);
  }));

  /**
   * GET /api/fitness/zone_led/status - Get LED controller status
   */
  router.get('/zone_led/status', (req, res) => {
    const result = fitnessHardwareService.zoneStatus(req.query.householdId);
    if (result.kind === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured' });
    }
    res.json(result.body);
  });

  /**
   * GET /api/fitness/zone_led/metrics - Get LED controller metrics
   */
  router.get('/zone_led/metrics', (req, res) => {
    const result = fitnessHardwareService.zoneMetrics();
    if (result.kind === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured' });
    }
    res.json(result.body);
  });

  /**
   * POST /api/fitness/zone_led/reset - Reset LED controller state
   */
  router.post('/zone_led/reset', (req, res) => {
    const operation = fitnessHardwareService.zoneReset();
    if (operation.kind === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Zone LED controller not configured' });
    }
    const result = operation.body;
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
    const householdId = req.query.householdId || req.body?.householdId;
    const result = await fitnessHardwareService.dance(action, householdId);
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
    const householdId = req.query.householdId || req.body?.householdId;
    const result = await fitnessHardwareService.dance('bpm', householdId, req.body?.bpm);
    return res.json(result);
  }));

  // =============================================================================
  // Equipment Fan Endpoints (require Home Assistant configuration)
  // =============================================================================

  /**
   * POST /api/fitness/equipment_fan - Evaluate fan trigger conditions and fire
   */
  router.post('/equipment_fan', asyncHandler(async (req, res) => {
    const { rpm = {}, zones = [], sessionEnded = false, householdId } = req.body;
    const operation = await fitnessHardwareService.evaluateFan({ rpm, zones, sessionEnded, householdId });
    if (operation.kind === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured (Home Assistant required)' });
    }
    return res.json(operation.body);
  }));

  /**
   * GET /api/fitness/equipment_fan/status
   */
  router.get('/equipment_fan/status', (req, res) => {
    const result = fitnessHardwareService.fanStatus(req.query.householdId);
    if (result.kind === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured' });
    }
    res.json(result.body);
  });

  /**
   * POST /api/fitness/equipment_fan/reset
   */
  router.post('/equipment_fan/reset', (req, res) => {
    const result = fitnessHardwareService.fanReset();
    if (result.kind === 'unconfigured') {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured' });
    }
    res.json(result.body);
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
      adapterCount: fitnessWebhookService.adapterCount(),
    });
    const result = fitnessWebhookService.challenge({ query: req.query });
    if (result.kind === 'accepted') return res.status(200).json(result.challenge);
    if (result.kind === 'rejected') {
      return res.status(result.category === 'authorization' ? 403 : 400).json({ error: result.reason });
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

    const result = fitnessWebhookService.event({ payload: req.body });
    if (result.kind === 'parse_failed') {
      return res.status(200).json({ ok: true, skipped: true, reason: 'parse-failed' });
    }
    if (result.kind === 'accepted') return res.status(200).json({ ok: true });
    return res.status(200).json({ ok: true, skipped: true, reason: 'unknown-provider' });
  });

  /**
   * GET /api/fitness/menu-music
   * Returns list of menu music track paths + configured volume.
   * Track paths are relative to the media root (media/fitness/ux/menus/).
   * Frontend passes them through DaylightMediaPath() to get full URLs.
   */
  router.get('/menu-music', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    if (getFitnessMenuMusic) return res.json(await getFitnessMenuMusic.execute(householdId));
    // Preserve the historical unconfigured response: music is optional and a
    // missing catalog means an empty track list, not an unavailable endpoint.
    const volume = fitnessConfigService?.getMenuMusicVolume?.(householdId) ?? 0.05;
    res.json({ tracks: [], volume });
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
    res.json(emergencyOperations ? await emergencyOperations.current() : { locked: false });
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
    if (!emergencyOperations) return res.status(409).json({ error: 'no-pending-detection' });
    const result = await emergencyOperations.commit(req.query.household || defaultHouseholdId);
    if (result.kind === 'no_pending') return res.status(409).json({ error: 'no-pending-detection' });
    if (result.kind === 'unavailable') return res.status(503).json({ error: 'emergency-unavailable' });
    const state = result.state;
    res.json({ locked: true, lockedUntil: state.lockedUntil, lockedBy: state.lockedBy });
  }));

  /**
   * POST /api/fitness/emergency/abort — confirm a cancel with an admin scan.
   *
   * - 200 { confirmed:boolean }
   */
  router.post('/emergency/abort', asyncHandler(async (req, res) => {
    res.json(emergencyOperations?.abort() || { confirmed: false });
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
    const householdId = req.query.household || defaultHouseholdId;
    const outcome = emergencyOperations ? await emergencyOperations.release(householdId) : { kind: 'unavailable' };
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'unlock-service-unavailable', released: false });
    }
    if (outcome.kind === 'scan_failed') {
      return sendInternalError(res, { error: 'release-scan-failed', released: false });
    }
    res.json({ released: outcome.kind === 'released' });
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
    if (!manageAccess) return res.status(503).json({ error: 'manage-access-unavailable' });
    res.json(manageAccess.listFingerprints(householdId));
  }));

  /**
   * POST /api/fitness/fingerprints/enroll { username, finger, clientToken }
   * Eligibility, duplicate-finger guard, self/admin gate, provider round-trip and
   * profile.yml persistence are all enforced by ManageAccess.enroll.
   */
  router.post('/fingerprints/enroll', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    if (!manageAccess) return res.status(503).json({ error: 'manage-access-unavailable' });
    return sendFingerprintOutcome(res, await manageAccess.enroll(householdId, req.body || {}));
  }));

  /**
   * DELETE /api/fitness/fingerprints { username, finger }
   * Finger→uuid resolution, self/admin gate, on-box delete and profile.yml removal
   * are all enforced by ManageAccess.remove.
   */
  router.delete('/fingerprints', asyncHandler(async (req, res) => {
    const householdId = req.query.household || defaultHouseholdId;
    if (!manageAccess) return res.status(503).json({ error: 'manage-access-unavailable' });
    return sendFingerprintOutcome(res, await manageAccess.remove(householdId, req.body || {}));
  }));

  // -------------------- Workouts (Build authors, Run performs) --------------------
  // Household-scoped, not per-user: the garage screen is shared equipment, so a workout
  // one person builds must be runnable by whoever walks in next. The record's `author`
  // field carries the credit instead of the file path.

  /**
   * GET /api/fitness/workouts - Summaries for the Build picker.
   * Summaries, not bodies: a picker needs a title, an author and how much work it is,
   * and shipping every set and rep of every workout to draw a list is the whole shelf
   * on the wire for one screen.
   */
  router.get('/workouts', asyncHandler(async (req, res) => {
    if (!workoutCatalog) return res.status(503).json({ error: 'workouts unavailable' });
    const householdId = req.query.household || defaultHouseholdId;
    return res.json({ workouts: workoutCatalog.list(householdId) });
  }));

  /**
   * GET /api/fitness/workouts/:id - One full workout, for Build to edit and Run to walk.
   */
  router.get('/workouts/:id', asyncHandler(async (req, res) => {
    if (!workoutCatalog) return res.status(503).json({ error: 'workouts unavailable' });
    const householdId = req.query.household || defaultHouseholdId;
    const workout = workoutCatalog.get(req.params.id, householdId);
    if (!workout) return res.status(404).json({ error: 'not found' });
    return res.json({ workout });
  }));

  /**
   * POST /api/fitness/workouts - Create or update. Body is the workout, or { workout }.
   *
   * A payload carrying an id updates that workout; without one, an id is generated. The
   * 400 path names EVERY unknown exercise slug: a workout pointing at an exercise that
   * does not exist would fail at Run time, in front of someone mid-session, so it is
   * refused here where the person who typed it can still fix it — all of them at once.
   */
  router.post('/workouts', asyncHandler(async (req, res) => {
    if (!saveWorkout) return res.status(503).json({ error: 'workouts unavailable' });
    const householdId = req.query.household || defaultHouseholdId;
    const body = req.body || {};
    const result = saveWorkout.execute({ workout: body.workout ?? body, householdId });
    if (!result.ok) {
      return res.status(400).json({ error: result.error, unknownSlugs: result.unknownSlugs });
    }
    return res.status(result.created ? 201 : 200).json({
      id: result.id, created: result.created, createdAt: result.createdAt, updatedAt: result.updatedAt,
    });
  }));

  /**
   * GET /api/fitness/workouts/:id/run - Everything Run needs for a SAVED workout.
   *
   * `{ workout: {id, title}, steps, exercises, missingSlugs }` — the flat ordered step
   * list `expandWorkout` produces, plus the slug -> { name, image } lookup joined against
   * the corpus server-side. The client renders it; it never re-derives the ordering (see
   * PrepareWorkoutRun, and the domain module's own docblock).
   *
   * A GET on the workout's own path because that is what it is: a derived READ of one
   * stored workout, idempotent, deep-linkable, and reachable from the picker without
   * passing through Build.
   */
  router.get('/workouts/:id/run', asyncHandler(async (req, res) => {
    if (!prepareWorkoutRun) return res.status(503).json({ error: 'workouts unavailable' });
    const householdId = req.query.household || defaultHouseholdId;
    const result = prepareWorkoutRun.execute({ workoutId: req.params.id, householdId });
    if (!result.ok) {
      return res.status(result.reason === 'unknown_workout' ? 404 : 400)
        .json({ error: result.error, reason: result.reason });
    }
    return res.json(result);
  }));

  /**
   * POST /api/fitness/workouts/run - The same payload for an UNSAVED draft.
   *
   * Body is the authored workout, or `{ workout }`. Build's "Start workout" is its own
   * target beside "Save", so a plan assembled at the rack normally has no id yet; making
   * Run depend on a save would either break that gesture or force an implicit save that
   * litters the shared shelf with plans nobody chose to keep. Nothing is persisted here.
   *
   * A POST rather than a GET because the workout travels in the body — and because this
   * one is not addressable: there is no resource to name.
   *
   * Unknown slugs are NOT rejected here (that is `POST /workouts`'s job, at authoring
   * time). A slug the corpus has since dropped degrades: the step still runs, the lookup
   * carries no entry, and the slug is named in `missingSlugs`.
   */
  router.post('/workouts/run', asyncHandler(async (req, res) => {
    if (!prepareWorkoutRun) return res.status(503).json({ error: 'workouts unavailable' });
    const householdId = req.query.household || defaultHouseholdId;
    const body = req.body || {};
    const result = prepareWorkoutRun.execute({ workout: body.workout ?? body, householdId });
    if (!result.ok) {
      return res.status(400).json({ error: result.error, reason: result.reason });
    }
    return res.json(result);
  }));

  /**
   * DELETE /api/fitness/workouts/:id - 404 on an unknown id rather than a silent 204:
   * the caller's picker is then known to be stale, instead of reporting success for a
   * workout that was never there.
   */
  router.delete('/workouts/:id', asyncHandler(async (req, res) => {
    if (!workoutCatalog) return res.status(503).json({ error: 'workouts unavailable' });
    const householdId = req.query.household || defaultHouseholdId;
    if (!workoutCatalog.delete(req.params.id, householdId)) {
      return res.status(404).json({ error: 'not found' });
    }
    return res.json({ ok: true, id: req.params.id });
  }));

  // -------------------- Exercises (the corpus Browse reads) --------------------
  // Read-only and household-agnostic: the corpus is a reference work, identical for
  // everyone, served from one in-memory copy loaded at boot.

  /**
   * GET /api/fitness/exercises - Browse.
   *
   * Facets: `group`, `muscle`, `equipment` (slugs) and `q` (free text over name and
   * slug). OR within a facet, AND across facets — `?group=chest&group=back` is either
   * group, `?group=chest&equipment=barbell` is both.
   *
   * The query VALUES are handed to the use case exactly as Express's `qs` parsed them.
   * Coercing a repeated key to a string here (`String(req.query.group)` → 'chest,back')
   * matches nothing, and dropping a non-scalar as "unfiltered" answers with the whole
   * 1,296-record corpus. Both fail silently, which is why neither happens here.
   *
   * Returns summaries, not bodies — see PROJECTION in the use case.
   */
  router.get('/exercises', asyncHandler(async (req, res) => {
    if (!browseExerciseLibrary) return res.status(503).json({ error: 'exercise library unavailable' });
    return res.json(browseExerciseLibrary.listExercises(
      parseExerciseFacets(req.query),
    ));
  }));

  /**
   * GET /api/fitness/exercises/taxonomy - Every facet value the rails can offer.
   *
   * MUST stay above /exercises/:slug — Express matches in declaration order, and below
   * it this path would be read as a request for an exercise slugged "taxonomy" and 404.
   */
  router.get('/exercises/taxonomy', asyncHandler(async (req, res) => {
    if (!browseExerciseLibrary) return res.status(503).json({ error: 'exercise library unavailable' });
    return res.json(browseExerciseLibrary.taxonomy());
  }));

  /**
   * GET /api/fitness/exercises/:slug - One exercise, in full.
   *
   * The 404 carries the library status: a deep link into an unbuilt corpus is a 404 for
   * every slug, and "not found" alone would send someone hunting for a missing exercise
   * instead of running the indexer.
   */
  router.get('/exercises/:slug', asyncHandler(async (req, res) => {
    if (!browseExerciseLibrary) return res.status(503).json({ error: 'exercise library unavailable' });
    const exercise = browseExerciseLibrary.getExercise(req.params.slug);
    if (!exercise) {
      return res.status(404).json({
        error: 'not found',
        slug: req.params.slug,
        library: browseExerciseLibrary.libraryStatus(),
      });
    }
    return res.json({ exercise });
  }));

  // Shared error middleware: expected errors (mapped by err.name/err.status) →
  // { error:'<message>', code } ; unexpected 500s → { error:'Internal server error',
  // code:'INTERNAL' } with the real error logged, not leaked to the client.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createFitnessRouter;
