// useContentCombobox.js — the side-effect layer around the pure combobox
// machine (comboboxMachine.js). Owns every fetch, debounce timer, and cache
// interaction; the machine owns every state transition. Behavior is ported
// from the two prior implementations (ContentSearchCombobox.jsx standalone,
// ListsItemRow.jsx inline) — including the audit fixes:
//   S1 — DRILL_LOADED/WENT_UP carry their own pagination, so a drilled level
//        can never inherit the siblings window (structural, via the machine).
//   S5 — doBatchSearch lists `searchParams` in its deps, so a prop change
//        reaches the batch fallback URL (the standalone had a stale closure).
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { useRefreshableRead } from '../../../../frontend/src/lib/hooks/useRefreshableRead.js';
import { useDebouncedCallback } from '@mantine/hooks';
import { useStreamingSearch } from "../../../../frontend/src/hooks/useStreamingSearch.js";
import { getChildLogger } from "../../../../frontend/src/lib/logging/singleton.js";
import { normalizeListSource, splitContentId, isContentIdLike, parseSourcePrefix, isDirectSourceIdQuery } from "../lib/contentSearchLogic.js";
import { getCacheEntry, loadSiblings, toBrowseItem } from "../lib/siblingsCache.js";
import { reducer, initialState, closeDecision, decideCommit, isContainer, Modes, RENDER_CAP } from "./comboboxMachine.js";
import { sanitizeBreadcrumbs } from "../lib/breadcrumbs.js";
import { notifyWarning } from "./notify.js";
import { loadKnownSources, isKnownSource } from "../lib/knownSources.js";

import { rememberTitle, useContentTitle } from "../lib/useContentTitle.js";

function expandContainer(source, localId, signal) {
  return DaylightAPI(
    `/api/v1/list/${encodeURIComponent(source)}/${encodeURIComponent(localId)}/expand`,
    {}, 'GET', { signal },
  );
}

const SEARCH_STREAM_ENDPOINT = '/api/v1/content/query/search/stream';
const SEARCH_BATCH_ENDPOINT = '/api/v1/content/query/search';
// The non-SSE batch fallback caps results; the SSE stream does not. Only the
// batch path can truncate, so the "showing first N" affordance (audit S6) is
// gated on it hitting this cap.
const BATCH_TAKE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 21;

/** Check if the browser supports Server-Sent Events. */
function supportsSSE() {
  return typeof EventSource !== 'undefined';
}

const normalizeValue = (v) => v?.replace(/:\s+/g, ':');

// F13: `word:` / `word-word:` followed by only optional whitespace — a source
// prefix whose term is empty. Distinct from parseSourcePrefix (which returns
// null both here AND for plain no-colon text), so we detect it explicitly.
const isBareSourcePrefix = (t) => typeof t === 'string' && /^[\w-]+:\s*$/.test(t);

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

// Map a siblings-API ancestor Crumb ({id,title,source,localId,type}) to the
// hook's crumb shape used by goUp/goToCrumb (source + localId drive the /list
// fetch). Ancestors already carry localId/type, so preserve them rather than
// re-deriving; fall back to id-splitting only if localId is absent.
function ancestorToCrumb(crumb, fallbackSource) {
  return {
    id: crumb.id,
    title: crumb.title,
    source: crumb.source || fallbackSource,
    localId: crumb.localId ?? crumb.id?.split(':').slice(1).join(':'),
    type: crumb.type ?? null,
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
 * @param {string} [args.fallbackSearchParams] - catalog-wide params to widen to when a
 *   search scoped by `searchParams` settles empty (D5: a search silently scoped to a
 *   narrow library — e.g. Music>Ambient — must not present as "nothing exists"). Optional
 *   and a no-op when omitted/nullish or equal to `searchParams` — non-Media consumers
 *   (Admin, PlaybackHub) that never pass it see no change in behavior.
 * @param {boolean} [args.appResults] - merge app-registry matches ahead of content results
 * @param {string} [args.logApp] - which app owns these log events. The combobox is
 *   shared, so without this every host's search funnel files itself under 'admin'
 *   and is invisible to an `app:<host>` log query (2026-08-12 session review).
 * @param {string} [args.scopeKey] - the caller's current search scope, stamped onto
 *   `search.dispatch`/`search.settled`/`search.fallback_to_all` payloads. One of the
 *   documented observability gaps from the 2026-08-21 incident: a search settling
 *   empty carried no record of which scope it ran against. Optional; omitted by
 *   callers (Admin, PlaybackHub) that have no scope concept — logs then carry
 *   `scopeKey: null`, no behavior change.
 * @param {string} [args.scopeLabel] - human label for `scopeKey` (e.g. "Ambient"),
 *   included alongside it in `search.fallback_to_all` for log readability. Optional.
 */
export function useContentCombobox({
  value, onChange, searchParams = '', fallbackSearchParams, scopeKey, scopeLabel,
  appResults = false, selectContainers = false, allowFreeform = true, logApp = 'admin', retainQueryOnEscape = false,
  retainPlayableSelection = false,
}) {
  const log = useMemo(() => getChildLogger({ component: 'useContentCombobox', app: logApp, sessionLog: true }), [logApp]);
  const [state, dispatch] = useReducer(reducer, value ?? '', initialState);

  // Latest-value refs so async continuations never read a stale closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // A shared sibling cache read may outlive this picker. Only the visit that
  // requested its data can use it to open the sibling window.
  const siblingsVisitRef = useRef(0);
  // Which committed value and request path own the live browse window. Only a
  // siblings load (BROWSE_LOADED) sets it — drilled/parent levels own their
  // own pagination, and paginate() must never fetch /siblings for those.
  // Structural guard: it does not rely on /list responses happening to carry
  // no pagination today.
  const paginationOwnerRef = useRef(null);
  const readExpansion = useCallback(async (isCurrent, signal, request) => {
    const { target, transition, referenceId, event, details, log } = request;
    try {
      const data = await expandContainer(target.source, target.localId, signal);
      if (!isCurrent()) return;
      const items = (data.items || []).map(ensureId);
      const referenceIndex = referenceId == null ? 0 : Math.max(0, items.findIndex((item) => item.id === referenceId));
      log.info(`${event}.done`, { ...details, itemCount: items.length });
      dispatch({ ...transition, items, pagination: data.pagination ?? null, referenceIndex });
    } catch (err) {
      if (!isCurrent()) return;
      log.error(`${event}.error`, { ...details, error: err.message });
      dispatch({ type: 'BROWSE_LOADING', loading: false });
    }
  }, []);
  const { reload: reloadExpansion, cancel: cancelExpansion } = useRefreshableRead(readExpansion);
  const readPage = useCallback(async (isCurrent, signal, { owner, direction, offset, limit, log }) => {
    log.info('load_more_siblings', { direction, offset, limit, contentId: owner.contentId, path: owner.path });
    try {
      const data = await DaylightAPI(
        `${owner.path}?offset=${offset}&limit=${limit}`,
        {}, 'GET', { signal },
      );
      if (!isCurrent()) return false;
      dispatch({ type: 'PAGINATED', direction, items: (data.items || []).map(toBrowseItem) });
      return true;
    } catch (err) {
      if (isCurrent()) log.error('load_more_siblings.error', { direction, error: err.message });
      return false;
    }
  }, []);
  const { poll: readPageWhenIdle, cancel: cancelPage } = useRefreshableRead(readPage);

  const invalidateBrowseLoads = useCallback(() => {
    siblingsVisitRef.current += 1;
    paginationOwnerRef.current = null;
    cancelExpansion();
    cancelPage();
  }, [cancelExpansion, cancelPage]);
  useLayoutEffect(() => invalidateBrowseLoads, [invalidateBrowseLoads]);

  // Warm the valid-prefix set for pickers that accept typed IDs. These reads
  // are shared across rows, and reopening can retry an incomplete lookup.
  useEffect(() => {
    if (allowFreeform) loadKnownSources();
  }, [allowFreeform]);

  // ── 2. Search transport: SSE stream with batch fallback ──
  const {
    state: streamState,
    results: streamResults,
    pending: pendingSources,
    isSearching: streamSearching,
    error: streamError,
    sourceErrors,
    search: streamSearch,
    retry: retryStream,
    cancel: cancelStream = () => {},
  } = useStreamingSearch(SEARCH_STREAM_ENDPOINT, searchParams);

  const [batchResults, setBatchResults] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const readBatch = useCallback(async (isCurrent, signal, text, effectiveParams, log) => {
    log.info('batch_search.start', { text, params: effectiveParams || null });
    setBatchLoading(true);
    try {
      const data = await DaylightAPI(
        `${SEARCH_BATCH_ENDPOINT}?text=${encodeURIComponent(text)}&take=${BATCH_TAKE}${effectiveParams ? '&' + effectiveParams : ''}`,
        {}, 'GET', { signal },
      );
      if (!isCurrent()) return;
      log.info('batch_search.done', { text, resultCount: (data.items || []).length });
      setBatchResults(data.items || []);
    } catch (err) {
      if (!isCurrent()) return;
      log.error('batch_search.error', { text, error: err.message });
      setBatchResults([]);
    } finally {
      if (isCurrent()) setBatchLoading(false);
    }
  }, []);
  const { reload: reloadBatch, cancel: cancelBatch } = useRefreshableRead(readBatch);

  // `cancelStream()` deliberately drops the previous request synchronously,
  // before its 300ms replacement debounce opens. Keep that visible intent
  // distinct from transport activity: otherwise both consumers briefly claim
  // a completed empty search during that hand-off.
  const [debouncePending, setDebouncePending] = useState(false);
  // Pre-cap count of the results last dispatched to the machine (which caps at
  // RENDER_CAP). Lets the UI surface a "showing first N" hint on ANY transport
  // — the SSE stream is uncapped and can blow past the cap, unlike the batch
  // fallback which the server already limits to BATCH_TAKE.
  const [rawResultCount, setRawResultCount] = useState(0);
  // Each user dispatch owns its settle log and recovery. Source retries and
  // catalog-wide fallback keep that owner even when their request params differ.
  const searchAttemptRef = useRef(null);
  const [fellBackToAll, setFellBackToAll] = useState(false);
  const clearBatchSearch = useCallback(() => {
    cancelBatch();
    setBatchLoading(false);
    setBatchResults([]);
  }, [cancelBatch]);

  // S5 fix: `searchParams` MUST be in the deps — the standalone version
  // omitted it, so prop changes never reached the batch URL (stale closure).
  // `overrideParams` mirrors useStreamingSearch's `search(query, overrideExtraQuery)` —
  // the D5 fallback effect uses it to re-run the same text with wider params without
  // waiting for the `searchParams` prop itself to change.
  const doBatchSearch = useCallback((text, overrideParams) => {
    if (!text || text.length < 2) {
      log.debug('batch_search.skip', { text, reason: 'too_short' });
      clearBatchSearch();
      return;
    }
    const effectiveParams = overrideParams !== undefined ? overrideParams : searchParams;
    return reloadBatch(text, effectiveParams, log);
  }, [clearBatchSearch, reloadBatch, searchParams, log]);

  const debouncedSearch = useDebouncedCallback((text) => {
    const mode = supportsSSE() ? 'sse' : 'batch';
    // F13: a bare source prefix ("singalong:") has an empty term. Sending the
    // literal to the backend triggers a full-text search for the string
    // "singalong:" across all sources (junk). Route it as an empty query —
    // same as clearing the box. Scoped "source:term" is left untouched.
    const q = isBareSourcePrefix(text) ? '' : text;
    setDebouncePending(false);
    log.info('search.dispatch', { text: q, mode, scopeKey: scopeKey ?? null });
    searchAttemptRef.current = q.length >= 2
      ? { text: q, params: searchParams, logged: false, retried: false, widened: false }
      : null;
    if (supportsSSE()) streamSearch(q);
    else doBatchSearch(q);
  }, SEARCH_DEBOUNCE_MS);

  const retireSearch = useCallback(() => {
    searchAttemptRef.current = null;
    setFellBackToAll(false);
    if (supportsSSE()) cancelStream();
    else clearBatchSearch();
  }, [cancelStream, clearBatchSearch]);

  const handleInput = useCallback((text) => {
    // The debounced transport cannot be the boundary of intent ownership: a
    // previous stream must be retired before its late callback can land under
    // the newly visible text.
    retireSearch();
    invalidateBrowseLoads();
    setDebouncePending(!isBareSourcePrefix(text) && text.trim().length >= 2);
    dispatch({ type: 'INPUT', text });
    debouncedSearch(text);
  }, [retireSearch, debouncedSearch, invalidateBrowseLoads]);

  // Scope chips change `searchParams`, and nothing re-ran the search: the chip
  // lit up (aria-pressed) directly above a result list that was still whatever
  // the previous scope returned, so the user believed a filter had applied
  // that never did. Re-dispatch the CURRENT box text whenever the active scope
  // changes.
  //
  // A scope change uses the same debounced dispatch as typing, so it can
  // replace a pending keystroke without starting a competing request.
  const prevSearchParamsRef = useRef(searchParams);
  useEffect(() => {
    if (prevSearchParamsRef.current === searchParams) return;
    prevSearchParamsRef.current = searchParams;
    const { mode, search } = stateRef.current;
    const text = search ?? '';
    // Nothing meaningful in the box (closed, cleared, too short, or a bare
    // `source:` prefix) — there is no search to re-run.
    if (mode !== Modes.SEARCH || isBareSourcePrefix(text) || text.trim().length < 2) return;
    // Scope changed now; the scoped replacement still debounces, but the old
    // scope must stop owning callbacks immediately.
    retireSearch();
    setDebouncePending(true);
    log.info('search.rerun_for_scope', { textLength: text.length, scopeKey: scopeKey ?? null });
    debouncedSearch(text);
  }, [searchParams, scopeKey, retireSearch, debouncedSearch, log]);

  // F14: while searching, a `source:term` query scopes the backend search to
  // that one source. Surface the scope so the UI can show a removable chip.
  // Only meaningful while editing/searching (search != null). But a DIRECT id
  // entry (plex:455704, canvas:fhe/elisha.jpeg) is not a within-source search —
  // suppress the chip so obvious id entry isn't framed as "searching within X".
  const activeScope = state.search != null && !isDirectSourceIdQuery(state.search, state.results)
    ? (parseSourcePrefix(state.search)?.source ?? null)
    : null;
  // Drop the source prefix, rewriting the box to the bare term and re-running
  // the now-unscoped search.
  const clearScope = useCallback(() => {
    const parsed = parseSourcePrefix(stateRef.current.search);
    if (parsed) handleInput(parsed.term);
  }, [handleInput]);

  // Dispatch RESULTS whenever stream/batch results change, merging
  // app-registry matches ahead of content results when enabled.
  const rawResults = supportsSSE() ? streamResults : batchResults;
  useEffect(() => {
    const attempt = searchAttemptRef.current;
    let cancelled = false;
    const finish = (items) => {
      if (cancelled || searchAttemptRef.current !== attempt) return;
      setRawResultCount(items.length); // pre-cap length (machine slices to RENDER_CAP)
      dispatch({ type: 'RESULTS', items });
    };
    const query = attempt?.text;
    if (!appResults || !query || query.length < 2) {
      finish(rawResults);
      return undefined;
    }
    (async () => {
      try {
        const { searchApps, APP_REGISTRY } = await import("../../../../frontend/src/lib/appRegistry.js");
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
    retireSearch();
    setDebouncePending(false);
    debouncedSearch('');
  }, [debouncedSearch, retireSearch]);

  // A controlled value replacement ends the current editing and browse visit.
  const prevValueRef = useRef(value);
  useLayoutEffect(() => {
    if (prevValueRef.current === value) return;
    const prevValue = prevValueRef.current;
    prevValueRef.current = value;
    invalidateBrowseLoads();
    cancelPendingSearch();
    if (!value && prevValue) log.info('value.cleared', { prevValue });
    else log.debug('props.value_changed', { value, prevValue });
    dispatch({ type: 'VALUE_CHANGED', value: value ?? '' });
  }, [value, log, invalidateBrowseLoads, cancelPendingSearch]);

  // ── 3. Siblings browse (cache-aware) ──
  const applyBrowseData = useCallback((contentId, data) => {
    if (!data) return;
    const items = (data.browseItems || []).map(ensureId);
    const fallbackSource = splitContentId(contentId)?.source;
    // Prefer the full root-first ancestor chain (climbable + clickable trail);
    // sanitize drops any ghost/dupe/junk crumbs. Fall back to the single parent
    // crumb when the response carries no ancestors (no regression).
    const breadcrumbs = (Array.isArray(data.ancestors) && data.ancestors.length > 0)
      ? sanitizeBreadcrumbs(data.ancestors.map((c) => ancestorToCrumb(c, fallbackSource)))
      : data.currentParent
        ? [parentToCrumb(data.currentParent, fallbackSource)]
        : [];
    const normalizedVal = normalizeValue(contentId);
    const foundIndex = (data.referenceIndex != null && data.referenceIndex >= 0)
      ? data.referenceIndex
      : items.findIndex((i) => i.id === normalizedVal);
    // Genuine-miss path: when the committed value isn't in the loaded window,
    // highlight nothing (idx -1) rather than a phantom row 0. The absence is
    // surfaced instead by the orientation header in ContentCombobox.
    const referenceIndex = foundIndex >= 0 ? foundIndex : -1;
    paginationOwnerRef.current = data.pagination && data.requestPath ? { contentId, path: data.requestPath } : null;
    dispatch({
      type: 'BROWSE_LOADED',
      items,
      breadcrumbs,
      pagination: data.pagination ?? null,
      referenceIndex,
    });
  }, []);

  const openWithSiblings = useCallback(async () => {
    if (allowFreeform) loadKnownSources();
    invalidateBrowseLoads();
    dispatch({ type: 'OPEN' });
    const contentId = stateRef.current.value;
    if (!contentId || !splitContentId(contentId)) {
      log.debug('load_siblings.skip', { contentId, reason: contentId ? 'no_colon' : 'no_value' });
      return;
    }
    const visit = siblingsVisitRef.current;
    const stillWanted = () => siblingsVisitRef.current === visit;

    const cached = getCacheEntry(contentId);
    if (cached?.status === 'loaded' && cached.data) {
      log.debug('load_siblings.cache_hit', { contentId, count: cached.data.browseItems?.length ?? 0 });
      applyBrowseData(contentId, cached.data);
      return;
    }
    log.info(cached?.promise ? 'load_siblings.cache_pending' : 'load_siblings.start', { contentId });
    dispatch({ type: 'BROWSE_LOADING' });
    try {
      const data = await loadSiblings(contentId);
      log.info('load_siblings.done', {
        contentId,
        itemCount: data?.browseItems?.length ?? 0,
        hasParent: !!data?.currentParent,
        pagination: data?.pagination ?? null,
      });
      if (stillWanted()) applyBrowseData(contentId, data);
    } catch (err) {
      log.error('load_siblings.error', { contentId, error: err.message });
      if (stillWanted()) dispatch({ type: 'BROWSE_LOADING', loading: false });
    }
  }, [allowFreeform, applyBrowseData, invalidateBrowseLoads, log]);

  // ── 4. Drill / up ──
  const startExpansion = useCallback((request) => {
    invalidateBrowseLoads();
    dispatch({ type: 'BROWSE_LOADING' });
    return reloadExpansion({ ...request, log });
  }, [invalidateBrowseLoads, reloadExpansion, log]);

  const drill = useCallback(async (item) => {
    const source = normalizeListSource(item.source || item.id?.split(':')[0]);
    const localId = item.localId
      ?? (item.id?.includes(':') ? item.id.split(':').slice(1).join(':') : item.id);
    const crumb = { id: item.id, title: item.title, source, localId };
    const details = { contentId: item.id, source, localId };
    log.info('browse_container.start', {
      ...details, title: item.title, prevBreadcrumbDepth: stateRef.current.browse.breadcrumbs.length,
    });
    return startExpansion({ target: crumb, transition: { type: 'DRILL_LOADED', crumb }, event: 'browse_container', details });
  }, [log, startExpansion]);

  // Both parent and breadcrumb navigation restore the highlight on the
  // child the user came from. The loaded level owns its own pagination.
  const expandAncestor = useCallback((breadcrumbs, index, event, details) => {
    return startExpansion({
      target: breadcrumbs[index],
      transition: { type: 'WENT_UP', breadcrumbs: breadcrumbs.slice(0, index + 1) },
      referenceId: breadcrumbs[index + 1]?.id,
      event,
      details,
    });
  }, [startExpansion]);

  const goUp = useCallback(async () => {
    const { breadcrumbs } = stateRef.current.browse;
    log.info('go_back.start', { breadcrumbDepth: breadcrumbs.length });
    if (breadcrumbs.length <= 1) {
      log.info('go_back.dismiss_from_root', { reason: 'at_root_or_single_crumb' });
      invalidateBrowseLoads();
      dispatch({ type: 'CLOSE' });
      cancelPendingSearch();
      return;
    }
    const index = breadcrumbs.length - 2;
    const parent = breadcrumbs[index];
    log.info('go_back.to_parent', { parentId: parent.id, parentTitle: parent.title, newDepth: index + 1 });
    return expandAncestor(breadcrumbs, index, 'go_back', { parentId: parent.id });
  }, [cancelPendingSearch, expandAncestor, invalidateBrowseLoads, log]);

  const goToCrumb = useCallback(async (index) => {
    const { breadcrumbs } = stateRef.current.browse;
    if (index < 0 || index >= breadcrumbs.length - 1) {
      log.debug('go_to_crumb.skip', { index, depth: breadcrumbs.length });
      return;
    }
    const target = breadcrumbs[index];
    const details = { index, targetId: target.id };
    log.info('go_to_crumb.start', { ...details, targetTitle: target.title, newDepth: index + 1 });
    return expandAncestor(breadcrumbs, index, 'go_to_crumb', details);
  }, [expandAncestor, log]);

  // ── 5. Pagination (in-flight guarded; the machine owns items/window math) ──
  // A skipped request returns false immediately. A started request resolves
  // true only after dispatching PAGINATED to its current window.
  const paginate = useCallback((direction) => {
    const current = stateRef.current;
    const pagination = current.browse.pagination;
    const owner = paginationOwnerRef.current;
    if (!pagination) return false;
    // Structural guard: only the siblings level paginates against /siblings.
    // After a drill/up, the visible pagination belongs to that level's /list
    // response — fetching value's siblings for it would corrupt the window.
    if (!owner || owner.contentId !== current.value) {
      log.debug('load_more_siblings.skip', { direction, reason: 'not_siblings_level' });
      return false;
    }

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

    return readPageWhenIdle({ owner, direction, offset, limit, log }) ?? false;
  }, [log, readPageWhenIdle]);

  // ── Lifecycle: close-commit policy + selection ──
  const handleClose = useCallback((reason) => {
    const current = stateRef.current;
    const decision = closeDecision({ search: current.search, value: current.value, allowFreeform }, reason);
    if (decision.action === 'commit') {
      log.info('freeform.commit_on_close', { freeformValue: decision.value, prevValue: current.value, reason });
      onChangeRef.current?.(decision.value);
    } else if (decision.action === 'revert' && current.search && current.search !== current.value) {
      log.info('freeform.revert_on_close', { discarded: current.search, kept: current.value, reason });
    }
    invalidateBrowseLoads();
    dispatch({ type: 'CLOSE', reason, retainSearch: reason === 'escape' && retainQueryOnEscape ? current.search : null });
    cancelPendingSearch();
  }, [cancelPendingSearch, invalidateBrowseLoads, log, allowFreeform, retainQueryOnEscape]);

  const select = useCallback((item) => {
    log.info('item_select', { contentId: item.id, title: item.title, prevValue: stateRef.current.value });
    rememberTitle(item.id, item.title);
    onChangeRef.current?.(item.id, item);
    if (retainPlayableSelection && !isContainer(item)) return;
    handleClose('select'); // closeDecision('select') → no double-commit
  }, [handleClose, log, retainPlayableSelection]);

  // ── Commit executor: run the pure decision and perform its side effect ──
  // An idle transport can still belong to the previous text or scope while
  // a replacement debounces. Only a dispatched attempt can settle.
  const attempt = searchAttemptRef.current;
  const searchSettled = !!attempt && attempt.text === state.search && attempt.params === searchParams
    && attempt.text.trim().length >= 2 && !streamSearching && !batchLoading && !streamError;
  const searchSettledRef = useRef(searchSettled);
  searchSettledRef.current = searchSettled;

  // Observability: the 2026-08-21 incident (phone search settled empty for a
  // title that existed) was undiagnosable because nothing recorded what a
  // search settled WITH. Log each settle transition once, with result counts
  // and any per-source stream errors.
  //
  // sourceErrors arrives from useStreamingSearch as an array of
  // {source, error} objects (not an object keyed by source name) — adapted
  // from the brief's object-shaped assumption accordingly.
  useEffect(() => {
    if (!searchSettled || searchAttemptRef.current !== attempt || attempt.logged) return;
    attempt.logged = true;
    const erroredSources = (sourceErrors || []).map((e) => e.source);
    log.info('search.settled', {
      textLength: attempt.text.length,
      resultCount: stateRef.current.results.length,
      rawResultCount,
      sourceErrors: erroredSources,
      scopeKey: scopeKey ?? null,
    });
    for (const { source, error } of sourceErrors || []) {
      log.warn('search.source_error', { source, error: String(error?.message ?? error) });
    }
  }, [attempt, searchSettled, sourceErrors, rawResultCount, scopeKey, log]);

  // ── Empty-settle recovery ladder (Task 5 retry + Task 11 / D5 widening) ──
  //
  // These two recoveries used to be separate effects, and the widening one
  // opened with `if (sourceErrors.length > 0) return;` — a VETO, not an
  // ordering. With a genuinely down source (Plex, in the 2026-08-21 incident)
  // that meant: scoped search settles empty → retried once → errors again →
  // and then nothing, ever. No results and no explanation, which is both
  // halves of the original incident at once.
  //
  // They are now ONE effect running one rung per empty settle, so "retry
  // first, widen second" is expressed as a sequence the user actually
  // traverses instead of a condition that can strand them:
  //
  //   rung 1 — a source errored: re-run the SAME text under the SAME scope
  //            once. Transient adapter failures are the common case and a
  //            successful retry means the widening never needs to happen.
  //   rung 2 — still empty (the retry is spent, or nothing errored at all):
  //            widen to `fallbackSearchParams` and set `fellBackToAll` so the
  //            surface can say so.
  //
  // Each rung fires at most once per attempt. A fresh user dispatch can
  // retry and widen even if its words and scope match an earlier attempt.
  useEffect(() => {
    if (!searchSettled || searchAttemptRef.current !== attempt) return;
    const { text } = attempt;
    if (rawResults.length > 0 || rawResultCount > 0 || stateRef.current.results.length > 0) return; // not empty — nothing to recover from

    // Rung 1: same text, same scope, one more time.
    const erroredSources = (sourceErrors || []).map((e) => e.source);
    if (erroredSources.length > 0 && !attempt.retried) {
      attempt.retried = true;
      log.info('search.retry_after_source_error', { textLength: text.length, sourceErrors: erroredSources });
      if (supportsSSE()) erroredSources.forEach((source) => retryStream(source));
      else doBatchSearch(text);
      return;
    }

    // Rung 2: widen. Skipped entirely for callers that never opted in
    // (fallbackSearchParams nullish — Admin/PlaybackHub) and when the search
    // is already catalog-wide (searchParams === fallbackSearchParams), which
    // would otherwise loop the identical search forever.
    if (fallbackSearchParams == null) return;
    if (searchParams === fallbackSearchParams) return;
    if (attempt.widened) return;
    attempt.widened = true;
    setFellBackToAll(true);
    log.info('search.fallback_to_all', {
      textLength: text.length,
      searchParams: searchParams || null,
      fallbackSearchParams: fallbackSearchParams || null,
      scopeKey: scopeKey ?? null,
      scopeLabel: scopeLabel ?? null,
    });
    if (supportsSSE()) streamSearch(text, fallbackSearchParams, { preserveFailures: true });
    else doBatchSearch(text, fallbackSearchParams);
  }, [
    attempt, searchSettled, sourceErrors, rawResults, rawResultCount, searchParams, fallbackSearchParams,
    scopeKey, scopeLabel, streamSearch, retryStream, doBatchSearch, log,
  ]);

  const commit = useCallback((reason) => {
    const s = stateRef.current;
    const decision = decideCommit({
      reason, search: s.search, value: s.value, results: s.results,
      highlightIdx: s.highlight.idx, userNavigated: s.highlight.userNavigated,
      selectContainers, searchSettled: searchSettledRef.current, isContainer,
      allowFreeform,
    });
    switch (decision.action) {
      case 'select': select(decision.item); break;   // existing helper: onChange(id,item)+close
      case 'drill':  drill(decision.item); break;     // stays OPEN, do not close
      case 'open':   break;                           // keep dropdown open, commit nothing
      case 'literal': {
        // A hand-typed id with an invented prefix used to be saved with the
        // same reassuring "saved as raw id" toast as a valid one, so a typo'd
        // source was indistinguishable from a good paste until something else
        // 404'd later. Name the problem at the moment of saving.
        const literalSource = parseSourcePrefix(decision.value)?.source ?? null;
        const known = literalSource ? isKnownSource(literalSource) : null;
        log.info('commit.literal_fallback', {
          value: decision.value, prevValue: s.value, source: literalSource, knownSource: known,
        });
        onChangeRef.current?.(decision.value);
        if (known === false) {
          notifyWarning({
            title: `Unknown source “${literalSource}”`,
            message: `Saved, but nothing can resolve “${literalSource}:”. Check the prefix — this row will not load.`,
          });
        } else {
          notifyWarning({
            title: 'Saved as raw id',
            message: `Saved “${decision.value}” as a raw content id`,
          });
        }
        invalidateBrowseLoads(); dispatch({ type: 'CLOSE' }); cancelPendingSearch();
        break;
      }
      case 'revert':
      case 'dismiss':
        log.info(`commit.${decision.action}`, { discarded: s.search, kept: s.value, reason });
        invalidateBrowseLoads(); dispatch({ type: 'CLOSE', retainSearch: reason === 'escape' && retainQueryOnEscape ? s.search : null }); cancelPendingSearch();
        break;
      case 'none':
      default:
        invalidateBrowseLoads(); dispatch({ type: 'CLOSE' }); cancelPendingSearch();
        break;
    }
    return decision;
  }, [selectContainers, select, drill, cancelPendingSearch, invalidateBrowseLoads, log, allowFreeform, retainQueryOnEscape]);

  // ── 6. Title resolution for the committed value ──
  const resolvedTitle = useContentTitle(isContentIdLike(value) ? value : null);

  const normalizedStreamState = streamState ?? {
    query: attempt?.text ?? '',
    scope: searchParams,
    sources: Object.fromEntries([
      ...pendingSources.map((source) => [source, 'pending']),
      ...sourceErrors.map(({ source }) => [source, 'failed']),
    ]),
    results: streamResults,
    phase: streamSearching ? (streamResults.length > 0 ? 'partial' : 'loading')
      : sourceErrors.length > 0 ? 'partial' : 'complete',
    failedSources: sourceErrors.map(({ source }) => source),
  };
  const searchState = supportsSSE()
    ? {
        ...normalizedStreamState,
        query: state.search ?? '',
        scope: searchParams,
        results: state.results,
        phase: debouncePending ? 'loading' : normalizedStreamState.phase,
      }
    : {
        query: state.search ?? '',
        scope: searchParams,
        sources: batchLoading ? { batch: 'pending' } : { batch: streamError ? 'failed' : 'complete' },
        results: state.results,
        phase: debouncePending || batchLoading
          ? 'loading'
          : streamError ? 'failed' : (state.search ?? '').trim().length < 2 ? 'idle' : 'complete',
        failedSources: streamError ? ['batch'] : [],
      };

  return {
    state,
    searchState,
    dispatch,
    // input/search
    handleInput,
    activeScope,
    clearScope,
    // browse
    openWithSiblings,
    drill,
    goUp,
    goToCrumb,
    paginate,
    paginationWindow: state.mode === Modes.BROWSE ? paginationOwnerRef.current : null,
    // lifecycle
    handleClose,
    select,
    commit,
    // meta
    searchSettled,
    resolvedTitle,
    isSearching: streamSearching || batchLoading || debouncePending,
    pendingSources,
    sourceErrors,
    streamError,
    retrySource: retryStream,
    // D5: true once this query text has widened from `searchParams` to
    // `fallbackSearchParams` after a clean empty settle. Surfaces use this to
    // render "Nothing in ‹scope› — showing N results from everywhere."
    fellBackToAll,
    // Flag truncation so the UI can offer a "refine your search" affordance
    // (audit S6 / F6). Two independent caps can bite: the machine caps every
    // transport's results at RENDER_CAP (the SSE stream is otherwise uncapped
    // and can stream hundreds), and the batch fallback the server limits to
    // BATCH_TAKE. Report whichever the raw (pre-cap) count crossed.
    truncatedAt: rawResultCount > RENDER_CAP
      ? RENDER_CAP
      : (!supportsSSE() && batchResults.length >= BATCH_TAKE) ? BATCH_TAKE : null,
  };
}

export { Modes };
export default useContentCombobox;
