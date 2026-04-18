import { useCallback } from 'react';
import { useStreamingSearch } from '../../../hooks/useStreamingSearch.js';
import mediaLog from '../logging/mediaLog.js';

const SEARCH_ENDPOINT = '/api/v1/content/query/search/stream';

export function useLiveSearch({ scopeParams = '' } = {}) {
  const inner = useStreamingSearch(SEARCH_ENDPOINT, scopeParams);

  const setQuery = useCallback((query) => {
    mediaLog.searchIssued({ text: query, scopeParams });
    inner.search(query, scopeParams);
  }, [inner, scopeParams]);

  return {
    results: inner.results,
    pending: inner.pending,
    isSearching: inner.isSearching,
    setQuery,
  };
}

export default useLiveSearch;
