import { Select } from '@/lib/ui/Select.jsx';
import { EmptyState, ErrorState, StateMessage } from '@/lib/ui/states.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useVisibleRefresh } from "@/lib/hooks/useVisibleRefresh.js";
import { useFeedWorkspace } from "../FeedWorkspaceContext.jsx";
import "../FeedShared.scss";

const resultKey = item => item.stateKey || item.id;
const NO_RESULTS = { items: [], nextCursor: null, total: 0, coverage: null };

export default function FeedSearch() {
  const [params, setParams] = useSearchParams();
  const requestKey = params.toString();
  const [query, setQuery] = useState(params.get('q') || '');
  const [source, setSource] = useState(params.get('source') || '');
  const [resultPage, setResultPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requestError, setRequestError] = useState(null);
  const { mutateItems, applyPendingMutations } = useFeedWorkspace();
  const inputRef = useRef(null);
  const requestRef = useRef(null);
  const writes = useRef({ pending: 0, generation: 0 });
  const currentPage = resultPage?.requestKey === requestKey ? resultPage : null;
  const { items, nextCursor, total, coverage } = currentPage ?? NO_RESULTS;
  const error = requestError?.requestKey === requestKey ? requestError.error : null;
  const searching = loading || (!currentPage && !error);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const current = new URLSearchParams(requestKey);
    setQuery(current.get('q') || '');
    setSource(current.get('source') || '');
  }, [requestKey]);

  const runSearch = useCallback(async ({ append = false, cursor = null, refresh = false } = {}) => {
    if (refresh && requestRef.current) return;
    requestRef.current?.abort();
    const writeGeneration = writes.current.generation;
    const controller = new AbortController();
    requestRef.current = controller;
    if (!refresh) {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setLoadingMore(false);
      }
      setRequestError(null);
    }
    const api = new URLSearchParams(requestKey);
    api.set('limit', '30');
    if (cursor) api.set('cursor', cursor); else api.delete('cursor');
    try {
      const result = await DaylightAPI(`/api/v1/feed/search?${api}`, {}, 'GET', { signal: controller.signal });
      if (controller.signal.aborted) return;
      // A poll overlapping an optimistic action can still report index
      // progress. A later poll can apply authoritative state after settlement.
      const overlappedWrite = writes.current.pending > 0 || writeGeneration !== writes.current.generation;
      const metadata = { total: result.total || 0, coverage: result.coverage || null };
      const incoming = refresh && overlappedWrite ? null : applyPendingMutations(result.items || []);
      const nextCursor = result.nextCursor || null;
      setResultPage(current => {
        if (!append && !refresh) {
          return { requestKey, items: incoming, nextCursor, ...metadata, hasAppendedPage: false };
        }
        if (current?.requestKey !== requestKey) return current;
        if (!incoming) return { ...current, ...metadata };
        if (append) {
          const existing = new Set(current.items.map(resultKey));
          const items = [...current.items, ...incoming.filter(item => !existing.has(resultKey(item)))];
          return { ...current, ...metadata, items, nextCursor, hasAppendedPage: true };
        }
        if (current.hasAppendedPage) {
          // Update visible rows without replacing the last page's continuation.
          const refreshed = new Map(incoming.map(item => [resultKey(item), item]));
          const items = current.items.map(item => refreshed.get(resultKey(item)) || item);
          return { ...current, ...metadata, items };
        }
        return { ...current, ...metadata, items: incoming, nextCursor };
      });
    } catch (err) {
      if (!refresh && !controller.signal.aborted && err.name !== 'AbortError') {
        setRequestError({ requestKey, error: new Error('Search could not be completed.') });
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!refresh && !controller.signal.aborted) { setLoading(false); setLoadingMore(false); }
      }
    }
  }, [applyPendingMutations, requestKey]);

  useEffect(() => {
    runSearch();
    return () => requestRef.current?.abort();
  }, [runSearch]);

  const refreshCoverage = useCallback(() => runSearch({ refresh: true }), [runSearch]);
  useVisibleRefresh({ active: coverage?.status === 'running' && !error, intervalMs: 2000, reload: refreshCoverage });

  const submit = event => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (query.trim()) next.set('q', query.trim()); else next.delete('q');
    if (source.trim()) next.set('source', source.trim()); else next.delete('source');
    setParams(next);
  };
  const replace = updated => setResultPage(current => {
    if (!current) return current;
    return { ...current, items: current.items.map(item => updated.find(value => value.id === item.id) || item) };
  });
  const actOnItem = async (item, action) => {
    writes.current.pending++;
    try {
      await mutateItems([item], action, { onApply: replace }).catch(() => {});
    } finally {
      writes.current.pending--;
      writes.current.generation++;
    }
  };
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  return (
    <section className="feed-search" aria-labelledby="feed-search-title">
      <h1 id="feed-search-title">Search your feed</h1>
      <form className="feed-search__form" onSubmit={submit} role="search">
        <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search headlines, sources, summaries…" aria-label="Search feed history" />
        <button type="submit">Search</button>
      </form>
      <div className="feed-filter-tabs" aria-label="Search filters">
        {['all', 'unread', 'saved', 'archived'].map(state => (
          <button key={state} className={(params.get('state') || 'all') === state ? 'active' : ''} onClick={() => setFilter('state', state === 'all' ? '' : state)}>{state}</button>
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
      {error && <ErrorState title={null} error={error} onRetry={() => runSearch()} />}
      {!searching && !error && items.length === 0 && <EmptyState title="No matching items in indexed history." />}
      <div className="feed-search__results">
        {items.map(item => (
          <article className="feed-result" key={item.stateKey || item.id}>
            <div className="feed-result__meta">{item.sourceInfo?.label || item.source} · {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : ''}{item.state?.syncStatus === 'pending' ? ' · sync pending' : ''}</div>
            <h2>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h2>
            {item.summary && <p>{item.summary}</p>}
            <div className="feed-item-actions">
              <button aria-pressed={!!item.state?.isSaved} onClick={() => actOnItem(item, item.state?.isSaved ? 'unsave' : 'save')}>{item.state?.isSaved ? 'Saved' : 'Save'}</button>
              <button onClick={() => actOnItem(item, item.state?.isArchived ? 'unarchive' : 'archive')}>{item.state?.isArchived ? 'Restore' : 'Archive'}</button>
              <button onClick={() => actOnItem(item, item.state?.isRead ? 'unread' : 'read')}>{item.state?.isRead ? 'Mark unread' : 'Mark read'}</button>
            </div>
          </article>
        ))}
      </div>
      {nextCursor && <button className="feed-search__more" disabled={searching || loadingMore} onClick={() => runSearch({ append: true, cursor: nextCursor })}>{loadingMore ? 'Loading…' : `Load more (${items.length} of ${total})`}</button>}
    </section>
  );
}
