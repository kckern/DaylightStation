import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSchoolApi } from '../runtime/useSchoolApi.js';
import { useSchoolInvalidation } from '../runtime/useSchoolInvalidation.js';
import { useSchoolRingGates } from '../status/useSchoolRingGates.js';
import { createRewardsCache } from './rewardsCache.js';

export default function useRewardsCache(kids, enabled, suppliedCache = null) {
  const api = useSchoolApi();
  const readGates = useSchoolRingGates({ enabled: enabled && !suppliedCache });
  const scopedCache = useMemo(() => createRewardsCache(api, { readGates }), [api, readGates]);
  const cache = suppliedCache ?? scopedCache;
  const key = kids.map(kid => kid.id).sort().join('|');
  const ids = useMemo(() => key ? key.split('|') : [], [key]);
  const snapshots = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  const refresh = useCallback(() => { if (enabled && ids.length) cache.refresh(ids, { again: true }); }, [enabled, ids, cache]);
  useEffect(() => { if (enabled && ids.length) cache.refresh(ids); }, [cache, enabled, ids]);
  useSchoolInvalidation({ refresh, enabled: enabled && ids.length > 0, learnerIds: ids, topics: ['school', 'state-gates'] });
  return snapshots;
}
