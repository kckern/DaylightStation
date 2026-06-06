/**
 * Resilience for stale lazy-loaded chunks after a deploy.
 *
 * A long-lived SPA tab holds an app shell (`index-<hash>.js`) that references
 * hashed asset chunks by name. When a new build is deployed those hashes change
 * and the previous chunks are removed from the server. Any dynamic `import()`
 * the old shell then performs — a lazy route, a lazy game, etc. — resolves to a
 * chunk hash that no longer exists, 404s ("Failed to fetch dynamically imported
 * module"), and with no recovery leaves a blank screen. This is exactly what
 * took PianoTetris (and every other lazy game) DOA after the latest deploy: the
 * game activated, but its chunk import failed silently into `Suspense
 * fallback={null}`.
 *
 * The fix: when a chunk-load failure is detected, hard-reload ONCE to fetch the
 * fresh `index.html` (served `no-cache`) and its current chunk hashes. A
 * sessionStorage guard prevents an infinite reload loop if the chunk is
 * genuinely broken rather than merely stale; the guard is cleared the moment a
 * dynamic import succeeds, so a FUTURE deploy can trigger recovery again.
 */
import { lazy } from 'react';
import { getChildLogger } from './logging/singleton.js';

const RELOAD_GUARD_KEY = 'daylight.chunkReload.attempted';

// Cross-browser set of messages browsers use when a dynamically imported module
// fails to load (Chrome/Edge, Firefox, Safari, and the legacy webpack phrasing).
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed/i;

let _logger;
function logger() {
  if (!_logger) _logger = getChildLogger({ component: 'chunk-reload' });
  return _logger;
}

/**
 * @param {*} err - an Error, an event payload, or a string
 * @returns {boolean} true if this looks like a stale/missing dynamic-import chunk
 */
export function isChunkLoadError(err) {
  if (!err) return false;
  const msg =
    typeof err === 'string'
      ? err
      : err.message || err.reason?.message || err.payload?.message || '';
  return CHUNK_ERROR_RE.test(msg);
}

function alreadyReloaded() {
  try {
    return !!window.sessionStorage?.getItem(RELOAD_GUARD_KEY);
  } catch {
    return false;
  }
}

function markReloaded() {
  try {
    window.sessionStorage?.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage unavailable (private mode, etc.) — reload still works */
  }
}

export function clearChunkReloadGuard() {
  try {
    window.sessionStorage?.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * If `err` is a stale-chunk failure and we have not already reloaded this
 * session, hard-reload to pick up the fresh app shell.
 *
 * @returns {boolean} true if a reload was triggered (the caller should stop and
 *   let the navigation happen); false if not a chunk error, or the guard is
 *   already tripped (genuine failure — surface it instead of looping).
 */
export function recoverFromChunkError(err, context = {}) {
  if (!isChunkLoadError(err)) return false;
  const message = (typeof err === 'string' ? err : err?.message) || String(err);
  if (alreadyReloaded()) {
    // Already reloaded once and the chunk STILL won't load — this is a real
    // failure, not a stale cache. Don't loop; let it surface.
    logger().error('chunk-reload.exhausted', { ...context, message });
    return false;
  }
  markReloaded();
  logger().warn('chunk-reload.reloading', { ...context, message });
  // index.html is served no-cache, so a plain reload revalidates it and fetches
  // the current chunk hashes.
  window.location.reload();
  return true;
}

/**
 * Install global listeners that auto-recover from stale-chunk failures for ALL
 * dynamic imports app-wide (lazy routes, lazy games, etc.). Call once at boot.
 */
export function installChunkReloadHandler() {
  if (typeof window === 'undefined') return;

  // Vite's documented hook for exactly this stale-deploy scenario: it fires
  // when a chunk preload fails. preventDefault() once we've claimed it.
  window.addEventListener('vite:preloadError', (event) => {
    if (recoverFromChunkError(event?.payload, { via: 'vite:preloadError' })) {
      event.preventDefault?.();
    }
  });

  // Catch dynamic-import rejections that don't surface as vite:preloadError
  // (plain import() factories, non-Vite paths, browsers without the event).
  window.addEventListener('unhandledrejection', (event) => {
    recoverFromChunkError(event?.reason, { via: 'unhandledrejection' });
  });

  // On a normal (non-post-reload) boot, the shell is current — clear any stale
  // guard so a future deploy can recover. After a recovery reload the guard is
  // intentionally left until an import actually succeeds (see importWithReload),
  // so a still-broken shell surfaces instead of looping forever.
  if (!alreadyReloaded()) clearChunkReloadGuard();
}

/**
 * Wrap a dynamic import factory so a stale-chunk failure triggers a guarded
 * hard reload, holding the promise pending across the navigation instead of
 * rejecting into a blank Suspense. On success it clears the reload guard.
 *
 * @param {() => Promise<any>} factory - e.g. () => import('./Foo')
 * @returns {Promise<any>}
 */
export function importWithReload(factory) {
  return factory().then(
    (mod) => {
      clearChunkReloadGuard();
      return mod;
    },
    (err) => {
      if (recoverFromChunkError(err, { via: 'lazy-import' })) {
        // Hang until window.location.reload() navigates away, so Suspense holds
        // its fallback rather than throwing into (an absent) error boundary.
        return new Promise(() => {});
      }
      throw err;
    },
  );
}

/**
 * Drop-in replacement for React.lazy() that adds stale-chunk reload recovery.
 *
 * @param {() => Promise<{ default: React.ComponentType }>} factory
 * @returns {React.LazyExoticComponent}
 */
export function lazyWithReload(factory) {
  return lazy(() => importWithReload(factory));
}

export default lazyWithReload;
