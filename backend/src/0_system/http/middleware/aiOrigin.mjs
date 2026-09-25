/**
 * aiOrigin middleware — runs the rest of a request under an AI-usage origin
 * of `http:METHOD <route pattern>`, so a ledger row written anywhere down the
 * request's async chain says which endpoint paid for it.
 *
 * What is guaranteed: no value that routing bound to a route parameter —
 * at any router level, including a parent router's `:username` that a child
 * router cannot see in its own req.params — appears in the origin. The
 * middleware records every params object the router assigns during the
 * request, and each path segment equal to one of those values becomes
 * `:<paramName>`. Once a route with a string path has matched, the origin is
 * that redacted prefix plus the route's own pattern. Before a match, or for a
 * regex/array route, it is the URL with the query string dropped, param
 * values redacted, and id-looking segments (digits, uuid, long hex, date,
 * email, a long token containing digits) replaced with `:id`.
 *
 * What is NOT guaranteed: a literal path segment that no router bound as a
 * parameter and that does not look like an id is kept as written (an unrouted
 * URL, a static path). Origin is informational only; it never attributes.
 *
 * The origin is resolved lazily while the request runs and settled (snapshot
 * taken, request released) when the response finishes or closes, so a timer
 * left running by a handler does not keep the request alive.
 *
 * Mount it AFTER the body parsers. A parser finishes on the request stream's
 * 'end' event, which fires outside any context this middleware opened; placed
 * after them, every later middleware and handler runs inside the origin.
 */
import { originSlot, runInOriginSlot } from '../../runtime/aiContext.mjs';

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

const paramLabel = (name) => (/^\d+$/.test(String(name)) ? 'param' : String(name));

/** Param value → name, from what was recorded plus the request's current params. */
function paramValues(req, seen) {
  const values = new Map(seen || []);
  for (const [name, value] of Object.entries(req?.params || {})) {
    if (typeof value === 'string' && value) values.set(value, name);
  }
  return values;
}

/**
 * Redact one path: param values → `:<name>`; optionally id-looking segments → `:id`.
 * @param {string} pathOnly - no query string
 * @param {Map<string,string>} values
 * @param {boolean} ids
 */
function redactPath(pathOnly, values, ids) {
  return pathOnly.split('/').map((segment) => {
    if (!segment) return segment;
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* keep raw */ }
    if (values.has(decoded)) return `:${paramLabel(values.get(decoded))}`;
    if (values.has(segment)) return `:${paramLabel(values.get(segment))}`;
    return ids && looksLikeId(decoded) ? ':id' : segment;
  }).join('/');
}

const cap = (p) => (p.length > MAX_LENGTH ? `${p.slice(0, MAX_LENGTH)}…` : p);

/**
 * @param {string} url - `req.originalUrl` (may carry a query string)
 * @param {Map<string,string>} [values] - param value → name to redact
 * @returns {string} e.g. `/api/v1/health/log/:id`
 */
export function normalizeOriginPath(url, values = new Map()) {
  const pathOnly = String(url || '/').split(/[?#]/)[0] || '/';
  return cap(redactPath(pathOnly, values, true));
}

/**
 * @param {Object} req
 * @param {Map<string,string>} [seen] - every param value routing bound so far
 * @returns {string} `http:METHOD /route/:pattern` once routed, else
 *   `http:METHOD /normalized/path`
 */
export function httpOrigin(req, seen = null) {
  const method = String(req.method || 'GET').toUpperCase();
  const values = paramValues(req, seen);
  const pattern = req.route?.path;
  if (typeof pattern === 'string') {
    const base = redactPath(String(req.baseUrl || '').split(/[?#]/)[0], values, true);
    const full = `${base}${pattern === '/' && base ? '' : pattern}` || '/';
    return `http:${method} ${cap(full)}`;
  }
  return `http:${method} ${normalizeOriginPath(req.originalUrl ?? req.url, values)}`;
}

/**
 * Record every params object the router assigns to this request, so a value
 * bound by a parent router is still known after a child router replaces
 * req.params with its own.
 * @returns {Map<string,string>} value → param name
 */
function trackParams(req) {
  const seen = new Map();
  const record = (params) => {
    if (!params || typeof params !== 'object') return;
    for (const [name, value] of Object.entries(params)) {
      if (typeof value === 'string' && value) seen.set(value, name);
    }
  };
  let current = req.params;
  record(current);
  try {
    Object.defineProperty(req, 'params', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value) => { current = value; record(value); },
    });
  } catch { /* a frozen request: fall back to the params visible at read time */ }
  return seen;
}

export function aiOriginMiddleware() {
  return function aiOrigin(req, res, next) {
    const seen = trackParams(req);
    const slot = originSlot(() => httpOrigin(req, seen));
    const settle = () => slot.settle();
    res.once?.('finish', settle);
    res.once?.('close', settle);
    runInOriginSlot(slot, () => next());
  };
}

export default aiOriginMiddleware;
