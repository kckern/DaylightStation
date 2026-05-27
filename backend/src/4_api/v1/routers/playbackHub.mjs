/**
 * Playback Hub Router (v1)
 * @module api/v1/routers/playbackHub
 *
 * Thin Express router for /api/v1/playback-hub. Each route resolves a use case
 * from the PlaybackHubContainer, executes with the request body/params, and
 * returns JSON. Domain/application/adapter errors are mapped to HTTP codes via
 * the local error-handler middleware mounted on this router.
 *
 * Error mapping:
 *   - domain ValidationError       → 400
 *   - DomainInvariantError         → 422
 *   - EntityNotFoundError          → 404
 *   - InfrastructureError (any)    → 502
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
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { DomainInvariantError } from '#domains/core/errors/DomainInvariantError.mjs';
import { EntityNotFoundError } from '#domains/core/errors/EntityNotFoundError.mjs';
import { InfrastructureError } from '#system/utils/errors/InfrastructureError.mjs';

const TERMINAL_SKIP_REASONS = new Set(['unreachable', 'not-found']);

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
  if (err instanceof EntityNotFoundError) return 404;
  if (err instanceof DomainInvariantError) return 422;
  if (err instanceof ValidationError) return 400;
  if (err instanceof InfrastructureError) return 502;
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
 * @param {Object} deps.container - PlaybackHubContainer instance
 * @param {Object} [deps.logger] - Logger
 * @returns {import('express').Router}
 */
export function createPlaybackHubRouter({ container, logger = console } = {}) {
  if (!container) {
    throw new Error('createPlaybackHubRouter: container required');
  }

  const router = Router();

  // -- GET /status ----------------------------------------------------------
  router.get('/status', asyncHandler(async (_req, res) => {
    const { slots, fetchedAt } = await container.getHubStatus.execute();
    res.json({
      ok: true,
      slots,
      fetchedAt: fetchedAt instanceof Date ? fetchedAt.toISOString() : fetchedAt,
    });
  }));

  // -- GET /config ----------------------------------------------------------
  router.get('/config', asyncHandler(async (_req, res) => {
    const hubConfig = await container.getHubConfig.execute();
    res.json({
      ok: true,
      config: hubConfig.toYaml(),
    });
  }));

  // -- POST /command --------------------------------------------------------
  router.post('/command', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const result = await container.sendHubCommand.execute({
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
    const device = await container.updateDeviceConfig.execute({
      color: req.params.color,
      patch: req.body ?? {},
    });
    res.json({
      ok: true,
      device: device.toYaml(),
    });
  }));

  // -- POST /scheduled (create) --------------------------------------------
  router.post('/scheduled', asyncHandler(async (req, res) => {
    const fire = await container.saveScheduledFire.execute({
      fire: req.body ?? {},
    });
    res.status(201).json({
      ok: true,
      fire: serializeScheduledFire(fire),
    });
  }));

  // -- PUT /scheduled/:id (upsert) -----------------------------------------
  router.put('/scheduled/:id', asyncHandler(async (req, res) => {
    const fire = await container.saveScheduledFire.execute({
      fire: { ...(req.body ?? {}), id: req.params.id },
    });
    res.status(200).json({
      ok: true,
      fire: serializeScheduledFire(fire),
    });
  }));

  // -- DELETE /scheduled/:id -----------------------------------------------
  router.delete('/scheduled/:id', asyncHandler(async (req, res) => {
    await container.deleteScheduledFire.execute({ id: req.params.id });
    res.status(204).end();
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

export default createPlaybackHubRouter;
