import { useFeedListShortcuts } from '../useFeedListShortcuts.js';
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { COMPACT_VIEWPORT_QUERY, useCompactViewport } from '@/lib/ui/useCompactViewport.js';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { useRetryRegion } from '@/lib/ui/useRetryRegion.js';
import { keepTabInPanel } from '@/lib/ui/dismiss/useDialogFocus.js';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { useSearchParams } from 'react-router-dom';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { useFeedWorkspace } from "../FeedWorkspaceContext.jsx";
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { useRefreshableRead } from '@/lib/hooks/useRefreshableRead.js';
import ReaderSidebar from "./ReaderSidebar.jsx";
import ArticleRow from "./ArticleRow.jsx";
import { useVirtualFeedWindow } from "../Scroll/hooks/useVirtualFeedWindow.js";
import { listOfflineEditions } from "../offline/feedOfflineStore.js";
import "./Reader.scss";

const log = getLogger().child({ app: 'feed', module: 'reader' });
const HISTORY_VIEWS = new Set(['unread', 'saved', 'archived']);
const streamTimeoutMs = 10_000;

function historyItemToArticle(item) {
  return {
    ...item,
    link: item.link || item.url || null,
    published: item.published || item.publishedAt || null,
    preview: item.preview || item.summary || '',
    feedTitle: item.feedTitle || item.sourceInfo?.label || item.source || '',
    iconUrl: item.iconUrl || item.sourceInfo?.iconUrl || null,
  };
}

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
  const datedArticles = [];
  const undatedArticles = [];
  for (const article of articles) {
    const hasDate = article.published != null && article.published !== '';
    if (hasDate && Number.isFinite(new Date(article.published).getTime())) datedArticles.push(article);
    else undatedArticles.push(article);
  }

  let groups = [];
  if (datedArticles.length > 0) {
    if (!isFiltered) groups = groupByDay(datedArticles);
    else {
      const groupers = [groupByDay, groupByWeek, groupByMonth, groupBySeason, groupByYear];
      for (const fn of groupers) {
        const candidate = fn(datedArticles);
        if (datedArticles.length / candidate.length >= 3) {
          groups = candidate;
          break;
        }
      }
      // Fallback: year (coarsest)
      if (groups.length === 0) groups = groupByYear(datedArticles);
    }
  }
  if (undatedArticles.length > 0) {
    groups.push({ key: 'publication-date-unknown', label: 'Publication date unknown', articles: undatedArticles });
  }
  return sortWithinGroups(groups);
}

export default function Reader() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { getSnapshot, setSnapshot, getLastVisit, markVisited, mutateItems, applyPendingMutations, pendingItemOperations, itemSyncRevision, checkpoints } = useFeedWorkspace();
  const activeView = searchParams.get('view') || 'all';
  const feedsParam = searchParams.get('feeds') || '';
  const cached = getSnapshot('reader');
  const initialSnapshot = useRef(cached?.view === activeView && cached.feeds === feedsParam ? cached : null);
  const initialCheckpoint = useRef(checkpoints.reader ?? {});
  const previousVisit = useRef(getLastVisit('reader'));
  const visitStarted = useRef(new Date().toISOString());
  const {
    data: feedsData, hasResult: feedsLoaded, error: feedsReadError, loading: feedsLoading, revalidating: feedsRevalidating, reload: reloadFeeds,
  } = useApiResource('/api/v1/feed/reader/feeds', { label: 'Feed subscriptions', dedupe: false });
  const { regionProps: feedsRegion, retry: retryFeeds } = useRetryRegion(reloadFeeds, feedsLoading || feedsRevalidating);
  const feeds = feedsData || [];
  const [articles, setArticles] = useState(() => applyPendingMutations(initialSnapshot.current?.articles || []));
  const [continuation, setContinuation] = useState(initialSnapshot.current?.continuation || null);
  const [exhausted, setExhausted] = useState(initialSnapshot.current?.exhausted || false);
  const activeFeeds = useMemo(() => new Set(feedsParam.split(',').filter(Boolean)), [feedsParam]);
  const [loading, setLoading] = useState(!initialSnapshot.current?.articles?.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [offlineError, setOfflineError] = useState(null);
  const [offlineItems, setOfflineItems] = useState([]);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [offlineAttempt, setOfflineAttempt] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  // Keep read-on-expand rows present until they are collapsed or the view changes.
  const [expandedUnreadIds, setExpandedUnreadIds] = useState(new Set());
  const compact = useCompactViewport();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerActive = compact && drawerOpen;
  const wasDrawerActive = useRef(false);
  const drawerOpenerRef = useRef(null);
  const sentinelRef = useRef(null);
  const listRef = useRef(null);
  const sidebarRef = useRef(null);
  const inFlightEdits = useRef(null);
  const loadedPages = useRef(1);
  const lastItemSync = useRef(itemSyncRevision);
  const streamFilter = useRef({
    view: initialSnapshot.current?.view ?? 'all',
    feeds: initialSnapshot.current?.feeds ?? '',
  });
  const snapshotRef = useRef(null);
  const entryFilter = useRef({ view: activeView, feeds: feedsParam });
  const checkpointRestoredRef = useRef(false);
  snapshotRef.current = activeView === 'offline'
    ? { view: activeView, feeds: feedsParam }
    : { articles, continuation, exhausted, view: activeView, feeds: feedsParam };

  useEffect(() => { markVisited('reader', visitStarted.current, initialCheckpoint.current); }, [markVisited]);

  useLayoutEffect(() => {
    if (drawerActive) {
      sidebarRef.current?.focus({ preventScroll: true });
    } else if (wasDrawerActive.current) {
      const target = compact ? drawerOpenerRef.current : sidebarRef.current;
      target?.focus({ preventScroll: true });
    } else if (compact && sidebarRef.current?.contains(document.activeElement)) {
      drawerOpenerRef.current?.focus({ preventScroll: true });
    }
    // Dock an open drawer. An open request may arrive before the media-query
    // listener has reported that the compact control is visible again.
    if (!compact && wasDrawerActive.current) setDrawerOpen(false);
    wasDrawerActive.current = drawerActive;
  }, [compact, drawerActive]);

  const openDrawer = () => {
    if (window.matchMedia(COMPACT_VIEWPORT_QUERY).matches) setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);
  const usesDismissStack = useDismissLayer(drawerActive, closeDrawer);

  useEffect(() => {
    if (activeView !== 'unread') {
      setExpandedUnreadIds(current => current.size ? new Set() : current);
    }
  }, [activeView]);
  const handleDrawerKeyDown = event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && !usesDismissStack) {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
      return;
    }
    keepTabInPanel(event);
  };

  useFeedListShortcuts(listRef, '.article-row-header', !drawerActive);

  const feedsError = feedsReadError ? 'Subscriptions are unavailable. The inbox can still be used.' : null;

  const readPage = useCallback(async (cursor, signal) => {
    if (HISTORY_VIEWS.has(activeView)) {
      const params = new URLSearchParams({ state: activeView, mode: 'reader', limit: '100' });
      if (cursor) params.set('cursor', cursor);
      const data = await DaylightAPI(`/api/v1/feed/search?${params}`, {}, 'GET', { signal });
      return { items: (data.items || []).map(historyItemToArticle), next: data.nextCursor || null, exhausted: !data.nextCursor };
    }
    const params = activeFeeds.size
      ? new URLSearchParams({ count: '50', feeds: [...activeFeeds].join(',') })
      : new URLSearchParams({ days: '3', count: '100' });
    if (cursor) params.set('continuation', cursor);
    const data = await DaylightAPI(`/api/v1/feed/reader/stream?${params}`, {}, 'GET', { signal });
    return { items: data.items || [], next: data.continuation || null, exhausted: !!data.exhausted };
  }, [activeFeeds, activeView]);

  const finishStreamRead = useCallback(() => {
    inFlightEdits.current = null;
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const reportStreamError = useCallback((cursor, pages, error) => {
    const append = cursor !== null;
    log.warn('reader.stream.failed', { append, error });
    setStreamError({ cursor, pages, message: append ? 'More articles could not be loaded.' : 'Articles could not be refreshed.' });
  }, []);

  const readStream = useCallback(async (isCurrent, signal, { cursor: startCursor = null, pages = 1 } = {}) => {
    const append = startCursor !== null;
    const editedStates = new Map();
    inFlightEdits.current = editedStates;
    setLoading(!append);
    setLoadingMore(append);
    setStreamError(null);
    try {
      let cursor = startCursor;
      const results = [];
      let page;
      do {
        page = await readPage(cursor, signal);
        if (!isCurrent()) return;
        results.push(page.items);
        cursor = page.next;
      } while (cursor && !page.exhausted && results.length < pages);
      loadedPages.current = (append ? loadedPages.current : 0) + results.length;
      setArticles(prev => {
        const rows = append ? [...prev] : [];
        for (const items of results) {
          const incoming = applyPendingMutations(items.map(item => {
            const state = editedStates.get(item.id);
            return state ? { ...item, state, isRead: state.isRead } : item;
          }));
          const accepted = HISTORY_VIEWS.has(activeView) && rows.length
            ? incoming.filter(item => !rows.some(existing => existing.stateKey === item.stateKey))
            : incoming;
          rows.push(...accepted);
        }
        return rows;
      });
      setContinuation(cursor);
      setExhausted(page.exhausted);
    } catch (err) {
      if (isCurrent() && err.name !== 'AbortError') reportStreamError(startCursor, pages, err.message);
    } finally {
      if (isCurrent()) finishStreamRead();
    }
  }, [activeView, applyPendingMutations, readPage, reportStreamError, finishStreamRead]);
  const onStreamTimeout = useCallback(({ cursor = null, pages = 1 } = {}) => {
    reportStreamError(cursor, pages, 'Reader request timed out');
    finishStreamRead();
  }, [reportStreamError, finishStreamRead]);
  const { reload: reloadStream, poll: loadMore } = useRefreshableRead(readStream, {
    timeoutMs: streamTimeoutMs, onTimeout: onStreamTimeout,
  });

  const retryArticles = () => {
    if (activeView === 'offline') setOfflineAttempt(attempt => attempt + 1);
    else if (streamError.cursor === null) reloadStream(streamError);
    else loadMore(streamError);
  };
  const { regionProps: inboxRegion, retry } = useRetryRegion(
    retryArticles, activeView === 'offline' ? offlineLoading : loading || loadingMore,
  );
  const inboxRef = inboxRegion.ref;

  // Initial load + reload on filter change
  useLayoutEffect(() => {
    const reconciled = lastItemSync.current !== itemSyncRevision;
    lastItemSync.current = itemSyncRevision;
    if (activeView === 'offline') {
      inFlightEdits.current = null;
      return;
    }
    if (streamFilter.current.view !== activeView || streamFilter.current.feeds !== feedsParam) {
      streamFilter.current = { view: activeView, feeds: feedsParam };
      loadedPages.current = 1;
      setArticles([]);
      setContinuation(null);
      setExhausted(false);
    }
    // Keep every loaded page mounted until its canonical replacement is ready.
    reloadStream({ pages: reconciled ? loadedPages.current : 1 });
  }, [activeView, feedsParam, reloadStream, itemSyncRevision]);

  useEffect(() => {
    if (activeView !== 'offline') return;
    let active = true;
    setOfflineLoading(true);
    setOfflineError(null);
    listOfflineEditions()
      .then(rows => { if (active) setOfflineItems(applyPendingMutations(rows.map(row => row.item))); })
      .catch(error => {
        if (!active) return;
        setOfflineError('Downloaded articles could not be opened on this device.');
        log.warn('reader.offline_editions.failed', { error: error.message });
      })
      .finally(() => { if (active) setOfflineLoading(false); });
    return () => { active = false; };
  }, [activeView, applyPendingMutations, offlineAttempt]);

  useLayoutEffect(() => {
    const el = inboxRef.current;
    return () => {
      const snapshot = snapshotRef.current;
      let position = initialCheckpoint.current;
      const rows = el?.querySelectorAll('[data-feed-item-id]');
      if (rows?.length) {
        const scrollOffset = el.scrollTop;
        setSnapshot('reader', { ...snapshot, scrollTop: scrollOffset });
        if (snapshot.view === 'all' && !snapshot.feeds) {
          const itemId = [...rows].find(node => node.getBoundingClientRect().bottom > el.getBoundingClientRect().top + 8)?.dataset.feedItemId || null;
          position = { itemId, scrollOffset };
        }
      }
      markVisited('reader', new Date().toISOString(), position);
    };
  }, [markVisited, setSnapshot]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (loading || loadingMore || streamError || !sentinelRef.current) return;
    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (active && entry.isIntersecting && continuation) {
          loadMore({ cursor: continuation });
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [continuation, loading, loadingMore, streamError, loadMore]);

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

  // Apply queued changes to the pages already on screen, including downloads.
  useEffect(() => {
    if (pendingItemOperations?.length) {
      setArticles(applyPendingMutations);
      setOfflineItems(applyPendingMutations);
    }
  }, [applyPendingMutations, pendingItemOperations]);

  // Mark as read (single article)
  const applyUpdatedItems = useCallback(updated => {
    // A read started before a local write can still update all other rows.
    const edited = inFlightEdits.current;
    if (edited) for (const item of updated) edited.set(item.id, item.state);
    const apply = current => current.map(value => updated.find(item => item.id === value.id) || value);
    setArticles(apply);
    setOfflineItems(apply);
  }, []);

  const handleMarkRead = async (article) => {
    if (!article) return;
    if (activeView === 'unread') {
      setExpandedUnreadIds(current => new Set(current).add(article.id));
    }
    await mutateItems([article], 'read', { onApply: applyUpdatedItems }).catch(() => {});
  };

  const handleCollapseUnreadArticle = (articleId) => {
    setExpandedUnreadIds(current => {
      if (!current.has(articleId)) return current;
      const next = new Set(current);
      next.delete(articleId);
      return next;
    });
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

  const isFiltered = activeFeeds.size > 0 || HISTORY_VIEWS.has(activeView);
  const visibleArticles = (activeView === 'offline' ? offlineItems : articles).filter(article => {
    if (activeView === 'unread') return !(article.state?.isRead ?? article.isRead) || expandedUnreadIds.has(article.id);
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

  useLayoutEffect(() => {
    if (checkpointRestoredRef.current) return;
    if (entryFilter.current.view !== activeView || entryFilter.current.feeds !== feedsParam) {
      checkpointRestoredRef.current = true;
      return;
    }
    const inbox = inboxRef.current;
    if (!inbox || !listRef.current || !readerRows.length) return;
    checkpointRestoredRef.current = true;
    const snapshot = initialSnapshot.current;
    if (snapshot?.scrollTop != null) {
      inbox.scrollTop = snapshot.scrollTop;
      return;
    }
    // Durable Reader positions have no filter identity and belong to the default inbox.
    if (activeView !== 'all' || feedsParam) return;
    const checkpoint = initialCheckpoint.current;
    const anchor = checkpoint?.itemId && [...listRef.current.querySelectorAll('[data-feed-item-id]')]
      .find(node => node.dataset.feedItemId === checkpoint.itemId);
    if (anchor) inbox.scrollTop += anchor.getBoundingClientRect().top - inbox.getBoundingClientRect().top;
    else if (checkpoint?.scrollOffset) inbox.scrollTop = checkpoint.scrollOffset;
  }, [activeView, feedsParam, readerRows.length]);

  // Keep the drawer open while choosing feeds so touch users can build a
  // multi-feed selection without modifier keys. The explicit close button
  // completes the selection.
  const handleMobileToggleFeed = (feedId, multi) => {
    handleToggleFeed(feedId, multi);
  };
  const handleMobileToggleCategory = (feedIds, multi) => {
    handleToggleCategory(feedIds, multi);
  };
  const handleMobileClearFilters = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('feeds');
    setSearchParams(params);
  };

  const errorMessage = activeView === 'offline' ? offlineError : streamError?.message;

  return (
    <div className="reader-view">
      {drawerActive && <div className="reader-drawer-backdrop" onClick={closeDrawer} aria-hidden="true" />}
      <aside
        ref={sidebarRef}
        tabIndex={-1}
        id="reader-subscriptions"
        aria-label="Subscriptions"
        role={drawerActive ? 'dialog' : undefined}
        aria-modal={drawerActive || undefined}
        inert={compact && !drawerActive ? '' : undefined}
        onKeyDown={drawerActive ? handleDrawerKeyDown : undefined}
        className={`reader-sidebar-wrapper ${drawerActive ? 'open' : ''}`}
      >
        <button type="button" className="reader-drawer-close" onClick={closeDrawer} aria-label="Close subscriptions">
          <UiIcon name="close" size={22} />
        </button>
        <section className="reader-subscriptions-list" aria-label="Feed list" {...feedsRegion}>
          {feedsError && <div className="reader-inline-error" role="status">{feedsError}<button onClick={retryFeeds}>Retry</button></div>}
          <ReaderSidebar
            feeds={feeds}
            loaded={feedsLoaded}
            activeFeeds={activeFeeds}
            onToggleFeed={handleMobileToggleFeed}
            onToggleCategory={handleMobileToggleCategory}
            onClearFilters={handleMobileClearFilters}
          />
        </section>
      </aside>
      <section className="reader-inbox" aria-label="Reader articles" {...inboxRegion} inert={drawerActive ? '' : undefined}>
        <div className="reader-mobile-toolbar">
          <button ref={drawerOpenerRef} className="reader-hamburger" onClick={openDrawer} aria-label="Open subscriptions" aria-expanded={drawerActive} aria-controls="reader-subscriptions">
            <span /><span /><span />
          </button>
          <span className="reader-mobile-title">
            {activeView === 'offline' ? 'Offline articles' : HISTORY_VIEWS.has(activeView) ? `${activeView[0].toUpperCase()}${activeView.slice(1)} articles` : activeFeeds.size > 0 ? `${activeFeeds.size} feed${activeFeeds.size > 1 ? 's' : ''} selected` : 'All Articles'}
          </span>
        </div>
        <div className="reader-view-tabs" role="group" aria-label="Article state">
          {['all', 'unread', 'saved', 'archived', 'offline'].map(view => <button key={view} type="button" aria-pressed={activeView === view} className={activeView === view ? 'active' : ''} onClick={() => {
            const params = new URLSearchParams(searchParams);
            if (view === 'all') params.delete('view'); else params.set('view', view);
            setSearchParams(params);
          }}>{view}</button>)}
          {activeView !== 'offline' && <button onClick={() => reloadStream()} disabled={loading}>Refresh</button>}
        </div>
        {errorMessage && <div className="reader-inline-error" role="alert">{errorMessage}<button onClick={retry}>Retry</button></div>}
        {(activeView === 'offline' ? offlineLoading : loading && !articles.length) ? (
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
                      initiallyExpanded={activeView === 'unread' && expandedUnreadIds.has(row.article.id)}
                      onMarkRead={handleMarkRead}
                      onCollapse={handleCollapseUnreadArticle}
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
            {activeView === 'offline' && offlineItems.length === 0 && !errorMessage && (
              <div className="reader-empty">No downloaded articles. Open an article and choose Download to build an offline edition.</div>
            )}
            {activeView !== 'offline' && !continuation && visibleArticles.length === 0 && !errorMessage && (
              <div className="reader-empty">{activeView === 'all' ? 'No articles' : `No ${activeView} articles in your Reader history.`}</div>
            )}
            {activeView !== 'offline' && !continuation && exhausted && articles.length > 0 && (
              <div className="reader-end">End of Available Articles</div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
