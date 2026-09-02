import { useCallback, useEffect, useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { BUCKETS } from './mealBuckets.js';

const logger = createAppLogger('health').child('use-health-day');

export function useHealthDay(date) {
  const list = useApiResource(`api/v1/health/nutrilist/${date}`, { deps: [date], label: 'nutrilist', logger });
  const budgetRes = useApiResource(`api/v1/health/budget?date=${date}`, { deps: [date], label: 'budget', logger });

  // The day's rows: the endpoint serves the array directly (Nutrition.jsx
  // precedent); unwrap an {items} envelope defensively.
  const items = useMemo(() => {
    const d = list.data;
    return Array.isArray(d) ? d : (Array.isArray(d?.items) ? d.items : []);
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
    error: list.error,
    reload,
    mutate,
  };
}

export default useHealthDay;
