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

/**
 * Adaptive grouping: picks the coarsest level where avg items per group >= 3.
 * day → week → month → season → year
 * Unfiltered always uses day grouping.
 */
function smartGroup(articles, isFiltered) {
  if (!isFiltered || articles.length === 0) return groupByDay(articles);

  const groupers = [groupByDay, groupByWeek, groupByMonth, groupBySeason, groupByYear];
  for (const fn of groupers) {
    const groups = fn(articles);
    const avg = articles.length / groups.length;
    if (avg >= 3) return groups;
  }
  // Fallback: year (coarsest)
  return groupByYear(articles);
}

export default function Reader() {
  const [feeds, setFeeds] = useState([]);
  const [articles, setArticles] = useState([]);
  const [continuation, setContinuation] = useState(null);
  const [exhausted, setExhausted] = useState(false);
  const [activeFeeds, setActiveFeeds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
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
  // Unfiltered: day-based primer (days=3)
  // Filtered:   count-based backlog (count=50), full feed history
  const fetchStream = useCallback(async (cont = null, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    try {
      const isFiltered = activeFeeds.size > 0;
      const params = new URLSearchParams();
      if (isFiltered) {
        params.set('count', '50');
        params.set('feeds', [...activeFeeds].join(','));
      } else {
        params.set('days', '3');
      }
      if (cont) params.set('continuation', cont);
      const data = await DaylightAPI(`/api/v1/feed/reader/stream?${params}`);
      setArticles(prev => append ? [...prev, ...(data.items || [])] : (data.items || []));
      setContinuation(data.continuation || null);
      setExhausted(data.exhausted || false);
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

  // Sidebar filter toggle (single feed)
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

  // Sidebar filter toggle (entire category)
  const handleToggleCategory = (feedIds, multiSelect) => {
    setActiveFeeds(prev => {
      const allActive = feedIds.every(id => prev.has(id));
      const next = new Set(multiSelect ? prev : []);
      if (allActive) {
        // All active → deselect all in this category
        for (const id of feedIds) next.delete(id);
      } else {
        // Some or none active → select all in this category
        for (const id of feedIds) next.add(id);
      }
      return next;
    });
  };

  // Mark as read (single article)
  const handleMarkRead = async (articleId) => {
    setArticles(prev => prev.map(a =>
      a.id === articleId ? { ...a, isRead: true } : a
    ));
    try {
      await DaylightAPI('/api/v1/feed/reader/items/mark', { itemIds: [articleId], action: 'read' }, 'POST');
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  // Mark all articles in a group as read
  const handleMarkGroupRead = async (groupArticles) => {
    const unreadIds = groupArticles.filter(a => !a.isRead).map(a => a.id);
    if (unreadIds.length === 0) return;
    setArticles(prev => prev.map(a =>
      unreadIds.includes(a.id) ? { ...a, isRead: true } : a
    ));
    try {
      await DaylightAPI('/api/v1/feed/reader/items/mark', { itemIds: unreadIds, action: 'read' }, 'POST');
    } catch (err) {
      console.error('Failed to mark group read:', err);
    }
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

  if (error) return <div className="feed-placeholder">{error}</div>;

  const isFiltered = activeFeeds.size > 0;
  const dayGroups = smartGroup(articles, isFiltered);

  return (
    <div className="reader-view">
      <ReaderSidebar
        feeds={feeds}
        activeFeeds={activeFeeds}
        onToggleFeed={handleToggleFeed}
        onToggleCategory={handleToggleCategory}
        onClearFilters={() => setActiveFeeds(new Set())}
      />
      <div className="reader-inbox">
        {loading ? (
          <div className="reader-loading">Loading...</div>
        ) : (
          <>
            {dayGroups.map(group => {
              const isGroupCollapsed = collapsedGroups.has(group.key);
              const unreadCount = group.articles.filter(a => !a.isRead).length;
              return (
                <div key={group.key} className="reader-day-group">
                  <div className="reader-day-header">
                    <span
                      className={`reader-group-arrow ${isGroupCollapsed ? 'collapsed' : ''}`}
                      onClick={() => toggleGroupCollapse(group.key)}
                    >&#9662;</span>
                    <span className="reader-group-label" onClick={() => toggleGroupCollapse(group.key)}>
                      {group.label}
                      <span className="reader-group-count">{group.articles.length}</span>
                    </span>
                    {unreadCount > 0 && (
                      <button
                        className="reader-mark-group-read"
                        onClick={() => handleMarkGroupRead(group.articles)}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {!isGroupCollapsed && group.articles.map(article => (
                    <ArticleRow
                      key={article.id}
                      article={article}
                      onMarkRead={handleMarkRead}
                    />
                  ))}
                </div>
              );
            })}
            {continuation && (
              <div ref={sentinelRef} className="reader-sentinel">
                {loadingMore && <span>Loading more...</span>}
              </div>
            )}
            {!continuation && articles.length === 0 && (
              <div className="reader-empty">No articles</div>
            )}
            {!continuation && exhausted && articles.length > 0 && (
              <div className="reader-end">End of Available Articles</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
