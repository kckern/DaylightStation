import { useCallback, useEffect, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

/**
 * Single source of truth for the Finance dashboard's data lifecycle.
 * budgets + mortgage always load and refresh TOGETHER (a partial update
 * left the mortgage block stale — see 2026-07-06 finance audit §2.2).
 */
export function useFinanceData() {
  const [data, setData] = useState(null);       // { budgets, mortgage } | null
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { budgets, mortgage } = await DaylightAPI('api/v1/finance/data');
      setData({ budgets, mortgage });
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await DaylightAPI('api/v1/finance/refresh', {}, 'POST');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { data, error, refreshing, load, refresh };
}
