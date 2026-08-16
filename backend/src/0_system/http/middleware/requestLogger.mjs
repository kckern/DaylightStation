/**
 * Request Logger Middleware
 * @module infrastructure/http/middleware/requestLogger
 *
 * Logs one `http.response` line per request, from `res.on('finish')`.
 *
 * WHY 'finish' AND NOT res.json: this middleware existed before the
 * 2026-08-16 remount storm, and would have missed it even had it been mounted
 * globally — it wrapped `res.json`, while both hot paths of that incident end
 * in `res.redirect` (the Plex stream mint) and `proxyRes.pipe` (the media
 * passthrough). A response logger that only sees JSON is not a response
 * logger. The 'finish' event fires once the response is fully written,
 * whatever wrote it.
 *
 * Request bodies are never logged. They carry credentials, meal photos and
 * children's schoolwork, and no question worth asking of a log needs them.
 */

import { createLogger } from '../../logging/logger.mjs';

const defaultLogger = createLogger({ source: 'http', app: 'middleware' });

/**
 * Successful responses are budgeted: this runs on every request in the system,
 * and an unbounded line per request would swamp the log it is written into. In
 * a storm the per-minute aggregate is the diagnosis anyway.
 */
const DEFAULT_MAX_PER_MINUTE = 30;

/**
 * Low-cardinality grouping for the aggregate.
 *
 * The sampler buckets string fields but keeps at most 20 distinct values per
 * field before collapsing the rest into `__other__`, and raw paths carry ids
 * (`/proxy/plex/stream/694719`), so an aggregate keyed on `path` would be
 * almost entirely `__other__` — the storm's shape lost precisely when it
 * matters. The first two segments are stable enough to count.
 *
 * @param {string} p
 * @returns {string}
 */
function routeGroup(p) {
  const parts = String(p || '/').split('/').filter(Boolean).slice(0, 2);
  return parts.length ? `/${parts.join('/')}` : '/';
}

/**
 * Create request logger middleware
 * @param {Object} options
 * @param {Object} [options.logger] - injected logger (defaults to the module's)
 * @param {number} [options.maxPerMinute] - budget for successful responses
 * @returns {Function} Express middleware
 */
export function requestLoggerMiddleware(options = {}) {
  const { logger = defaultLogger, maxPerMinute = DEFAULT_MAX_PER_MINUTE } = options;

  return (req, res, next) => {
    const startTime = Date.now();
    let recorded = false;

    const record = () => {
      // 'close' fires after 'finish' on a normal response, so without this
      // guard every line in the system would appear twice.
      if (recorded) return;
      recorded = true;

      // A response the client walked away from never reaches 'finish'. That is
      // the shape a remount storm produces by the hundred — abandoned in-flight
      // media requests — and hooking only 'finish' would have left the log
      // saying it did not happen.
      const aborted = !res.writableEnded;

      const data = {
        method: req.method,
        // Mount-relative, and deliberately without the query string: session
        // ids and tokens ride in query params and have no business here.
        path: req.path,
        route: routeGroup(req.path),
        status: res.statusCode,
        // Read THIS in an aggregate, not `status` — the sampler sums numbers,
        // so an aggregated `status` is a sum of status codes and means nothing.
        statusClass: `${Math.floor(res.statusCode / 100)}xx`,
        durationMs: Date.now() - startTime,
        // null, not absent: "the client sent no User-Agent" is a fact, and a
        // missing field would be indistinguishable from a field never captured.
        userAgent: req.headers['user-agent'] ?? null,
        aborted,
      };

      // Failures skip the budget entirely. A 500 storm sampled away is exactly
      // the class of blindness this is here to remove. An abandoned request
      // counts as one: hundreds of them is the storm.
      if (res.statusCode >= 400 || aborted) {
        logger.warn('http.response', data);
      } else {
        logger.sampled('http.response', data, { maxPerMinute });
      }
    };

    res.on('finish', record);
    res.on('close', record);

    next();
  };
}

export default requestLoggerMiddleware;
