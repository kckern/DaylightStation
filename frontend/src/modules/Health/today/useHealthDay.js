import { useCallback, useEffect, useMemo, useRef } from 'react';
import { summarizeDayQuality } from './dayQuality.js';
import { useApiResource, peekApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';
import { noteVisibleRows } from './addFlow.js';
import { refreshHealthResources, healthDayPath } from '../healthResources.js';

const logger = createAppLogger('health').child('use-health-day');

export function useHealthDay(date, { enabled = true } = {}) {
  // `day.view`: once per viewed date, whether the day painted from the swr
  // cache (a prefetch or an earlier visit) and how long it took to have data.
  // The cache is peeked BEFORE the reader below runs, so a hit is a real hit.
  const view = useRef(null);
  if (enabled && view.current?.date !== date) {
    view.current = { date, startedAt: performance.now(), fromCache: peekApiResource(healthDayPath(date)) !== undefined, logged: false };
  }
  // swr:true — a cached day (nutrilist + budget) renders immediately with
  // loading:false on mount/date-change, and a mutation's reload() revalidates
  // quietly in the background rather than flipping `loading` back to true.
  // This is what lets TodayView keep its headings/section frames mounted
  // permanently: `loading` only goes true on a genuine cold start (no cache
  // for this date yet), never on a refetch of a date already seen.
  const list = useApiResource(healthDayPath(date), { deps: [date], enabled, label: 'health-day', logger, swr: true });

  // The day's rows: the endpoint serves {message, data:[...], date, count};
  // also tolerate bare array or {items} for backward compatibility.
  const items = useMemo(() => {
    const d = list.data;
    return Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : (Array.isArray(d?.items) ? d.items : []));
  }, [list.data]);

  // An add from the add row completes (add.flow) when its rows are here.
  useEffect(() => { if (enabled) noteVisibleRows(items); }, [enabled, items]);

  const byBucket = useMemo(() => {
    const map = new Map([...BUCKETS.map((b) => [b.id, []]), [null, []]]);
    for (const row of items) {
      const key = map.has(row.mealTime) ? row.mealTime : null;
      map.get(key).push(row);
    }
    return map;
  }, [items]);

  useEffect(() => {
    const current = view.current;
    if (!enabled || !list.data || !current || current.logged || current.date !== date) return;
    current.logged = true;
    logger.info('day.view', { date, fromCache: current.fromCache, paintMs: Math.round(performance.now() - current.startedAt) });
  }, [enabled, date, list.data]);

  // One data-quality census per (date, ledger revision) — not per poll — so
  // the log store can answer "which days render gaps, and why" without a
  // screenshot. Clean days log nothing.
  const revision = list.data?.revision ?? null;
  const qualityLogged = useRef(null);
  useEffect(() => {
    if (!enabled || !list.data) return;
    const key = `${date}@${revision}`;
    if (qualityLogged.current === key) return;
    qualityLogged.current = key;
    const summary = summarizeDayQuality(items);
    if (summary.issues > 0) logger.info('day.quality', { date, revision, ...summary });
  }, [enabled, list.data, date, revision, items]);

  const reload = refreshHealthResources;

  const mutate = useCallback(async (action) => {
    try {
      await action();
    } finally {
      reload();
    }
  }, [reload]);

  // Kitchen-scale / Telegram entries appear when the tab regains focus.
  useEffect(() => {
    if (!enabled) return undefined;
    window.addEventListener('focus', reload);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(onVisible, 15000);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [reload, enabled]);

  return {
    items,
    byBucket,
    budget: list.data?.budget ?? null,
    budgetError: list.data?.budgetError ?? null,
    revision: list.data?.revision ?? null,
    loading: list.loading,
    // Either resource quietly refreshing in the background counts as
    // "revalidating" — the view uses this (rather than `loading`) to decide
    // whether anything at all should visually acknowledge an in-flight
    // refetch, and it must never be true at the same time as a cold `loading`.
    revalidating: list.revalidating,
    error: list.error,
    reload,
    mutate,
  };
}

export default useHealthDay;
