/**
 * Server-side trigger for a refused media file.
 *
 * The Plex proxy turns a persistent part/segment 404 into 503 `source-unreadable`
 * and announces it (`ProxyService.onErrorReplaced`). This maps the proxied path
 * back to its item — awaiting the resolver, which may need to ask Plex — and runs
 * the same healer check the Player would, marked `origin: 'proxy'` so the healer
 * refreshes the file on the host even when Plex's own probe says "readable".
 *
 * See docs/reference/player/media-source-healing.md.
 */
export const TRIGGER_COOLDOWN_MS = 30_000;

export function createProxyRefusalHandler({
  healer, resolveRatingKey, logger = console, clock = () => Date.now(), cooldownMs = TRIGGER_COOLDOWN_MS,
}) {
  // path-key / ratingKey -> last trigger time. A player hammering a dead file
  // (every segment, every retry) must cost one resolution and one check per
  // window, not one per request. Bounded; expired entries go first.
  const seen = new Map();
  const throttled = (key) => {
    const now = clock();
    const last = seen.get(key);
    if (last !== undefined && now - last < cooldownMs) return true;
    if (seen.size >= 500) {
      for (const [k, at] of seen) if (now - at >= cooldownMs) seen.delete(k);
      if (seen.size >= 500) return true;
    }
    seen.set(key, now);
    return false;
  };
  return function onErrorReplaced({ service, path, reason } = {}) {
    if (service !== 'plex' || reason !== 'source-unreadable') return;
    if (throttled(`path:${pathKey(path)}`)) return;
    void (async () => {
      let ratingKey = null;
      try {
        ratingKey = await resolveRatingKey(path);
      } catch (error) {
        logger.warn?.('media.source.heal.proxy-failed', { path: safePath(path), error: error.message });
        return;
      }
      if (!ratingKey) {
        logger.info?.('media.source.heal.proxy-unmapped', { path: safePath(path) });
        return;
      }
      if (throttled(`item:${ratingKey}`)) return;
      try {
        await healer.check(`plex:${ratingKey}`, { origin: 'proxy' });
      } catch (error) {
        logger.warn?.('media.source.heal.proxy-failed', { ratingKey, error: error.message });
      }
    })();
  };
}

/** One key per refused FILE: a transcode's segments share a session, so drop the segment name. */
function pathKey(path) {
  const p = safePath(path);
  return /\/transcode\/universal\/session\//.test(p) ? p.replace(/\/[^/]*$/, '') : p;
}

/** The path without its query (it can carry a token). */
function safePath(path) {
  return String(path || '').split('?')[0];
}

export default createProxyRefusalHandler;
