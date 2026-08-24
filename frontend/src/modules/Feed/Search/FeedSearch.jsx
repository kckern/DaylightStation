import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useFeedWorkspace } from '../FeedWorkspaceContext.jsx';
import '../FeedShared.scss';

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

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const current = new URLSearchParams(requestKey);
    setQuery(current.get('q') || '');
    setSource(current.get('source') || '');
  }, [requestKey]);

  const runSearch = useCallback(async ({ append = false, cursor = null } = {}) => {
    if (!append) requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    const api = new URLSearchParams(requestKey);
    api.set('limit', '30');
    if (cursor) api.set('cursor', cursor); else api.delete('cursor');
    try {
      const result = await DaylightAPI(`/api/v1/feed/search?${api}`, {}, 'GET', { signal: controller.signal });
      const incoming = applyPendingMutations(result.items || []);
      setItems(current => append ? [...current, ...incoming.filter(item => !current.some(existing => existing.stateKey === item.stateKey))] : incoming);
      setNextCursor(result.nextCursor || null);
      setTotal(result.total || 0);
      setCoverage(result.coverage || null);
    } catch (err) {
      if (err.name !== 'AbortError') setError('Search could not be completed.');
    } finally {
      if (!controller.signal.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [applyPendingMutations, requestKey]);

  useEffect(() => {
    runSearch();
    return () => requestRef.current?.abort();
  }, [runSearch]);

  useEffect(() => {
    if (coverage?.status !== 'running') return undefined;
    const timer = setTimeout(() => runSearch(), 2_000);
    return () => clearTimeout(timer);
  }, [coverage?.indexed, coverage?.status, runSearch]);

  const submit = event => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    if (query.trim()) next.set('q', query.trim()); else next.delete('q');
    if (source.trim()) next.set('source', source.trim()); else next.delete('source');
    setParams(next);
  };
  const replace = updated => setItems(current => current.map(item => updated.find(value => value.id === item.id) || item));
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  return (
    <main className="feed-search" aria-labelledby="feed-search-title">
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
        <label>Mode<select value={params.get('mode') || ''} onChange={event => setFilter('mode', event.target.value)}><option value="">Any</option><option value="reader">Reader</option><option value="headlines">Headlines</option><option value="scroll">Scroll</option></select></label>
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
              <button aria-pressed={!!item.state?.isSaved} onClick={() => mutateItems([item], item.state?.isSaved ? 'unsave' : 'save', { onApply: replace })}>{item.state?.isSaved ? 'Saved' : 'Save'}</button>
              <button onClick={() => mutateItems([item], item.state?.isArchived ? 'unarchive' : 'archive', { onApply: replace })}>{item.state?.isArchived ? 'Restore' : 'Archive'}</button>
              <button onClick={() => mutateItems([item], item.state?.isRead ? 'unread' : 'read', { onApply: replace })}>{item.state?.isRead ? 'Mark unread' : 'Mark read'}</button>
            </div>
          </article>
        ))}
      </div>
      {nextCursor && <button className="feed-search__more" disabled={loadingMore} onClick={() => runSearch({ append: true, cursor: nextCursor })}>{loadingMore ? 'Loading…' : `Load more (${items.length} of ${total})`}</button>}
    </main>
  );
}
