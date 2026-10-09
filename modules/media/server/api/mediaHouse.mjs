/**
 * Media house router — screens, routines, how playback started, played
 * earlier and suggestions. Mounted under /api/v1/media beside the media
 * router (see docs/reference/media/media-app-technical.md §2.5–2.9).
 *
 * Screens (RQ-HOUSE-06/08, RQ-AUTO-02):
 * - GET    /screens                     — { screens, notSeenLately, retired }
 * - POST   /screens                     — add { name, room? }
 * - POST   /screens/announce            — a screen reporting in { id, name?, room? }
 * - GET    /screens/:id                 — one screen + the routines that target it
 * - PATCH  /screens/:id                 — { name?, room?, onCollision?, confirm? }
 * - GET|PUT /screens/rooms/adjacency    — neighbouring rooms { room, neighbours: [room] } (drift warning)
 * - POST   /screens/:id/merge           — { into, confirm } fold this duplicate into another screen
 * - POST   /screens/:id/unmerge         — undo a merge (:id = the merged duplicate)
 * - POST   /screens/:id/retire          — { confirm? }
 * - POST   /screens/:id/restore
 * - GET    /screens/:id/routines        — routines that target the screen
 *
 * Screen playback (RQ-HOUSE-07, RQ-FIND-17):
 * - GET    /started-by                  — how playback started on every screen playing now
 * - GET    /screens/:id/started-by      — how this screen's playback started
 * - GET    /screens/:id/played-earlier  — this screen's plays, newest first (?limit=&before=)
 *
 * Suggestions (RQ-FIND-16):
 * - GET    /suggestions                 — start-page rows (?deviceId=, else the X-Daylight-Device header)
 *
 * Routines (RQ-AUTO-02, RQ-AUTO-05):
 * - GET    /routines                    — { routines, sources }
 * - PUT    /routines/catalog            — import { routines, source? } (extracted where the HA config is readable)
 * - GET    /routines/history            — recent routine starts (?limit=&deviceId=&routineId=)
 * - GET    /routines/flags              — routines pointed at screens that are off/unreachable/retired
 *
 * Every route takes the optional `?household=<id>`. Each section answers 501
 * when its service is not wired.
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const SCREEN_ID = /^(fleet|browser|screen):[A-Za-z0-9._-]{1,96}$/;

const ERROR_STATUS = {
  INVALID_NAME: 400,
  INVALID_ROOM: 400,
  INVALID_SCREEN_ID: 400,
  INVALID_MERGE: 400,
  INVALID_ROUTINES: 400,
  SCREEN_NOT_FOUND: 404,
  NAME_TAKEN: 409,
  SCREEN_MERGED: 409,
  ROUTINES_TARGET: 409,
  CONFIRM_REQUIRED: 409,
  NOT_MERGED: 404,
  HOUSEHOLD_NOT_FOUND: 404,
};

function sendDomainError(res, error) {
  const status = ERROR_STATUS[error?.code];
  if (!status) return false;
  res.status(status).json({ error: error.message, code: error.code, ...(error.details || {}) });
  return true;
}

/**
 * @param {Object} config
 * @param {Object} [config.screenRegistry] - ScreenRegistryService
 * @param {Object} [config.routineCatalog] - RoutineCatalogService
 * @param {Object} [config.routineHistory] - RoutineHistoryService
 * @param {Object} [config.screenPlayback] - ScreenPlaybackService
 * @param {Object} [config.suggestions] - MediaSuggestionsService
 * @param {(householdId: string) => boolean} [config.householdExists] - unknown `?household=` → 404
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createMediaHouseRouter({ screenRegistry = null, routineCatalog = null, routineHistory = null,
  screenPlayback = null, suggestions = null, householdExists = null, logger = console } = {}) {
  const router = express.Router();

  // `?household=` must name a household: 404 before any service touches paths.
  router.use((req, res, next) => {
    const household = req.query.household;
    if (household === undefined || !householdExists) return next();
    if (typeof household === 'string' && household && householdExists(household)) return next();
    return res.status(404).json({ error: `Household not found: ${household}`, code: 'HOUSEHOLD_NOT_FOUND' });
  });
  const hid = (req) => (typeof req.query.household === 'string' && req.query.household ? req.query.household : undefined);
  const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  const requireService = (service, name) => (req, res, next) => {
    if (service) return next();
    return res.status(501).json({ error: `${name} not configured` });
  };

  /** Run a handler, mapping registry rule violations to 4xx. */
  const guarded = (fn) => asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (sendDomainError(res, error)) {
        logger.debug?.('media.house.rejected', { path: req.path, code: error.code });
        return;
      }
      throw error;
    }
  });

  // ── Screens ──────────────────────────────────────────────────────────────
  const screens = requireService(screenRegistry, 'Screen registry');

  router.get('/screens', screens, guarded(async (req, res) => {
    res.json(await screenRegistry.list({ householdId: hid(req) }));
  }));

  router.post('/screens', screens, guarded(async (req, res) => {
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: 'name is required', code: 'INVALID_NAME' });
    res.status(201).json(await screenRegistry.add({ householdId: hid(req), name, room: str(req.body?.room) }));
  }));

  // Which rooms neighbour which (the several-screen drift warning). Declared before /screens/:id.
  router.get('/screens/rooms/adjacency', screens, guarded(async (req, res) => {
    res.json({ roomAdjacency: await screenRegistry.roomAdjacency({ householdId: hid(req) }) });
  }));

  router.put('/screens/rooms/adjacency', screens, guarded(async (req, res) => {
    const room = str(req.body?.room);
    if (!room) return res.status(400).json({ error: 'room is required', code: 'INVALID_ROOM' });
    res.json(await screenRegistry.setRoomNeighbours({ householdId: hid(req), room, neighbours: req.body?.neighbours }));
  }));

  router.post('/screens/announce', screens, guarded(async (req, res) => {
    const id = str(req.body?.id) || str(req.get('X-Daylight-Device'));
    if (!id) return res.status(400).json({ error: 'id is required', code: 'INVALID_SCREEN_ID' });
    // `playing` / `previousId` (the browser's old header token) come from the app;
    // an unnamed browser that never played is not registered (`screen: null`).
    res.json({ screen: await screenRegistry.announce({
      householdId: hid(req), id, name: str(req.body?.name), room: str(req.body?.room),
      playing: req.body?.playing === true, previousId: str(req.body?.previousId),
    }) });
  }));

  router.get('/screens/:id', screens, guarded(async (req, res) => {
    const householdId = hid(req);
    const screen = await screenRegistry.get({ householdId, id: req.params.id });
    if (!screen) return res.status(404).json({ error: 'Unknown screen', code: 'SCREEN_NOT_FOUND' });
    res.json({ screen, routines: await screenRegistry.routinesFor({ householdId, id: screen.id }) });
  }));

  router.patch('/screens/:id', screens, guarded(async (req, res) => {
    const householdId = hid(req);
    const body = req.body || {};
    const hasName = body.name !== undefined;
    const hasRoom = body.room !== undefined;
    if (!hasName && !hasRoom) return res.status(400).json({ error: 'name or room is required', code: 'INVALID_NAME' });
    if (body.onCollision !== undefined && !['reject', 'suffix'].includes(body.onCollision)) {
      return res.status(400).json({ error: 'onCollision must be reject or suffix', code: 'INVALID_NAME' });
    }
    let result = null;
    if (hasName) {
      result = await screenRegistry.rename({
        householdId, id: req.params.id, name: body.name, onCollision: body.onCollision ?? 'reject', confirm: body.confirm === true,
      });
    }
    if (hasRoom) {
      const roomResult = await screenRegistry.setRoom({ householdId, id: req.params.id, room: body.room });
      result = { routines: [], ...result, screen: roomResult.screen };
    }
    res.json(result);
  }));

  router.post('/screens/:id/merge', screens, guarded(async (req, res) => {
    const into = str(req.body?.into);
    if (!into) return res.status(400).json({ error: 'into is required', code: 'INVALID_MERGE' });
    res.json(await screenRegistry.merge({ householdId: hid(req), fromId: req.params.id, intoId: into, confirm: req.body?.confirm === true }));
  }));

  router.post('/screens/:id/unmerge', screens, guarded(async (req, res) => {
    res.json(await screenRegistry.unmerge({ householdId: hid(req), id: req.params.id }));
  }));

  router.post('/screens/:id/retire', screens, guarded(async (req, res) => {
    res.json(await screenRegistry.retire({ householdId: hid(req), id: req.params.id, confirm: req.body?.confirm === true }));
  }));

  router.post('/screens/:id/restore', screens, guarded(async (req, res) => {
    res.json(await screenRegistry.restore({ householdId: hid(req), id: req.params.id }));
  }));

  router.get('/screens/:id/routines', screens, guarded(async (req, res) => {
    res.json({ items: await screenRegistry.routinesFor({ householdId: hid(req), id: req.params.id }) });
  }));

  // ── Screen playback ──────────────────────────────────────────────────────
  const playback = requireService(screenPlayback, 'Screen playback');

  router.get('/started-by', playback, guarded(async (req, res) => {
    res.json(await screenPlayback.startedByAll({ householdId: hid(req) }));
  }));

  router.get('/screens/:id/started-by', playback, guarded(async (req, res) => {
    res.json(await screenPlayback.startedBy({ householdId: hid(req), deviceId: req.params.id }));
  }));

  router.get('/screens/:id/played-earlier', playback, guarded(async (req, res) => {
    const before = str(req.query.before);
    if (before && !Number.isFinite(Date.parse(before))) {
      return res.status(400).json({ error: 'before must be an ISO-8601 timestamp', code: 'INVALID_QUERY' });
    }
    res.json(await screenPlayback.playedEarlier({ householdId: hid(req), deviceId: req.params.id, limit: req.query.limit, before }));
  }));

  // ── Suggestions ──────────────────────────────────────────────────────────
  router.get('/suggestions', requireService(suggestions, 'Suggestions'), guarded(async (req, res) => {
    const deviceId = str(req.query.deviceId) || str(req.get('X-Daylight-Device'));
    if (deviceId && !SCREEN_ID.test(deviceId)) {
      return res.status(400).json({ error: 'deviceId must be a screen id (fleet:|browser:|screen:)', code: 'INVALID_SCREEN_ID' });
    }
    res.json(await suggestions.suggest({ householdId: hid(req), deviceId }));
  }));

  // ── Routines ─────────────────────────────────────────────────────────────
  const catalog = requireService(routineCatalog, 'Routine catalog');
  const history = requireService(routineHistory, 'Routine history');

  router.get('/routines', catalog, guarded(async (req, res) => {
    res.json(await routineCatalog.list({ householdId: hid(req) }));
  }));

  router.put('/routines/catalog', catalog, guarded(async (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.routines)) {
      return res.status(400).json({ error: 'routines (array) is required; push extracted routines, not a config', code: 'INVALID_ROUTINES' });
    }
    res.json(await routineCatalog.importSnapshot({ householdId: hid(req), routines: body.routines, source: str(body.source) || 'import' }));
  }));

  router.get('/routines/history', history, guarded(async (req, res) => {
    res.json(await routineHistory.list({
      householdId: hid(req), limit: req.query.limit, deviceId: str(req.query.deviceId), routineId: str(req.query.routineId),
    }));
  }));

  router.get('/routines/flags', history, guarded(async (req, res) => {
    res.json(await routineHistory.flags({ householdId: hid(req) }));
  }));

  return router;
}

export default createMediaHouseRouter;
