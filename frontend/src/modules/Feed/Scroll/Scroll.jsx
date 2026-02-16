import { useState, useEffect, useCallback, useRef } from 'react';
import { renderFeedCard } from './cards/index.jsx';
import ContentDrawer from './ContentDrawer.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Scroll.scss';

export default function Scroll() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);
  const sessionStartRef = useRef(new Date().toISOString());
  const lastTapRef = useRef({ id: null, time: 0 });

  const fetchItems = useCallback(async (append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const cursor = append && items.length > 0 ? items[items.length - 1].id : undefined;
      const params = new URLSearchParams({
        limit: '15',
        session: sessionStartRef.current,
      });
      if (cursor) params.set('cursor', cursor);

      const result = await DaylightAPI(`/api/v1/feed/scroll?${params}`);

      if (append) {
        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = (result.items || []).filter(i => !existingIds.has(i.id));
          return [...prev, ...newItems];
        });
      } else {
        setItems(result.items || []);
      }
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to fetch scroll items:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [items]);

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

  // Double-tap detection for expanding external cards
  const handleCardClick = useCallback((e, item) => {
    // Only expand external cards (headline, freshrss, reddit)
    if (item.type !== 'external') return;

    const now = Date.now();
    const last = lastTapRef.current;

    if (last.id === item.id && now - last.time < 400) {
      // Double-tap detected
      e.preventDefault();
      setExpandedItemId(prev => prev === item.id ? null : item.id);
      lastTapRef.current = { id: null, time: 0 };
    } else {
      lastTapRef.current = { id: item.id, time: now };
    }
  }, []);

  if (loading) {
    return (
      <div className="scroll-view">
        <div className="scroll-skeleton">
          {[1, 2, 3].map(i => (
            <div key={i} className="scroll-skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="scroll-view">
      <div className="scroll-items">
        {items.map((item, i) => (
          <div key={item.id || i} className="scroll-item-wrapper">
            <div onClick={(e) => handleCardClick(e, item)}>
              {renderFeedCard(item)}
            </div>
            {expandedItemId === item.id && (
              <ContentDrawer
                item={item}
                onClose={() => setExpandedItemId(null)}
              />
            )}
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
  );
}
