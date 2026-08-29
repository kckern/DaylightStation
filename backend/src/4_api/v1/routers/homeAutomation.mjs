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
 * @param {Object} config.homeAutomationService - Semantic legacy home-control operations
 * @param {Function} [config.getEntropyReport] - Semantic current-household entropy operation
 * @param {Object} [config.eventAggregationService] - Event aggregation service
 * @param {Object} [config.callHomeAssistantService] - Use case wrapping
 *   `haGateway.callService` for the /ha/call and /ha/script/:scriptId
 *   endpoints. Required for those two endpoints; when absent they return 503.
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createHomeAutomationRouter(config) {
  const router = express.Router();
  const {
    homeAutomationService,
    householdId = 'default',
    getEntropyReport,
    eventAggregationService,
    callHomeAssistantService,
    logger = console
  } = config;

  // ===========================================================================
  // TV Control Endpoints
  // ===========================================================================

  /**
   * GET /home-automation/tv/:state — state must be on|off|toggle
   * Control living room TV power
   */
  // Express 5 (path-to-regexp v8) dropped param regexes like :state(on|off|toggle);
  // the value is validated in the handler instead (next() preserves the 404 fall-through).
  router.get('/tv/:state', asyncHandler(async (req, res, next) => {
    if (!['on', 'off', 'toggle'].includes(req.params.state)) return next();
    const outcome = await homeAutomationService.controlTv(req.params.state);
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'TV control not configured (Home Assistant required)' });
    }

    const { state } = req.params;
    logger.info?.('homeAutomation.tv.request', { state });

    return res.json(outcome.value);
  }));

  /**
   * GET /home-automation/office_tv/:state — state must be on|off|toggle
   * Control office TV power
   */
  // Express 5: param regex dropped, validated in handler (see /tv/:state above)
  router.get('/office_tv/:state', asyncHandler(async (req, res, next) => {
    if (!['on', 'off', 'toggle'].includes(req.params.state)) return next();
    const outcome = await homeAutomationService.controlTv(req.params.state, 'office');
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'TV control not configured (Home Assistant required)' });
    }

    const { state } = req.params;
    logger.info?.('homeAutomation.officeTv.request', { state });

    return res.json(outcome.value);
  }));

  // Retired: GET /home-automation/tv (turn on TV + load the legacy /tv app).
  // The living-room TV is driven by the device registry
  // (/api/v1/device/livingroom-tv/load), which loads /screen/living-room. The
  // TVApp is gone; the TV power endpoint (/tv/:state) above stays.

  // ===========================================================================
  // Volume Control Endpoints
  // ===========================================================================

  /**
   * GET /home-automation/vol/:level or /home-automation/volume/:level
   * Control audio volume on remote device
   * Levels: 0-100, +, -, mute, unmute, togglemute, cycle
   */
  const handleVolumeRequest = asyncHandler(async (req, res) => {
    const parsed = parseInt(req.params.level, 10);
    const level = Number.isNaN(parsed) ? req.params.level : parsed;
    const outcome = await homeAutomationService.controlVolume(level);
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'Volume control not configured (Remote exec adapter required)' });
    }

    return res.json(outcome.value);
  });

  router.get('/vol/:level', handleVolumeRequest);
  router.get('/volume/:level', handleVolumeRequest);

  /**
   * GET /home-automation/audio/:device
   * Set audio output device
   */
  router.get('/audio/:device', asyncHandler(async (req, res) => {
    const outcome = await homeAutomationService.setAudioDevice(req.params.device);
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'Audio device control not configured (Remote exec adapter required)' });
    }

    return res.json({ device: req.params.device, ...outcome.value });
  }));

  // ===========================================================================
  // Remote Command Endpoint
  // ===========================================================================

  /**
   * POST /home-automation/cmd
   * Execute arbitrary command on remote host
   */
  router.post('/cmd', asyncHandler(async (req, res) => {
    if (!homeAutomationService.isRemoteExecutionAvailable()) {
      return res.status(503).json({ error: 'Remote command not configured (Remote exec adapter required)' });
    }
    const { cmd } = { ...req.body, ...req.query };

    if (!cmd) {
      return res.status(400).json({ error: 'Command required' });
    }

    const outcome = await homeAutomationService.executeRemote(cmd);
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'Remote command not configured (Remote exec adapter required)' });
    }
    return res.json(outcome.value);
  }));

  // ===========================================================================
  // Keyboard Configuration Endpoint
  // ===========================================================================

  /**
   * GET /home-automation/keyboard{/:keyboard_id}
   * Get keyboard configuration data for a specific keyboard
   * Returns key mappings with labels, functions, and parameters
   */
  router.get('/keyboard{/:keyboard_id}', asyncHandler(async (req, res) => {
    const outcome = homeAutomationService.getKeyboard(req.params.keyboard_id);
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'State file loading not configured' });
    }

    if (outcome.kind === 'not_found') {
      return res.status(404).json({ error: 'Keyboard not found', keyboard_id: req.params.keyboard_id });
    }
    return res.json(outcome.value);
  }));

  // ===========================================================================
  // Data Endpoints (weather, events, entropy)
  // ===========================================================================

  /**
   * GET /home/entropy
   * Get entropy report
   */
  router.get('/entropy', asyncHandler(async (req, res) => {
    if (!getEntropyReport) {
      return res.status(503).json({ error: 'Entropy service not configured' });
    }
    const report = await getEntropyReport();
    res.json(report);
  }));

  /**
   * GET /home/weather
   * Get weather data from state files
   */
  router.get('/weather', asyncHandler(async (req, res) => {
    const outcome = await homeAutomationService.getWeather();
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'State file loading not configured' });
    }

    return res.json(outcome.value);
  }));

  /**
   * GET /home/events
   * Get events data from state files
   */
  router.get('/events', asyncHandler(async (req, res) => {
    if (eventAggregationService) {
      const events = eventAggregationService.getUpcomingEvents();
      return res.json(events);
    }
    const outcome = homeAutomationService.getEvents();
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'Event data not configured' });
    }

    return res.json(outcome.value);
  }));

  // ===========================================================================
  // E-ink agenda feeds (calendar / todos / photo)
  // Shaped for the hardware panel's canned widgets (1_rendering/eink/widgets).
  // ===========================================================================

  /**
   * GET /home/calendar
   * Upcoming calendar events as widget-ready rows: { events: [{ day, time, title }] }.
   */
  router.get('/calendar', asyncHandler(async (req, res) => {
    if (!eventAggregationService) {
      return res.status(503).json({ error: 'Event aggregation not configured' });
    }
    const limit = Math.min(Number(req.query.limit) || 8, 20);
    const events = eventAggregationService.getCalendarAgenda({ limit });

    logger.info?.('home.calendar.served', { count: events.length });
    res.json({ events });
  }));

  /**
   * GET /home/todos
   * Open Todoist tasks as widget-ready rows: { items: [{ text, done:false }] }.
   */
  router.get('/todos', asyncHandler(async (req, res) => {
    if (!eventAggregationService) {
      return res.status(503).json({ error: 'Event aggregation not configured' });
    }
    const limit = Math.min(Number(req.query.limit) || 8, 20);

    const items = eventAggregationService.getTodoAgenda({ limit });

    logger.info?.('home.todos.served', { count: items.length });
    res.json({ items });
  }));

  /**
   * GET /home/photo
   * Picks a random gallery photo (config-driven query, e.g. ?favorites=true) and
   * HOLDS it for ?holdHours (default 12) via a server-side cache, so the e-ink
   * panel's content hash is stable across wakes and it only does the costly e-ink
   * refresh once per hold window. Returns { id, imageUrl, title, date } — the
   * renderer preloads `imageUrl` and renders it for the panel (grey tones on a
   * mono panel, full colour on Spectra-6).
   *
   * `?hold_key=<panelId>` buckets the hold per device, so each panel cycles its
   * OWN favorite instead of every panel showing the one global pick. Omitting it
   * keeps the legacy global hold (one shared photo).
   *
   * `?collection=<name>` draws the candidate pool from a named ArtMode collection
   * in art.yml (e.g. `kids` = Immich photos with ≥2 of the four kids) instead of
   * the default favorites/all search. Only Immich-backed collections are
   * supported; the chosen asset is still loaded via the same `getViewable` path,
   * so the payload shape is unchanged. Absent → legacy favorites/all behavior.
   */
  router.get('/photo', asyncHandler(async (req, res) => {
    const outcome = await homeAutomationService.getPhoto({
      favorites: req.query.favorites === 'true' || req.query.favorites === '1',
      collection: typeof req.query.collection === 'string' ? req.query.collection : '',
      holdHours: Number(req.query.holdHours) > 0 ? Number(req.query.holdHours) : 12,
      holdKey: typeof req.query.hold_key === 'string' ? req.query.hold_key : '',
    });
    if (outcome.kind === 'gallery_unavailable') {
      return res.status(503).json({ error: 'Immich gallery not configured' });
    }
    if (outcome.kind === 'art_unavailable') return res.status(503).json({ error: 'art collections not configured' });
    if (outcome.kind === 'not_found') return res.status(404).json({ error: 'no photos found for query' });
    if (outcome.kind === 'load_failed') return res.status(502).json({ error: 'failed to load chosen photo' });
    return res.json(outcome.value);
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
    if (!callHomeAssistantService) {
      return res.status(503).json({
        ok: false,
        error: 'Home Assistant not configured'
      });
    }

    const { scriptId } = req.params;
    const entityId = scriptId.startsWith('script.') ? scriptId : `script.${scriptId}`;

    logger.info?.('homeAutomation.ha.script.running', { entityId });

    const useCaseResult = await callHomeAssistantService.execute({
      domain: 'script',
      service: 'turn_on',
      data: { entity_id: entityId },
    });

    res.json({ ok: true, entityId, result: useCaseResult.result });
  });

  router.get('/ha/script/:scriptId', haScriptHandler);
  router.post('/ha/script/:scriptId', haScriptHandler);

  /**
   * POST /home-automation/ha/call
   * Generic Home Assistant service-call wrapper. Body: { domain, service, data }.
   * Used by playback-hub to fire switch.turn_on / notify.* without each caller
   * needing to know HA tokens or write its own HA client.
   *
   * Delegates to the `CallHomeAssistantService` use case (DDD layering — the
   * router does not reach into the adapter layer directly).
   */
  router.post('/ha/call', asyncHandler(async (req, res) => {
    if (!callHomeAssistantService) {
      return res.status(503).json({ ok: false, error: 'Home Assistant not configured' });
    }
    const { domain, service, data } = req.body || {};
    if (!domain || !service) {
      return res.status(400).json({ ok: false, error: 'domain and service required' });
    }
    const useCaseResult = await callHomeAssistantService.execute({
      domain,
      service,
      data: data || {},
    });
    res.json({
      ok: true,
      domain: useCaseResult.domain,
      service: useCaseResult.service,
      data: useCaseResult.data,
      result: useCaseResult.result,
    });
  }));

  // ===========================================================================
  // Status Endpoints
  // ===========================================================================

  /**
   * GET /home-automation/status
   * Get status of all home automation adapters
   */
  router.get('/status', (req, res) => {
    res.json(homeAutomationService.getStatus());
  });

  return router;
}

export default createHomeAutomationRouter;
