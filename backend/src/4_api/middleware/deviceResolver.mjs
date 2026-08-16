// backend/src/4_api/middleware/deviceResolver.mjs

/**
 * Middleware that answers "which device made this request".
 *
 * Every frontend in the house reaches this server over the docker network, so
 * `req.ip` is one address for all of them (`172.18.0.53` throughout the
 * 2026-08-16 investigation). The backend's own log context is
 * `{source, app, host}` where `host` is `os.hostname()` — the SERVER — and
 * frontend-forwarded events get `ip`/`userAgent` injected at ingestion while
 * backend requests got nothing at all. Filtering by IP conflated the garage
 * fitness kiosk with the piano tablet and sent the investigation after the
 * wrong screen.
 *
 * Stamps two fields, never one, because a single field would have to encode
 * four different facts at once:
 *
 *   req.deviceId        the value, or null
 *   req.deviceIdSource  where it came from —
 *     'header'      the client sent X-Daylight-Device; `deviceId` is that value
 *     'user-agent'  it did not; `deviceId` is the User-Agent string, which
 *                   already separates Shield WebView from tablet Chromium from
 *                   garage Firefox at zero cost. Coarser than a device id: two
 *                   identical kiosks are indistinguishable this way.
 *     'none'        neither was sent; `deviceId` is null
 *   (a reader may also see 'unresolved', which the request logger substitutes
 *    when this middleware did not run for the request at all)
 *
 * Media traffic cannot reach the first case: `<video>`/dash segment fetches are
 * issued by the element itself and cannot carry custom headers. Those are
 * identified by the `?session=` query param instead.
 */

/** Headers are untrusted input on their way into a log. Bound the damage. */
const MAX_DEVICE_ID_LENGTH = 128;

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalize(raw) {
  if (typeof raw !== 'string') return null;
  // Strip control characters so a crafted header cannot forge line structure
  // in a log, and cap the length so it cannot flood one.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_DEVICE_ID_LENGTH);
}

/**
 * @returns {import('express').RequestHandler}
 */
export function deviceResolver() {
  return (req, _res, next) => {
    const declared = normalize(req.headers?.['x-daylight-device']);
    if (declared) {
      req.deviceId = declared;
      req.deviceIdSource = 'header';
      return next();
    }

    const userAgent = normalize(req.headers?.['user-agent']);
    req.deviceId = userAgent;
    req.deviceIdSource = userAgent ? 'user-agent' : 'none';
    return next();
  };
}

export default deviceResolver;
