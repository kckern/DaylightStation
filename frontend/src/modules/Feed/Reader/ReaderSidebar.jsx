import { useState, useMemo } from 'react';

/**
 * Sidebar with collapsible categories and feed filter toggles.
 * @param {Object} props
 * @param {Array} props.feeds - [{id, title, categories: [{id, label}]}]
 * @param {Set} props.activeFeeds - set of selected feed IDs (empty = show all)
 * @param {Function} props.onToggleFeed - (feedId, multiSelect) => void
 */
export default function ReaderSidebar({ feeds, activeFeeds, onToggleFeed }) {
  const [collapsed, setCollapsed] = useState({});

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

  const toggleCollapse = (cat) => {
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleFeedClick = (feedId, e) => {
    onToggleFeed(feedId, e.ctrlKey || e.metaKey);
  };

  return (
    <div className="reader-sidebar">
      <h4 className="reader-sidebar-title">Feeds</h4>
      {grouped.map(([category, catFeeds]) => (
        <div key={category} className="reader-category">
          <button
            className="reader-category-header"
            onClick={() => toggleCollapse(category)}
          >
            <span className={`reader-category-arrow ${collapsed[category] ? 'collapsed' : ''}`}>&#9662;</span>
            {category}
          </button>
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
