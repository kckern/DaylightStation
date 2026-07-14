// frontend/src/hooks/useStreamingSearch.js
import { useState, useCallback, useRef, useEffect } from 'react';
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useStreamingSearch' });
  return _logger;
}

// ---- Relevance ordering (pure helpers, exported for tests) -----------------

/** Titles that look like machine filenames (timestamps, long token blobs). */
export function looksLikeMachineTitle(title) {
  if (!title) return false;
  const t = String(title).trim();
  return /^\d{8,}/.test(t) || (!t.includes(' ') && t.length > 25);
}

const CONTAINER_TYPES = new Set([
  'show', 'series', 'season', 'artist', 'album', 'collection', 'container', 'playlist',
]);

function itemType(item) {
  return String(item?.type ?? item?.metadata?.type ?? item?.mediaType ?? '').toLowerCase();
}

/**
 * Relevance score for a streamed search item. Prefers the backend-provided
 * `item.score` when present; otherwise computes a local fallback so results
 * still rank sensibly against older backends.
 */
export function scoreSearchResult(item, query) {
  if (typeof item?.score === 'number' && Number.isFinite(item.score)) return item.score;
  let score = 0;
  const title = String(item?.title ?? '').trim().toLowerCase();
  const q = String(query ?? '').trim().toLowerCase();
  if (title && q) {
    if (title === q) score += 20;
    else if (title.startsWith(q)) score += 10;
    else if (title.includes(q)) score += 5;
  }
  if (CONTAINER_TYPES.has(itemType(item))) score += 3; // curated containers over loose files
  if (looksLikeMachineTitle(item?.title)) score -= 10; // fitness-recording style junk
  return score;
}

function itemId(item) {
  return item?.id ?? item?.itemId ?? null;
}

function itemSource(item) {
  if (item?.source) return String(item.source).toLowerCase();
  const id = String(itemId(item) ?? '');
  const sep = id.indexOf(':');
  return sep > 0 ? id.slice(0, sep).toLowerCase() : null;
}

/** Key for cross-source near-duplicate collapse (plex vs abs audiobooks). */
function crossSourceKey(item) {
  const title = String(item?.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!title) return null;
  return `${title}|${String(item?.mediaType ?? '').toLowerCase()}`;
}

/**
 * Merge a newly-arrived batch into the sorted result list.
 * - Deduped by item id (first occurrence wins).
 * - Cross-source near-duplicates (same normalized title + mediaType from both
 *   plex and abs) collapse to the plex item, whichever order they arrive in.
 * - Sorted by score descending; stable by arrival order within equal scores.
 * Items are annotated with `_score` / `_arrival` (additive, non-enumerated by
 * consumers, mirrors the backend's `_idMatch` convention).
 */
export function mergeSearchResults(prev, incoming, query) {
  const next = [...prev];
  const seenIds = new Set(next.map((it) => itemId(it)).filter(Boolean));
  const crossIndex = new Map(); // crossSourceKey -> index in next (plex/abs only)
  next.forEach((it, i) => {
    const src = itemSource(it);
    if (src !== 'plex' && src !== 'abs') return;
    const key = crossSourceKey(it);
    if (key && !crossIndex.has(key)) crossIndex.set(key, i);
  });
  let arrival = next.reduce((max, it) => Math.max(max, it._arrival ?? 0), 0);

  for (const raw of incoming ?? []) {
    const id = itemId(raw);
    if (id && seenIds.has(id)) continue; // first occurrence wins
    const src = itemSource(raw);
    const key = (src === 'plex' || src === 'abs') ? crossSourceKey(raw) : null;
    const item = { ...raw, _score: scoreSearchResult(raw, query), _arrival: ++arrival };

    if (key && crossIndex.has(key)) {
      const at = crossIndex.get(key);
      const existingSrc = itemSource(next[at]);
      // Only collapse across DIFFERENT sources (plex+abs pair for the same
      // work). Same-source title twins (e.g. two episodes named "Pilot")
      // are distinct items and fall through to a normal append.
      if (src === 'plex' && existingSrc === 'abs') {
        // Plex wins the pair: replace the abs copy in place.
        const oldId = itemId(next[at]);
        if (oldId) seenIds.delete(oldId);
        next[at] = item;
        if (id) seenIds.add(id);
        continue;
      }
      if (src === 'abs' && existingSrc === 'plex') continue; // plex already present
    }

    if (key && !crossIndex.has(key)) crossIndex.set(key, next.length);
    next.push(item);
    if (id) seenIds.add(id);
  }

  next.sort((a, b) => (b._score - a._score) || (a._arrival - b._arrival));
  return next;
}

/**
 * Hook for streaming search via SSE with AbortController for race condition handling.
 *
 * @param {string} endpoint - SSE endpoint URL (without query params)
 * @param {string} [extraQueryString] - Additional query params to append (e.g. 'capability=listable&source=plex')
 * @returns {{
 *   results: Array,
 *   pending: string[],
 *   isSearching: boolean,
 *   error: {kind: 'stream'|'connection', message: string}|null,
 *   search: (query: string, overrideExtraQuery?: string) => void
 * }}
 */
export function useStreamingSearch(endpoint, extraQueryString = '') {
  const [results, setResults] = useState([]);
  const [pending, setPending] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [sourceErrors, setSourceErrors] = useState([]);
  const eventSourceRef = useRef(null);
  const queryRef = useRef('');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const search = useCallback((query, overrideExtraQuery) => {
    // Cancel any in-flight request
    if (eventSourceRef.current) {
      logger().debug('search.cancelled', { reason: 'new-query' });
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setError(null);

    // Short queries: clear and don't search
    if (!query || query.length < 2) {
      setResults([]);
      setPending([]);
      setSourceErrors([]);
      setIsSearching(false);
      return;
    }

    // Use override if provided, otherwise use hook-level extraQueryString
    const effectiveExtra = overrideExtraQuery !== undefined ? overrideExtraQuery : extraQueryString;

    // Start new search
    queryRef.current = query;
    setIsSearching(true);
    logger().info('search.started', { query, endpoint, filterParams: effectiveExtra || null });
    setResults([]);
    setPending([]);
    setSourceErrors([]);

    const url = `${endpoint}?text=${encodeURIComponent(query)}${effectiveExtra ? '&' + effectiveExtra : ''}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      // Check if this request was cancelled
      if (eventSourceRef.current !== eventSource) {
        eventSource.close();
        return;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.event === 'pending') {
          setPending(data.sources);
        } else if (data.event === 'results') {
          const newItems = data.items?.length || 0;
          // Keep the list relevance-sorted as batches arrive: dedupe, collapse
          // plex/abs near-duplicates, insert by score (arrival-stable ties).
          setResults(prev => mergeSearchResults(prev, data.items ?? [], queryRef.current));
          logger().info('search.results-received', { source: data.source, newItems });
          setPending(data.pending);
        } else if (data.event === 'complete') {
          logger().info('search.completed', { query });
          setPending([]);
          setIsSearching(false);
          eventSource.close();
        } else if (data.event === 'source_error') {
          logger().warn('search.source-error', { query, source: data.source, error: data.error });
          setSourceErrors(prev => [...prev, { source: data.source, error: data.error }]);
          if (Array.isArray(data.pending)) setPending(data.pending);
        } else if (data.event === 'error') {
          logger().warn('search.error', { query, error: data.message });
          setError({ kind: 'stream', message: data.message ?? 'Search adapter reported an error.' });
          setIsSearching(false);
          setPending([]);
          eventSource.close();
        }
      } catch {
        // Ignore malformed JSON
      }
    };

    eventSource.onerror = () => {
      logger().warn('search.connection-error', { endpoint });
      if (eventSourceRef.current === eventSource) {
        setError({ kind: 'connection', message: 'Lost connection to the search service.' });
        setIsSearching(false);
        setPending([]);
      }
      eventSource.close();
    };
  }, [endpoint, extraQueryString]);

  return { results, pending, isSearching, error, sourceErrors, search };
}

export default useStreamingSearch;
