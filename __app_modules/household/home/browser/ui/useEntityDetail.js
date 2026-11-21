import { useCallback, useMemo, useState } from 'react';
import homeLogger from '../homeLogger.js';

const logger = homeLogger.child({ component: 'entity-detail' });

/**
 * Which entity's detail sheet is open. Keeps the sheet showing the live
 * reading (not the one tapped) by re-resolving the id against each poll.
 */
export function useEntityDetail(entities) {
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(() => (selectedId === null ? null : entities.find(e => e.id === selectedId) ?? null), [entities, selectedId]);
  // Once an accepted reading removes the entity, its detail visit is over.
  if (selectedId !== null && selected === null) setSelectedId(null);
  const open = useCallback((entity) => {
    logger.info('home.entity.detail', { entityId: entity.id, type: entity.type, stateClass: entity.stateClass });
    setSelectedId(entity.id);
  }, []);
  const close = useCallback(() => setSelectedId(null), []);
  return { selected, open, close };
}

export default useEntityDetail;
