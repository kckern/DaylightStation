import { useState, useMemo, useEffect } from 'react';

/**
 * Sidebar with collapsible categories and feed filter toggles.
 * @param {Object} props
 * @param {Array} props.feeds - [{id, title, categories: [{id, label}]}]
 * @param {Set} props.activeFeeds - set of selected feed IDs (empty = show all)
 * @param {Function} props.onToggleFeed - (feedId, multiSelect) => void
 * @param {Function} props.onToggleCategory - (feedIds, multiSelect) => void
 * @param {Function} props.onClearFilters - () => void
 */
export default function ReaderSidebar({ feeds, activeFeeds, onToggleFeed, onToggleCategory, onClearFilters }) {
  const [collapsed, setCollapsed] = useState({});
  const [initialized, setInitialized] = useState(false);

  // Collapse all categories once feeds load
  useEffect(() => {
    if (feeds.length > 0 && !initialized) {
      const init = {};
      for (const feed of feeds) {
        const cat = feed.categories?.[0]?.label || 'Uncategorized';
        init[cat] = true;
      }
      setCollapsed(init);
      setInitialized(true);
    }
  }, [feeds, initialized]);

  // Group feeds by category label
  const grouped = useMemo(() => {
    const map = new Map();
    for (const feed of feeds) {
      const catLabel = feed.categories?.[0]?.label || 'Uncategorized';
      if (!map.has(catLabel)) map.set(catLabel, []);
      map.get(catLabel).push(feed);
    }
    // Sort categories alphabetically, Uncategorized last
    return [...map.entries()].sort((a, b) => {
      if (a[0] === 'Uncategorized') return 1;
      if (b[0] === 'Uncategorized') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [feeds]);

  const toggleCollapse = (cat, catFeeds) => {
    const wasCollapsed = collapsed[cat];
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));
    // Expanding a filtered category → auto-remove that category's filter
    if (wasCollapsed && isCategoryActive(catFeeds)) {
      const feedIds = catFeeds.map(f => f.id);
      onToggleCategory(feedIds, false);
    }
  };

  const handleFeedClick = (feedId, e) => {
    onToggleFeed(feedId, e.ctrlKey || e.metaKey);
  };

  const handleCategoryClick = (catFeeds, e) => {
    const feedIds = catFeeds.map(f => f.id);
    onToggleCategory(feedIds, e.ctrlKey || e.metaKey);
  };

  // Check if all feeds in a category are active
  const isCategoryActive = (catFeeds) => {
    return catFeeds.length > 0 && catFeeds.every(f => activeFeeds.has(f.id));
  };

  return (
    <div className="reader-sidebar">
      <h4 className="reader-sidebar-title">Feeds</h4>
      {activeFeeds.size > 0 && (
        <button className="reader-view-all" onClick={onClearFilters}>View All</button>
      )}
      {grouped.map(([category, catFeeds]) => (
        <div key={category} className="reader-category">
          <div className={`reader-category-header ${isCategoryActive(catFeeds) ? 'active' : ''}`}>
            <span
              className={`reader-category-arrow ${collapsed[category] ? 'collapsed' : ''}`}
              onClick={() => toggleCollapse(category, catFeeds)}
            >&#9662;</span>
            <span
              className="reader-category-label"
              onClick={(e) => handleCategoryClick(catFeeds, e)}
            >{category}</span>
          </div>
          {!collapsed[category] && catFeeds.map(feed => (
            <button
              key={feed.id}
              className={`reader-feed-item ${activeFeeds.has(feed.id) ? 'active' : ''}`}
              onClick={(e) => handleFeedClick(feed.id, e)}
            >
              {feed.title}
            </button>
          ))}
        </div>
      ))}
      {feeds.length === 0 && (
        <div className="reader-empty">No feeds found</div>
      )}
    </div>
  );
}
