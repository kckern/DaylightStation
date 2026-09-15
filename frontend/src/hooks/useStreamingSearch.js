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
 * Hook for streaming search via SSE with request-owned terminal cleanup.
 *
 * @param {string} endpoint - SSE endpoint URL (without query params)
 * @param {string} [extraQueryString] - Additional query params to append (e.g. 'capability=listable&source=plex')
 * @param {{streamDeadlineMs?: number}} [options] - test-only timing injection;
 *   production keeps the server-aligned 30 second stream budget.
 * @returns {{
 *   results: Array,
 *   pending: string[],
 *   isSearching: boolean,
 *   error: {kind: 'stream'|'connection'|'timeout', message: string}|null,
 *   search: (query: string, overrideExtraQuery?: string) => void,
 *   retry: (source?: string) => void,
 *   cancel: () => void
 * }}
 */
export function useStreamingSearch(endpoint, extraQueryString = '', options = {}) {
  const streamDeadlineMs = options.streamDeadlineMs ?? 30000;
  const [results, setResults] = useState([]);
  const [pending, setPending] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [sourceErrors, setSourceErrors] = useState([]);
  const queryRef = useRef('');
  const resultCountRef = useRef(0);
  const startedAtRef = useRef(null);
  const generationRef = useRef(0);
  const requestsRef = useRef(new Set());
  const currentSearchRef = useRef(null);
  const primaryPendingRef = useRef(new Set());

  const recomputePending = useCallback(() => {
    const names = new Set(primaryPendingRef.current);
    for (const request of requestsRef.current) {
      if (request.source && request.sourcePending) names.add(request.source);
    }
    setPending([...names]);
  }, []);

  const closeRequest = useCallback((request) => {
    if (!request?.active) return;
    request.active = false;
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    request.eventSource.close();
    requestsRef.current.delete(request);
  }, []);

  const cancelAllRequests = useCallback((reason) => {
    for (const request of [...requestsRef.current]) closeRequest(request);
    primaryPendingRef.current = new Set();
    if (reason) logger().debug('search.cancelled', { reason });
  }, [closeRequest]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAllRequests('unmount');
    };
  }, [cancelAllRequests]);

  const startRequest = useCallback((query, effectiveExtra, {
    preserveResults = false,
    source = null,
    replaceGeneration = true,
  } = {}) => {
    if (replaceGeneration) {
      cancelAllRequests('new-query');
      generationRef.current += 1;
      primaryPendingRef.current = new Set();
      setError(null);
      setSourceErrors([]);
      if (!preserveResults) {
        resultCountRef.current = 0;
        setResults([]);
      }
    } else {
      // A source retry is a sibling of the active primary stream. It must not
      // retire that stream: other sources may still be validly pending.
      setError(null);
      setSourceErrors(prev => prev.filter((entry) => entry.source !== source));
    }

    queryRef.current = query;
    if (replaceGeneration) {
      currentSearchRef.current = { query, effectiveExtra, generation: generationRef.current };
    }
    if (replaceGeneration) startedAtRef.current = Date.now();
    setIsSearching(true);
    recomputePending();

    const url = `${endpoint}?text=${encodeURIComponent(query)}${effectiveExtra ? '&' + effectiveExtra : ''}`;
    const eventSource = new EventSource(url);
    const request = {
      eventSource,
      generation: generationRef.current,
      query,
      source,
      sourcePending: Boolean(source),
      active: true,
      timer: null,
    };
    requestsRef.current.add(request);
    recomputePending();
    logger().info('search.started', {
      query,
      endpoint,
      filterParams: effectiveExtra || null,
      sourceRetry: source,
    });

    const isCurrent = () => request.active
      && request.generation === generationRef.current
      && requestsRef.current.has(request);

    const finish = ({ failure = null, promoteUnanswered = false, sourceError = null } = {}) => {
      if (!isCurrent()) return;
      // The backend's hard deadline ends the response without a `complete`
      // frame. Snapshot identity before close clears the pending bookkeeping,
      // so an ordinary connection/error terminal state retains retryable
      // sources but never invents one before the stream named it.
      const unanswered = request.source
        ? (request.sourcePending ? [request.source] : [])
        : [...primaryPendingRef.current];
      if (promoteUnanswered && unanswered.length > 0) {
        setSourceErrors(prev => {
          const existing = new Set(prev.map((entry) => entry.source));
          return [...prev, ...unanswered
            .filter((name) => !existing.has(name))
            .map((name) => ({ source: name, error: sourceError ?? failure?.message ?? 'Search stream ended before all sources answered.' }))];
        });
      }
      closeRequest(request);
      if (request.source) request.sourcePending = false;
      else primaryPendingRef.current = new Set();
      if (failure) setError(failure);
      recomputePending();
      if (requestsRef.current.size === 0) setIsSearching(false);
    };

    const timeout = () => {
      if (!isCurrent()) return;
      logger().warn('search.timeout', { query: request.query, source: request.source, deadlineMs: streamDeadlineMs });
      finish({
        failure: { kind: 'timeout', message: 'Search service did not complete in time. Please retry.' },
        promoteUnanswered: true,
        sourceError: 'Search stream timed out.',
      });
    };
    request.timer = setTimeout(timeout, streamDeadlineMs);

    eventSource.onmessage = (event) => {
      if (!isCurrent()) {
        eventSource.close();
        return;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.event === 'pending') {
          if (request.source) request.sourcePending = true;
          else primaryPendingRef.current = new Set(Array.isArray(data.sources) ? data.sources : []);
          recomputePending();
        } else if (data.event === 'results') {
          const newItems = data.items?.length || 0;
          setResults(prev => {
            const merged = mergeSearchResults(prev, data.items ?? [], request.query);
            resultCountRef.current = merged.length;
            return merged;
          });
          logger().info('search.results-received', { source: data.source, newItems });
          if (request.source) request.sourcePending = false;
          else primaryPendingRef.current = new Set(Array.isArray(data.pending) ? data.pending : []);
          recomputePending();
        } else if (data.event === 'complete') {
          logger().info('search.completed', {
            query: request.query,
            resultCount: resultCountRef.current,
            totalMs: startedAtRef.current ? Date.now() - startedAtRef.current : null,
          });
          finish();
        } else if (data.event === 'source_error') {
          logger().warn('search.source-error', { query: request.query, source: data.source, error: data.error });
          setSourceErrors(prev => (
            prev.some((entry) => entry.source === data.source)
              ? prev
              : [...prev, { source: data.source, error: data.error }]
          ));
          if (request.source) request.sourcePending = false;
          else if (Array.isArray(data.pending)) primaryPendingRef.current = new Set(data.pending);
          else primaryPendingRef.current.delete(data.source);
          recomputePending();
        } else if (data.event === 'error') {
          logger().warn('search.error', { query: request.query, error: data.message });
          finish({
            failure: { kind: 'stream', message: data.message ?? 'Search adapter reported an error.' },
            promoteUnanswered: true,
          });
        }
      } catch {
        // Ignore malformed JSON; the deadline still bounds a malformed stream.
      }
    };

    eventSource.onerror = () => {
      if (!isCurrent()) {
        eventSource.close();
        return;
      }
      logger().warn('search.connection-error', { endpoint });
      finish({
        failure: { kind: 'connection', message: 'Lost connection to the search service.' },
        promoteUnanswered: true,
      });
    };
  }, [cancelAllRequests, closeRequest, endpoint, recomputePending, streamDeadlineMs]);

  const search = useCallback((query, overrideExtraQuery) => {
    // Short queries: clear and don't search
    if (!query || query.length < 2) {
      cancelAllRequests('clear-or-short-query');
      generationRef.current += 1;
      currentSearchRef.current = null;
      setError(null);
      setResults([]);
      setPending([]);
      setSourceErrors([]);
      setIsSearching(false);
      return;
    }

    // Use override if provided, otherwise use hook-level extraQueryString
    const effectiveExtra = overrideExtraQuery !== undefined ? overrideExtraQuery : extraQueryString;
    startRequest(query, effectiveExtra);
  }, [cancelAllRequests, extraQueryString, startRequest]);

  // Intent can change before a consumer's debounce has chosen the next query.
  // Revoke synchronously rather than leaving the old stream current for that
  // gap; `search()` will start the replacement later without a second engine.
  const cancel = useCallback(() => {
    cancelAllRequests('superseded-intent');
    generationRef.current += 1;
    currentSearchRef.current = null;
    queryRef.current = '';
    resultCountRef.current = 0;
    setResults([]);
    setPending([]);
    setError(null);
    setSourceErrors([]);
    setIsSearching(false);
  }, [cancelAllRequests]);

  const retry = useCallback((source) => {
    const current = currentSearchRef.current;
    if (!current?.query) return;
    if (!source) {
      startRequest(current.query, current.effectiveExtra);
      return;
    }
    // The status control can receive repeated click/keyboard activation while
    // its first retry is still opening. One source owns at most one sibling
    // request in a generation; duplicate streams add no information and make
    // terminal ordering ambiguous.
    if ([...requestsRef.current].some((request) => (
      request.active
      && request.generation === current.generation
      && request.source === source
    ))) return;
    const params = new URLSearchParams(current.effectiveExtra);
    params.delete('source');
    params.set('source', source);
    startRequest(current.query, params.toString(), {
      preserveResults: true,
      source,
      replaceGeneration: false,
    });
  }, [startRequest]);

  return { results, pending, isSearching, error, sourceErrors, search, retry, cancel };
}

export default useStreamingSearch;
