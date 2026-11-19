import { Select } from '@/lib/ui/Select.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useVisibleRefresh } from "@/lib/hooks/useVisibleRefresh.js";
import { useFeedWorkspace } from "../FeedWorkspaceContext.jsx";
import "../FeedShared.scss";

const resultKey = item => item.stateKey || item.id;

export default function FeedSearch() {
  const [params, setParams] = useSearchParams();
  const requestKey = params.toString();
  const [query, setQuery] = useState(params.get('q') || '');
  const [source, setSource] = useState(params.get('source') || '');
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [total, setTotal] = useState(0);
  const [coverage, setCoverage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const { mutateItems, applyPendingMutations } = useFeedWorkspace();
  const inputRef = useRef(null);
  const requestRef = useRef(null);
  const hasAppendedPage = useRef(false);
  const writes = useRef({ pending: 0, generation: 0 });

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
        hasAppendedPage.current = false;
      }
      setError(null);
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
      if (!refresh || !overlappedWrite) {
        const incoming = applyPendingMutations(result.items || []);
        if (append) {
          hasAppendedPage.current = true;
          setItems(current => {
            const existing = new Set(current.map(resultKey));
            return [...current, ...incoming.filter(item => !existing.has(resultKey(item)))];
          });
        } else if (refresh && hasAppendedPage.current) {
          // Page one can update rows already displayed without moving the
          // reader or replacing the continuation supplied by their last page.
          const refreshed = new Map(incoming.map(item => [resultKey(item), item]));
          setItems(current => current.map(item => refreshed.get(resultKey(item)) || item));
        } else {
          setItems(incoming);
        }
        if (!refresh || !hasAppendedPage.current) setNextCursor(result.nextCursor || null);
      }
      setTotal(result.total || 0);
      setCoverage(result.coverage || null);
    } catch (err) {
      if (!refresh && !controller.signal.aborted && err.name !== 'AbortError') setError('Search could not be completed.');
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
  const replace = updated => setItems(current => current.map(item => updated.find(value => value.id === item.id) || item));
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
      {loading && <p role="status">Searching…</p>}
      {error && <p className="feed-error" role="alert">{error} <button onClick={() => runSearch()}>Retry</button></p>}
      {!loading && !error && items.length === 0 && <p className="feed-empty">No matching items in indexed history.</p>}
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
      {nextCursor && <button className="feed-search__more" disabled={loadingMore} onClick={() => runSearch({ append: true, cursor: nextCursor })}>{loadingMore ? 'Loading…' : `Load more (${items.length} of ${total})`}</button>}
    </section>
  );
}
