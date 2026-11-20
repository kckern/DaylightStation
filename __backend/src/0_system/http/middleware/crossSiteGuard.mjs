/**
 * Refuse state-changing requests that a browser sends on behalf of another site.
 *
 * Why this exists: networkTrustResolver grants `sysadmin` to any private-address
 * socket peer, and every request through the reverse proxy is one. So a page on
 * any other site, opened in a household browser, could POST to `/api/v1/admin/*`
 * and be treated as sysadmin. A form or `text/plain` fetch needs no preflight, so
 * CORS alone never stopped it.
 *
 * The rule, for POST, PUT, PATCH and DELETE only:
 *   1. `Origin` on the allow-list (`http.allowed_origins` in system.yml): allowed.
 *   2. `Sec-Fetch-Site` present: allowed only as `same-origin` (this app's own
 *      page) or `none` (the user typed or bookmarked it). Page script cannot set
 *      this header, and every current browser sends it.
 *   3. Otherwise `Origin` present (an older browser or WebView): allowed only
 *      when its host is the host the request was sent to (the `Host` header, or
 *      `X-Forwarded-Host` when Express's `trust proxy` trusts the peer). The
 *      opaque origin `null` (sandboxed frame, file://, data:) is refused.
 *   4. Neither header: allowed. That is every non-browser caller (CLIs, Home
 *      Assistant, bridges, firmware, the Android app's native code, webhooks).
 *
 * Reads are isolated too, for `/api` and `/admin` paths, by any method: a
 * request whose `Sec-Fetch-Site` is `cross-site` or `same-site` is refused
 * unless it is a top-level navigation (`Sec-Fetch-Mode: navigate` into a
 * document: a link, a Telegram button, an OAuth callback). So another site's
 * page cannot fire an action GET from an <img>, a fetch or a hidden iframe,
 * nor read a response. An `Origin` on the allow-list is still allowed. Requests
 * without `Sec-Fetch-Site` (non-browser callers, plain-http LAN pages, older
 * WebViews) are not affected. No path is exempt: nothing on another origin
 * embeds the API (checked 2026-11-20: the data tree, Home Assistant's config and
 * dashboards, the extensions, the frontend).
 *
 * Reference: __docs/reference/core/network-exposure.md (Cross-site requests).
 */

import { routePathWithin } from '../routePath.mjs';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_SITES = new Set(['same-origin', 'none']);
const FOREIGN_SITES = new Set(['cross-site', 'same-site']);
const ISOLATED_PREFIXES = ['/api', '/admin'];
// Navigations that land inside another page rather than replacing it.
const NESTED_DESTINATIONS = new Set(['iframe', 'frame', 'embed', 'object', 'fencedframe']);

function header(req, name) {
  return req.get?.(name) ?? req.headers?.[name.toLowerCase()];
}

function lowerHeader(req, name) {
  return String(header(req, name) ?? '').trim().toLowerCase();
}

// Compared canonically: Express routes `/API/v1/...` to the same handler as
// `/api/v1/...`, so a case-sensitive check could be stepped around.
function isIsolatedPath(path) {
  return ISOLATED_PREFIXES.some((prefix) => routePathWithin(path, prefix));
}

/** `scheme://host[:port]`, lower-case, default port dropped; null when not a usable origin. */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Host header value, lower-case, without the default port for the scheme. */
function hostKey(host, protocol) {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return null;
  const defaultPort = protocol === 'https:' ? ':443' : protocol === 'http:' ? ':80' : null;
  return defaultPort && value.endsWith(defaultPort) ? value.slice(0, -defaultPort.length) : value;
}

/** The hosts a request may have been addressed to: the raw Host, and Express's proxy-aware `req.host`. */
function requestHosts(req, protocol) {
  const hosts = new Set();
  const raw = hostKey(req.get?.('Host') ?? req.headers?.host, protocol);
  if (raw) hosts.add(raw);
  let forwarded = null;
  try { forwarded = req.host; } catch { forwarded = null; }
  const viaProxy = hostKey(forwarded, protocol);
  if (viaProxy) hosts.add(viaProxy);
  return hosts;
}

/** Turn a configured list into a Set of normalized origins, skipping anything unusable. */
export function originAllowList(list, { logger = null } = {}) {
  const allowed = new Set();
  for (const entry of Array.isArray(list) ? list : []) {
    const origin = normalizeOrigin(entry);
    if (origin) allowed.add(origin);
    else logger?.warn?.('security.allowed-origin.invalid', { value: String(entry) });
  }
  return allowed;
}

/**
 * Why a request is refused, or null when it may proceed.
 * @returns {null | 'sec-fetch-site' | 'origin-null' | 'origin-mismatch' | 'cross-site-read' | 'cross-site-frame'}
 */
export function crossSiteRefusal(req, allowed = new Set()) {
  const origin = req.get?.('Origin') ?? req.headers?.origin;
  const normalized = normalizeOrigin(origin);
  if (normalized && allowed.has(normalized)) return null;

  if (!UNSAFE_METHODS.has(String(req.method || '').toUpperCase())) return crossSiteReadRefusal(req);

  const site = String(req.get?.('Sec-Fetch-Site') ?? req.headers?.['sec-fetch-site'] ?? '').trim().toLowerCase();
  if (site) return ALLOWED_SITES.has(site) ? null : 'sec-fetch-site';

  if (origin === undefined || origin === null || origin === '') return null;
  if (!normalized) return 'origin-null';
  const url = new URL(normalized);
  return requestHosts(req, url.protocol).has(hostKey(url.host, url.protocol)) ? null : 'origin-mismatch';
}

/**
 * Resource isolation for a read (GET, HEAD, OPTIONS) of `/api` or `/admin`:
 * another site's page may navigate there, but not load it.
 * @returns {null | 'cross-site-read' | 'cross-site-frame'}
 */
function crossSiteReadRefusal(req) {
  if (!isIsolatedPath(req.path ?? String(req.url || '').split('?')[0])) return null;
  if (!FOREIGN_SITES.has(lowerHeader(req, 'Sec-Fetch-Site'))) return null;
  if (lowerHeader(req, 'Sec-Fetch-Mode') !== 'navigate') return 'cross-site-read';
  return NESTED_DESTINATIONS.has(lowerHeader(req, 'Sec-Fetch-Dest')) ? 'cross-site-frame' : null;
}

// The peers `trust proxy: 'loopback, linklocal, uniquelocal'` trusts in app.mjs.
const TRUSTED_PROXY_PEERS = [
  /^127\./, /^::1$/,                                       // loopback
  /^169\.254\./, /^fe[89ab][0-9a-f]:/i,                    // link-local
  /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^f[cd][0-9a-f]{2}:/i, // unique local
];

function isTrustedProxyPeer(address) {
  const ip = String(address || '').trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  return Boolean(ip) && TRUSTED_PROXY_PEERS.some((pattern) => pattern.test(ip));
}

/**
 * Why a WebSocket upgrade is refused, or null when it may connect.
 *
 * A browser lets any page open a WebSocket to any host, with cookies and no
 * CORS check, and always names the page in `Origin`. So without this, a page
 * on any site opened in a household browser could read every broadcast
 * (heart-rate telemetry, presence) and send client messages. The rule:
 *   1. No `Origin`: allowed. Node `ws`, Python `websockets`, native apps.
 *   2. `Origin: null` (sandboxed frame, data: page): refused.
 *   3. Any other non-http(s) Origin: allowed. arduinoWebSockets, the relay
 *      firmware's library, sends `Origin: file://` on every handshake. A
 *      browser never sends one for a web page.
 *   4. `Origin` on the allow-list: allowed.
 *   5. `Sec-Fetch-Site: same-origin`: allowed.
 *   6. Otherwise (no or another `Sec-Fetch-Site`) allowed only when the
 *      Origin's host is the Host the upgrade was sent to, or the first
 *      `X-Forwarded-Host` when the peer is the reverse proxy (loopback,
 *      link-local or private, the same peers Express's `trust proxy` trusts).
 *      A browser sets `Origin` itself and the WebSocket API lets a page set no
 *      request headers, so a page cannot forge the match.
 * Works on a bare IncomingMessage (what `ws` passes to verifyClient).
 *
 * @returns {null | 'origin-null' | 'origin-mismatch'}
 */
export function webSocketOriginRefusal(req, allowed = new Set()) {
  const headers = req?.headers || {};
  const origin = typeof headers.origin === 'string' ? headers.origin.trim() : '';
  if (!origin) return null;
  if (origin.toLowerCase() === 'null') return 'origin-null';

  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  if (allowed.has(normalized)) return null;

  const site = String(headers['sec-fetch-site'] ?? '').trim().toLowerCase();
  if (site === 'same-origin') return null;

  const url = new URL(normalized);
  const hosts = requestHosts(req, url.protocol);
  if (isTrustedProxyPeer(req?.socket?.remoteAddress)) {
    const forwarded = hostKey(String(headers['x-forwarded-host'] ?? '').split(',')[0], url.protocol);
    if (forwarded) hosts.add(forwarded);
  }
  return hosts.has(hostKey(url.host, url.protocol)) ? null : 'origin-mismatch';
}

/**
 * @param {object} [options]
 * @param {Iterable<string>|string[]} [options.allowedOrigins] - Extra origins allowed to write.
 * @param {object} [options.logger] - Structured logger (`sampled`, `warn`).
 */
export function crossSiteGuard({ allowedOrigins = [], logger = null } = {}) {
  const allowed = allowedOrigins instanceof Set ? allowedOrigins : originAllowList([...allowedOrigins], { logger });

  return (req, res, next) => {
    const reason = crossSiteRefusal(req, allowed);
    if (!reason) return next();

    const data = {
      method: req.method,
      path: req.path,
      origin: req.get?.('Origin') ?? null,
      secFetchSite: req.get?.('Sec-Fetch-Site') ?? null,
      secFetchMode: req.get?.('Sec-Fetch-Mode') ?? null,
      secFetchDest: req.get?.('Sec-Fetch-Dest') ?? null,
      reason,
    };
    if (logger?.sampled) logger.sampled('security.cross-site-refused', data, { maxPerMinute: 20, aggregate: true, level: 'warn' });
    else logger?.warn?.('security.cross-site-refused', data);

    return res.status(403).json({ error: 'cross-site-refused' });
  };
}

/**
 * Options for the `cors` package: no CORS headers for any origin except the
 * allow-list. Same-origin pages need none; everything else is refused by the
 * browser, which closes cross-origin reads of the API as well as writes.
 */
export function corsOptionsFor(allowed = new Set()) {
  return {
    origin(origin, callback) {
      const normalized = normalizeOrigin(origin);
      callback(null, Boolean(normalized && allowed.has(normalized)));
    },
  };
}

export default crossSiteGuard;
