import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { renderFeedCard } from './cards/index.jsx';
import DetailView from './detail/DetailView.jsx';
import DetailModal from './detail/DetailModal.jsx';
import FeedPlayerMiniBar from './FeedPlayerMiniBar.jsx';
import PersistentPlayer from './PersistentPlayer.jsx';
import { usePlaybackObserver } from './hooks/usePlaybackObserver.js';
import { useMasonryLayout } from './hooks/useMasonryLayout.js';
import FeedAssemblyOverlay from './FeedAssemblyOverlay.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import { feedLog } from './feedLog.js';
import './Scroll.scss';

/** Base64url-encode an item ID for use in the URL path. */
function encodeItemId(id) {
  return btoa(id).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url slug back to the original item ID. */
function decodeItemId(slug) {
  let s = slug.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try { return atob(s); } catch { return null; }
}

function ScrollCard({ item, colors, onDismiss, onPlay, onClick, style, itemRef }) {
  const wrapperRef = useRef(null);
  const touchRef = useRef(null);

  // Combine refs: local wrapperRef + external measureRef
  const setRefs = useCallback((node) => {
    wrapperRef.current = node;
    if (itemRef) itemRef(node);
  }, [itemRef]);

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

    if (dx < -100 && elapsed < 600) {
      // Threshold met — dismiss
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
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div onClick={onClick}>
        {renderFeedCard(item, colors, { onDismiss: (cardItem) => onDismiss(cardItem, wrapperRef.current), onPlay })}
      </div>
    </div>
  );
}

export default function Scroll() {
  const { itemId: urlSlug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [focusSource, setFocusSource] = useState(null);
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);
  const containerRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeMedia, setActiveMedia] = useState(null);
  const playerRef = useRef(null);
  const [colors, setColors] = useState({});
  const [assemblyBatches, setAssemblyBatches] = useState([]);
  const [assemblyFilter, setAssemblyFilter] = useState({ tiers: [], sources: [] });
  const savedScrollRef = useRef(0);

  const playback = usePlaybackObserver(playerRef, !!activeMedia);

  const handlePlay = useCallback((item) => {
    if (!item) { feedLog.player('clear activeMedia'); setActiveMedia(null); return; }
    feedLog.player('play', { id: item.id, title: item.title, source: item.source });
    setActiveMedia({ item, contentId: item.id });
  }, []);

  const handleClearMedia = useCallback(() => setActiveMedia(null), []);

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

  // Decode URL slug to full item ID
  const fullId = urlSlug ? decodeItemId(urlSlug) : null;

  // Find selected item in loaded list or from deep-link fetch
  const selectedItem = fullId
    ? (items.find(i => i.id === fullId) || (deepLinkedItem?.id === fullId ? deepLinkedItem : null))
    : null;

  const fetchItems = useCallback(async (append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const cur = itemsRef.current;
      const cursor = append && cur.length > 0 ? cur[cur.length - 1].id : undefined;
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (focusSource) params.set('focus', focusSource);
      const filterParam = searchParams.get('filter');
      if (filterParam) params.set('filter', filterParam);

      feedLog.scroll(append ? 'fetchMore' : 'fetchInitial', { cursor, focus: focusSource, filter: filterParam, currentCount: cur.length });

      const result = await DaylightAPI(`/api/v1/feed/scroll?${params}`);

      const incoming = result.items || [];
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
        feedLog.scroll('appendResult', { incoming: incoming.length, new: newCount, allDupes, hasMore: allDupes ? false : result.hasMore });

        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = incoming.filter(i => !existingIds.has(i.id));
          if (newItems.length === 0) return prev;
          return [...prev, ...newItems];
        });
        setHasMore(allDupes ? false : result.hasMore);
      } else {
        feedLog.scroll('initialResult', { count: incoming.length, hasMore: result.hasMore });
        setItems(incoming);
        setHasMore(result.hasMore);
      }
    } catch (err) {
      console.error('Failed to fetch scroll items:', err);
      feedLog.scroll('fetchError', err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [focusSource, searchParams]);

  useEffect(() => { fetchItems(); }, []);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore) {
          feedLog.scroll('sentinel intersecting — triggering fetchMore', { scrollY: window.scrollY, itemCount: itemsRef.current.length });
          fetchItems(true);
        }
      },
      { threshold: 0.1 }
    );

    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, fetchItems, loading]);

  /** Queue of item IDs to batch-dismiss via API. */
  const dismissQueueRef = useRef([]);
  const dismissTimerRef = useRef(null);

  const flushDismissQueue = useCallback(() => {
    const ids = dismissQueueRef.current.splice(0);
    if (ids.length === 0) return;
    feedLog.dismiss('flush batch', { count: ids.length, ids });
    DaylightAPI('/api/v1/feed/scroll/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: ids }),
    }).catch(err => {
      console.error('Dismiss failed:', err);
      feedLog.dismiss('flush error', err.message);
    });
  }, []);

  const queueDismiss = useCallback((itemId) => {
    feedLog.dismiss('queue', { itemId, queueSize: dismissQueueRef.current.length + 1 });
    dismissQueueRef.current.push(itemId);
    clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(flushDismissQueue, 500);
  }, [flushDismissQueue]);

  // Fetch detail when URL slug changes (route-driven)
  const prevSlugRef = useRef(null);
  useEffect(() => {
    if (!urlSlug || urlSlug === prevSlugRef.current) return;
    prevSlugRef.current = urlSlug;

    if (!fullId) return;

    // Auto-dismiss: mark item as read when detail opens (wire tier only)
    const matchedItem = items.find(i => i.id === fullId);
    if ((matchedItem?.tier || 'wire') === 'wire') queueDismiss(fullId);

    // Check if item is already in the loaded list
    const item = items.find(i => i.id === fullId);

    if (item) {
      // Item is in the scroll batch — fetch detail the normal way
      feedLog.detail('open (in batch)', { id: fullId, source: item.source, title: item.title });
      setDetailData(null);
      setDetailLoading(true);
      if (!isDesktop) window.scrollTo(0, 0);

      const params = new URLSearchParams();
      if (item.link) params.set('link', item.link);
      if (item.meta) params.set('meta', JSON.stringify(item.meta));

      DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(item.id)}?${params}`)
        .then(result => {
          feedLog.detail('loaded', { id: fullId, sections: result.sections?.length || 0 });
          setDetailData(result);
        })
        .catch(err => {
          console.error('Detail fetch failed:', err);
          feedLog.detail('fetchError', { id: fullId, error: err.message });
          setDetailData(null);
        })
        .finally(() => setDetailLoading(false));
    } else {
      // Cold load / deep link — fetch item + detail from server cache
      feedLog.detail('open (deep link)', { slug: urlSlug, fullId });
      setDetailData(null);
      setDetailLoading(true);
      setDeepLinkedItem(null);
      if (!isDesktop) window.scrollTo(0, 0);

      DaylightAPI(`/api/v1/feed/scroll/item/${urlSlug}`)
        .then(result => {
          feedLog.detail('deep link loaded', { hasItem: !!result.item, sections: result.sections?.length || 0 });
          if (result.item) setDeepLinkedItem(result.item);
          setDetailData({
            sections: result.sections || [],
            ogImage: result.ogImage || null,
            ogDescription: result.ogDescription || null,
          });
        })
        .catch(err => {
          console.error('Deep-link fetch failed:', err);
          feedLog.detail('deep link error — redirecting to list', { slug: urlSlug, error: err.message });
          // Item not in server cache — redirect to scroll list
          navigate('/feed/scroll', { replace: true });
        })
        .finally(() => setDetailLoading(false));
    }
  }, [urlSlug, items, fullId, navigate, queueDismiss]);

  // Restore scroll position when navigating back to list
  useEffect(() => {
    if (!urlSlug) {
      feedLog.nav('back to list — restoring scrollY', { savedY: savedScrollRef.current, itemCount: items.length });
      setDetailData(null);
      setDetailLoading(false);
      setDeepLinkedItem(null);
      prevSlugRef.current = null;
      requestAnimationFrame(() => {
        window.scrollTo(0, savedScrollRef.current);
      });
    }
  }, [urlSlug]);

  // Prevent body scroll when modal is open on desktop
  useEffect(() => {
    if (urlSlug && isDesktop) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [urlSlug, isDesktop]);

  const handleBack = useCallback(() => {
    navigate('/feed/scroll');
  }, [navigate]);

  // Apply assembly debug filter (tier/source toggles)
  const visibleItems = (() => {
    const { tiers, sources } = assemblyFilter;
    if (tiers.length === 0 && sources.length === 0) return items;
    const tierSet = new Set(tiers);
    const sourceSet = new Set(sources);
    return items.filter(item => {
      const tierMatch = tierSet.size === 0 || tierSet.has(item.tier);
      const sourceMatch = sourceSet.size === 0 || sourceSet.has(item.source);
      return tierMatch && sourceMatch;
    });
  })();

  const { containerStyle, getItemStyle, measureRef } = useMasonryLayout(containerRef, visibleItems, isDesktop);

  const handleCardClick = useCallback((e, item) => {
    e.preventDefault();
    savedScrollRef.current = window.scrollY;
    feedLog.nav('card click — saving scrollY', { scrollY: window.scrollY, id: item.id, title: item.title });
    navigate(`/feed/scroll/${encodeItemId(item.id)}`);
  }, [navigate]);

  const handleNav = useCallback((direction) => {
    if (!selectedItem) return;
    const idx = visibleItems.findIndex(i => i.id === selectedItem.id);
    if (idx === -1) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= visibleItems.length) return;
    navigate(`/feed/scroll/${encodeItemId(visibleItems[nextIdx].id)}`, { replace: true });
  }, [selectedItem, visibleItems, navigate]);

  const handleGalleryNav = useCallback((galleryItem) => {
    // Add synthetic item to list so URL-driven detail fetch finds it
    setItems(prev => {
      if (prev.find(i => i.id === galleryItem.id)) return prev;
      return [...prev, galleryItem];
    });
    navigate(`/feed/scroll/${encodeItemId(galleryItem.id)}`, { replace: true });
  }, [navigate]);

  const handleDismiss = useCallback((item, wrapperEl) => {
    feedLog.dismiss('handleDismiss', { id: item.id, title: item.title, hasWrapper: !!wrapperEl, isDesktop });
    queueDismiss(item.id);

    if (wrapperEl) {
      if (isDesktop) {
        // Desktop: fade out and leave empty space
        wrapperEl.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 250, easing: 'ease-in', fill: 'forwards' }
        );
      } else {
        // Mobile: slide left + collapse
        const slideAnim = wrapperEl.animate(
          [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-100%)', opacity: 0 }],
          { duration: 250, easing: 'ease-in', fill: 'forwards' }
        );
        slideAnim.onfinish = () => {
          wrapperEl.animate(
            [{ height: wrapperEl.offsetHeight + 'px', marginBottom: '12px' }, { height: '0px', marginBottom: '0px' }],
            { duration: 200, easing: 'ease-out', fill: 'forwards' }
          ).onfinish = () => {
            setItems(prev => prev.filter(i => i.id !== item.id));
          };
        };
      }
    } else {
      setItems(prev => prev.filter(i => i.id !== item.id));
    }
  }, [queueDismiss, isDesktop]);

  if (loading) {
    return (
      <div className="scroll-layout">
        <div className="scroll-view">
          <div className="scroll-skeleton">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="scroll-skeleton-card" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const currentIdx = selectedItem ? visibleItems.findIndex(i => i.id === selectedItem.id) : -1;

  return (
    <div className="scroll-layout">
      <div className="scroll-view" style={{ display: (urlSlug && !isDesktop) ? 'none' : undefined }}>
        <div ref={containerRef} className="scroll-items" style={containerStyle}>
          {visibleItems.map((item, i) => (
            <ScrollCard
              key={item.id || i}
              item={item}
              colors={colors}
              onDismiss={(item.tier || 'wire') === 'wire' ? handleDismiss : undefined}
              onPlay={handlePlay}
              onClick={(e) => handleCardClick(e, item)}
              style={getItemStyle(item.id)}
              itemRef={measureRef(item.id)}
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
        {!hasMore && items.length > 0 && (
          <div className="scroll-end">
            <button
              className="scroll-load-more"
              disabled={loadingMore}
              onClick={() => fetchItems(true)}
            >
              {loadingMore ? 'Loading…' : 'Load More…'}
            </button>
          </div>
        )}
        {!hasMore && items.length === 0 && (
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
        />
      )}
      {activeMedia && !urlSlug && (
        <FeedPlayerMiniBar
          item={activeMedia.item}
          playback={playback}
          onOpen={() => navigate(`/feed/scroll/${encodeItemId(activeMedia.item.id)}`)}
          onClose={handleClearMedia}
        />
      )}
      <PersistentPlayer
        ref={playerRef}
        contentId={activeMedia?.contentId || null}
        onEnd={handleClearMedia}
      />
      <FeedAssemblyOverlay batches={assemblyBatches} onFilterChange={handleAssemblyFilter} />
    </div>
  );
}
