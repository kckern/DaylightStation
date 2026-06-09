export const SEARCH_STATE = Object.freeze({
  IDLE: 'idle',
  SEARCHING: 'searching',
  RESULTS: 'results',
  EMPTY: 'empty',
  ERROR: 'error',
});

export function deriveSearchState({ query, isSearching, results, error }) {
  const q = (query ?? '').trim();
  if (q.length < 2) return { kind: SEARCH_STATE.IDLE };
  // Content-ID-like queries (e.g. `frozen: part 2`, `plex-main:12345`) search
  // normally; the deep-link affordance is a pinned row in SearchBar, not a hijack.
  if (Array.isArray(results) && results.length > 0) return { kind: SEARCH_STATE.RESULTS, results };
  if (error) return { kind: SEARCH_STATE.ERROR, error };
  if (isSearching) return { kind: SEARCH_STATE.SEARCHING };
  return { kind: SEARCH_STATE.EMPTY, query: q };
}
