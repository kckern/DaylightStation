/**
 * aiOrigin middleware — runs the rest of a request under an AI-usage origin
 * of `http:METHOD /normalized/path`, so a ledger row written anywhere down the
 * request's async chain says which endpoint paid for it.
 *
 * The matched route pattern is not known until routing finishes, so the path
 * is normalized instead: the query string is dropped and any segment that
 * looks like an identifier (digits, uuid, long hex, date, email, a long token
 * containing digits) becomes `:id`. Informational only — see aiContext.
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

/** @returns {string} `http:METHOD /normalized/path` */
export function httpOrigin(req) {
  return `http:${String(req.method || 'GET').toUpperCase()} ${normalizeOriginPath(req.originalUrl ?? req.url)}`;
}

export function aiOriginMiddleware() {
  return function aiOrigin(req, res, next) {
    runWithOrigin(httpOrigin(req), () => next());
  };
}

export default aiOriginMiddleware;
