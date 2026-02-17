import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { renderFeedCard } from './cards/index.jsx';
import DetailView from './detail/DetailView.jsx';
import DetailModal from './detail/DetailModal.jsx';
import FeedPlayerMiniBar from './FeedPlayerMiniBar.jsx';
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

export default function Scroll() {
  const { itemId: urlSlug } = useParams();
  const navigate = useNavigate();

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
  const savedScrollRef = useRef(0);

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

      const result = await DaylightAPI(`/api/v1/feed/scroll?${params}`);

      const incoming = result.items || [];

      if (append) {
        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = incoming.filter(i => !existingIds.has(i.id));
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
  }, [focusSource]);

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
  }, [hasMore, loadingMore, fetchItems]);

  // Fetch detail when URL slug changes (route-driven)
  const prevSlugRef = useRef(null);
  useEffect(() => {
    if (!urlSlug || urlSlug === prevSlugRef.current) return;
    prevSlugRef.current = urlSlug;

    if (!fullId) return;

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
  }, [urlSlug, items, fullId, navigate]);

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
            <div key={item.id || i} className="scroll-item-wrapper">
              <div onClick={(e) => handleCardClick(e, item)}>
                {renderFeedCard(item)}
              </div>
            </div>
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
          <div className="scroll-end">You're all caught up</div>
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
          onPlay={(item) => setActiveMedia(item ? { item } : null)}
          activeMedia={activeMedia}
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
          onPlay={(item) => setActiveMedia(item ? { item } : null)}
          activeMedia={activeMedia}
          onNavigateToItem={handleGalleryNav}
        />
      )}
      {activeMedia && !urlSlug && (
        <FeedPlayerMiniBar
          item={activeMedia.item}
          onOpen={() => navigate(`/feed/scroll/${encodeItemId(activeMedia.item.id)}`)}
          onClose={() => setActiveMedia(null)}
        />
      )}
    </div>
  );
}
