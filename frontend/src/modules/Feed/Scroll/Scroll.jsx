import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { renderFeedCard } from './cards/index.jsx';
import DetailView from './detail/DetailView.jsx';
import DetailModal from './detail/DetailModal.jsx';
import { useFeedPlayer } from '../players/FeedPlayerContext.jsx';
import { usePlaybackObserver } from './hooks/usePlaybackObserver.js';
import { useMasonryLayout } from './hooks/useMasonryLayout.js';
import { usePerfMonitor } from './hooks/usePerfMonitor.js';
import { useMasonryVirtualWindow, useVirtualFeedWindow } from './hooks/useVirtualFeedWindow.js';
import { applySessionBudget, buildScrollFilterSearch, getScrollSourceOptions } from './scrollProductControls.js';
import FeedAssemblyOverlay from './FeedAssemblyOverlay.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import { feedLog } from './feedLog.js';
import getLogger from '../../../lib/logging/Logger.js';
import { useFeedWorkspace } from '../FeedWorkspaceContext.jsx';
import { getOfflineEdition } from '../offline/feedOfflineStore.js';
import './Scroll.scss';

/** Base64url-encode an item ID for use in the URL path (UTF-8 safe). */
function encodeFeedItemId(id) {
  const bytes = new TextEncoder().encode(String(id));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url slug back to the original item ID (UTF-8 safe). */
function decodeFeedItemId(slug) {
  let s = slug.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

function ScrollCard({ item, isNew, colors, onDismiss, onPlay, onClick, onFilter, onSourcePreference, sourcePreference, style, itemRef, viewportObserver }) {
  const wrapperRef = useRef(null);
  const touchRef = useRef(null);

  // Combine refs: local wrapperRef + external measureRef + viewport observer
  const setRefs = useCallback((node) => {
    if (wrapperRef.current && viewportObserver) {
      viewportObserver.unobserve(wrapperRef.current);
    }
    wrapperRef.current = node;
    if (itemRef) itemRef(node);
    if (node && viewportObserver) {
      viewportObserver.observe(node);
    }
  }, [itemRef, viewportObserver]);

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  };

  const handleTouchMove = (e) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchRef.current.x;
    const dy = touch.clientY - touchRef.current.y;

    // Only track leftward horizontal swipes
    if (dx < -10 && Math.abs(dx) > Math.abs(dy)) {
      if (wrapperRef.current) {
        wrapperRef.current.style.transform = `translateX(${dx}px)`;
        wrapperRef.current.style.opacity = Math.max(0, 1 + dx / 300);
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchRef.current.x;
    const elapsed = Date.now() - touchRef.current.time;
    touchRef.current = null;

    if (dx < -100 && elapsed < 600 && onDismiss) {
      // Threshold met — dismiss (only when this card supports dismissal)
      feedLog.dismiss('swipe dismiss', { id: item.id, dx, elapsed });
      onDismiss(item, wrapperRef.current);
    } else if (wrapperRef.current) {
      // Spring back
      wrapperRef.current.animate(
        [
          { transform: wrapperRef.current.style.transform || 'translateX(0)', opacity: wrapperRef.current.style.opacity || '1' },
          { transform: 'translateX(0)', opacity: '1' },
        ],
        { duration: 150, easing: 'ease-out', fill: 'forwards' }
      ).onfinish = () => {
        if (wrapperRef.current) {
          wrapperRef.current.style.transform = '';
          wrapperRef.current.style.opacity = '';
        }
      };
    }
  };

  return (
    <div
      ref={setRefs}
      className="scroll-item-wrapper"
      data-feed-item-id={item.id}
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="scroll-card-surface" onClick={onClick}>
        {renderFeedCard(item, colors, {
          // Only wire a dismiss handler through when this card actually
          // supports dismissal — otherwise the button/callback is omitted
          // (prevents calling an undefined onDismiss). (F-08)
          onDismiss: onDismiss ? (cardItem) => onDismiss(cardItem, wrapperRef.current) : undefined,
          onPlay,
        })}
      </div>
      <div className="scroll-card-context">
        {isNew && <span className="scroll-card-new">New</span>}
        <details onClick={event => event.stopPropagation()}>
          <summary>Why shown</summary>
          <p>
            <strong>{item.sourceInfo?.label || item.meta?.sourceName || item.source}</strong> is part of your <strong>{item.tier || 'personalized'}</strong> mix.
          </p>
          {item.source && <button type="button" onClick={() => onFilter?.(item.source)}>Show only this source</button>}
          {item.source && <div className="scroll-source-tuning" role="group" aria-label={`Tune ${item.sourceInfo?.label || item.source}`}>
            <button type="button" className={sourcePreference === 'more' ? 'active' : ''} onClick={() => onSourcePreference?.(item.source, sourcePreference === 'more' ? 'normal' : 'more')}>More</button>
            <button type="button" className={sourcePreference === 'less' ? 'active' : ''} onClick={() => onSourcePreference?.(item.source, sourcePreference === 'less' ? 'normal' : 'less')}>Less</button>
            <button type="button" className={sourcePreference === 'mute' ? 'active' : ''} onClick={() => onSourcePreference?.(item.source, sourcePreference === 'mute' ? 'normal' : 'mute')}>Mute</button>
          </div>}
        </details>
        <button type="button" className="scroll-card-open" onClick={onClick} aria-label={item.title ? `Open: ${item.title}` : 'Open item'}>Open</button>
      </div>
    </div>
  );
}

/** Scroll container is .feed-content (overflow-y: auto), NOT the window. */
function getScrollEl() { return document.querySelector('.feed-content'); }

export default function Scroll() {
  const { feedItemId: urlSlug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { getSnapshot, setSnapshot, getLastVisit, markVisited, mutateItems, readingPreferences, applyPendingMutations, checkpoints, sourcePreferences, setSourcePreference } = useFeedWorkspace();
  const initialSnapshot = useRef(getSnapshot('scroll'));
  const initialCheckpoint = useRef(checkpoints.scroll);
  const previousVisit = useRef(getLastVisit('scroll'));
  const visitStarted = useRef(new Date().toISOString());

  const [items, setItems] = useState(() => applyPendingMutations(initialSnapshot.current?.items || []));
  const [loading, setLoading] = useState(!initialSnapshot.current?.items?.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialSnapshot.current?.hasMore ?? true);
  const [caughtUp, setCaughtUp] = useState(initialSnapshot.current?.caughtUp || false);
  const [budgetReached, setBudgetReached] = useState(initialSnapshot.current?.budgetReached || false);
  const [serverHasMore, setServerHasMore] = useState(initialSnapshot.current?.serverHasMore ?? true);
  const [budgetOverride, setBudgetOverride] = useState(null);
  const [sessionId, setSessionId] = useState(initialSnapshot.current?.sessionId || null);
  const [error, setError] = useState(null);
  // focusSource is read into the ?focus= param; no UI currently sets it (F-29).
  const focusSource = searchParams.get('focus');
  const filterParam = searchParams.get('filter') || '';
  const sessionStorageKey = `feed:scroll:session:${focusSource || 'all'}:${filterParam || 'all'}`;
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);
  const containerRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { activeMedia, play: contextPlay, stop: contextStop, playerRef, speed } = useFeedPlayer();
  const [colors, setColors] = useState({});
  const [assemblyBatches, setAssemblyBatches] = useState([]);
  const [assemblyFilter, setAssemblyFilter] = useState({ tiers: [], sources: [] });
  const savedScrollRef = useRef(0);
  const listAbortRef = useRef(null);
  const appendLockRef = useRef(false);
  const detailAbortRef = useRef(null);
  const snapshotRef = useRef(null);
  const checkpointRestoredRef = useRef(false);
  const effectiveBudget = budgetOverride ?? readingPreferences.sessionBudget;
  snapshotRef.current = { items, hasMore, caughtUp, budgetReached, serverHasMore, sessionId };

  useEffect(() => {
    setBudgetOverride(null);
    setBudgetReached(false);
  }, [sessionStorageKey]);

  const playback = usePlaybackObserver(playerRef, !!activeMedia, speed);

  const handlePlay = useCallback((item, contentId) => {
    if (!item) { feedLog.player('clear activeMedia'); contextStop(); return; }
    feedLog.player('play', { id: item.id, title: item.title, source: item.source, contentId });
    contextPlay(item, contentId);
  }, [contextPlay, contextStop]);

  const handleAssemblyFilter = useCallback((filter) => {
    setAssemblyFilter(filter);
  }, []);

  // Deep-linked item (fetched from server when not in scroll batch)
  const [deepLinkedItem, setDeepLinkedItem] = useState(null);

  // Viewport-aware rendering
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' && window.innerWidth >= 900
  );
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 900px)');
    const handler = (e) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Performance monitoring — active when scroll list is visible (not detail view)
  usePerfMonitor(searchParams.get('debug') === '1' && !loading && !(urlSlug && !isDesktop));

  // Decode URL slug to full item ID
  const fullId = urlSlug ? decodeFeedItemId(urlSlug) : null;

  // Find selected item in loaded list or from deep-link fetch
  const selectedItem = fullId
    ? (items.find(i => i.id === fullId) || (deepLinkedItem?.id === fullId ? deepLinkedItem : null))
    : null;

  const fetchItems = useCallback(async (append = false, requestedSession = sessionId) => {
    if (append && appendLockRef.current) return;
    if (append) appendLockRef.current = true;
    if (!append) listAbortRef.current?.abort();
    const controller = new AbortController();
    if (!append) listAbortRef.current = controller;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const cur = itemsRef.current;
      const cursor = append && cur.length > 0 ? cur[cur.length - 1].id : undefined;
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (effectiveBudget > 0) params.set('limit', String(Math.max(1, effectiveBudget - cur.length)));
      if (focusSource) params.set('focus', focusSource);
      if (filterParam) params.set('filter', filterParam);
      if (searchParams.get('debug') === '1') params.set('debug', '1');

      feedLog.scroll(append ? 'fetchMore' : 'fetchInitial', { cursor, focus: focusSource, filter: filterParam, currentCount: cur.length });

      const fetchStart = performance.now();
      let result;
      if (append) {
        if (!requestedSession) throw new Error('Scroll session is unavailable');
        result = await DaylightAPI(`/api/v1/feed/scroll/sessions/${encodeURIComponent(requestedSession)}?${params}`, {}, 'GET', { signal: controller.signal });
      } else if (requestedSession) {
        const resumeParams = new URLSearchParams(params);
        resumeParams.set('resume', '1');
        try {
          result = await DaylightAPI(`/api/v1/feed/scroll/sessions/${encodeURIComponent(requestedSession)}?${resumeParams}`, {}, 'GET', { signal: controller.signal });
        } catch (resumeError) {
          if (controller.signal.aborted) throw resumeError;
          if (!String(resumeError.message).startsWith('HTTP 404:')) throw resumeError;
          sessionStorage.removeItem(sessionStorageKey);
          result = await DaylightAPI('/api/v1/feed/scroll/sessions', {
            focus: focusSource || null,
            filter: filterParam || null,
            limit: effectiveBudget > 0 ? Math.min(15, effectiveBudget) : undefined,
          }, 'POST', { signal: controller.signal });
        }
      } else {
        result = await DaylightAPI('/api/v1/feed/scroll/sessions', {
          focus: focusSource || null,
          filter: filterParam || null,
          limit: effectiveBudget > 0 ? Math.min(15, effectiveBudget) : undefined,
        }, 'POST', { signal: controller.signal });
      }
      if (result.sessionId) {
        setSessionId(result.sessionId);
        sessionStorage.setItem(sessionStorageKey, result.sessionId);
      }
      feedLog.timing('scroll-fetch', { durationMs: Math.round(performance.now() - fetchStart), append, cursor, count: (result.items || []).length });

      const incoming = applyPendingMutations(result.items || []);
      setServerHasMore(!!result.hasMore);
      if (result.colors) setColors(result.colors);

      // Collect feed_assembly stats per batch
      if (result.feed_assembly) {
        feedLog.assembly('batch', result.feed_assembly);
        if (append) {
          setAssemblyBatches(prev => [...prev, result.feed_assembly]);
        } else {
          setAssemblyBatches([result.feed_assembly]);
        }
      }

      if (append) {
        const knownIds = new Set(itemsRef.current.map(i => i.id));
        const newCount = incoming.filter(i => !knownIds.has(i.id)).length;
        const allDupes = incoming.length > 0 && newCount === 0;
        const nextCount = itemsRef.current.length + newCount;
        const hitBudget = effectiveBudget > 0 && nextCount >= effectiveBudget;
        feedLog.scroll('appendResult', { incoming: incoming.length, new: newCount, allDupes, hasMore: allDupes ? false : result.hasMore });

        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = incoming.filter(i => !existingIds.has(i.id));
          if (newItems.length === 0) return prev;
          const merged = [...prev, ...newItems];
          return applySessionBudget(merged, hitBudget ? effectiveBudget : 0).items;
        });
        setHasMore(hitBudget ? false : (allDupes ? false : result.hasMore));
        setBudgetReached(hitBudget && !!result.hasMore);
        setCaughtUp(!!result.caughtUp || allDupes);
      } else {
        const hitBudget = effectiveBudget > 0 && incoming.length >= effectiveBudget;
        feedLog.scroll('initialResult', { count: incoming.length, hasMore: result.hasMore });
        setItems(applySessionBudget(incoming, hitBudget ? effectiveBudget : 0).items);
        setHasMore(hitBudget ? false : result.hasMore);
        setBudgetReached(hitBudget && !!result.hasMore);
        setCaughtUp(!!result.caughtUp);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      feedLog.scroll('fetchError', err.message);
      // Surface an error state and stop the infinite sentinel from retrying
      // an outage in a tight loop. (F-11)
      setError(err.message || 'Failed to load feed');
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      appendLockRef.current = false;
    }
  }, [applyPendingMutations, effectiveBudget, filterParam, focusSource, searchParams, sessionId, sessionStorageKey]);

  useEffect(() => () => listAbortRef.current?.abort(), []);
  useEffect(() => { markVisited('scroll', visitStarted.current); }, [markVisited]);

  useEffect(() => {
    const scrollEl = getScrollEl();
    const initialOffset = initialSnapshot.current?.scrollTop ?? initialCheckpoint.current?.scrollOffset;
    if (scrollEl && initialOffset) requestAnimationFrame(() => { scrollEl.scrollTop = initialOffset; });
    return () => {
      const scrollOffset = getScrollEl()?.scrollTop || 0;
      const scrollEl = getScrollEl();
      const itemId = [...(scrollEl?.querySelectorAll('[data-feed-item-id]') || [])]
        .find(node => node.getBoundingClientRect().bottom > scrollEl.getBoundingClientRect().top + 8)?.dataset.feedItemId || null;
      setSnapshot('scroll', { ...snapshotRef.current, scrollTop: scrollOffset });
      markVisited('scroll', new Date().toISOString(), { itemId, scrollOffset });
    };
  }, [markVisited, setSnapshot]);

  useEffect(() => {
    if (checkpointRestoredRef.current || initialSnapshot.current?.scrollTop || !initialCheckpoint.current?.itemId || !items.length) return;
    const target = [...(getScrollEl()?.querySelectorAll('[data-feed-item-id]') || [])]
      .find(node => node.dataset.feedItemId === initialCheckpoint.current.itemId);
    if (target) {
      checkpointRestoredRef.current = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    }
  }, [items.length]);

  // Initial load + reset/refetch whenever the ?filter= identity changes. (F-11)
  useEffect(() => {
    const storedSession = sessionStorage.getItem(sessionStorageKey);
    setSessionId(storedSession);
    setItems([]);
    setHasMore(true);
    setError(null);
    fetchItems(false, storedSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStorageKey]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore) {
          feedLog.scroll('sentinel intersecting — triggering fetchMore', { scrollY: getScrollEl()?.scrollTop || 0, itemCount: itemsRef.current.length });
          fetchItems(true);
        }
      },
      { threshold: 0.1 }
    );

    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, fetchItems, loading]);

  // Scroll activity tracking (throttled to ~5/sec to reduce main-thread work)
  useEffect(() => {
    const scrollEl = getScrollEl();
    if (!scrollEl) return;
    let lastY = scrollEl.scrollTop;
    let lastTime = performance.now();
    let lastLogTime = 0;

    const handler = () => {
      const now = performance.now();
      if (now - lastLogTime < 200) return;
      lastLogTime = now;

      const y = scrollEl.scrollTop;
      const dy = y - lastY;
      const dt = now - lastTime;
      const velocity = dt > 0 ? Math.round((dy / dt) * 1000) : 0;
      feedLog.scroll('activity', {
        scrollY: Math.round(y),
        direction: dy > 0 ? 'down' : dy < 0 ? 'up' : 'idle',
        velocity,
        dt: Math.round(dt),
      });
      lastY = y;
      lastTime = now;
    };

    scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handler);
  }, []);

  // Card viewport tracking (enter/exit with dwell time)
  const enterTimesRef = useRef(new Map());
  const viewportObserverRef = useRef(null);

  useEffect(() => {
    viewportObserverRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.feedItemId;
          if (!id) continue;
          if (entry.isIntersecting) {
            enterTimesRef.current.set(id, performance.now());
            feedLog.viewport('enter', { id, scrollY: Math.round(getScrollEl()?.scrollTop || 0) });
          } else if (enterTimesRef.current.has(id)) {
            const dwellMs = Math.round(performance.now() - enterTimesRef.current.get(id));
            enterTimesRef.current.delete(id);
            feedLog.viewport('exit', { id, dwellMs, scrollY: Math.round(getScrollEl()?.scrollTop || 0) });
          }
        }
      },
      { threshold: 0.5 }
    );
    return () => viewportObserverRef.current?.disconnect();
  }, []);

  // Fetch detail when URL slug changes (route-driven)
  const prevSlugRef = useRef(null);
  // Monotonic generation guard: a slower, older detail request must not
  // overwrite the sections of a newer selection. (F-11)
  const detailGenRef = useRef(0);
  useEffect(() => {
    if (!urlSlug || urlSlug === prevSlugRef.current) return;
    prevSlugRef.current = urlSlug;

    if (!fullId) return;

    const gen = ++detailGenRef.current;
    const isCurrent = () => gen === detailGenRef.current;

    // Opening an item marks it read, but never archives it.
    const matchedItem = itemsRef.current.find(i => i.id === fullId);
    if (matchedItem && !(matchedItem.state?.isRead ?? matchedItem.isRead)) {
      mutateItems([matchedItem], 'read', {
        onApply: updated => setItems(current => current.map(value => updated.find(next => next.id === value.id) || value)),
      }).catch(() => {});
    }

    // Check if item is already in the loaded list
    const item = itemsRef.current.find(i => i.id === fullId);

    if (item) {
      // Item is in the scroll batch — fetch detail the normal way
      feedLog.detail('open (in batch)', { id: fullId, source: item.source, title: item.title });
      setDetailData(null);
      setDetailLoading(true);
      if (!isDesktop) { const el = getScrollEl(); if (el) el.scrollTop = 0; }

      const params = new URLSearchParams();
      if (item.contentType === 'youtube') params.set('quality', '480p');
      if (item.link) params.set('link', item.link);
      if (item.meta) {
        // Keep large/private bodies out of the URL, access logs, and error
        // traces. The server resolves these fields by item id server-side. (F-09)
        const OMIT_FROM_URL = new Set(['fullConversation', 'conversation', 'body', 'html', 'content']);
        const safeMeta = Object.fromEntries(
          Object.entries(item.meta).filter(([k]) => !OMIT_FROM_URL.has(k))
        );
        params.set('meta', JSON.stringify(safeMeta));
      }

      const detailStart = performance.now();
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;
      DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(item.id)}?${params}`, {}, 'GET', { signal: controller.signal })
        .then(result => {
          if (!isCurrent()) return; // a newer selection superseded this request
          feedLog.timing('detail-sections', { durationMs: Math.round(performance.now() - detailStart), id: fullId, sectionCount: result.sections?.length || 0 });
          feedLog.detail('loaded', { id: fullId, sections: result.sections?.length || 0 });
          setDetailData(result);
        })
        .catch(async err => {
          if (!isCurrent() || err.name === 'AbortError') return;
          feedLog.detail('fetchError', { id: fullId, error: err.message });
          try {
            const offline = await getOfflineEdition(item.id);
            if (!isCurrent()) return;
            setDetailData(offline?.item ? (offline.detail || { sections: [], ogImage: null, ogDescription: offline.item.summary || item.summary || null }) : null);
          } catch {
            if (isCurrent()) setDetailData(null);
          }
        })
        .finally(() => { if (isCurrent()) setDetailLoading(false); });
    } else {
      // Cold load / deep link — fetch item + detail from server cache
      feedLog.detail('open (deep link)', { slug: urlSlug, fullId });
      setDetailData(null);
      setDetailLoading(true);
      setDeepLinkedItem(null);
      if (!isDesktop) { const el = getScrollEl(); if (el) el.scrollTop = 0; }

      const detailStart = performance.now();
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;
      DaylightAPI(`/api/v1/feed/items/${urlSlug}`, {}, 'GET', { signal: controller.signal })
        .then(result => {
          if (!isCurrent()) return; // superseded by a newer selection
          feedLog.timing('deeplink-fetch', { durationMs: Math.round(performance.now() - detailStart), slug: urlSlug, hasItem: !!result.item, sectionCount: result.sections?.length || 0 });
          feedLog.detail('deep link loaded', { hasItem: !!result.item, sections: result.sections?.length || 0 });
          if (result.item) setDeepLinkedItem(result.item);
          setDetailData({
            sections: result.sections || [],
            ogImage: result.ogImage || null,
            ogDescription: result.ogDescription || null,
          });
        })
        .catch(async err => {
          if (!isCurrent() || err.name === 'AbortError') return;
          try {
            const offline = await getOfflineEdition(fullId);
            if (!isCurrent()) return;
            if (offline?.item) {
              feedLog.detail('deep link loaded from offline edition', { slug: urlSlug });
              setDeepLinkedItem(applyPendingMutations([offline.item])[0]);
              setDetailData(offline.detail || { sections: [], ogImage: null, ogDescription: offline.item.summary || null });
              return;
            }
          } catch (offlineError) {
            feedLog.detail('offline edition unavailable', { slug: urlSlug, error: offlineError.message });
          }
          feedLog.detail('deep link error — redirecting to list', { slug: urlSlug, error: err.message });
          navigate(`/feed/scroll${location.search}`, { replace: true });
        })
        .finally(() => { if (isCurrent()) setDetailLoading(false); });
    }
    return () => detailAbortRef.current?.abort();
  }, [applyPendingMutations, urlSlug, fullId, navigate, location.search, mutateItems, isDesktop]);

  // Restore scroll position when navigating back to list
  const scrollLog = useCallback(() => getLogger().child({ module: 'scroll-restore' }), []);
  useEffect(() => {
    if (!urlSlug) {
      const savedY = savedScrollRef.current;
      const el = getScrollEl();
      scrollLog().info('nav.backToList', { savedY, itemCount: items.length, scrollHeight: el?.scrollHeight || 0 });
      setDetailData(null);
      setDetailLoading(false);
      setDeepLinkedItem(null);
      prevSlugRef.current = null;

      // Restore scroll on .feed-content — retry if content hasn't laid out yet
      let attempts = 0;
      const tryRestore = () => {
        const scrollEl = getScrollEl();
        if (!scrollEl) return;
        scrollEl.scrollTop = savedY;
        attempts++;
        const actual = scrollEl.scrollTop;
        scrollLog().info('nav.scrollRestore', { savedY, actualY: actual, attempt: attempts, scrollHeight: scrollEl.scrollHeight });
        if (savedY > 0 && Math.abs(actual - savedY) > 50 && attempts < 5) {
          requestAnimationFrame(tryRestore);
        }
      };
      requestAnimationFrame(tryRestore);
    }
  }, [items.length, scrollLog, urlSlug]);

  // Lock the actual Feed scroller while the desktop modal is open.
  useEffect(() => {
    if (urlSlug && isDesktop) {
      const scrollEl = getScrollEl();
      if (!scrollEl) return undefined;
      const previous = scrollEl.style.overflow;
      scrollEl.style.overflow = 'hidden';
      return () => { scrollEl.style.overflow = previous; };
    }
    return undefined;
  }, [urlSlug, isDesktop]);

  const handleBack = useCallback(() => {
    if (location.state?.feedModal) navigate(-1);
    else navigate(`/feed/scroll${location.search}`, { replace: true });
  }, [location.search, location.state, navigate]);

  // Apply assembly debug filter (tier/source toggles)
  const visibleItems = (() => {
    const activeItems = items.filter(item => !item.state?.isArchived && sourcePreferences[item.source] !== 'mute');
    const { tiers, sources } = assemblyFilter;
    if (tiers.length === 0 && sources.length === 0) return activeItems;
    const tierSet = new Set(tiers);
    const sourceSet = new Set(sources);
    return activeItems.filter(item => {
      const tierMatch = tierSet.size === 0 || tierSet.has(item.tier);
      const sourceMatch = sourceSet.size === 0 || sourceSet.has(item.source);
      return tierMatch && sourceMatch;
    });
  })();
  useEffect(() => {
    if (urlSlug) return undefined;
    const onKeyDown = event => {
      if (!['j', 'k'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable) return;
      const cards = [...document.querySelectorAll('.scroll-item-wrapper .scroll-card-open')];
      if (!cards.length) return;
      const activeIndex = cards.findIndex(card => card === document.activeElement);
      const nextIndex = event.key === 'j' ? Math.min(cards.length - 1, activeIndex + 1) : Math.max(0, activeIndex <= 0 ? 0 : activeIndex - 1);
      event.preventDefault();
      cards[nextIndex].focus({ preventScroll: true });
      cards[nextIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [urlSlug]);

  const { containerStyle, getItemStyle, getItemMetrics, measureRef } = useMasonryLayout(containerRef, visibleItems, isDesktop);
  const mobileWindow = useVirtualFeedWindow(containerRef, visibleItems, !isDesktop);
  const desktopWindow = useMasonryVirtualWindow(containerRef, visibleItems, isDesktop, getItemMetrics);
  const renderedItems = isDesktop ? desktopWindow : mobileWindow.items;
  const renderedContainerStyle = isDesktop ? containerStyle : {
    paddingTop: `${mobileWindow.paddingTop}px`,
    paddingBottom: `${mobileWindow.paddingBottom}px`,
  };

  const handleCardClick = useCallback((e, item) => {
    e.preventDefault();
    const el = getScrollEl();
    const scrollY = el ? el.scrollTop : 0;
    savedScrollRef.current = scrollY;
    getLogger().child({ module: 'scroll-restore' }).info('nav.saveScroll', {
      scrollY: Math.round(scrollY),
      scrollHeight: el ? el.scrollHeight : 0,
      id: item.id,
    });
    feedLog.nav('card click', { scrollY: Math.round(scrollY), id: item.id, title: item.title, source: item.source, tier: item.tier });
    navigate({ pathname: `/feed/scroll/${encodeFeedItemId(item.id)}`, search: location.search }, { state: { feedModal: true } });
  }, [location.search, navigate]);

  const handleNav = useCallback((direction) => {
    if (!selectedItem) return;
    const idx = visibleItems.findIndex(i => i.id === selectedItem.id);
    if (idx === -1) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= visibleItems.length) return;
    navigate({ pathname: `/feed/scroll/${encodeFeedItemId(visibleItems[nextIdx].id)}`, search: location.search }, { replace: true, state: location.state });
  }, [selectedItem, visibleItems, navigate, location.search, location.state]);

  const handleGalleryNav = useCallback((galleryItem) => {
    // Add synthetic item to list so URL-driven detail fetch finds it
    setItems(prev => {
      if (prev.find(i => i.id === galleryItem.id)) return prev;
      return [...prev, galleryItem];
    });
    navigate({ pathname: `/feed/scroll/${encodeFeedItemId(galleryItem.id)}`, search: location.search }, { replace: true, state: location.state });
  }, [navigate, location.search, location.state]);

  const handleDismiss = useCallback((item) => {
    feedLog.dismiss('archive', { id: item.id, title: item.title });
    mutateItems([item], 'archive', {
      onApply: updated => setItems(current => current.map(value => updated.find(next => next.id === value.id) || value)),
    }).catch(() => {});
  }, [mutateItems]);

  const setProductFilter = useCallback((filter) => {
    const next = buildScrollFilterSearch(searchParams, filter);
    navigate(`/feed/scroll${next ? `?${next}` : ''}`);
  }, [navigate, searchParams]);

  if (loading) {
    return (
      <div className="scroll-layout">
        <div className="scroll-view">
          <div className="scroll-skeleton">
            {[...Array(18)].map((_, i) => (
              <div key={i} className="scroll-skeleton-card" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const currentIdx = selectedItem ? visibleItems.findIndex(i => i.id === selectedItem.id) : -1;
  const sourceOptions = getScrollSourceOptions(items);

  return (
    <div className="scroll-layout">
      <div className="scroll-view" style={{ display: (urlSlug && !isDesktop) ? 'none' : undefined }}>
        <div className="scroll-controls" aria-label="Scroll filters">
          {[['', 'For you'], ['wire', 'News'], ['library', 'Library'], ['scrapbook', 'Personal']].map(([filter, label]) => (
            <button key={label} className={(searchParams.get('filter') || '') === filter ? 'active' : ''} onClick={() => setProductFilter(filter)}>{label}</button>
          ))}
          {!!sourceOptions.length && <details className="scroll-source-filter">
            <summary>Sources</summary>
            <div>
              {sourceOptions.map(([source, label]) => <button type="button" key={source} className={filterParam === source ? 'active' : ''} onClick={() => setProductFilter(source)}>{label}</button>)}
            </div>
          </details>}
        </div>
        <div ref={containerRef} className="scroll-items" style={renderedContainerStyle}>
          {renderedItems.map((item, i) => (
            <ScrollCard
              key={item.id || i}
              item={item}
              isNew={!!previousVisit.current && new Date(item.publishedAt || item.timestamp || 0).getTime() > new Date(previousVisit.current).getTime()}
              colors={colors}
              onDismiss={handleDismiss}
              onPlay={handlePlay}
              onClick={(e) => handleCardClick(e, item)}
              onFilter={setProductFilter}
              onSourcePreference={setSourcePreference}
              sourcePreference={sourcePreferences[item.source] || 'normal'}
              style={getItemStyle(item.id)}
              itemRef={isDesktop ? measureRef(item.id) : mobileWindow.measureRef(item.id)}
              viewportObserver={viewportObserverRef.current}
            />
          ))}
        </div>
        {hasMore && (
          <div ref={sentinelRef} className="scroll-sentinel">
            {loadingMore && (
              <div className="scroll-loading">
                <div className="scroll-loading-dots">
                  <span /><span /><span />
                </div>
              </div>
            )}
          </div>
        )}
        {!hasMore && items.length > 0 && caughtUp && (
          <div className="scroll-end">
            <h2>You’re caught up</h2>
            <p>You’ve reached the end of the current source pool.</p>
            <div className="scroll-end__actions">
              <button className="scroll-load-more" onClick={() => {
                sessionStorage.removeItem(sessionStorageKey);
                setSessionId(null);
                fetchItems(false, null);
              }}>Refresh sources</button>
              <button className="scroll-load-more" onClick={() => navigate('/feed/search')}>Browse history</button>
            </div>
          </div>
        )}
        {!hasMore && items.length > 0 && budgetReached && !caughtUp && (
          <div className="scroll-end" role="status">
            <h2>Session complete</h2>
            <p>You reached your {effectiveBudget}-item reading boundary.</p>
            <div className="scroll-end__actions">
              <button className="scroll-load-more" disabled={!serverHasMore} onClick={() => {
                setBudgetOverride(items.length + 30);
                setBudgetReached(false);
                setHasMore(serverHasMore);
              }}>Continue 30 more</button>
              <button className="scroll-load-more" onClick={() => navigate('/feed/search?state=saved')}>Review saved</button>
            </div>
          </div>
        )}
        {error && (
          <div className="scroll-error" role="alert">
            <span>Couldn’t load the feed.</span>
            <button
              className="scroll-load-more"
              onClick={() => { setError(null); setHasMore(true); fetchItems(items.length > 0); }}
            >
              Retry
            </button>
          </div>
        )}
        {!error && !hasMore && items.length === 0 && (
          <div className="scroll-empty">Nothing in your feed yet</div>
        )}
      </div>
      {selectedItem && isDesktop && (
        <DetailModal
          item={selectedItem}
          sections={detailData?.sections || []}
          ogImage={detailData?.ogImage || null}
          ogDescription={detailData?.ogDescription || null}
          loading={detailLoading}
          onBack={handleBack}
          onNext={currentIdx < visibleItems.length - 1 ? () => handleNav(1) : null}
          onPrev={currentIdx > 0 ? () => handleNav(-1) : null}
          onPlay={handlePlay}
          activeMedia={activeMedia}
          playback={playback}
          onNavigateToItem={handleGalleryNav}
          onStateAction={(action) => mutateItems([selectedItem], action, { onApply: updated => setItems(current => current.map(value => updated.find(next => next.id === value.id) || value)) }).then(() => { if (action === 'archive') handleBack(); }).catch(() => {})}
        />
      )}
      {selectedItem && !isDesktop && (
        <DetailView
          item={selectedItem}
          sections={detailData?.sections || []}
          ogImage={detailData?.ogImage || null}
          ogDescription={detailData?.ogDescription || null}
          loading={detailLoading}
          onBack={handleBack}
          onNext={currentIdx < visibleItems.length - 1 ? () => handleNav(1) : null}
          onPrev={currentIdx > 0 ? () => handleNav(-1) : null}
          onPlay={handlePlay}
          activeMedia={activeMedia}
          playback={playback}
          onNavigateToItem={handleGalleryNav}
          onStateAction={(action) => mutateItems([selectedItem], action, { onApply: updated => setItems(current => current.map(value => updated.find(next => next.id === value.id) || value)) }).then(() => { if (action === 'archive') handleBack(); }).catch(() => {})}
        />
      )}
      {searchParams.get('debug') === '1' && (
        <FeedAssemblyOverlay batches={assemblyBatches} onFilterChange={handleAssemblyFilter} />
      )}
    </div>
  );
}
