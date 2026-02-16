import { useState, useEffect, useCallback, useRef } from 'react';
import { ScrollCard } from './ScrollCard.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Scroll.scss';

export default function Scroll() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);

  const fetchItems = useCallback(async (append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const cursor = append && items.length > 0 ? items[items.length - 1].id : undefined;
      const params = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
      const result = await DaylightAPI(`/api/v1/feed/scroll${params}`);

      if (append) {
        setItems(prev => [...prev, ...result.items]);
      } else {
        setItems(result.items);
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

  if (loading) return <div className="feed-placeholder">Loading feed...</div>;

  return (
    <div className="scroll-view">
      <div className="scroll-items">
        {items.map((item, i) => (
          <ScrollCard key={item.id || i} item={item} />
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="scroll-sentinel">
          {loadingMore && <div className="scroll-loading">Loading more...</div>}
        </div>
      )}
      {!hasMore && items.length > 0 && (
        <div className="scroll-end">You've reached the end</div>
      )}
      {!hasMore && items.length === 0 && (
        <div className="feed-placeholder">No feed items. Try harvesting headlines first.</div>
      )}
    </div>
  );
}
