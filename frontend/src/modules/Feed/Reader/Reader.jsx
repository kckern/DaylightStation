import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import ReaderSidebar from './ReaderSidebar.jsx';
import ArticleRow from './ArticleRow.jsx';
import './Reader.scss';

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

export default function Reader() {
  const [feeds, setFeeds] = useState([]);
  const [articles, setArticles] = useState([]);
  const [continuation, setContinuation] = useState(null);
  const [activeFeeds, setActiveFeeds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const sentinelRef = useRef(null);

  // Load feeds for sidebar
  useEffect(() => {
    DaylightAPI('/api/v1/feed/reader/feeds')
      .then(f => setFeeds(f || []))
      .catch(err => {
        console.error('Failed to load feeds:', err);
        setError('Could not connect to FreshRSS.');
      });
  }, []);

  // Fetch stream articles
  const fetchStream = useCallback(async (cont = null, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ days: '3' });
      if (cont) params.set('continuation', cont);
      if (activeFeeds.size > 0) params.set('feeds', [...activeFeeds].join(','));
      const data = await DaylightAPI(`/api/v1/feed/reader/stream?${params}`);
      setArticles(prev => append ? [...prev, ...(data.items || [])] : (data.items || []));
      setContinuation(data.continuation || null);
    } catch (err) {
      console.error('Failed to load stream:', err);
      if (!append) setError('Failed to load articles.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeFeeds]);

  // Initial load + reload on filter change
  useEffect(() => {
    fetchStream();
  }, [fetchStream]);

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

  // Sidebar filter toggle
  const handleToggleFeed = (feedId, multiSelect) => {
    setActiveFeeds(prev => {
      const next = new Set(multiSelect ? prev : []);
      if (prev.has(feedId)) {
        next.delete(feedId);
      } else {
        next.add(feedId);
      }
      return next;
    });
  };

  // Mark as read
  const handleMarkRead = async (articleId) => {
    // Optimistic update
    setArticles(prev => prev.map(a =>
      a.id === articleId ? { ...a, isRead: true } : a
    ));
    try {
      await DaylightAPI('/api/v1/feed/reader/items/mark', { itemIds: [articleId], action: 'read' }, 'POST');
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  if (error) return <div className="feed-placeholder">{error}</div>;

  const dayGroups = groupByDay(articles);

  return (
    <div className="reader-view">
      <ReaderSidebar
        feeds={feeds}
        activeFeeds={activeFeeds}
        onToggleFeed={handleToggleFeed}
      />
      <div className="reader-inbox">
        {loading ? (
          <div className="reader-loading">Loading...</div>
        ) : dayGroups.length === 0 ? (
          <div className="reader-empty">No articles</div>
        ) : (
          <>
            {dayGroups.map(group => (
              <div key={group.key} className="reader-day-group">
                <div className="reader-day-header">{group.label}</div>
                {group.articles.map(article => (
                  <ArticleRow
                    key={article.id}
                    article={article}
                    onMarkRead={handleMarkRead}
                  />
                ))}
              </div>
            ))}
            {continuation && (
              <div ref={sentinelRef} className="reader-sentinel">
                {loadingMore && <span>Loading more...</span>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
