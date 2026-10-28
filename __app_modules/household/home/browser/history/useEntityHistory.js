import { useEffect } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import homeLogger from '../homeLogger.js';

const logger = homeLogger.child({ component: 'entity-history' });

/** The history path for one entity and range (`24h` | `7d`). */
export const historyPath = (entityId, range) => (
  `api/v1/home-dashboard/entities/${encodeURIComponent(entityId)}/history?range=${range}`
);

/**
 * One entity's recent past for the drawer: `{history, loading, error, reload}`.
 * Cached per path (stale-while-revalidate), so flipping 24 h ↔ 7 d back paints
 * at once.
 */
export function useEntityHistory(entityId, range) {
  const path = entityId ? historyPath(entityId, range) : null;
  // useApiResource conceals the previous path's payload on a key change, so
  // a 7 d chart never shows under a 24 h switch.
  const { data: history, loading, error, reload } = useApiResource(path, { label: 'entity history', logger, swr: true, enabled: Boolean(path) });

  useEffect(() => {
    if (history) logger.debug('home.history.loaded', { entityId, range, kind: history.kind });
  }, [history, entityId, range]);
  useEffect(() => {
    if (error) logger.warn('home.history.failed', { entityId, range, error: error.message });
  }, [error, entityId, range]);

  return { history: history || null, loading, error, reload };
}

export default useEntityHistory;
