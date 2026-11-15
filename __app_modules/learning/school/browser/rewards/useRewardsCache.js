import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useWebSocketSubscription } from '../../../../../frontend/src/hooks/useWebSocket.js';
import { coalescer, SCHOOL_REFRESH_EVENTS } from '../status/schoolRefreshEvents.js';
import { rewardsCache } from './rewardsCache.js';

export default function useRewardsCache(kids, enabled, cache = rewardsCache) {
  const key = kids.map(kid => kid.id).sort().join('|');
  const ids = useMemo(() => key ? key.split('|') : [], [key]);
  const snapshots = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  const refresh = useCallback(() => { if (enabled && ids.length) cache.refresh(ids, { again: true }); }, [enabled, ids, cache]);
  const burst = useMemo(() => coalescer(refresh), [refresh]);
  useEffect(() => {
    if (!enabled || !ids.length) return undefined;
    cache.refresh(ids);
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 60_000);
    const visible = () => { if (document.visibilityState !== 'hidden') refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [cache, enabled, ids, refresh]);
  useEffect(() => () => burst.cancel(), [burst]);
  const school = useCallback(event => {
    if (enabled && SCHOOL_REFRESH_EVENTS.has(event?.event) && (!event.learnerId || ids.includes(event.learnerId))) burst.poke();
  }, [enabled, ids, burst]);
  const gates = useCallback(event => {
    const gateId = event?.payload?.gateId ?? event?.payload?.current?.gateId ?? event?.evaluation?.gateId;
    if (enabled && (gateId === 'fitness.weekly-rings' || gateId === 'school.day-complete')) burst.poke();
  }, [enabled, burst]);
  useWebSocketSubscription('school', school, [school]);
  useWebSocketSubscription('state-gates', gates, [gates]);
  return snapshots;
}
