export const SEARCH_STATE = Object.freeze({
  IDLE: 'idle',
  SEARCHING: 'searching',
  RESULTS: 'results',
  EMPTY: 'empty',
  ERROR: 'error',
});

// Recognises `source:localId` content ID shapes.
const CONTENT_ID_RE = /^([a-z][a-z0-9-]*):(.+)$/i;

export function deriveSearchState({ query, isSearching, results, error }) {
  const q = (query ?? '').trim();
  if (q.length < 2) return { kind: SEARCH_STATE.IDLE };
  // Content-ID input (e.g. plex-main:12345) shows the deep-link affordance,
  // which lives inside SearchIdleState — return IDLE so it renders.
  if (CONTENT_ID_RE.test(q)) return { kind: SEARCH_STATE.IDLE };
  if (Array.isArray(results) && results.length > 0) return { kind: SEARCH_STATE.RESULTS, results };
  if (error) return { kind: SEARCH_STATE.ERROR, error };
  if (isSearching) return { kind: SEARCH_STATE.SEARCHING };
  return { kind: SEARCH_STATE.EMPTY, query: q };
}
