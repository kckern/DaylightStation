import { useCallback, useEffect, useRef, useState } from 'react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch.js';
import mediaLog from '../logging/mediaLog.js';

const SEARCH_ENDPOINT = '/api/v1/content/query/search/stream';
const DEBOUNCE_MS = 250;

export function useLiveSearch({ scopeParams = '' } = {}) {
  const inner = useStreamingSearch(SEARCH_ENDPOINT, scopeParams);
  const lastQueryRef = useRef('');
  const timerRef = useRef(null);
  // True between first keystroke and debounce firing, so the UI shows
  // "Searching…" instead of flashing the EMPTY state during the gap.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const setQuery = useCallback((query) => {
    lastQueryRef.current = query;
    clearTimeout(timerRef.current);
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
    }, DEBOUNCE_MS);
  }, [inner, scopeParams]);

  const retry = useCallback(() => {
    const q = lastQueryRef.current;
    if (q) setQuery(q);
  }, [setQuery]);

  return {
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
