//
// The ONE client-side reader of GET /api/v1/health/budget/range.
//
// Every range surface (the week strip, the desktop month block, the
// intake-vs-burn chart, the progress adherence bars) goes through this hook so
// there is a single path spelling and a single cache key per range. `swr: true`
// matters here specifically: the hook's per-path generation token is what stops
// two mounted components asking for the same range and letting the slower,
// older answer win the cache (useApiResource.js).
//
// It does NOT dedupe two simultaneous mounts of the same range into one HTTP
// request — the hook has no in-flight registry. The fix for that is structural
// and is applied by the callers: a range that more than one widget shows is
// fetched ONCE, high in the tree, and handed down as `days`. This hook is for
// the widget that genuinely owns its range.
import { useMemo } from 'react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('budget-range');

/**
 * @param {string} from - YYYY-MM-DD, inclusive
 * @param {string} to - YYYY-MM-DD, inclusive
 * @returns {{ days: Array, byDate: Map, loading: boolean, error: any, reload: Function }}
 *   `days` is the server's array verbatim: an entry is either a computed day or
 *   a gap `{ date, error }`. Gaps are NOT filtered out — a caller that wants to
 *   draw a hole needs to know where the holes are.
 */
export function useBudgetRange(from, to, { enabled = true } = {}) {
  const path = from && to ? `api/v1/health/budget/range?from=${from}&to=${to}` : null;
  const res = useApiResource(path, { label: 'budget-range', logger, swr: true, enabled });
  const days = useMemo(() => res.data?.days || [], [res.data]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  return { days, byDate, loading: res.loading, error: res.error, reload: res.reload };
}

export default useBudgetRange;
