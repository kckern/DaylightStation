// frontend/src/modules/Media/search/useLiveSearch.js
// Debounced live search over the streaming (SSE) search endpoint.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch.js';
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';

const SEARCH_ENDPOINT = '/api/v1/content/query/search/stream';

export function useLiveSearch({ scopeParams = '' } = {}) {
  const inner = useStreamingSearch(SEARCH_ENDPOINT, scopeParams);
  const lastQueryRef = useRef('');
  const timerRef = useRef(null);
  // True between first keystroke and debounce firing, so the UI shows
  // "Searching…" instead of flashing the EMPTY state during the gap.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const setQuery = useCallback((query) => {
    const queryChanged = query !== lastQueryRef.current;
    lastQueryRef.current = query;
    clearTimeout(timerRef.current);
    // Intent changes synchronously retire the prior generation. Waiting for
    // the debounce to call search() left the old SSE live while the wrapper
    // labelled its results with the newly typed query.
    if (queryChanged) inner.cancel();
    if (!query || query.length < 2) {
      // Short/empty queries clear hook state instantly — no debounce.
      setWaiting(false);
      inner.search(query, scopeParams);
      return;
    }
    setWaiting(true);
    timerRef.current = setTimeout(() => {
      setWaiting(false);
      mediaLog.searchIssued({ text: query, scopeParams });
      inner.search(query, scopeParams);
    }, TIMING.SEARCH_DEBOUNCE_MS);
  }, [inner, scopeParams]);

  const retry = useCallback((source) => {
    if (source) {
      inner.retry(source);
      return;
    }
    const q = lastQueryRef.current;
    if (q) setQuery(q);
  }, [inner, setQuery]);

  return {
    // SearchState belongs to the streaming reducer. Debounce is wrapper UI
    // state (`isSearching`) and must not relabel reducer results or phases.
    state: inner.state,
    results: inner.results,
    pending: inner.pending,
    isSearching: waiting || inner.isSearching,
    error: inner.error,
    sourceErrors: inner.sourceErrors ?? [],
    setQuery,
    retry,
  };
}

export default useLiveSearch;
