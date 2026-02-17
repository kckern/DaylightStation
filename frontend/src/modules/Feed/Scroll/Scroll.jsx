import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { renderFeedCard } from './cards/index.jsx';
import DetailView from './detail/DetailView.jsx';
import DetailModal from './detail/DetailModal.jsx';
import FeedPlayerMiniBar from './FeedPlayerMiniBar.jsx';
import PersistentPlayer from './PersistentPlayer.jsx';
import { usePlaybackObserver } from './hooks/usePlaybackObserver.js';
import { DaylightAPI } from '../../../lib/api.mjs';
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

function ScrollCard({ item, colors, onDismiss, onPlay, onClick }) {
  const wrapperRef = useRef(null);
  const touchRef = useRef(null);

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
      ref={wrapperRef}
      className="scroll-item-wrapper"
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
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeMedia, setActiveMedia] = useState(null);
  const playerRef = useRef(null);
  const [colors, setColors] = useState({});
  const savedScrollRef = useRef(0);

  const playback = usePlaybackObserver(playerRef, !!activeMedia);

  const handlePlay = useCallback((item) => {
    if (!item) { setActiveMedia(null); return; }
    setActiveMedia({ item, contentId: item.id });
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

      const result = await DaylightAPI(`/api/v1/feed/scroll?${params}`);

      const incoming = result.items || [];
      if (result.colors) setColors(result.colors);

      if (append) {
        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = incoming.filter(i => !existingIds.has(i.id));
          if (newItems.length === 0) return prev;
          return [...prev, ...newItems];
        });
      } else {
        setItems(incoming);
      }
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to fetch scroll items:', err);
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
    DaylightAPI('/api/v1/feed/scroll/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: ids }),
    }).catch(err => console.error('Dismiss failed:', err));
  }, []);

  const queueDismiss = useCallback((itemId) => {
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

    // Auto-dismiss: mark item as read when detail opens
    queueDismiss(fullId);

    // Check if item is already in the loaded list
    const item = items.find(i => i.id === fullId);

    if (item) {
      // Item is in the scroll batch — fetch detail the normal way
      setDetailData(null);
      setDetailLoading(true);
      if (!isDesktop) window.scrollTo(0, 0);

      const params = new URLSearchParams();
      if (item.link) params.set('link', item.link);
      if (item.meta) params.set('meta', JSON.stringify(item.meta));

      DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(item.id)}?${params}`)
        .then(result => setDetailData(result))
        .catch(err => {
          console.error('Detail fetch failed:', err);
          setDetailData(null);
        })
        .finally(() => setDetailLoading(false));
    } else {
      // Cold load / deep link — fetch item + detail from server cache
      setDetailData(null);
      setDetailLoading(true);
      setDeepLinkedItem(null);
      if (!isDesktop) window.scrollTo(0, 0);

      DaylightAPI(`/api/v1/feed/scroll/item/${urlSlug}`)
        .then(result => {
          if (result.item) setDeepLinkedItem(result.item);
          setDetailData({
            sections: result.sections || [],
            ogImage: result.ogImage || null,
            ogDescription: result.ogDescription || null,
          });
        })
        .catch(err => {
          console.error('Deep-link fetch failed:', err);
          // Item not in server cache — redirect to scroll list
          navigate('/feed/scroll', { replace: true });
        })
        .finally(() => setDetailLoading(false));
    }
  }, [urlSlug, items, fullId, navigate, queueDismiss]);

  // Restore scroll position when navigating back to list
  useEffect(() => {
    if (!urlSlug) {
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

  const handleCardClick = useCallback((e, item) => {
    e.preventDefault();
    savedScrollRef.current = window.scrollY;
    navigate(`/feed/scroll/${encodeItemId(item.id)}`);
  }, [navigate]);

  const handleNav = useCallback((direction) => {
    if (!selectedItem) return;
    const idx = items.findIndex(i => i.id === selectedItem.id);
    if (idx === -1) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= items.length) return;
    navigate(`/feed/scroll/${encodeItemId(items[nextIdx].id)}`, { replace: true });
  }, [selectedItem, items, navigate]);

  const handleGalleryNav = useCallback((galleryItem) => {
    // Add synthetic item to list so URL-driven detail fetch finds it
    setItems(prev => {
      if (prev.find(i => i.id === galleryItem.id)) return prev;
      return [...prev, galleryItem];
    });
    navigate(`/feed/scroll/${encodeItemId(galleryItem.id)}`, { replace: true });
  }, [navigate]);

  const handleDismiss = useCallback((item, wrapperEl) => {
    queueDismiss(item.id);

    if (wrapperEl) {
      // Slide left + collapse using Web Animations API
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
    } else {
      setItems(prev => prev.filter(i => i.id !== item.id));
    }
  }, [queueDismiss]);

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

  const currentIdx = selectedItem ? items.findIndex(i => i.id === selectedItem.id) : -1;

  return (
    <div className="scroll-layout">
      <div className="scroll-view" style={{ display: (urlSlug && !isDesktop) ? 'none' : undefined }}>
        <div className="scroll-items">
          {items.map((item, i) => (
            <ScrollCard
              key={item.id || i}
              item={item}
              colors={colors}
              onDismiss={handleDismiss}
              onPlay={handlePlay}
              onClick={(e) => handleCardClick(e, item)}
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
          onNext={currentIdx < items.length - 1 ? () => handleNav(1) : null}
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
          onNext={currentIdx < items.length - 1 ? () => handleNav(1) : null}
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
          onClose={() => setActiveMedia(null)}
        />
      )}
      <PersistentPlayer
        ref={playerRef}
        contentId={activeMedia?.contentId || null}
        onEnd={() => setActiveMedia(null)}
      />
    </div>
  );
}
