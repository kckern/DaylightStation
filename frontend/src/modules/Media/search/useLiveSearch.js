import { useCallback, useRef } from 'react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch.js';
import mediaLog from '../logging/mediaLog.js';

const SEARCH_ENDPOINT = '/api/v1/content/query/search/stream';

export function useLiveSearch({ scopeParams = '' } = {}) {
  const inner = useStreamingSearch(SEARCH_ENDPOINT, scopeParams);
  const lastQueryRef = useRef('');

  const setQuery = useCallback((query) => {
    lastQueryRef.current = query;
    mediaLog.searchIssued({ text: query, scopeParams });
    inner.search(query, scopeParams);
  }, [inner, scopeParams]);

  const retry = useCallback(() => {
    const q = lastQueryRef.current;
    if (q) setQuery(q);
  }, [setQuery]);

  return {
    results: inner.results,
    pending: inner.pending,
    isSearching: inner.isSearching,
    error: inner.error,
    setQuery,
    retry,
  };
}

export default useLiveSearch;
