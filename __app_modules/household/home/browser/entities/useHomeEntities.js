import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import { DaylightAPI } from '@/lib/api.mjs';
import homeLogger from '../homeLogger.js';

const PATH = 'api/v1/home-dashboard/entities';
const REFRESH_MS = 10_000;
// How long a toggle's expected state is shown without the platform agreeing.
// Zigbee/MQTT state lags the service call; a poll already in flight when the
// switch was tapped answers with the old state.
const PENDING_MS = 5_000;

const logger = homeLogger.child({ component: 'home-entities' });

/**
 * Live home entities: polled while the tab is visible, with optimistic toggles
 * that show the new state until the next reading confirms (or contradicts) it.
 */
export function useHomeEntities({ refreshMs = REFRESH_MS } = {}) {
  const { data, loading, error, reload, revalidating } = useApiResource(PATH, { label: 'home entities', logger, swr: true });
  // entityId -> { expected: stateClass, until: ms } for toggles not yet confirmed
  const [pending, setPending] = useState({});

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, refreshMs);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload, refreshMs]);

  // A reading retires a guess only when it agrees with it; a guess that the
  // platform never confirms expires, and the real state shows.
  useEffect(() => {
    setPending((current) => {
      const ids = Object.keys(current);
      if (!ids.length) return current;
      const byId = new Map((data?.entities || []).map((e) => [e.id, e]));
      const now = Date.now();
      const next = {};
      for (const id of ids) {
        const reading = byId.get(id);
        if (reading && reading.stateClass === current[id].expected) continue;
        if (now >= current[id].until) continue;
        next[id] = current[id];
      }
      return next;
    });
  }, [data]);

  // Expire guesses even when no poll lands (tab hidden, platform slow).
  useEffect(() => {
    const ids = Object.keys(pending);
    if (!ids.length) return undefined;
    const soonest = Math.min(...ids.map((id) => pending[id].until));
    const timer = setTimeout(() => {
      setPending((current) => Object.fromEntries(Object.entries(current).filter(([, p]) => p.until > Date.now())));
    }, Math.max(0, soonest - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [pending]);

  // When the figures on screen were read; the Now view says so under its sentence.
  const [fetchedAt, setFetchedAt] = useState(null);
  useEffect(() => {
    if (!data) return;
    setFetchedAt(Date.now());
    logger.debug('home.entities.loaded', {
      count: data.entities?.length ?? 0, rooms: data.rooms?.length ?? 0, summary: Boolean(data.summary),
    });
  }, [data]);

  const toggle = useCallback(async (entity) => {
    if (entity.pending) return false;
    const expected = entity.stateClass === 'on' ? 'off' : 'on';
    setPending((p) => ({ ...p, [entity.id]: { expected, until: Date.now() + PENDING_MS } }));
    logger.info('home.entities.toggle', { entityId: entity.id, from: entity.stateClass, to: expected });
    try {
      // An explicit target, not 'toggle': a change someone else made between
      // render and tap must not be inverted.
      await DaylightAPI('api/v1/home-dashboard/toggle', { entityId: entity.id, desiredState: expected }, 'POST');
      return true;
    } catch (err) {
      logger.warn('home.entities.toggle.failed', { entityId: entity.id, error: err.message });
      setPending((p) => { const next = { ...p }; delete next[entity.id]; return next; });
      return false;
    } finally {
      reload();
    }
  }, [reload]);

  /** Turn off every entity given (a room's lit lamps); one request each, together. */
  const turnOff = useCallback(async (list) => {
    const lit = list.filter((e) => e.stateClass === 'on' && e.controllable && !e.pending);
    logger.info('home.entities.turn-off-many', { count: lit.length, entityIds: lit.map((e) => e.id) });
    const results = await Promise.all(lit.map((e) => toggle(e)));
    return results.every(Boolean);
  }, [toggle]);

  const entities = useMemo(() => (data?.entities || []).map((e) => (
    pending[e.id] ? { ...e, stateClass: pending[e.id].expected, state: pending[e.id].expected, pending: true } : e
  )), [data, pending]);

  return {
    entities,
    rooms: data?.rooms || [],
    types: data?.types || [],
    stateClasses: data?.stateClasses || [],
    haUrl: data?.haUrl || null,
    // Absent on a server that predates the Now view; the views degrade to the list.
    summary: data?.summary || null,
    fetchedAt,
    hasData: Boolean(data),
    loading, error, revalidating, reload, toggle, turnOff,
  };
}

export default useHomeEntities;
