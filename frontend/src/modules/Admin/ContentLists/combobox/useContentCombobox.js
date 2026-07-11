// useContentCombobox.js — the side-effect layer around the pure combobox
// machine (comboboxMachine.js). Owns every fetch, debounce timer, and cache
// interaction; the machine owns every state transition. Behavior is ported
// from the two prior implementations (ContentSearchCombobox.jsx standalone,
// ListsItemRow.jsx inline) — including the audit fixes:
//   S1 — DRILL_LOADED/WENT_UP carry their own pagination, so a drilled level
//        can never inherit the siblings window (structural, via the machine).
//   S5 — doBatchSearch lists `searchParams` in its deps, so a prop change
//        reaches the batch fallback URL (the standalone had a stale closure).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useDebouncedCallback } from '@mantine/hooks';
import { useStreamingSearch } from '../../../../hooks/useStreamingSearch';
import { getChildLogger } from '../../../../lib/logging/singleton.js';
import { isContentIdLike } from '../contentSearchLogic.js';
import { getCacheEntry, setCacheEntry } from '../siblingsCache.js';
import { reducer, initialState, closeDecision, Modes } from './comboboxMachine.js';

const SEARCH_STREAM_ENDPOINT = '/api/v1/content/query/search/stream';
const SEARCH_BATCH_ENDPOINT = '/api/v1/content/query/search';
// The non-SSE batch fallback caps results; the SSE stream does not. Only the
// batch path can truncate, so the "showing first N" affordance (audit S6) is
// gated on it hitting this cap.
const BATCH_TAKE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 21;
const TITLE_CACHE_MAX = 500;

/** Check if the browser supports Server-Sent Events. */
function supportsSSE() {
  return typeof EventSource !== 'undefined';
}

function normalizeListSource(source) {
  return source === 'list' ? 'menu' : source;
}

/** Split `source:localId`, tolerating the legacy `source: localId` spacing. */
function splitContentId(contentId) {
  if (typeof contentId !== 'string') return null;
  const colonIndex = contentId.indexOf(':');
  if (colonIndex === -1) return null;
  return {
    source: normalizeListSource(contentId.slice(0, colonIndex).trim()),
    localId: contentId.slice(colonIndex + 1).trim(),
  };
}

const normalizeValue = (v) => v?.replace(/:\s+/g, ':');

// Process-lifetime cache of contentId -> human title so the resolved-title
// line renders instantly for items we've already seen. Exported for tests.
export const titleCache = new Map();

function rememberTitle(contentId, title) {
  if (!contentId || !title) return;
  if (titleCache.size > TITLE_CACHE_MAX) titleCache.clear();
  titleCache.set(contentId, title);
}

// Map a raw /siblings API item into the shared cache shape (same mapping as
// ListsItemRow's doFetchSiblings, plus `id` so machine items are uniform).
function toBrowseItem(item) {
  return {
    id: item.id,
    value: item.id,
    title: item.title,
    source: item.source,
    type: item.type || item.itemType,
    thumbnail: item.thumbnail,
    grandparent: item.grandparentTitle,
    parent: item.parentTitle,
    library: item.libraryTitle,
    itemCount: item.childCount ?? null,
    itemIndex: item.itemIndex ?? null,
    number: item.number ?? null,
    isContainer: item.isContainer || item.itemType === 'container',
  };
}

// Cache entries written by ListsItemRow's preloader key items on `value`.
const ensureId = (item) => (item.id != null ? item : { ...item, id: item.value });

function parentToCrumb(parent, fallbackSource) {
  return {
    id: parent.id,
    title: parent.title,
    source: parent.source || fallbackSource,
    localId: parent.id?.split(':').slice(1).join(':'),
  };
}

/**
 * Fetch siblings of a content id and shape the result for the shared
 * siblingsCache ({browseItems, currentParent, pagination, referenceIndex}).
 */
async function fetchSiblingsData(contentId) {
  const parsed = splitContentId(contentId);
  if (!parsed) return null;
  const { source, localId } = parsed;
  const response = await fetch(`/api/v1/siblings/${source}/${encodeURIComponent(localId)}`);
  if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
  const data = await response.json();
  return {
    browseItems: (data.items || []).map(toBrowseItem),
    // Keyed on `data.parent` truthy for parity with ListsItemRow's
    // doFetchSiblings — the cache is shared with legacy code until Task 13.
    currentParent: data.parent
      ? {
          id: data.parent.id,
          title: data.parent.title,
          source: data.parent.source || source,
          thumbnail: data.parent.thumbnail,
          parentKey: data.parent.parentId ?? null,
          libraryId: data.parent.libraryId ?? null,
        }
      : null,
    pagination: data.pagination || null,
    referenceIndex: data.referenceIndex ?? -1,
  };
}

/**
 * useContentCombobox — reducer wiring + transports for the unified content
 * combobox. The component (Task 10) renders `state` and calls these handlers.
 *
 * @param {object} args
 * @param {string} args.value - committed content id ('' when unset)
 * @param {(id: string, item?: object) => void} args.onChange
 * @param {string} [args.searchParams] - extra query params for search endpoints
 * @param {boolean} [args.appResults] - merge app-registry matches ahead of content results
 */
export function useContentCombobox({ value, onChange, searchParams = '', appResults = false }) {
  const log = useMemo(() => getChildLogger({ component: 'useContentCombobox', app: 'admin', sessionLog: true }), []);
  const [state, dispatch] = useReducer(reducer, value ?? '', initialState);

  // Latest-value refs so async continuations never read a stale closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Monotonic token invalidating in-flight browse loads when the user types,
  // the dropdown closes, or the committed value changes — a late response must
  // not yank the machine back into BROWSE over newer intent.
  const browseTokenRef = useRef(0);
  // Which committed value the live browse pagination belongs to. Only a
  // siblings load (BROWSE_LOADED) sets it — drilled/parent levels own their
  // own pagination, and paginate() must never fetch /siblings for those.
  // Structural guard: it does not rely on /list responses happening to carry
  // no pagination today.
  const paginationOwnerRef = useRef(null);
  const invalidateBrowseLoads = () => {
    browseTokenRef.current += 1;
    paginationOwnerRef.current = null;
  };

  // ── 1. Reducer wiring: VALUE_CHANGED on prop change (skip initial render) ──
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current === value) return;
    const prevValue = prevValueRef.current;
    prevValueRef.current = value;
    invalidateBrowseLoads();
    if (!value && prevValue) log.info('value.cleared', { prevValue });
    else log.debug('props.value_changed', { value, prevValue });
    dispatch({ type: 'VALUE_CHANGED', value: value ?? '' });
  }, [value, log]);

  // ── 2. Search transport: SSE stream with batch fallback ──
  const {
    results: streamResults,
    pending: pendingSources,
    isSearching: streamSearching,
    sourceErrors,
    search: streamSearch,
  } = useStreamingSearch(SEARCH_STREAM_ENDPOINT, searchParams);

  const [batchResults, setBatchResults] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const queryRef = useRef(''); // last dispatched search text (for app-result merge)

  // S5 fix: `searchParams` MUST be in the deps — the standalone version
  // omitted it, so prop changes never reached the batch URL (stale closure).
  const doBatchSearch = useCallback(async (text) => {
    if (!text || text.length < 2) {
      log.debug('batch_search.skip', { text, reason: 'too_short' });
      setBatchResults([]);
      return;
    }
    log.info('batch_search.start', { text });
    setBatchLoading(true);
    try {
      const response = await fetch(
        `${SEARCH_BATCH_ENDPOINT}?text=${encodeURIComponent(text)}&take=${BATCH_TAKE}${searchParams ? '&' + searchParams : ''}`
      );
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      log.info('batch_search.done', { text, resultCount: (data.items || []).length });
      setBatchResults(data.items || []);
    } catch (err) {
      log.error('batch_search.error', { text, error: err.message });
      setBatchResults([]);
    } finally {
      setBatchLoading(false);
    }
  }, [searchParams, log]);

  const debouncedSearch = useDebouncedCallback((text) => {
    const mode = supportsSSE() ? 'sse' : 'batch';
    log.info('search.dispatch', { text, mode });
    queryRef.current = text;
    if (supportsSSE()) streamSearch(text);
    else doBatchSearch(text);
  }, SEARCH_DEBOUNCE_MS);

  const handleInput = useCallback((text) => {
    invalidateBrowseLoads();
    dispatch({ type: 'INPUT', text });
    debouncedSearch(text);
  }, [debouncedSearch]);

  // Dispatch RESULTS whenever stream/batch results change, merging
  // app-registry matches ahead of content results when enabled.
  const rawResults = supportsSSE() ? streamResults : batchResults;
  useEffect(() => {
    let cancelled = false;
    const finish = (items) => { if (!cancelled) dispatch({ type: 'RESULTS', items }); };
    const query = queryRef.current;
    if (!appResults || !query || query.length < 2) {
      finish(rawResults);
      return undefined;
    }
    (async () => {
      try {
        const { searchApps, APP_REGISTRY } = await import('../../../../lib/appRegistry.js');
        const appMatches = searchApps(query).map((app) => ({
          id: `app:${app.id}`,
          title: app.label,
          source: 'app',
          type: 'app',
          thumbnail: APP_REGISTRY[app.id]?.icon || null,
          isApp: true,
          appId: app.id,
          hasParam: !!app.param,
          param: app.param,
        }));
        finish([...appMatches, ...rawResults]);
      } catch (err) {
        log.warn('app_results.error', { query, error: err.message });
        finish(rawResults);
      }
    })();
    return () => { cancelled = true; };
  }, [rawResults, appResults, log]);

  // Cancel any pending debounced dispatch and clear transport results — a
  // timer surviving close would repopulate results while closed.
  const cancelPendingSearch = useCallback(() => {
    queryRef.current = '';
    debouncedSearch('');
    if (supportsSSE()) streamSearch(''); // hook clears results/pending for short queries
    else setBatchResults([]);
  }, [debouncedSearch, streamSearch]);

  // ── 3. Siblings browse (cache-aware) ──
  const applyBrowseData = useCallback((contentId, data) => {
    if (!data) return;
    const items = (data.browseItems || []).map(ensureId);
    const breadcrumbs = data.currentParent
      ? [parentToCrumb(data.currentParent, splitContentId(contentId)?.source)]
      : [];
    const normalizedVal = normalizeValue(contentId);
    const foundIndex = (data.referenceIndex != null && data.referenceIndex >= 0)
      ? data.referenceIndex
      : items.findIndex((i) => i.id === normalizedVal);
    // When the committed value isn't in the loaded window, highlight the first
    // sibling (ListsItemRow parity) rather than nothing.
    const referenceIndex = foundIndex >= 0 ? foundIndex : (items.length > 0 ? 0 : -1);
    paginationOwnerRef.current = data.pagination ? contentId : null;
    dispatch({
      type: 'BROWSE_LOADED',
      items,
      breadcrumbs,
      pagination: data.pagination ?? null,
      referenceIndex,
    });
  }, []);

  const openWithSiblings = useCallback(async () => {
    invalidateBrowseLoads();
    dispatch({ type: 'OPEN' });
    const contentId = stateRef.current.value;
    if (!contentId || !splitContentId(contentId)) {
      log.debug('load_siblings.skip', { contentId, reason: contentId ? 'no_colon' : 'no_value' });
      return;
    }
    const token = browseTokenRef.current;
    const stillWanted = () => browseTokenRef.current === token;

    const cached = getCacheEntry(contentId);
    if (cached?.status === 'loaded' && cached.data) {
      log.debug('load_siblings.cache_hit', { contentId, count: cached.data.browseItems?.length ?? 0 });
      applyBrowseData(contentId, cached.data);
      return;
    }
    if (cached?.status === 'pending' && cached.promise) {
      log.debug('load_siblings.cache_pending', { contentId });
      dispatch({ type: 'BROWSE_LOADING' });
      try {
        const data = await cached.promise;
        if (stillWanted()) applyBrowseData(contentId, data);
      } catch (err) {
        log.error('load_siblings.error', { contentId, from: 'cache_pending', error: err.message });
        if (stillWanted()) dispatch({ type: 'BROWSE_LOADING', loading: false });
      }
      return;
    }

    // Cache miss — fetch and populate the shared cache.
    log.info('load_siblings.start', { contentId });
    dispatch({ type: 'BROWSE_LOADING' });
    const promise = fetchSiblingsData(contentId);
    setCacheEntry(contentId, { status: 'pending', data: null, promise });
    try {
      const data = await promise;
      setCacheEntry(contentId, { status: 'loaded', data, promise: null });
      log.info('load_siblings.done', {
        contentId,
        itemCount: data?.browseItems?.length ?? 0,
        hasParent: !!data?.currentParent,
        pagination: data?.pagination ?? null,
      });
      if (stillWanted()) applyBrowseData(contentId, data);
    } catch (err) {
      setCacheEntry(contentId, { status: 'error', data: null, promise: null });
      log.error('load_siblings.error', { contentId, error: err.message });
      if (stillWanted()) dispatch({ type: 'BROWSE_LOADING', loading: false });
    }
  }, [applyBrowseData, log]);

  // ── 4. Drill / up ──
  const drill = useCallback(async (item) => {
    const source = normalizeListSource(item.source || item.id?.split(':')[0]);
    const localId = item.localId
      ?? (item.id?.includes(':') ? item.id.split(':').slice(1).join(':') : item.id);
    // Bump the token so any overlapping browse response (siblings, another
    // drill, pagination) started earlier cannot interleave with this one.
    const token = ++browseTokenRef.current;
    paginationOwnerRef.current = null; // the drilled level owns its pagination
    log.info('browse_container.start', {
      contentId: item.id, title: item.title, source, localId,
      prevBreadcrumbDepth: stateRef.current.browse.breadcrumbs.length,
    });
    dispatch({ type: 'BROWSE_LOADING' });
    try {
      const response = await fetch(`/api/v1/list/${source}/${encodeURIComponent(localId)}`);
      if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
      const data = await response.json();
      const crumb = { id: item.id, title: item.title, source, localId };
      log.info('browse_container.done', { source, localId, itemCount: (data.items || []).length });
      if (browseTokenRef.current !== token) return;
      dispatch({
        type: 'DRILL_LOADED',
        crumb,
        items: (data.items || []).map(ensureId),
        pagination: data.pagination ?? null, // S1: drilled level owns its pagination
      });
    } catch (err) {
      log.error('browse_container.error', { contentId: item.id, source, localId, error: err.message });
      if (browseTokenRef.current === token) dispatch({ type: 'BROWSE_LOADING', loading: false });
    }
  }, [log]);

  const goUp = useCallback(async () => {
    const { breadcrumbs } = stateRef.current.browse;
    log.info('go_back.start', { breadcrumbDepth: breadcrumbs.length });
    if (breadcrumbs.length <= 1) {
      // At the siblings root — dismiss to DISPLAY keeping the committed value.
      // OPEN seeded `search` with the committed id, so an INPUT here would turn
      // Back into a keyword search of the raw id string (F8). CLOSE resets to
      // initialState(value): DISPLAY mode, search=null, value preserved.
      log.info('go_back.dismiss_from_root', { reason: 'at_root_or_single_crumb' });
      invalidateBrowseLoads(); // a late browse response must not yank us back
      dispatch({ type: 'CLOSE' });
      cancelPendingSearch(); // clear any debounced search timer/results
      return;
    }
    const nextBreadcrumbs = breadcrumbs.slice(0, -1);
    const popped = breadcrumbs[breadcrumbs.length - 1];
    const parent = nextBreadcrumbs[nextBreadcrumbs.length - 1];
    const token = ++browseTokenRef.current; // invalidate overlapping browse responses
    paginationOwnerRef.current = null; // the parent level owns its pagination
    log.info('go_back.to_parent', {
      parentId: parent.id, parentTitle: parent.title, newDepth: nextBreadcrumbs.length,
    });
    dispatch({ type: 'BROWSE_LOADING' });
    try {
      const response = await fetch(`/api/v1/list/${parent.source}/${encodeURIComponent(parent.localId)}`);
      if (!response.ok) throw new Error(`Browse failed: ${response.status}`);
      const data = await response.json();
      const items = (data.items || []).map(ensureId);
      const referenceIndex = items.findIndex((i) => i.id === popped.id);
      log.info('go_back.done', { parentId: parent.id, itemCount: items.length });
      if (browseTokenRef.current !== token) return;
      dispatch({
        type: 'WENT_UP',
        items,
        breadcrumbs: nextBreadcrumbs,
        pagination: data.pagination ?? null, // S1: parent level owns its pagination
        referenceIndex: referenceIndex >= 0 ? referenceIndex : 0,
      });
    } catch (err) {
      log.error('go_back.error', { parentId: parent.id, error: err.message });
      if (browseTokenRef.current === token) dispatch({ type: 'BROWSE_LOADING', loading: false });
    }
  }, [cancelPendingSearch, log]);

  // ── 5. Pagination (in-flight guarded; the machine owns items/window math) ──
  // Returns true only when a PAGINATED event was actually dispatched, so the
  // component can arm/disarm its scroll-suppression guard accurately.
  const paginationInFlightRef = useRef(false);
  const paginate = useCallback(async (direction) => {
    const current = stateRef.current;
    const pagination = current.browse.pagination;
    const contentId = current.value;
    if (!contentId || !pagination || paginationInFlightRef.current) return false;
    // Structural guard: only the siblings level paginates against /siblings.
    // After a drill/up, the visible pagination belongs to that level's /list
    // response — fetching value's siblings for it would corrupt the window.
    if (paginationOwnerRef.current !== contentId) {
      log.debug('load_more_siblings.skip', { direction, reason: 'not_siblings_level' });
      return false;
    }
    const parsed = splitContentId(contentId);
    if (!parsed) return false;

    let offset;
    let limit;
    if (direction === 'after') {
      if (!pagination.hasAfter) return false;
      offset = pagination.offset + pagination.window;
      limit = PAGE_SIZE;
    } else {
      if (!pagination.hasBefore) return false;
      offset = Math.max(0, pagination.offset - PAGE_SIZE);
      limit = Math.min(PAGE_SIZE, pagination.offset);
      if (limit <= 0) return false;
    }

    log.info('load_more_siblings', { direction, offset, limit, ...parsed });
    paginationInFlightRef.current = true;
    const token = ++browseTokenRef.current; // invalidate overlapping browse responses
    paginationOwnerRef.current = contentId; // still the siblings level
    try {
      const response = await fetch(
        `/api/v1/siblings/${parsed.source}/${encodeURIComponent(parsed.localId)}?offset=${offset}&limit=${limit}`
      );
      if (!response.ok) return false;
      const data = await response.json();
      if (browseTokenRef.current !== token) return false;
      dispatch({ type: 'PAGINATED', direction, items: (data.items || []).map(toBrowseItem) });
      return true;
    } catch (err) {
      log.error('load_more_siblings.error', { direction, error: err.message });
      return false;
    } finally {
      paginationInFlightRef.current = false;
    }
  }, [log]);

  // ── Lifecycle: close-commit policy + selection ──
  const handleClose = useCallback((reason) => {
    const current = stateRef.current;
    const decision = closeDecision(current, reason);
    if (decision.action === 'commit') {
      log.info('freeform.commit_on_close', { freeformValue: decision.value, prevValue: current.value, reason });
      onChangeRef.current?.(decision.value);
    } else if (decision.action === 'revert' && current.search && current.search !== current.value) {
      log.info('freeform.revert_on_close', { discarded: current.search, kept: current.value, reason });
    }
    invalidateBrowseLoads();
    dispatch({ type: 'CLOSE', reason });
    cancelPendingSearch();
  }, [cancelPendingSearch, log]);

  const select = useCallback((item) => {
    log.info('item_select', { contentId: item.id, title: item.title, prevValue: stateRef.current.value });
    rememberTitle(item.id, item.title);
    onChangeRef.current?.(item.id, item);
    handleClose('select'); // closeDecision('select') → no double-commit
  }, [handleClose, log]);

  // ── 6. Title resolution for the committed value ──
  const [resolvedTitle, setResolvedTitle] = useState(() => (
    isContentIdLike(value) && titleCache.has(value) ? titleCache.get(value) : null
  ));
  useEffect(() => {
    if (!isContentIdLike(value)) {
      setResolvedTitle(null);
      return undefined;
    }
    if (titleCache.has(value)) {
      setResolvedTitle(titleCache.get(value));
      return undefined;
    }
    setResolvedTitle(null);
    const parsed = splitContentId(value);
    if (!parsed) return undefined;
    let cancelled = false;
    fetch(`/api/v1/info/${parsed.source}/${encodeURIComponent(parsed.localId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (cancelled || !info?.title) return;
        rememberTitle(value, info.title);
        setResolvedTitle(info.title);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [value]);

  return {
    state,
    dispatch,
    // input/search
    handleInput,
    // browse
    openWithSiblings,
    drill,
    goUp,
    paginate,
    // lifecycle
    handleClose,
    select,
    // meta
    resolvedTitle,
    isSearching: streamSearching || batchLoading,
    pendingSources,
    sourceErrors,
    // Only the batch fallback caps results; flag when it hit the cap so the UI
    // can offer a "refine your search" affordance (audit S6). The SSE stream is
    // uncapped, so it never truncates.
    truncatedAt: (!supportsSSE() && batchResults.length >= BATCH_TAKE) ? BATCH_TAKE : null,
  };
}

export { Modes };
export default useContentCombobox;
