import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { mediaLog } from '../logging/mediaLog.js';

function buildPath(path, { modifiers = {} }) {
  const clean = String(path).replace(/^\/|\/$/g, '');
  const segs = [clean];
  if (modifiers.playable) segs.push('playable');
  if (modifiers.shuffle) segs.push('shuffle');
  if (modifiers.recent_on_top) segs.push('recent_on_top');
  // Opt out of the router's season-as-one-tile wrapping: browsing a season
  // must list its episodes, not the season itself (defect 14).
  if (modifiers.expand) segs.push('expand');
  return `api/v1/list/${segs.join('/')}`;
}

// A Back restore re-fetches every row the person had scrolled through in one
// request; beyond this it would be a rare, heavy request for little gain.
const MAX_INITIAL_TAKE = 1000;

/**
 * @param {number} [options.initialTake] - Rows to fetch in the FIRST request
 *   (never fewer than `take`). Returning to a list passes how many rows were
 *   loaded when the person left, so the row they came back to exists again.
 */
export function useListBrowse(path, { modifiers = {}, take = 50, initialTake = 0 } = {}) {
  const firstTake = Math.min(Math.max(take, Number(initialTake) || 0), Math.max(take, MAX_INITIAL_TAKE));
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const skipRef = useRef(0);
  const baseRef = useRef('');
  const totalRef = useRef(0);
  const generationRef = useRef(0);
  const readyGenerationRef = useRef(null);
  const loadMoreInFlightRef = useRef(null);

  useEffect(() => {
    const base = buildPath(path, { modifiers });
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    baseRef.current = base;
    skipRef.current = 0;
    totalRef.current = 0;
    readyGenerationRef.current = null;
    loadMoreInFlightRef.current = null;
    setItems([]);
    setLoading(true);
    setLoadingMore(false);
    setError(null);

    let cancelled = false;
    DaylightAPI(`${base}?take=${firstTake}`)
      .then((res) => {
        if (cancelled || generationRef.current !== generation) return;
        const nextItems = Array.isArray(res?.items) ? res.items : [];
        const nextTotal = typeof res?.total === 'number' ? res.total : 0;
        setItems(nextItems);
        setTotal(nextTotal);
        totalRef.current = nextTotal;
        skipRef.current = nextItems.length;
        readyGenerationRef.current = generation;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || generationRef.current !== generation) return;
        mediaLog.loadFailed({ surface: 'browse', path, error: err?.message });
        setError(err);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, take, firstTake, attempt, modifiers.playable, modifiers.shuffle, modifiers.recent_on_top, modifiers.expand]);

  const loadMore = useCallback(async () => {
    const generation = generationRef.current;
    if (readyGenerationRef.current !== generation) return;
    if (loadMoreInFlightRef.current?.generation === generation || skipRef.current >= totalRef.current) return;
    const base = baseRef.current;
    const skip = skipRef.current;
    const request = { generation, base, skip };
    const url = `${base}?take=${take}&skip=${skip}`;
    loadMoreInFlightRef.current = request;
    setLoadingMore(true);
    try {
      const res = await DaylightAPI(url);
      if (generationRef.current !== generation || baseRef.current !== base
        || readyGenerationRef.current !== generation || skipRef.current !== skip) return;
      const nextItems = Array.isArray(res?.items) ? res.items : [];
      setItems((prev) => prev.concat(nextItems));
      skipRef.current = skip + nextItems.length;
    } catch (err) {
      if (generationRef.current === generation) setError(err);
    } finally {
      if (loadMoreInFlightRef.current === request) loadMoreInFlightRef.current = null;
      if (generationRef.current === generation) setLoadingMore(false);
    }
  }, [take]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { items, total, loading, loadingMore, error, loadMore, reload };
}

export default useListBrowse;
