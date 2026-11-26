import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';

/** Most events one request may carry; a client batches, it does not stream. */
export const MAX_EVENTS = 200;
/** Largest body accepted, in bytes. */
export const MAX_BYTES = 128 * 1024;
const SOURCE = /^[a-z][a-z0-9-]{0,31}$/;
const DEVICE = /^[A-Za-z0-9:._-]{1,80}$/;

/**
 * /api/v1/client-log — client log events over plain HTTP, for clients with no
 * WebSocket (the DaylightStation Android app's native screens). The same path
 * into the log store as the WebSocket `logging` topic: the events go to the
 * injected `ingest` (FrontendLogIngestion.ingestFrontendLogs), so they get its
 * normalization and its process-wide rate limiter.
 *
 * POST /  { source: "android", events: [{ event, level, ts, data, context }] }
 *   202 { accepted, dropped }  dropped = entries that are not an object with a
 *                              string `event`
 *   400 not { events: [...] }
 *   413 more than MAX_EVENTS events, or a body over MAX_BYTES
 *
 * Each kept event's context.source is the body's `source` (default "android";
 * a lowercase slug), stamped here: ingestion would otherwise call it
 * "frontend". context.app, component, deviceId and the rest pass through. The
 * X-Daylight-Device header, when present, becomes context.device. No auth
 * beyond the other device routes (LAN/VPN reach). See
 * __docs/reference/core/configuration.md (Client log over HTTP).
 */
export function createClientLogRouter({ ingest, logger = console } = {}) {
  if (typeof ingest !== 'function') throw new Error('createClientLogRouter: ingest is required');
  const router = express.Router();

  router.post('/', (req, res) => {
    const declared = Number.parseInt(req.get('content-length') ?? '', 10);
    const body = req.body;
    const size = Number.isFinite(declared) ? declared : Buffer.byteLength(JSON.stringify(body ?? null));
    if (size > MAX_BYTES) return res.status(413).json({ error: `body over ${MAX_BYTES} bytes` });
    if (!body || typeof body !== 'object' || !Array.isArray(body.events)) {
      return res.status(400).json({ error: 'body must be { events: [...] }' });
    }
    if (body.events.length > MAX_EVENTS) {
      return res.status(413).json({ error: `at most ${MAX_EVENTS} events per request` });
    }
    const source = typeof body.source === 'string' && SOURCE.test(body.source) ? body.source : 'android';
    const headerDevice = req.get('x-daylight-device');
    const device = typeof headerDevice === 'string' && DEVICE.test(headerDevice) ? headerDevice : null;

    const kept = [];
    let dropped = 0;
    for (const e of body.events) {
      if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.event !== 'string' || !e.event) {
        dropped++;
        continue;
      }
      const context = e.context && typeof e.context === 'object' && !Array.isArray(e.context) ? e.context : {};
      kept.push({ ...e, context: { ...context, source, ...(device && { device }) } });
    }

    let accepted = 0;
    if (kept.length > 0) {
      try {
        ingest({ events: kept }, { ip: req.ip, userAgent: req.get('user-agent') });
        accepted = kept.length;
      } catch (err) {
        logger.warn?.('client-log.ingest_failed', { source, count: kept.length, error: err?.message });
        return sendInternalError(res, { error: 'ingest failed' });
      }
    }
    if (dropped > 0) logger.debug?.('client-log.dropped', { source, dropped });
    return res.status(202).json({ accepted, dropped });
  });

  return router;
}

export default createClientLogRouter;
