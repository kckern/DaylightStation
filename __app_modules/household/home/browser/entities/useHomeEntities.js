import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVisibleRefresh } from '@/lib/hooks/useVisibleRefresh.js';
import { invalidateApiResources, useApiResource } from '@/lib/hooks/useApiResource.js';
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
export function useHomeEntities({ active = true, refreshMs = REFRESH_MS } = {}) {
  const { data, loading, error, reload, revalidating, poll } = useApiResource(active ? PATH : null, { label: 'home entities', logger, swr: true });
  // A null deadline represents a command whose acknowledgement is still pending.
  const [pending, setPending] = useState({});
  const submitting = useRef(new Set());

  useVisibleRefresh({ active, intervalMs: refreshMs, reload, poll });

  // A reading retires a guess only when it agrees with it; a guess that the
  // platform never confirms expires, and the real state shows.
  useEffect(() => {
    if (!data) return;
    setPending((current) => {
      const ids = Object.keys(current);
      if (!ids.length) return current;
      const byId = new Map((data.entities || []).map((e) => [e.id, e]));
      const now = Date.now();
      const next = {};
      for (const id of ids) {
        const reading = byId.get(id);
        const intent = current[id];
        if (intent.until != null && (reading?.stateClass === intent.expected || now >= intent.until)) continue;
        next[id] = intent;
      }
      return next;
    });
  }, [data]);

  // Expire guesses even when no poll lands (tab hidden, platform slow).
  useEffect(() => {
    const deadlines = Object.values(pending).map(intent => intent.until).filter(until => until != null);
    if (!deadlines.length) return;
    const soonest = Math.min(...deadlines);
    const timer = setTimeout(() => {
      const now = Date.now();
      setPending(current => Object.fromEntries(Object.entries(current).filter(([, intent]) => intent.until == null || intent.until > now)));
    }, Math.max(0, soonest - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!data) return;
    logger.debug('home.entities.loaded', {
      count: data.entities?.length ?? 0, rooms: data.rooms?.length ?? 0, summary: Boolean(data.summary),
    });
  }, [data]);

  const toggle = useCallback(async (entity) => {
    const id = entity.id;
    if (entity.pending || submitting.current.has(id)) return false;
    submitting.current.add(id);
    const expected = entity.stateClass === 'on' ? 'off' : 'on';
    setPending(current => ({ ...current, [id]: { expected, until: null } }));
    logger.info('home.entities.toggle', { entityId: id, from: entity.stateClass, to: expected });
    try {
      // An explicit target, not 'toggle': a change someone else made between
      // render and tap must not be inverted.
      await DaylightAPI('api/v1/home-dashboard/toggle', { entityId: id, desiredState: expected }, 'POST');
      const until = Date.now() + PENDING_MS;
      setPending(current => ({ ...current, [id]: { expected, until } }));
      return true;
    } catch (err) {
      logger.warn('home.entities.toggle.failed', { entityId: id, error: err.message });
      setPending(current => { const next = { ...current }; delete next[id]; return next; });
      return false;
    } finally {
      submitting.current.delete(id);
      invalidateApiResources(path => path === PATH);
    }
  }, []);

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
    // The mosaic's groups (byRoom / byType); absent on an older server.
    mosaic: data?.mosaic || null,
    // Absent on an older server; the views degrade without it.
    summary: data?.summary || null,
    hasData: Boolean(data),
    loading, error, revalidating, reload, toggle, turnOff,
  };
}

export default useHomeEntities;
