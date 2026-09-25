/**
 * aiOrigin middleware — runs the rest of a request under an AI-usage origin
 * of `http:METHOD <route pattern>`, so a ledger row written anywhere down the
 * request's async chain says which endpoint paid for it.
 *
 * The origin is resolved lazily (see aiContext): once routing has matched, it
 * is the pattern — `req.baseUrl + req.route.path`, e.g.
 * `/api/v1/health/members/:username` — so no username, name slug or id from
 * the URL is ever recorded. Before a match (middleware, or a route with a
 * non-string path) it falls back to the URL normalized: query string dropped,
 * id-looking segments (digits, uuid, long hex, date, email, a long token
 * containing digits) replaced with `:id`. Informational only.
 *
 * Mount it AFTER the body parsers. A parser finishes on the request stream's
 * 'end' event, which fires outside any context this middleware opened; placed
 * after them, every later middleware and handler runs inside the origin.
 */
import { runWithOrigin } from '../../runtime/aiContext.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{12,}$/i;
const DIGITS = /^\d+$/;
const DATE = /^\d{4}-?\d{2}-?\d{2}/;
const MAX_LENGTH = 200;

function looksLikeId(segment) {
  return DIGITS.test(segment)
    || UUID.test(segment)
    || LONG_HEX.test(segment)
    || DATE.test(segment)
    || segment.includes('@')
    || (segment.length >= 8 && /\d/.test(segment));
}

/**
 * @param {string} url - `req.originalUrl` (may carry a query string)
 * @returns {string} e.g. `/api/v1/health/log/:id`
 */
export function normalizeOriginPath(url) {
  const pathOnly = String(url || '/').split(/[?#]/)[0] || '/';
  const normalized = pathOnly.split('/').map((segment) => {
    if (!segment) return segment;
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* keep raw */ }
    return looksLikeId(decoded) ? ':id' : segment;
  }).join('/');
  return normalized.length > MAX_LENGTH ? `${normalized.slice(0, MAX_LENGTH)}…` : normalized;
}

/**
 * @returns {string} `http:METHOD /route/:pattern` once routed, else
 *   `http:METHOD /normalized/path`
 */
export function httpOrigin(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const pattern = req.route?.path;
  if (typeof pattern === 'string') {
    const full = `${req.baseUrl || ''}${pattern === '/' && req.baseUrl ? '' : pattern}` || '/';
    return `http:${method} ${full.length > MAX_LENGTH ? `${full.slice(0, MAX_LENGTH)}…` : full}`;
  }
  return `http:${method} ${normalizeOriginPath(req.originalUrl ?? req.url)}`;
}

export function aiOriginMiddleware() {
  return function aiOrigin(req, res, next) {
    runWithOrigin(() => httpOrigin(req), () => next());
  };
}

export default aiOriginMiddleware;
