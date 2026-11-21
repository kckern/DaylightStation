/**
 * Feed links come from other people's RSS and FreshRSS, unchecked. The app
 * renders them as anchors and as the src of an iframe sandboxed with
 * `allow-scripts allow-same-origin`. So a link is usable only as an absolute
 * http(s) URL: `javascript:` in an anchor would run in the app's page, and
 * `data:`/`blob:` or a relative path in that iframe would run with the app's
 * origin. __docs/reference/core/network-exposure.md (Cross-site requests).
 */

import { canonicalRoutePath, routePathWithin } from '../../../../shared/contracts/http/routePath.mjs';

/**
 * The link, trimmed, when it is an absolute http(s) URL; else null. Returned
 * as given rather than re-serialized: harvested headline ids hash the link.
 */
export function webLink(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Absolute URLs only: no relative or protocol-relative paths, which would
  // resolve against the app's own origin.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * The link if it may be loaded into an iframe sandboxed with
 * `allow-scripts allow-same-origin`, or null. That pair is harmless only for
 * another origin: a page on the app's own origin could reach out of the
 * sandbox and drive the app as the household member.
 * @param {string} value
 * @param {string} appOrigin - the page's origin (`window.location.origin`)
 */
export function frameableLink(value, appOrigin) {
  const link = webLink(value);
  if (!link) return null;
  let own = null;
  try { own = new URL(appOrigin).origin; } catch { own = null; }
  return own && new URL(link).origin === own ? null : link;
}

// Paths an <img> may load from this app's own origin: the read-only image
// endpoints the app's own feed sources (Immich, Plex, Komga, Reddit, ABS,
// Libby, icons) point at. Anything else there, `/api/...` above all, could be
// an action GET, and a same-origin <img> carries the household member's trust.
const APP_IMAGE_PREFIXES = [
  '/api/v1/proxy/plex/library/metadata',
  '/api/v1/proxy/plex/photo',
  '/api/v1/proxy/immich/assets',
  '/api/v1/proxy/komga/composite',
  '/api/v1/proxy/reddit',
  '/api/v1/proxy/abs/items',
  '/api/v1/proxy/libby/cover',
  '/api/v1/proxy/media',
  '/api/v1/static',
  '/api/v1/feed/icon',
  '/api/v1/feed/image',
];
// Image paths that a prefix cannot express: a Komga page image is
// `.../books/<id>/pages/<n>`, while its siblings (`file`, `read-progress`) are not images.
const APP_IMAGE_PATTERNS = [
  /^\/api\/v1\/proxy\/komga\/api\/v1\/books\/[^/]+\/pages\/\d+$/,
];
const APP_PATH_PREFIXES = ['/api', '/admin'];
const IMAGE_PROXY = '/api/v1/feed/image?url=';

/** The path a browser would request: dot segments resolved, as given otherwise. */
function browserPath(path) {
  try { return new URL(path, 'http://placeholder.invalid').pathname; } catch { return null; }
}

function within(path, prefixes) {
  const resolved = browserPath(path);
  return resolved !== null && prefixes.some((prefix) => routePathWithin(resolved, prefix));
}

function isAppImagePath(path) {
  const resolved = browserPath(path);
  if (resolved === null) return false;
  const canonical = canonicalRoutePath(resolved);
  return within(resolved, APP_IMAGE_PREFIXES) || APP_IMAGE_PATTERNS.some((pattern) => pattern.test(canonical));
}

/**
 * An image URL from someone else's feed, at ingest: an absolute http(s) URL
 * whose path is not under `/api` or `/admin` on any host (the app is reached
 * by several names, and the server cannot tell which a feed meant). Else null.
 */
export function externalImageLink(value) {
  const link = webLink(value);
  if (!link) return null;
  return within(new URL(link).pathname, APP_PATH_PREFIXES) ? null : link;
}

/**
 * What an <img> in the feed may load, or null to show none.
 * - A path on this app's origin (relative, or absolute on `appOrigin`): only
 *   the read-only image endpoints above.
 * - An http(s) URL on another host: as given, unless its path is under `/api`
 *   or `/admin` (it may be this app under another name); that one goes through
 *   the server's image proxy, whose SSRF guard refuses private targets.
 * - `data:image/...`: as given (no request).
 * @param {string} value
 * @param {string} appOrigin - the page's origin (`window.location.origin`)
 */
export function feedImageSrc(value, appOrigin) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return isAppImagePath(trimmed.split(/[?#]/)[0]) ? trimmed : null;
  }
  const link = webLink(trimmed);
  if (!link) return null;
  const url = new URL(link);
  let own = null;
  try { own = new URL(appOrigin).origin; } catch { own = null; }
  if (own && url.origin === own) return isAppImagePath(url.pathname) ? link : null;
  return within(url.pathname, APP_PATH_PREFIXES) ? `${IMAGE_PROXY}${encodeURIComponent(link)}` : link;
}
