import { useCallback, useEffect, useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';

const logger = createAppLogger('health').child('use-health-day');

export function useHealthDay(date) {
  // swr:true — a cached day (nutrilist + budget) renders immediately with
  // loading:false on mount/date-change, and a mutation's reload() revalidates
  // quietly in the background rather than flipping `loading` back to true.
  // This is what lets TodayView keep its headings/section frames mounted
  // permanently: `loading` only goes true on a genuine cold start (no cache
  // for this date yet), never on a refetch of a date already seen.
  const list = useApiResource(`api/v1/health/nutrilist/${date}`, { deps: [date], label: 'nutrilist', logger, swr: true });
  const budgetRes = useApiResource(`api/v1/health/budget?date=${date}`, { deps: [date], label: 'budget', logger, swr: true });

  // The day's rows: the endpoint serves {message, data:[...], date, count};
  // also tolerate bare array or {items} for backward compatibility.
  const items = useMemo(() => {
    const d = list.data;
    return Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : (Array.isArray(d?.items) ? d.items : []));
  }, [list.data]);

  const byBucket = useMemo(() => {
    const map = new Map([...BUCKETS.map((b) => [b.id, []]), [null, []]]);
    for (const row of items) {
      const key = map.has(row.mealTime) ? row.mealTime : null;
      map.get(key).push(row);
    }
    return map;
  }, [items]);

  const reload = useCallback(() => { list.reload(); budgetRes.reload(); }, [list.reload, budgetRes.reload]);

  const mutate = useCallback(async (action) => {
    try {
      await action();
    } finally {
      reload();
    }
  }, [reload]);

  // Kitchen-scale / Telegram entries appear when the tab regains focus.
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  return {
    items,
    byBucket,
    budget: budgetRes.error ? null : budgetRes.data,
    budgetError: budgetRes.error,
    loading: list.loading,
    // Either resource quietly refreshing in the background counts as
    // "revalidating" — the view uses this (rather than `loading`) to decide
    // whether anything at all should visually acknowledge an in-flight
    // refetch, and it must never be true at the same time as a cold `loading`.
    revalidating: list.revalidating || budgetRes.revalidating,
    error: list.error,
    reload,
    mutate,
  };
}

export default useHealthDay;
