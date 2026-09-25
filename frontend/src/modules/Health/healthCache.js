// Health's on-disk resource cache. Every Health read goes through
// useApiResource under `api/v1/health/`; backing those with IndexedDB means a
// reopened /health paints yesterday's-last-seen day, budget, weight and coach
// line on its first frame and then revalidates each one quietly — instead of
// a spinner until the slowest request answers. See
// attachApiResourcePersistence in lib/hooks/useApiResource.js.
import { useEffect, useState } from 'react';
import { attachApiResourcePersistence, claimApiResourceOwner, getApiResourceOwner } from '../../lib/hooks/useApiResource.js';
import { createIdbResourceStore } from '../../lib/hooks/persistentResourceStore.js';
import { createAppLogger } from '../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('cache');

export const HEALTH_CACHE_PREFIXES = ['api/v1/health/'];

let hydration = null;
let hydrated = false;

/** Start restoring once per page; resolves when the cache is ready to read. */
export function hydrateHealthCache() {
  if (hydration) return hydration;
  const startedAt = performance.now();
  hydration = attachApiResourcePersistence({ store: createIdbResourceStore('daylight-health-cache', { maxEntries: 100 }), prefixes: HEALTH_CACHE_PREFIXES })
    .catch(() => 0)
    .then(restored => {
      hydrated = true;
      logger.info('cache.hydrated', { restored, ms: Math.round(performance.now() - startedAt) });
      return restored;
    });
  return hydration;
}

/** True once the disk cache has been restored (or given up on). */
export function useHealthCacheHydrated() {
  const [ready, setReady] = useState(hydrated);
  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    hydrateHealthCache().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [ready]);
  return ready;
}

/**
 * Record whose data the cache holds, from a context the SERVER just
 * confirmed (never a restored one). A different person than last time drops
 * the previous person's snapshots and refetches.
 */
export function claimHealthCacheOwner(userId) {
  if (claimApiResourceOwner(userId)) logger.info('cache.owner-changed', { userId });
}

/**
 * True when the cache holds someone ELSE's snapshots than `userId`'s, i.e. a
 * shell for `userId` must not mount yet: its readers would start on the other
 * person's data. Unknown or first-visit owners hold nothing to mix up.
 */
export function healthCacheHeldByOther(userId) {
  const owner = getApiResourceOwner();
  return Boolean(owner && userId && owner !== userId);
}
