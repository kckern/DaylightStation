/**
 * A request path in one canonical spelling, for security decisions made by
 * path prefix (which guard applies, which app a route belongs to).
 *
 * Express routes case-insensitively (`/API/v1/admin` reaches the `/admin`
 * router), so a check that compares the raw path can be stepped around by
 * changing case. This spelling is deliberately broader than Express: it also
 * decodes percent-encoding, collapses repeated slashes and drops trailing
 * dots, so a guard that uses it may match a path Express would 404, never
 * miss one Express would route.
 *
 * @param {string} path - `req.path` (no query string)
 * @returns {string} lower-case, decoded, single-slashed, no trailing slash
 */
export function canonicalRoutePath(path) {
  const segments = String(path ?? '').split('/').map((segment) => {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { decoded = segment; }
    return decoded.toLowerCase().replace(/\.+$/, '');
  });
  const joined = segments.join('/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/** Whether `path` is `prefix` or below it, compared canonically. */
export function routePathWithin(path, prefix) {
  const value = canonicalRoutePath(path);
  const base = canonicalRoutePath(prefix);
  return base === '/' || value === base || value.startsWith(`${base}/`);
}
