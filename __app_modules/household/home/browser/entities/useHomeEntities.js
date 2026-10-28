import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import { DaylightAPI } from '@/lib/api.mjs';
import homeLogger from '../homeLogger.js';

const PATH = 'api/v1/home-dashboard/entities';
const REFRESH_MS = 10_000;

const logger = homeLogger.child({ component: 'home-entities' });

/**
 * Live home entities: polled while the tab is visible, with optimistic toggles
 * that show the new state until the next reading confirms (or contradicts) it.
 */
export function useHomeEntities({ refreshMs = REFRESH_MS } = {}) {
  const { data, loading, error, reload, revalidating } = useApiResource(PATH, { label: 'home entities', logger, swr: true });
  // entityId -> stateClass we expect after a toggle the server has not reported yet
  const [pending, setPending] = useState({});

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, refreshMs);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload, refreshMs]);

  // A fresh reading retires every guess.
  useEffect(() => { setPending({}); }, [data]);

  useEffect(() => {
    if (data) logger.debug('home.entities.loaded', { count: data.entities?.length ?? 0, rooms: data.rooms?.length ?? 0 });
  }, [data]);

  const toggle = useCallback(async (entity) => {
    const expected = entity.stateClass === 'on' ? 'off' : 'on';
    setPending((p) => ({ ...p, [entity.id]: expected }));
    logger.info('home.entities.toggle', { entityId: entity.id, from: entity.stateClass, to: expected });
    try {
      await DaylightAPI('api/v1/home-dashboard/toggle', { entityId: entity.id, desiredState: 'toggle' }, 'POST');
      return true;
    } catch (err) {
      logger.warn('home.entities.toggle.failed', { entityId: entity.id, error: err.message });
      setPending((p) => { const next = { ...p }; delete next[entity.id]; return next; });
      return false;
    } finally {
      reload();
    }
  }, [reload]);

  const entities = useMemo(() => (data?.entities || []).map((e) => (
    pending[e.id] ? { ...e, stateClass: pending[e.id], state: pending[e.id], pending: true } : e
  )), [data, pending]);

  return {
    entities,
    rooms: data?.rooms || [],
    types: data?.types || [],
    stateClasses: data?.stateClasses || [],
    haUrl: data?.haUrl || null,
    hasData: Boolean(data),
    loading, error, revalidating, reload, toggle,
  };
}

export default useHomeEntities;
