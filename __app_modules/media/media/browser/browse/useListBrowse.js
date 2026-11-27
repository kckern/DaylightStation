import { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { isApiResourceFresh, peekApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { useRefreshableRead } from '@/lib/hooks/useRefreshableRead.js';
import { mediaLog } from "../logging/mediaLog.js";
import { buildPath } from "./browsePath.js";

/** A first page a prefetch (browse/prefetchBrowse.js) already holds, fresh. */
function warmPage(url, attempt) {
  if (attempt !== 0 || !isApiResourceFresh(url)) return null;
  const res = peekApiResource(url);
  if (!res) return null;
  return { url, attempt, items: Array.isArray(res.items) ? res.items : EMPTY_ITEMS, total: typeof res.total === 'number' ? res.total : 0, warm: true };
}

// A Back restore re-fetches every row the person had scrolled through in one
// request; beyond this it would be a rare, heavy request for little gain.
const MAX_INITIAL_TAKE = 1000;
const EMPTY_ITEMS = [];

/**
 * @param {number} [options.initialTake] - Rows to fetch in the FIRST request
 *   (never fewer than `take`). Returning to a list passes how many rows were
 *   loaded when the person left, so the row they came back to exists again.
 * @param {Function} [options.onPageAppended] - Capture view state before the
 *   accepted append changes the rendered list.
 */
export function useListBrowse(path, { modifiers = {}, take = 50, initialTake = 0, onPageAppended } = {}) {
  const firstTake = Math.min(Math.max(take, Number(initialTake) || 0), Math.max(take, MAX_INITIAL_TAKE));
  const base = buildPath(path, { modifiers });
  const initialUrl = `${base}?take=${firstTake}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [append, setAppend] = useState(null);
  // A page prefetched on hover paints at once: no skeleton, no second request.
  const page = (result?.url === initialUrl && result.attempt === attempt ? result : null) ?? warmPage(initialUrl, attempt);
  const items = page?.items ?? EMPTY_ITEMS;
  const total = page?.total ?? 0;
  const error = page?.error ?? null;
  const nextUrl = `${base}?take=${take}&skip=${items.length}`;
  const activeAppend = append?.page === page && append.url === nextUrl ? append : null;
  const hasMore = Boolean(page) && !error && items.length < total;

  const readFirst = useCallback(async (isCurrent, signal) => {
    const warm = warmPage(initialUrl, attempt);
    if (warm) {
      setResult(warm);
      setAppend(null);
      return;
    }
    setResult(null);
    setAppend(null);
    try {
      const res = await DaylightAPI(initialUrl, {}, 'GET', { signal });
      if (!isCurrent()) return;
      const items = Array.isArray(res?.items) ? res.items : EMPTY_ITEMS;
      const total = typeof res?.total === 'number' ? res.total : 0;
      setResult({ url: initialUrl, attempt, items, total });
    } catch (err) {
      if (!isCurrent()) return;
      mediaLog.loadFailed({ surface: 'browse', path, error: err?.message });
      setResult({ url: initialUrl, attempt, error: err });
    }
  }, [initialUrl, attempt, path]);
  const { reload: readInitialPage } = useRefreshableRead(readFirst);
  useEffect(() => { readInitialPage(); }, [readInitialPage]);

  const readMore = useCallback(async (isCurrent, signal) => {
    if (!hasMore) return;
    setAppend(current => ({
      page, url: nextUrl, loading: true,
      error: current?.page === page && current.url === nextUrl ? current.error : null,
    }));
    try {
      const res = await DaylightAPI(nextUrl, {}, 'GET', { signal });
      if (!isCurrent()) return;
      const added = Array.isArray(res?.items) ? res.items : EMPTY_ITEMS;
      onPageAppended?.(added);
      setResult({
        ...page,
        items: page.items.concat(added),
        // An empty slice ends this traversal even if the prior total is stale.
        total: added.length ? page.total : page.items.length,
      });
      setAppend(null);
    } catch (err) {
      if (!isCurrent()) return;
      setAppend({ page, url: nextUrl, error: err, loading: false });
    }
  }, [page, nextUrl, hasMore, onPageAppended]);
  const { poll: loadMore } = useRefreshableRead(readMore);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    items, total, loading: !page, error,
    loadingMore: Boolean(activeAppend?.loading), appendError: activeAppend?.error ?? null,
    loadMore, reload,
  };
}

export default useListBrowse;
