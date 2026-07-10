import getLogger from '@/lib/logging/Logger.js';

/**
 * Cache-bypassing page reload — the touchable Ctrl+Shift+R equivalent for the
 * garage kiosk. Every step is best-effort: the final reload always runs even
 * if cache clearing or the revalidation fetch fails. Safe mid-session: the
 * play queue is mirrored to sessionStorage and restored on mount.
 *
 * @param {string} source - trigger tag for the session log
 *   ('settings-menu' | 'footer-longpress' | 'footer-tap')
 * @param {object} deps - test-only injection of { logger, cacheStorage, fetchFn, loc }
 */
export default async function hardReload(source = 'unknown', deps = {}) {
  const {
    logger = getLogger(),
    cacheStorage = (typeof caches !== 'undefined' ? caches : null),
    fetchFn = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
    loc = window.location
  } = deps;

  try {
    logger.info('fitness-hard-reload', { source });
  } catch (_) { /* logging must never block the reload */ }

  if (cacheStorage) {
    try {
      const keys = await cacheStorage.keys();
      await Promise.all(keys.map((key) => cacheStorage.delete(key)));
    } catch (_) { /* Cache API absent or broken — proceed */ }
  }

  if (fetchFn) {
    try {
      // Force HTTP-cache revalidation of index.html — the file that points at
      // the hashed bundles — so the reload below picks up a fresh deploy.
      await fetchFn(loc.pathname, { cache: 'reload' });
    } catch (_) { /* offline or fetch failure — reload anyway */ }
  }

  // Non-standard forceGet flag: honored by Firefox (the kiosk browser),
  // harmlessly ignored elsewhere.
  loc.reload(true);
}
