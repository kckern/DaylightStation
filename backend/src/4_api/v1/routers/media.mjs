/**
 * Media API Router
 *
 * Endpoints:
 * - GET    /config                 — Load media browse config
 * - GET    /queue                  — Load current queue
 * - PUT    /queue                  — Replace entire queue
 * - POST   /queue/items            — Add items to queue
 * - DELETE  /queue/items/:queueId  — Remove item from queue
 * - PATCH  /queue/items/reorder    — Reorder an item
 * - PATCH  /queue/position         — Set playback position
 * - PATCH  /queue/state            — Update shuffle / repeat / volume
 * - DELETE  /queue                 — Clear the queue
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';

/**
 * Factory function that returns an Express Router for media queue endpoints.
 *
 * @param {Object} config
 * @param {Object} config.mediaQueueService - MediaQueueService instance
 * @param {Object} config.configService - ConfigService instance (for browse config)
 * @param {Function} config.contentIdResolver - Resolves content IDs (reserved for future use)
 * @param {Function} config.broadcastEvent - (eventName, payload) => void
 * @param {Object} config.logger - Structured logger
 * @returns {express.Router}
 */
export function createMediaRouter(config) {
  const {
    mediaQueueService,
    configService,
    contentIdResolver,
    broadcastEvent,
    logger = console,
  } = config;

  const router = express.Router();

  // ── Internal helpers ───────────────────────────────────────────

  /**
   * Extract household ID from query params (optional).
   * @param {express.Request} req
   * @returns {string|undefined}
   */
  function resolveHid(req) {
    return req.query.household || undefined;
  }

  /**
   * Broadcast a queue mutation to all connected clients.
   * @param {MediaQueue} queue
   * @param {string} [mutationId]
   */
  function broadcast(queue, mutationId) {
    broadcastEvent('media:queue', { ...queue.toJSON(), mutationId });
  }

  /**
   * Returns true if value is a non-negative integer (0, 1, 2, ...).
   * Rejects floats, negatives, strings, null, undefined.
   */
  function isNonNegativeInt(value) {
    return Number.isInteger(value) && value >= 0;
  }

  /**
   * Returns true if value is an integer (includes negatives, for step).
   */
  function isInt(value) {
    return Number.isInteger(value);
  }

  // ── 0. GET /config ────────────────────────────────────────────

  router.get('/config', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const appConfig = configService.getHouseholdAppConfig(hid, 'media') || {};
    res.json({
      browse: appConfig.browse || [],
      searchScopes: appConfig.searchScopes || [],
    });
  }));

  // ── 1. GET /queue ──────────────────────────────────────────────

  router.get('/queue', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const queue = await mediaQueueService.load(hid);
    res.json(queue.toJSON());
  }));

  // ── 2. PUT /queue ──────────────────────────────────────────────

  router.put('/queue', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const { items, position, shuffle, repeat, volume, mutationId } = req.body;
    const queue = new MediaQueue({ items, position, shuffle, repeat, volume });
    await mediaQueueService.replace(queue, hid);
    broadcast(queue, mutationId);
    res.json(queue.toJSON());
  }));

  // ── 3. POST /queue/items ───────────────────────────────────────

  router.post('/queue/items', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const { items, placement, mutationId } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }

    const added = await mediaQueueService.addItems(items, placement || 'end', hid);
    const queue = await mediaQueueService.load(hid);
    broadcast(queue, mutationId);
    res.json({ added, queue: queue.toJSON() });
  }));

  // ── 4. DELETE /queue/items/:queueId ────────────────────────────

  router.delete('/queue/items/:queueId', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const { queueId } = req.params;
    const mutationId = req.body?.mutationId || req.query.mutationId;
    const queue = await mediaQueueService.removeItem(queueId, hid);
    broadcast(queue, mutationId);
    res.json(queue.toJSON());
  }));

  // ── 5. PATCH /queue/items/reorder ──────────────────────────────

  router.patch('/queue/items/reorder', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const { queueId, toIndex, mutationId } = req.body;
    const queue = await mediaQueueService.reorder(queueId, toIndex, hid);
    broadcast(queue, mutationId);
    res.json(queue.toJSON());
  }));

  // ── 6. POST /queue/advance ─────────────────────────────────────
  // Delegates to MediaQueue.advance() — honours repeat, shuffle, and step direction.
  // Use this instead of PATCH /queue/position for end-of-track and manual skip.

  router.post('/queue/advance', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const { step = 1, auto = false, mutationId } = req.body;

    if (!isInt(step)) {
      return res.status(400).json({ error: 'step must be an integer' });
    }

    const queue = await mediaQueueService.advance(step, { auto }, hid);
    broadcast(queue, mutationId);
    res.json(queue.toJSON());
  }));

  // ── 7. PATCH /queue/position ───────────────────────────────────
  // Direct position setter — use only for jump-to-index (tapping a queue item).
  // For next/prev/auto-advance use POST /queue/advance.

  router.patch('/queue/position', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const { position, mutationId } = req.body;

    if (!isNonNegativeInt(position)) {
      return res.status(400).json({ error: 'position must be a non-negative integer' });
    }

    const queue = await mediaQueueService.setPosition(position, hid);
    broadcast(queue, mutationId);
    res.json(queue.toJSON());
  }));

  // ── 7. PATCH /queue/state ──────────────────────────────────────

  router.patch('/queue/state', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const { shuffle, repeat, volume, mutationId } = req.body;

    // Only include defined fields in the state object
    const state = {};
    if (shuffle !== undefined) state.shuffle = shuffle;
    if (repeat !== undefined) state.repeat = repeat;
    if (volume !== undefined) state.volume = volume;

    const queue = await mediaQueueService.updateState(state, hid);
    broadcast(queue, mutationId);
    res.json(queue.toJSON());
  }));

  // ── 8. DELETE /queue ───────────────────────────────────────────

  router.delete('/queue', asyncHandler(async (req, res) => {
    const hid = resolveHid(req);
    const mutationId = req.body?.mutationId || req.query.mutationId;
    const queue = await mediaQueueService.clear(hid);
    broadcast(queue, mutationId);
    res.json(queue.toJSON());
  }));

  return router;
}

export default createMediaRouter;
