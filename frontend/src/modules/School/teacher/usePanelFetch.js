/**
 * usePanelFetch — the teacher console's one fetch contract (spec §4.3).
 * Five states, so a panel can tell the difference between "nothing yet"
 * (empty — quiet zero-state), "this install doesn't have the feature"
 * (unavailable), and "the fetch broke" (error — named inline notice with a
 * retry). Fetches are per-panel and independent: one failing endpoint never
 * blanks its tab.
 *
 * Mapping knobs, because the same status means different things per read:
 *  - `notFoundAs`: a 404 is 'unavailable' for lifecycle-backed panels (the
 *    route isn't registered on this install), 'empty' for known
 *    404-as-empty reads (assignments for an unassigned learner), and the
 *    default 'error' otherwise.
 *  - `nullAs`: an ok-but-null body is 'unavailable' where null is the
 *    unwired tell (`/report-card`), default 'empty'.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { teacherLog } from './teacherLog.js';

const looksEmpty = (d) => (
  d == null
  || (Array.isArray(d) && d.length === 0)
  || (typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 0)
);

export function usePanelFetch(fetcher, {
  deps = [], isEmpty = looksEmpty, notFoundAs = 'error', nullAs = 'empty', panel = 'panel',
} = {}) {
  const [result, setResult] = useState({ state: 'loading', data: null, refreshing: false });
  const [attempt, setAttempt] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // The last good payload, for stale-while-revalidate retries: a manual retry
  // after success must not blank a perfectly good panel back to a skeleton.
  const lastGoodRef = useRef(null);

  const depsKeyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    // Deps changed = a different query (new learner/day) — stale data from
    // the old query must never show under the new one.
    const depsKey = JSON.stringify(deps);
    if (depsKeyRef.current !== depsKey) { lastGoodRef.current = null; depsKeyRef.current = depsKey; }
    const stale = attempt > 0 ? lastGoodRef.current : null;
    setResult(stale
      ? { state: stale.state, data: stale.data, refreshing: true }
      : { state: 'loading', data: null, refreshing: false });
    fetcherRef.current().then(({ ok, status, data }) => {
      if (!alive) return;
      if (!ok) {
        if (status === 404 && notFoundAs !== 'error') {
          if (notFoundAs === 'unavailable') teacherLog.fetch('unavailable', { panel, status });
          setResult({ state: notFoundAs, data: null, refreshing: false });
        } else {
          teacherLog.fetch('fetch-failed', { panel, status });
          // A failed REFRESH keeps the stale data on screen; only a first
          // load (nothing to show) surfaces the error state.
          setResult(stale
            ? { state: stale.state, data: stale.data, refreshing: false }
            : { state: 'error', data: null, refreshing: false });
        }
        return;
      }
      if (data === null) {
        if (nullAs === 'unavailable') teacherLog.fetch('unavailable', { panel, status });
        setResult({ state: nullAs, data: null, refreshing: false });
        return;
      }
      const next = isEmpty(data) ? { state: 'empty', data, refreshing: false } : { state: 'ok', data, refreshing: false };
      if (next.state === 'ok') lastGoodRef.current = { state: 'ok', data };
      setResult(next);
    }).catch((err) => {
      // schoolApi's req() never throws, but the hook is the module-wide
      // contract and callers pass composed closures — a rejection must land
      // in `error`, never leave the panel loading forever.
      if (!alive) return;
      teacherLog.fetchError('fetcher-threw', { panel, error: err?.message });
      setResult(stale
        ? { state: stale.state, data: stale.data, refreshing: false }
        : { state: 'error', data: null, refreshing: false });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...deps]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state: result.state, data: result.data, refreshing: result.refreshing, retry };
}

/** The single-banner rule: true only when EVERY lifecycle panel reported unavailable. */
export function allUnavailable(states) {
  return states.length > 0 && states.every((s) => s === 'unavailable');
}

export default usePanelFetch;
