import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { useFeedWorkspace } from '../FeedWorkspaceContext.jsx';
import ReaderSidebar from './ReaderSidebar.jsx';
import ArticleRow from './ArticleRow.jsx';
import { useVirtualFeedWindow } from '../Scroll/hooks/useVirtualFeedWindow.js';
import { listOfflineEditions } from '../offline/feedOfflineStore.js';
import './Reader.scss';

const log = getLogger().child({ app: 'feed', module: 'reader' });

/** Group articles by day label */
function groupByDay(articles) {
  const groups = [];
  const map = new Map();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const todayKey = dayKey(today);
  const yesterdayKey = dayKey(yesterday);

  for (const article of articles) {
    const d = new Date(article.published);
    const key = dayKey(d);
    let label;
    if (key === todayKey) label = 'Today';
    else if (key === yesterdayKey) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

    if (!map.has(key)) {
      const group = { key, label, articles: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).articles.push(article);
  }
  return groups;
}

/** Group articles by week (Monday-anchored) */
function groupByWeek(articles) {
  const groups = [];
  const map = new Map();
  for (const article of articles) {
    const d = new Date(article.published);
    // Monday of this week
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = `${mon.getFullYear()}-${mon.getMonth()}-${mon.getDate()}`;
    const label = `Week of ${mon.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    if (!map.has(key)) {
      const group = { key, label, articles: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).articles.push(article);
  }
  return groups;
}

/** Group articles by month */
function groupByMonth(articles) {
  const groups = [];
  const map = new Map();
  for (const article of articles) {
    const d = new Date(article.published);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!map.has(key)) {
      const group = { key, label, articles: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).articles.push(article);
  }
  return groups;
}

const SEASON_NAMES = ['Winter', 'Spring', 'Summer', 'Fall'];

/** Group articles by season (Winter=Dec-Feb, Spring=Mar-May, Summer=Jun-Aug, Fall=Sep-Nov) */
function groupBySeason(articles) {
  const groups = [];
  const map = new Map();
  for (const article of articles) {
    const d = new Date(article.published);
    const m = d.getMonth(); // 0-11
    // Dec(11)=Winter of next year, Jan(0)-Feb(1)=Winter of this year
    const seasonIdx = m === 11 ? 0 : Math.floor((m + 1) / 3); // 0=Winter,1=Spring,2=Summer,3=Fall
    const yr = m === 11 ? d.getFullYear() + 1 : d.getFullYear();
    const key = `${yr}-${seasonIdx}`;
    const label = `${SEASON_NAMES[seasonIdx]} ${yr}`;
    if (!map.has(key)) {
      const group = { key, label, articles: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).articles.push(article);
  }
  return groups;
}

/** Group articles by year */
function groupByYear(articles) {
  const groups = [];
  const map = new Map();
  for (const article of articles) {
    const d = new Date(article.published);
    const key = `${d.getFullYear()}`;
    const label = key;
    if (!map.has(key)) {
      const group = { key, label, articles: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).articles.push(article);
  }
  return groups;
}

/** Sort articles within each group by published date descending */
function sortWithinGroups(groups) {
  for (const group of groups) {
    group.articles.sort((a, b) => new Date(b.published) - new Date(a.published));
  }
  return groups;
}

/**
 * Adaptive grouping: picks the coarsest level where avg items per group >= 3.
 * day → week → month → season → year
 * Unfiltered always uses day grouping.
 */
function smartGroup(articles, isFiltered) {
  if (!isFiltered || articles.length === 0) return sortWithinGroups(groupByDay(articles));

  const groupers = [groupByDay, groupByWeek, groupByMonth, groupBySeason, groupByYear];
  for (const fn of groupers) {
    const groups = fn(articles);
    const avg = articles.length / groups.length;
    if (avg >= 3) return sortWithinGroups(groups);
  }
  // Fallback: year (coarsest)
  return sortWithinGroups(groupByYear(articles));
}

export default function Reader() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { getSnapshot, setSnapshot, getLastVisit, markVisited, mutateItems, applyPendingMutations, checkpoints } = useFeedWorkspace();
  const initialSnapshot = useRef(getSnapshot('reader'));
  const initialCheckpoint = useRef(checkpoints.reader);
  const previousVisit = useRef(getLastVisit('reader'));
  const visitStarted = useRef(new Date().toISOString());
  const [feeds, setFeeds] = useState([]);
  const [articles, setArticles] = useState(() => applyPendingMutations(initialSnapshot.current?.articles || []));
  const [continuation, setContinuation] = useState(initialSnapshot.current?.continuation || null);
  const [exhausted, setExhausted] = useState(initialSnapshot.current?.exhausted || false);
  const feedsParam = searchParams.get('feeds') || '';
  const activeFeeds = useMemo(() => new Set(feedsParam.split(',').filter(Boolean)), [feedsParam]);
  const activeView = searchParams.get('view') || 'all';
  const [loading, setLoading] = useState(!initialSnapshot.current?.articles?.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [offlineError, setOfflineError] = useState(null);
  const [feedsError, setFeedsError] = useState(null);
  const [offlineItems, setOfflineItems] = useState([]);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sentinelRef = useRef(null);
  const inboxRef = useRef(null);
  const listRef = useRef(null);
  const sidebarRef = useRef(null);
  const requestRef = useRef(null);
  const appendLockRef = useRef(false);
  const snapshotRef = useRef(null);
  const checkpointRestoredRef = useRef(false);
  snapshotRef.current = { articles, continuation, exhausted };

  useEffect(() => { markVisited('reader', visitStarted.current); }, [markVisited]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previous = document.activeElement;
    sidebarRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') setDrawerOpen(false);
      if (event.key !== 'Tab' || !sidebarRef.current) return;
      const focusable = [...sidebarRef.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); sidebarRef.current.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sidebarRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [drawerOpen]);

  useEffect(() => {
    const inbox = inboxRef.current;
    if (!inbox) return undefined;
    if (drawerOpen) inbox.setAttribute('inert', '');
    else inbox.removeAttribute('inert');
    return () => inbox.removeAttribute('inert');
  }, [drawerOpen]);

  useEffect(() => {
    const onKeyDown = event => {
      if (!['j', 'k'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable) return;
      const rows = [...document.querySelectorAll('.article-row-header')];
      if (!rows.length) return;
      const activeIndex = rows.findIndex(row => row === document.activeElement);
      const nextIndex = event.key === 'j' ? Math.min(rows.length - 1, activeIndex + 1) : Math.max(0, activeIndex <= 0 ? 0 : activeIndex - 1);
      event.preventDefault();
      rows[nextIndex].focus({ preventScroll: true });
      rows[nextIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Load feeds for sidebar
  const loadFeeds = useCallback(() => {
    const controller = new AbortController();
    setFeedsError(null);
    DaylightAPI('/api/v1/feed/reader/feeds', {}, 'GET', { signal: controller.signal })
      .then(f => { setFeeds(f || []); setFeedsError(null); })
      .catch(err => {
        if (err.name === 'AbortError') return;
        log.warn('reader.feeds.failed', { error: err.message });
        setFeedsError('Subscriptions are unavailable. The inbox can still be used.');
      });
    return controller;
  }, []);

  useEffect(() => {
    const controller = loadFeeds();
    return () => controller.abort();
  }, [loadFeeds]);

  // Fetch stream articles
  // Unfiltered: day-based primer (days=3)
  // Filtered:   count-based backlog (count=50), full feed history
  const fetchStream = useCallback(async (cont = null, append = false) => {
    if (append && appendLockRef.current) return;
    if (append) appendLockRef.current = true;
    if (!append) requestRef.current?.abort();
    const controller = new AbortController();
    if (!append) requestRef.current = controller;
    if (!append) setLoading(true);
    else setLoadingMore(true);
    setStreamError(null);
    try {
      const isFiltered = activeFeeds.size > 0;
      const params = new URLSearchParams();
      if (isFiltered) {
        params.set('count', '50');
        params.set('feeds', [...activeFeeds].join(','));
      } else {
        params.set('days', '3');
        params.set('count', '100');
      }
      if (cont) params.set('continuation', cont);
      const data = await DaylightAPI(`/api/v1/feed/reader/stream?${params}`, {}, 'GET', { signal: controller.signal });
      const incoming = applyPendingMutations(data.items || []);
      setArticles(prev => append ? [...prev, ...incoming] : incoming);
      setContinuation(data.continuation || null);
      setExhausted(data.exhausted || false);
    } catch (err) {
      if (err.name !== 'AbortError') {
        log.warn('reader.stream.failed', { append, error: err.message });
        setStreamError('Articles could not be refreshed.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
      appendLockRef.current = false;
    }
  }, [activeFeeds, applyPendingMutations]);

  // Initial load + reload on filter change
  useEffect(() => {
    if (activeView === 'offline') return undefined;
    fetchStream();
    return () => requestRef.current?.abort();
  }, [activeView, fetchStream]);

  const loadOffline = useCallback(() => {
    let active = true;
    setOfflineLoading(true);
    setOfflineError(null);
    listOfflineEditions()
      .then(rows => { if (active) setOfflineItems(applyPendingMutations(rows.map(row => row.item))); })
      .catch(error => {
        if (active) setOfflineError('Downloaded articles could not be opened on this device.');
        log.warn('reader.offline_editions.failed', { error: error.message });
      })
      .finally(() => { if (active) setOfflineLoading(false); });
    return () => { active = false; };
  }, [applyPendingMutations]);

  useEffect(() => {
    if (activeView !== 'offline') return undefined;
    return loadOffline();
  }, [activeView, loadOffline]);

  useEffect(() => {
    const el = inboxRef.current;
    const initialOffset = initialSnapshot.current?.scrollTop ?? initialCheckpoint.current?.scrollOffset;
    if (el && initialOffset) requestAnimationFrame(() => { el.scrollTop = initialOffset; });
    return () => {
      const scrollOffset = el?.scrollTop || 0;
      const itemId = [...(el?.querySelectorAll('[data-feed-item-id]') || [])]
        .find(node => node.getBoundingClientRect().bottom > el.getBoundingClientRect().top + 8)?.dataset.feedItemId || null;
      setSnapshot('reader', { ...snapshotRef.current, scrollTop: scrollOffset });
      markVisited('reader', new Date().toISOString(), { itemId, scrollOffset });
    };
  }, [markVisited, setSnapshot]);

  useEffect(() => {
    if (checkpointRestoredRef.current || initialSnapshot.current?.scrollTop || !initialCheckpoint.current?.itemId || !articles.length) return;
    const target = [...(inboxRef.current?.querySelectorAll('[data-feed-item-id]') || [])]
      .find(node => node.dataset.feedItemId === initialCheckpoint.current.itemId);
    if (target) {
      checkpointRestoredRef.current = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    }
  }, [articles.length]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && continuation && !loadingMore) {
          fetchStream(continuation, true);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [continuation, loadingMore, fetchStream]);

  // Sidebar filter toggle (single feed)
  const handleToggleFeed = (feedId, multiSelect) => {
    const next = new Set(multiSelect ? activeFeeds : []);
      if (activeFeeds.has(feedId)) {
        next.delete(feedId);
      } else {
        next.add(feedId);
      }
    const params = new URLSearchParams(searchParams);
    if (next.size) params.set('feeds', [...next].join(',')); else params.delete('feeds');
    setSearchParams(params);
  };

  // Sidebar filter toggle (entire category)
  const handleToggleCategory = (feedIds, multiSelect) => {
    {
      const prev = activeFeeds;
      const allActive = feedIds.every(id => prev.has(id));
      const next = new Set(multiSelect ? prev : []);
      if (allActive) {
        // All active → deselect all in this category
        for (const id of feedIds) next.delete(id);
      } else {
        // Some or none active → select all in this category
        for (const id of feedIds) next.add(id);
      }
      const params = new URLSearchParams(searchParams);
      if (next.size) params.set('feeds', [...next].join(',')); else params.delete('feeds');
      setSearchParams(params);
    }
  };

  // Mark as read (single article)
  const applyUpdatedItems = useCallback(updated => {
    const apply = current => current.map(value => updated.find(item => item.id === value.id) || value);
    setArticles(apply);
    setOfflineItems(apply);
  }, []);

  const handleMarkRead = async (articleId) => {
    const article = articles.find(value => value.id === articleId);
    if (!article) return;
    await mutateItems([article], 'read', { onApply: applyUpdatedItems }).catch(() => {});
  };

  // Mark all articles in a group as read
  const handleMarkGroupRead = async (groupArticles) => {
    const unreadIds = groupArticles.filter(a => !(a.state?.isRead ?? a.isRead)).map(a => a.id);
    if (unreadIds.length === 0) return;
    const selected = groupArticles.filter(article => unreadIds.includes(article.id));
    await mutateItems(selected, 'read', { onApply: applyUpdatedItems }).catch(() => {});
  };

  // Toggle group collapse
  const toggleGroupCollapse = (groupKey) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const isFiltered = activeFeeds.size > 0;
  const visibleArticles = (activeView === 'offline' ? offlineItems : articles).filter(article => {
    if (activeView === 'unread') return !(article.state?.isRead ?? article.isRead);
    if (activeView === 'saved') return article.state?.isSaved;
    if (activeView === 'archived') return article.state?.isArchived;
    if (activeView === 'offline') return true;
    return !article.state?.isArchived;
  });
  const dayGroups = smartGroup(visibleArticles, isFiltered);
  const readerRows = dayGroups.flatMap(group => {
    const header = { id: `group:${group.key}`, type: 'group', group };
    if (collapsedGroups.has(group.key)) return [header];
    return [header, ...group.articles.map(article => ({ id: `article:${article.id}`, type: 'article', article }))];
  });
  const virtualRows = useVirtualFeedWindow(listRef, readerRows, true, {
    scrollRef: inboxRef,
    estimatedHeight: 72,
    gap: 0,
    maxMounted: 60,
    overscan: 600,
  });

  // Close drawer when a filter is applied on mobile
  const handleMobileToggleFeed = (feedId, multi) => {
    handleToggleFeed(feedId, multi);
    setDrawerOpen(false);
  };
  const handleMobileToggleCategory = (feedIds, multi) => {
    handleToggleCategory(feedIds, multi);
    setDrawerOpen(false);
  };
  const handleMobileClearFilters = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('feeds');
    setSearchParams(params);
    setDrawerOpen(false);
  };

  return (
    <div className="reader-view">
      {drawerOpen && <div className="reader-drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <aside ref={sidebarRef} tabIndex={-1} id="reader-subscriptions" aria-label="Subscriptions" role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen || undefined} className={`reader-sidebar-wrapper ${drawerOpen ? 'open' : ''}`}>
        <button type="button" className="reader-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close subscriptions">×</button>
        {feedsError && <div className="reader-inline-error" role="status">{feedsError}<button onClick={loadFeeds}>Retry</button></div>}
        <ReaderSidebar
          feeds={feeds}
          activeFeeds={activeFeeds}
          onToggleFeed={handleMobileToggleFeed}
          onToggleCategory={handleMobileToggleCategory}
          onClearFilters={handleMobileClearFilters}
        />
      </aside>
      <main className="reader-inbox" ref={inboxRef}>
        <div className="reader-mobile-toolbar">
          <button className="reader-hamburger" onClick={() => setDrawerOpen(true)} aria-label="Open subscriptions" aria-expanded={drawerOpen} aria-controls="reader-subscriptions">
            <span /><span /><span />
          </button>
          <span className="reader-mobile-title">
            {isFiltered ? `${activeFeeds.size} feed${activeFeeds.size > 1 ? 's' : ''} selected` : 'All Articles'}
          </span>
        </div>
        <div className="reader-view-tabs" role="group" aria-label="Article state">
          {['all', 'unread', 'saved', 'archived', 'offline'].map(view => <button key={view} className={activeView === view ? 'active' : ''} onClick={() => {
            const params = new URLSearchParams(searchParams);
            if (view === 'all') params.delete('view'); else params.set('view', view);
            setSearchParams(params);
          }}>{view}</button>)}
          {activeView !== 'offline' && <button onClick={() => fetchStream()} disabled={loading}>Refresh</button>}
        </div>
        {(activeView === 'offline' ? offlineError : streamError) && <div className="reader-inline-error" role="alert">{activeView === 'offline' ? offlineError : streamError}<button onClick={() => activeView === 'offline' ? loadOffline() : fetchStream()}>Retry</button></div>}
        {(activeView === 'offline' ? offlineLoading : loading) ? (
          <div className="reader-loading">Loading...</div>
        ) : (
          <>
            <div ref={listRef} className="reader-virtual-list" style={{ paddingTop: virtualRows.paddingTop, paddingBottom: virtualRows.paddingBottom }}>
              {virtualRows.items.map(row => {
                if (row.type === 'article') return (
                  <div key={row.id} ref={virtualRows.measureRef(row.id)} className="reader-virtual-row" data-feed-item-id={row.article.id}>
                    <ArticleRow
                      article={row.article}
                      isNew={!!previousVisit.current && new Date(row.article.publishedAt || row.article.published || 0).getTime() > new Date(previousVisit.current).getTime()}
                      onMarkRead={handleMarkRead}
                      onStateAction={(item, action) => mutateItems([item], action, { onApply: applyUpdatedItems }).catch(() => {})}
                    />
                  </div>
                );
                const group = row.group;
                const isGroupCollapsed = collapsedGroups.has(group.key);
                const unreadCount = group.articles.filter(a => !(a.state?.isRead ?? a.isRead)).length;
                return (
                  <div key={row.id} ref={virtualRows.measureRef(row.id)} className="reader-day-header">
                    <button
                      className={`reader-group-arrow ${isGroupCollapsed ? 'collapsed' : ''}`}
                      onClick={() => toggleGroupCollapse(group.key)}
                      aria-label={`${isGroupCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                      aria-expanded={!isGroupCollapsed}
                    >&#9662;</button>
                    <button className="reader-group-label" onClick={() => toggleGroupCollapse(group.key)} aria-expanded={!isGroupCollapsed}>
                      {group.label}
                      <span className="reader-group-count">{group.articles.length}</span>
                    </button>
                    {unreadCount > 0 && (
                      <button
                        className="reader-mark-group-read"
                        onClick={() => handleMarkGroupRead(group.articles)}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {activeView !== 'offline' && continuation && (
              <div ref={sentinelRef} className="reader-sentinel">
                {loadingMore && <span>Loading more...</span>}
              </div>
            )}
            {activeView === 'offline' && offlineItems.length === 0 && (
              <div className="reader-empty">No downloaded articles. Open an article and choose Download to build an offline edition.</div>
            )}
            {activeView !== 'offline' && !continuation && articles.length === 0 && (
              <div className="reader-empty">No articles</div>
            )}
            {activeView !== 'offline' && !continuation && exhausted && articles.length > 0 && (
              <div className="reader-end">End of Available Articles</div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
