import { Button } from '@/lib/ui/Button.jsx';
import { Select } from '@/lib/ui/Select.jsx';
import { EmptyState, ErrorState, StateMessage } from '@/lib/ui/states.jsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useRefreshableRead } from '@/lib/hooks/useRefreshableRead.js';
import { useRetryRegion } from '@/lib/ui/useRetryRegion.js';
import { useVisibleRefresh } from "@/lib/hooks/useVisibleRefresh.js";
import { useFeedWorkspace } from "../FeedWorkspaceContext.jsx";
import "../FeedShared.scss";
import { webLink } from "../../shared/webLink.mjs";

const resultKey = item => item.stateKey || item.id;
const NO_RESULTS = { items: [], nextCursor: null, total: 0, coverage: null };
const searchTimeoutMs = 10_000;

function reconcileRows(items, current, before, pending) {
  const recent = new Map(current.filter(item => {
    const key = resultKey(item);
    return pending.has(key) || before.get(key) !== item;
  }).map(item => [resultKey(item), item]));
  const found = new Set(items.map(resultKey));
  const rows = items.map(item => {
    const local = recent.get(resultKey(item));
    return local ? { ...item, state: local.state, isRead: local.isRead } : item;
  });
  current.forEach((item, index) => {
    const key = resultKey(item);
    if (recent.has(key) && !found.has(key)) rows.splice(index, 0, item);
  });
  return rows;
}

export default function FeedSearch() {
  const [params, setParams] = useSearchParams();
  const requestKey = params.toString();
  const committedQuery = params.get('q') || '';
  const committedSource = params.get('source') || '';
  const activeState = params.get('state') || 'all';
  const [query, setQuery] = useState(committedQuery);
  const [source, setSource] = useState(committedSource);
  const [resultPage, setResultPage] = useState(null);
  const [foreground, setForeground] = useState('initial');
  const [requestError, setRequestError] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const { mutateItems, applyPendingMutations, pendingItemOperations, itemSyncRevision } = useFeedWorkspace();
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const paginationRef = useRef(null);
  const syncRetryRef = useRef(null);
  const appendedHeadingRef = useRef(null);
  const handledAppendFocus = useRef(null);
  const latestSync = useRef(itemSyncRevision);
  latestSync.current = itemSyncRevision;
  const requestedSync = useRef(itemSyncRevision);
  const writes = useRef({ pending: new Set(), generation: 0 });
  const currentPage = resultPage?.requestKey === requestKey ? resultPage : null;
  const displayedPage = useRef(null);
  displayedPage.current = currentPage;
  const { items, nextCursor, total, coverage } = currentPage ?? NO_RESULTS;
  const failure = requestError?.requestKey === requestKey ? requestError : null;
  const syncing = syncStatus?.requestKey === requestKey && syncStatus.pending;
  const syncError = syncStatus?.requestKey === requestKey && syncStatus.error;
  const loadingMore = foreground === 'append';
  const searching = foreground === 'initial' || (!currentPage && !failure);
  const appendFocus = currentPage?.appendFocus;

  useLayoutEffect(() => {
    if (!appendFocus || handledAppendFocus.current === appendFocus) return;
    handledAppendFocus.current = appendFocus;
    if (document.activeElement === document.body) {
      const target = appendFocus.target?.isConnected ? appendFocus.target : appendedHeadingRef.current ?? inputRef.current;
      target?.focus();
    }
  }, [appendFocus]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setQuery(committedQuery); }, [committedQuery]);
  useEffect(() => { setSource(committedSource); }, [committedSource]);

  const readPage = useCallback((cursor, signal) => {
    const api = new URLSearchParams(requestKey);
    api.set('limit', '30');
    if (cursor) api.set('cursor', cursor); else api.delete('cursor');
    return DaylightAPI(`/api/v1/feed/search?${api}`, {}, 'GET', { signal });
  }, [requestKey]);

  const readSettledItems = useCallback(async (isCurrent, signal) => {
    const window = displayedPage.current;
    if (window?.requestKey !== requestKey) return;
    setSyncStatus(current => ({ requestKey, pending: true, error: current?.requestKey === requestKey && current.error }));
    const before = new Map(window.items.map(item => [resultKey(item), item]));
    const pending = new Set([...writes.current.pending].filter(edit => edit.requestKey === requestKey).map(edit => edit.key));

    // Search cursors are offsets into the current filtered query. Follow
    // the refreshed sequence to fill the loaded window after membership changes.
    const refreshed = new Map();
    let result;
    let cursor = null;
    let pages = 0;
    do {
      result = await readPage(cursor, signal);
      if (!isCurrent()) return;
      for (const item of result.items || []) refreshed.set(resultKey(item), item);
      cursor = result.nextCursor || null;
      pages++;
    } while (cursor && pages < window.pages);

    const active = document.activeElement;
    const restoreFocus = resultsRef.current?.contains(active) || active === paginationRef.current || active === syncRetryRef.current;
    const incoming = [...refreshed.values()];
    setResultPage(current => {
      if (current?.requestKey !== requestKey) return current;
      const items = applyPendingMutations(reconcileRows(incoming, current.items, before, pending));
      return { ...current, items, pages, nextCursor: cursor, total: result.total || 0, coverage: result.coverage || null,
        appendFocus: restoreFocus ? { target: active } : current.appendFocus };
    });
    setRequestError(null);
    setSyncStatus(null);
  }, [applyPendingMutations, readPage, requestKey]);

  const finishRead = useCallback((kind, cursor, failed) => {
    if (kind === 'coverage') return;
    if (kind === 'reconcile') {
      if (failed) setSyncStatus({ requestKey, error: true });
      return;
    }
    if (failed) {
      setRequestError({ requestKey, append: kind === 'append', cursor, error: new Error('Search could not be completed.') });
    }
    setForeground(null);
  }, [requestKey]);

  const readSearch = useCallback(async (isCurrent, signal, kind = 'initial', cursor = null) => {
    const append = kind === 'append';
    const refresh = kind === 'coverage';
    const writeGeneration = writes.current.generation;
    if (kind === 'initial') {
      // A full read started after replay already covers that revision.
      requestedSync.current = latestSync.current;
    }
    if (kind === 'initial' || append) {
      setForeground(kind);
      setRequestError(null);
    }
    let failed = false;
    try {
      if (kind === 'reconcile') {
        await readSettledItems(isCurrent, signal);
        return;
      }
      const result = await readPage(cursor, signal);
      if (!isCurrent()) return;
      // A poll overlapping an optimistic action can still report index
      // progress. A later poll can apply authoritative state after settlement.
      const overlappedWrite = writes.current.pending.size > 0 || writeGeneration !== writes.current.generation;
      const metadata = { total: result.total || 0, coverage: result.coverage || null };
      const incoming = refresh && overlappedWrite ? null : applyPendingMutations(result.items || []);
      const nextCursor = result.nextCursor || null;
      const moveFocus = append && !nextCursor && paginationRef.current?.matches(':focus');
      setResultPage(current => {
        if (!append && !refresh) {
          return { requestKey, items: incoming, nextCursor, ...metadata, pages: 1 };
        }
        if (current?.requestKey !== requestKey) return current;
        if (!incoming) return { ...current, ...metadata };
        if (append) {
          const existing = new Set(current.items.map(resultKey));
          const added = incoming.filter(item => !existing.has(resultKey(item)));
          const items = [...current.items, ...added];
          const focusItem = added[0] ?? items.at(-1);
          const appendFocus = moveFocus ? { key: focusItem && resultKey(focusItem) } : null;
          return { ...current, ...metadata, items, nextCursor, pages: current.pages + 1, appendFocus };
        }
        if (current.pages > 1) {
          // Update visible rows without replacing the last page's continuation.
          const refreshed = new Map(incoming.map(item => [resultKey(item), item]));
          const items = current.items.map(item => refreshed.get(resultKey(item)) || item);
          return { ...current, ...metadata, items };
        }
        return { ...current, ...metadata, items: incoming, nextCursor };
      });
    } catch (err) {
      failed = err.name !== 'AbortError';
    } finally {
      if (isCurrent()) finishRead(kind, cursor, failed);
    }
  }, [applyPendingMutations, finishRead, readPage, readSettledItems, requestKey]);
  const onTimeout = useCallback((kind = 'initial', cursor = null) => finishRead(kind, cursor, true), [finishRead]);
  const { reload, poll } = useRefreshableRead(readSearch, {
    timeoutMs: searchTimeoutMs, onTimeout,
  });

  useLayoutEffect(() => {
    setSyncStatus(null);
    reload();
  }, [reload]);

  useEffect(() => {
    if (!pendingItemOperations?.length) return;
    setResultPage(current => current?.requestKey === requestKey
      ? { ...current, items: applyPendingMutations(current.items) } : current);
  }, [applyPendingMutations, pendingItemOperations, requestKey]);

  useLayoutEffect(() => {
    if (!currentPage || foreground || requestedSync.current === itemSyncRevision) return;
    requestedSync.current = itemSyncRevision;
    reload('reconcile');
  }, [currentPage, itemSyncRevision, foreground, reload]);

  const refreshCoverage = useCallback(() => poll('coverage'), [poll]);
  useVisibleRefresh({ active: coverage?.status === 'running' && !failure && !syncError, intervalMs: 2000, reload: refreshCoverage });

  const submit = event => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (query.trim()) next.set('q', query.trim()); else next.delete('q');
    if (source.trim()) next.set('source', source.trim()); else next.delete('source');
    setParams(next);
  };
  const replace = updated => setResultPage(current => {
    if (current?.requestKey !== requestKey) return current;
    return { ...current, items: current.items.map(item => updated.find(value => value.id === item.id) || item) };
  });
  const actOnItem = async (item, action) => {
    const edit = { requestKey, key: resultKey(item) };
    writes.current.pending.add(edit);
    try {
      await mutateItems([item], action, { onApply: replace }).catch(() => {});
    } finally {
      writes.current.pending.delete(edit);
      writes.current.generation++;
    }
  };
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };
  const appendFailure = failure?.append ? failure : null;
  const reading = searching || loadingMore || syncing;
  const paginationDisabled = reading || syncError;
  const { regionProps, retry } = useRetryRegion(reload, searching);

  return (
    <section className="feed-search" aria-labelledby="feed-search-title" {...regionProps}>
      <h1 id="feed-search-title">Search your feed</h1>
      <form className="feed-search__form" onSubmit={submit} role="search">
        <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search headlines, sources, summaries…" aria-label="Search feed history" />
        <button type="submit">Search</button>
      </form>
      <div className="feed-filter-tabs" role="group" aria-label="Search filters">
        {['all', 'unread', 'saved', 'archived'].map(state => (
          <button key={state} className={activeState === state ? 'active' : ''}
            aria-pressed={activeState === state}
            onClick={() => setFilter('state', state === 'all' ? '' : state)}>{state}</button>
        ))}
      </div>
      <form className="feed-search__advanced" aria-label="Search scope" onSubmit={submit}>
        <label>Mode<Select density="compact" value={params.get('mode') || ''} onChange={event => setFilter('mode', event.target.value)}><option value="">Any</option><option value="reader">Reader</option><option value="headlines">Headlines</option><option value="scroll">Scroll</option></Select></label>
        <label>Source<input value={source} onChange={event => setSource(event.target.value)} placeholder="Name or type" /></label>
        <label>From<input type="date" value={params.get('from') || ''} onChange={event => setFilter('from', event.target.value)} /></label>
        <label>To<input type="date" value={(params.get('to') || '').slice(0, 10)} onChange={event => setFilter('to', event.target.value ? `${event.target.value}T23:59:59.999Z` : '')} /></label>
        <button type="submit">Apply</button>
      </form>
      {coverage && <p className="feed-search__coverage" role="status">{total} result{total === 1 ? '' : 's'} · {coverage.retentionMonths}-month history{coverage.status === 'running' ? ` · indexing (${coverage.indexed || 0})` : coverage.status === 'failed' ? ' · backfill paused' : ''}</p>}
      {searching && <StateMessage state="loading" role="status" title="Searching…" />}
      {failure && !appendFailure && <ErrorState title={null} error={failure.error} onRetry={retry} />}
      {!searching && !failure && items.length === 0 && <EmptyState title="No matching items in indexed history." />}
      <div className="feed-search__results" ref={resultsRef}>
        {items.map(item => {
          const key = resultKey(item);
          const isFocusTarget = appendFocus?.key === key;
          const publicationDate = item.publishedAt ? new Date(item.publishedAt) : null;
          const metadata = [
            item.sourceInfo?.label || item.source,
            publicationDate && Number.isFinite(publicationDate.getTime()) ? publicationDate.toLocaleDateString() : null,
            item.state?.syncStatus === 'pending' ? 'sync pending' : null,
          ].filter(Boolean).join(' · ');
          return <article className="feed-result" key={key}>
            <div className="feed-result__meta">{metadata}</div>
            <h2 ref={isFocusTarget ? appendedHeadingRef : null} tabIndex={isFocusTarget ? -1 : undefined}>
              {webLink(item.url) ? <a href={webLink(item.url)} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
            </h2>
            {item.summary && <p>{item.summary}</p>}
            <div className="feed-item-actions">
              <button aria-pressed={!!item.state?.isSaved} onClick={() => actOnItem(item, item.state?.isSaved ? 'unsave' : 'save')}>{item.state?.isSaved ? 'Saved' : 'Save'}</button>
              <button onClick={() => actOnItem(item, item.state?.isArchived ? 'unarchive' : 'archive')}>{item.state?.isArchived ? 'Restore' : 'Archive'}</button>
              <button onClick={() => actOnItem(item, item.state?.isRead ? 'unread' : 'read')}>{item.state?.isRead ? 'Mark unread' : 'Mark read'}</button>
            </div>
          </article>;
        })}
      </div>
      {syncError && (
        <div>
          <StateMessage state="error" role="alert" detail="Search results could not be refreshed." />
          <Button ref={syncRetryRef} density="compact" variant="secondary" aria-disabled={reading || undefined}
            aria-busy={syncing || undefined} onClick={() => { if (!reading) reload('reconcile'); }}>
            Retry refresh
          </Button>
        </div>
      )}
      {appendFailure && <StateMessage state="error" role="alert" detail={appendFailure.error.message} />}
      {nextCursor && (
        <Button ref={paginationRef} className="feed-search__more" density="compact" variant="secondary"
          aria-disabled={paginationDisabled || undefined} aria-busy={loadingMore || syncing || undefined}
          onClick={() => {
            if (paginationDisabled) return;
            reload('append', appendFailure?.cursor ?? nextCursor);
          }}>
          {loadingMore ? 'Loading…' : appendFailure ? 'Retry' : `Load more (${items.length} of ${total})`}
        </Button>
      )}
    </section>
  );
}
