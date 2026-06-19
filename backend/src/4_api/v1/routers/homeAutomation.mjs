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
import moment from 'moment';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { buildPhotoTitle, formatPhotoDate } from '#adapters/content/gallery/immich/photoLabels.mjs';

// --- Small presentation helpers for the e-ink agenda feeds -------------------
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;

/** Todoist task content is often a markdown link `[text](url)` — keep the text. */
function stripMarkdownLinks(s) {
  return String(s ?? '').replace(MD_LINK, '$1').replace(/\s+/g, ' ').trim();
}

/** Clip to `n` chars with an ellipsis (the eink rows don't wrap). */
function truncate(s, n) {
  const str = String(s ?? '').trim();
  return str.length > n ? `${str.slice(0, n - 1).trimEnd()}…` : str;
}

/** "Today" / "Tmrw" / weekday for a calendar event's start. */
function calDayLabel(m, now) {
  if (m.isSame(now, 'day')) return 'Today';
  if (m.isSame(now.clone().add(1, 'day'), 'day')) return 'Tmrw';
  return m.format('ddd');
}

/** Compact clock label: "9a" / "12:30p" (top-of-hour drops the :00). */
function calTimeLabel(m) {
  const ap = m.hours() < 12 ? 'a' : 'p';
  const t = m.minutes() === 0 ? m.format('h') : m.format('h:mm');
  return `${t}${ap}`;
}

/**
 * Create home automation router
 * @param {Object} config
 * @param {import('#adapters/home-automation/tv/TVControlAdapter.mjs').TVControlAdapter} config.tvAdapter
 * @param {import('#adapters/home-automation/kiosk/KioskAdapter.mjs').KioskAdapter} config.kioskAdapter
 * @param {import('#adapters/home-automation/tasker/TaskerAdapter.mjs').TaskerAdapter} config.taskerAdapter
 * @param {import('#adapters/home-automation/remote-exec/RemoteExecAdapter.mjs').RemoteExecAdapter} config.remoteExecAdapter
 * @param {Function} [config.loadFile] - Function to load state files
 * @param {Function} [config.saveFile] - Function to save state files
 * @param {string} [config.householdId] - Household ID for state files
 * @param {Object} [config.entropyService] - Entropy service for data freshness
 * @param {Object} [config.configService] - Config service for user lookup
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
    eventAggregationService,
    immichAdapter,
    artAdapter,
    callHomeAssistantService,
    logger = console
  } = config;

  // Photo-of-the-day cache for the e-ink panel. A chosen favorite is held for
  // `holdHours` so the panel's content hash stays stable and it does NOT burn
  // battery on a costly e-ink refresh until the hold expires.
  const photoCache = new Map(); // key -> { pickedAt, payload }

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

    const keyboardData = loadFile('config/keyboard') || [];
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
    const weatherData = loadFile('common/weather') || {};
    res.json(weatherData);
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
    if (!loadFile) {
      return res.status(503).json({ error: 'Event data not configured' });
    }

    // loadFile already prepends household path, just use relative path
    const eventsData = loadFile('common/events') || [];
    res.json(eventsData);
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
    const now = moment();
    const startOfToday = now.clone().startOf('day');
    const limit = Math.min(Number(req.query.limit) || 8, 20);

    const events = eventAggregationService.getUpcomingEvents()
      .filter((e) => e.type === 'calendar' && e.start)
      // parseZone keeps each event's own UTC offset (the wall-clock at its place).
      .map((e) => ({ e, m: moment.parseZone(e.start) }))
      .filter(({ m }) => m.isValid() && m.isSameOrAfter(startOfToday))
      .sort((a, b) => a.m.valueOf() - b.m.valueOf())
      .slice(0, limit)
      .map(({ e, m }) => ({
        day: calDayLabel(m, now),
        time: e.allday ? '' : calTimeLabel(m),
        title: truncate(e.summary, 26),
      }));

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

    const items = eventAggregationService.getUpcomingEvents()
      .filter((e) => e.type === 'todoist')
      .map((e) => truncate(stripMarkdownLinks(e.summary), 28))
      .filter(Boolean)
      .slice(0, limit)
      .map((text) => ({ text, done: false }));

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
    if (!immichAdapter) {
      return res.status(503).json({ error: 'Immich gallery not configured' });
    }
    const favorites = req.query.favorites === 'true' || req.query.favorites === '1';
    const collection = typeof req.query.collection === 'string' ? req.query.collection : '';
    const holdHours = Number(req.query.holdHours) > 0 ? Number(req.query.holdHours) : 12;
    const holdMs = holdHours * 3600 * 1000;
    const holdKey = typeof req.query.hold_key === 'string' ? req.query.hold_key : '';
    const key = JSON.stringify({ favorites, collection, holdHours, holdKey });
    const now = Date.now();

    const cached = photoCache.get(key);
    if (cached && now - cached.pickedAt < holdMs) {
      logger.info?.('home.photo.cached', { ageMs: now - cached.pickedAt, holdHours, holdKey, collection });
      return res.json(cached.payload);
    }

    // A named collection resolves through the ArtMode Immich resolver (people +
    // minPeople combination search, favorites, albums, …); otherwise fall back
    // to the legacy direct favorites/all search.
    let ids;
    if (collection) {
      if (!artAdapter?.collectionAssetIds) {
        return res.status(503).json({ error: 'art collections not configured' });
      }
      ids = (await artAdapter.collectionAssetIds(collection)).slice().sort();
    } else {
      const result = await immichAdapter.search({ favorites, mediaType: 'image', take: 1000 });
      ids = (result?.items || [])
        .map((it) => it?.id)
        .filter(Boolean)
        .sort(); // stable order independent of Immich's internal sort
    }
    if (!ids.length) {
      return res.status(404).json({ error: 'no photos found for query' });
    }

    const picked = ids[Math.floor(Math.random() * ids.length)];
    const viewable = await immichAdapter.getViewable(picked);
    if (!viewable) {
      return res.status(502).json({ error: 'failed to load chosen photo' });
    }

    const meta = viewable.metadata || {};
    const people = Array.isArray(meta.people) ? meta.people.map((p) => p.name).filter(Boolean) : [];
    const location = meta.exif?.city || null;
    const when = meta.localDateTime || null; // TZ-contract field for photoLabels
    const payload = {
      id: viewable.id,
      imageUrl: viewable.imageUrl,
      title: buildPhotoTitle(people, location, when),
      date: formatPhotoDate(when) || '',
    };

    photoCache.set(key, { pickedAt: now, payload });
    logger.info?.('home.photo.picked', { id: picked, count: ids.length, holdHours, holdKey, collection });
    res.json(payload);
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
