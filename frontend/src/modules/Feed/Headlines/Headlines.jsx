import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { SourcePanel } from './SourcePanel.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useFeedWorkspace } from '../FeedWorkspaceContext.jsx';
import { buildHeadlineGrid } from './buildHeadlineGrid.js';
import './Headlines.scss';

export default function Headlines({ pageId }) {
  const [pages, setPages] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'outlets' ? 'outlets' : 'briefing';
  const data = pages[pageId] || null;
  const { getLastVisit, markVisited, mutateItems, applyPendingMutations } = useFeedWorkspace();
  const previousVisit = useRef(getLastVisit('headlines'));
  const visitStarted = useRef(new Date().toISOString());

  useEffect(() => { markVisited('headlines', visitStarted.current); }, [markVisited]);

  const fetchHeadlines = useCallback(async ({ signal } = {}) => {
    setError(null);
    setLoading(true);
    try {
      const result = await DaylightAPI(`/api/v1/feed/headlines?page=${encodeURIComponent(pageId || '')}`, {}, 'GET', { signal });
      const sources = Object.fromEntries(Object.entries(result.sources || {}).map(([id, source]) => [id, { ...source, items: applyPendingMutations(source.items || []) }]));
      const briefing = (result.briefing || []).map(story => {
        const coverage = applyPendingMutations(story.coverage || []);
        return { ...story, coverage, state: coverage[0]?.state || story.state };
      });
      if (!signal?.aborted) setPages(current => ({ ...current, [pageId]: { ...result, sources, briefing } }));
    } catch (err) {
      if (err.name !== 'AbortError') setError('This edition could not be refreshed.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [applyPendingMutations, pageId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchHeadlines({ signal: controller.signal });
    return () => controller.abort();
  }, [fetchHeadlines]);

  const triggerHarvestAll = async () => {
    setLoading(true);
    try {
      await DaylightAPI(`/api/v1/feed/headlines/harvest?page=${encodeURIComponent(pageId || '')}`, {}, 'POST');
      await fetchHeadlines();
    } catch {
      setError('Sources could not be refreshed. Existing headlines are still available.');
      notifications.show({ color: 'red', title: 'Refresh failed', message: 'Showing the last available edition.' });
    } finally { setLoading(false); }
  };

  if (loading && !data) return <div className="feed-placeholder" role="status">Loading headlines…</div>;

  const sources = data?.sources || {};
  const grid = data?.grid;
  const rows = grid?.rows || [];
  const cols = grid?.cols || [];
  const cells = buildHeadlineGrid(sources, rows, cols);

  const setView = nextView => {
    const next = new URLSearchParams(searchParams);
    if (nextView === 'briefing') next.delete('view'); else next.set('view', nextView);
    setSearchParams(next, { replace: true });
  };

  const updateHeadlineState = (item, action) => mutateItems([item], action, {
    onApply: updated => setPages(current => {
      const nextById = new Map(updated.map(value => [value.id, value]));
      return {
        ...current,
        [pageId]: {
          ...current[pageId],
          sources: Object.fromEntries(Object.entries(current[pageId]?.sources || {}).map(([id, source]) => [id, {
            ...source,
            items: (source.items || []).map(value => nextById.get(value.id) || value),
          }])),
          briefing: (current[pageId]?.briefing || []).map(story => {
            const coverage = (story.coverage || []).map(value => nextById.get(value.id) || value);
            return { ...story, coverage, state: coverage[0]?.state || story.state };
          }),
        },
      };
    }),
  }).catch(() => {});

  return (
    <main className="headlines-view">
      <header className="headlines-toolbar">
        <div>
          <div className="headlines-view-switcher" role="group" aria-label="Headline view">
            <button className={view === 'briefing' ? 'active' : ''} onClick={() => setView('briefing')}>Briefing</button>
            <button className={view === 'outlets' ? 'active' : ''} onClick={() => setView('outlets')}>Outlets</button>
          </div>
          <span className="headlines-meta">{Object.keys(sources).length} sources{data?.lastHarvest && ` · updated ${formatTime(data.lastHarvest)}`}</span>
        </div>
        <button className="headlines-harvest-btn" onClick={triggerHarvestAll} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh all'}</button>
      </header>
      {error && <div className="headlines-error" role="alert"><span>{error}</span><button onClick={() => fetchHeadlines()}>Retry</button></div>}
      {!!data?.configWarnings?.length && <div className="headlines-error" role="status">{data.configWarnings.length} source placement{data.configWarnings.length === 1 ? '' : 's'} need configuration attention.</div>}

      {view === 'briefing' ? (
        <section className="headline-briefing" aria-label="Top stories">
          {(data?.briefing || []).filter(story => !story.state?.isArchived).map((story, index) => (
            <article className={`briefing-story ${index === 0 ? 'briefing-story--lead' : ''}`} key={story.id}>
              <div className="briefing-story__eyebrow">{!!previousVisit.current && new Date(story.publishedAt || 0).getTime() > new Date(previousVisit.current).getTime() && <span className="briefing-story__new">New · </span>}{story.sourceCount > 1 ? `${story.sourceCount} outlets` : story.leadSource}{story.publishedAt ? ` · ${formatTime(story.publishedAt)}` : ''}</div>
              <h2><a href={story.coverage?.[0]?.url} target="_blank" rel="noreferrer">{story.title}</a></h2>
              {story.excerpt && <p>{story.excerpt}</p>}
              {story.coverage?.[0] && <HeadlineStateActions item={story.coverage[0]} onAction={updateHeadlineState} />}
              <details>
                <summary>{story.sourceCount > 1 ? 'Compare coverage' : 'Source'}</summary>
                <ul>{story.coverage?.map(item => <li key={`${item.sourceId}:${item.id}`}><a href={item.url} target="_blank" rel="noreferrer"><strong>{item.sourceLabel}:</strong> {item.title}</a></li>)}</ul>
              </details>
              {story.timeline?.length > 1 && <details className="briefing-story__timeline">
                <summary>Story timeline</summary>
                <ol>{story.timeline.map(item => <li key={`timeline:${item.sourceId}:${item.id}`}><time dateTime={item.publishedAt}>{formatTimelineTime(item.publishedAt)}</time><span className={`briefing-story__event briefing-story__event--${item.kind}`}>{item.kind}</span><a href={item.url} target="_blank" rel="noreferrer">{item.sourceLabel}: {item.title}</a></li>)}</ol>
              </details>}
            </article>
          ))}
          {!data?.briefing?.length && <p className="feed-empty">No headlines are available for this edition.</p>}
        </section>
      ) : (
        <section className="headlines-matrix" aria-label="Outlet matrix">
          {cells.map((row, r) => (
            <div key={rows[r] ?? r} className="matrix-row">
              {row.map((cell, c) => <SourcePanel key={cell?.id || `empty-${r}-${c}`} source={cell} col={c} totalCols={cols.length} paywallProxy={data?.paywallProxy || null} onRefresh={() => fetchHeadlines()} onStateAction={updateHeadlineState} colColors={data?.col_colors || null} />)}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

function HeadlineStateActions({ item, onAction }) {
  return (
    <div className="headline-state-actions" aria-label={`Actions for ${item.title}`}>
      <button type="button" aria-pressed={!!item.state?.isSaved} onClick={() => onAction(item, item.state?.isSaved ? 'unsave' : 'save')}>{item.state?.isSaved ? 'Saved' : 'Save'}</button>
      <button type="button" onClick={() => onAction(item, item.state?.isArchived ? 'unarchive' : 'archive')}>{item.state?.isArchived ? 'Restore' : 'Archive'}</button>
      <button type="button" onClick={() => onAction(item, item.state?.isRead ? 'unread' : 'read')}>{item.state?.isRead ? 'Unread' : 'Read'}</button>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return date.toLocaleDateString();
}

function formatTimelineTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
