/**
 * Playback Hub Router (v1)
 * @module api/v1/routers/playbackHub
 *
 * Thin Express router for /api/v1/playback-hub. Each route resolves a use case
 * from the injected Playback Hub operations, executes with the request body/params, and
 * returns JSON. Domain/application/adapter errors are mapped to HTTP codes via
 * the local error-handler middleware mounted on this router.
 *
 * Error mapping:
 *   - domain ValidationError       → 400
 *   - DomainInvariantError         → 422
 *   - EntityNotFoundError          → 404
 *   - InfrastructureError HUB_TIMEOUT → 504
 *   - InfrastructureError (other)  → 502
 *   - unhandled                    → 500
 *
 * Partial-failure HTTP coding for POST /command (per design):
 *   - applied.length > 0                                            → 200
 *   - applied.length === 0 && every skip reason is 'unreachable' or
 *     'not-found'                                                   → 502
 *   - otherwise (e.g. all-contention, mixed)                        → 200
 */

import { Router } from 'express';

import { asyncHandler } from '#system/http/middleware/index.mjs';
import { InfrastructureError } from '#system/utils/errors/InfrastructureError.mjs';

const TERMINAL_SKIP_REASONS = new Set(['unreachable', 'not-found']);

/** Translate the public HTTP patch vocabulary into an application command. */
function mapDeviceConfigPatch(body = {}) {
  const patch = {};
  for (const key of ['position', 'color', 'mac', 'class']) {
    if (key in body) patch[key] = body[key];
  }
  if ('volume' in body) patch.volumeBounds = body.volume;
  // Retain the existing public alias while keeping HTTP vocabulary out of the
  // application boundary.
  if ('volumeBounds' in body) patch.volumeBounds = body.volumeBounds;
  if ('schedules' in body) patch.continuousSchedules = body.schedules;
  if ('continuousSchedules' in body) patch.continuousSchedules = body.continuousSchedules;
  if ('ha_entity_id' in body) patch.haEntityId = body.ha_entity_id;
  if ('haEntityId' in body) patch.haEntityId = body.haEntityId;
  if ('ha_turn_off_on_stop' in body) patch.haTurnOffOnStop = body.ha_turn_off_on_stop;
  if ('haTurnOffOnStop' in body) patch.haTurnOffOnStop = body.haTurnOffOnStop;
  return patch;
}

/**
 * Serialize a CommandResult value object for the wire.
 * Accepts either a CommandResult VO or a plain object with the same shape.
 */
function serializeCommandResult(result) {
  return {
    applied: [...(result.applied ?? [])],
    skipped: (result.skipped ?? []).map(({ color, reason }) => ({ color, reason })),
  };
}

/**
 * Decide partial-failure HTTP status for POST /command.
 * @param {{applied: string[], skipped: Array<{color: string, reason: string}>}} result
 * @returns {200 | 502}
 */
function commandHttpStatus(result) {
  const applied = result.applied ?? [];
  const skipped = result.skipped ?? [];
  if (applied.length > 0) return 200;
  if (skipped.length === 0) return 200;
  // All-skipped: 502 only when every skip is terminal (unreachable / not-found).
  const allTerminal = skipped.every((s) => TERMINAL_SKIP_REASONS.has(s.reason));
  return allTerminal ? 502 : 200;
}

/**
 * Map a thrown error to an HTTP status code per the design table.
 * @param {Error} err
 * @returns {number}
 */
export function statusForError(err) {
  // Matched BY NAME, not by `instanceof`. The `api-no-domains` rule forbids
  // `4_api` from importing the domain layer, and `errorHandler.mjs` states the
  // alternative in its own comment — routers that cannot import domain classes
  // key on `err.name` at their boundary, which is exactly what its
  // `getHttpStatusByName` does. Every one of these three domain errors sets
  // `this.name` in its constructor, so the mapping is unchanged for real
  // instances; it additionally now works for a plain Error stamped with the
  // same name, which is what a router without the import can throw.
  if (err?.name === 'EntityNotFoundError') return 404;
  if (err?.name === 'DomainInvariantError') return 422;
  if (err?.name === 'ValidationError') return 400;
  if (err instanceof InfrastructureError) {
    return err?.code === 'HUB_TIMEOUT' ? 504 : 502;
  }
  return 500;
}

/**
 * Local error-handler middleware. Mounted last on the router. Express
 * dispatches here when an async handler rejects via `asyncHandler`.
 */
export function mapPlaybackHubErrors(err, req, res, _next) {
  const status = statusForError(err);
  res.status(status).json({
    ok: false,
    error: err?.message ?? 'unknown error',
    code: err?.code ?? null,
  });
}

/**
 * Create the playback-hub Express router.
 *
 * @param {Object} deps
 * @param {Object} deps.operations - Playback Hub application use cases
 * @param {Object} [deps.logger] - Logger
 * @returns {import('express').Router}
 */
export function createPlaybackHubRouter({ operations, logger = console } = {}) {
  if (!operations) {
    throw new Error('createPlaybackHubRouter: operations required');
  }

  const router = Router();

  // -- GET /status ----------------------------------------------------------
  router.get('/status', asyncHandler(async (_req, res) => {
    const { slots, fetchedAt } = await operations.getHubStatus.execute();
    res.json({
      ok: true,
      slots: (slots ?? []).map(serializeSlotStatus),
      fetchedAt: fetchedAt instanceof Date ? fetchedAt.toISOString() : fetchedAt,
    });
  }));

  // -- GET /config ----------------------------------------------------------
  router.get('/config', asyncHandler(async (_req, res) => {
    const hubConfig = await operations.getHubConfig.execute();
    res.json({
      ok: true,
      config: serializeHubConfig(hubConfig),
    });
  }));

  // -- POST /command --------------------------------------------------------
  router.post('/command', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const result = await operations.sendHubCommand.execute({
      action: body.action,
      target: body.target,
      contentId: body.contentId ?? null,
      volume: body.volume ?? null,
      durationMin: body.durationMin ?? null,
      resumePrevious: body.resumePrevious ?? false,
    });
    const payload = serializeCommandResult(result);
    const status = commandHttpStatus(payload);
    res.status(status).json({ ok: true, ...payload });
  }));

  // -- PATCH /devices/:color ------------------------------------------------
  router.patch('/devices/:color', asyncHandler(async (req, res) => {
    const device = await operations.updateDeviceConfig.execute({
      color: req.params.color,
      patch: mapDeviceConfigPatch(req.body ?? {}),
    });
    res.json({
      ok: true,
      device: serializeHubDevice(device),
    });
  }));

  // -- POST /scheduled (create) --------------------------------------------
  router.post('/scheduled', asyncHandler(async (req, res) => {
    const fire = await operations.saveScheduledFire.execute({
      fire: req.body ?? {},
    });
    res.status(201).json({
      ok: true,
      fire: serializeScheduledFire(fire),
    });
  }));

  // -- PUT /scheduled/:id (upsert) -----------------------------------------
  router.put('/scheduled/:id', asyncHandler(async (req, res) => {
    const fire = await operations.saveScheduledFire.execute({
      fire: { ...(req.body ?? {}), id: req.params.id },
    });
    res.status(200).json({
      ok: true,
      fire: serializeScheduledFire(fire),
    });
  }));

  // -- DELETE /scheduled/:id -----------------------------------------------
  router.delete('/scheduled/:id', asyncHandler(async (req, res) => {
    await operations.deleteScheduledFire.execute({ id: req.params.id });
    res.status(204).end();
  }));

  // -- GET /verify/:color ---------------------------------------------------
  router.get('/verify/:color', asyncHandler(async (req, res) => {
    const payload = await operations.verifyAudioFlowing.execute({
      color: req.params.color,
    });
    res.json(payload);
  }));

  // Error handler (must be mounted last).
  router.use((err, req, res, next) => {
    const status = statusForError(err);
    if (status >= 500) {
      logger.error?.('playbackHub.error', {
        method: req.method,
        path: req.path,
        message: err?.message,
        code: err?.code,
        stack: err?.stack,
      });
    } else {
      logger.warn?.('playbackHub.error', {
        method: req.method,
        path: req.path,
        message: err?.message,
        code: err?.code,
        status,
      });
    }
    mapPlaybackHubErrors(err, req, res, next);
  });

  return router;
}

/**
 * Serialize a SlotStatus VO (or a plain object passthrough) into the wire
 * shape documented by the design's "Event shape" snapshot example. Handles
 * both real VOs (with private fields exposed via getters) and plain objects
 * (e.g. from tests).
 */
function serializeSlotStatus(slot) {
  if (slot && typeof slot === 'object') {
    // If the object already has its fields enumerable (plain object / from
    // hub JSON), return a defensive copy with the documented keys present.
    return {
      position: slot.position,
      color: slot.color,
      bt_connected: slot.bt_connected,
      paused: slot.paused,
      now_playing: slot.now_playing ?? null,
      volume: slot.volume,
      playlist_pos: slot.playlist_pos,
      playlist_count: slot.playlist_count,
      armed_source: slot.armed_source ?? null,
    };
  }
  return slot;
}

/**
 * Serialize a ScheduledFire entity for the wire. Matches the YAML shape used
 * by HubConfig.toYaml() for `scheduled` entries.
 */
function serializeScheduledFire(fire) {
  const out = {
    id: fire.id,
    time: fire.time,
    target: fire.target,
    queue: fire.queue.toString(),
    days: fire.days.value,
  };
  if (fire.durationMin !== null && fire.durationMin !== undefined) {
    out.duration_min = fire.durationMin;
  }
  if (fire.volumeOverride !== null && fire.volumeOverride !== undefined) {
    out.volume_override = fire.volumeOverride;
  }
  return out;
}

function serializeVolumeBounds(bounds) {
  const out = {};
  for (const key of ['default', 'min', 'max']) {
    if (bounds.hasExplicit(key)) out[key] = bounds[key];
  }
  return out;
}

function serializeHubDevice(device) {
  const out = {
    slot: device.position.value,
    color: device.color.value,
    mac: device.mac,
    class: device.class.value,
  };
  if (device.haEntityId !== null) out.ha_entity_id = device.haEntityId;
  if (device.haTurnOffOnStop) out.ha_turn_off_on_stop = true;
  const volume = serializeVolumeBounds(device.volumeBounds);
  if (Object.keys(volume).length > 0) out.volume = volume;
  if (device.continuousSchedules.length > 0) {
    out.schedules = device.continuousSchedules.map(schedule => {
      const entry = { start: schedule.start, end: schedule.end, queue: schedule.queue.toString() };
      if (schedule.shuffle) entry.shuffle = true;
      return entry;
    });
  }
  if (device.extras !== null) {
    for (const key of Object.keys(device.extras)) {
      if (!(key in out)) out[key] = device.extras[key];
    }
  }
  return out;
}

function serializeHubConfig(config) {
  const out = { devices: config.devices.map(serializeHubDevice) };
  if (config.scheduledFires.length > 0) {
    out.scheduled = config.scheduledFires.map(serializeScheduledFire);
  }
  if (config.daylightStation !== null) out.daylight_station = { ...config.daylightStation };
  return out;
}

export default createPlaybackHubRouter;
