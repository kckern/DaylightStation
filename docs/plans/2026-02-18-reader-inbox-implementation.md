# Reader Inbox Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 3-column FreshRSS Reader with a 2-column Google Reader-style inbox with category sidebar filtering, day-grouped articles, accordion expand, and infinite scroll.

**Architecture:** New backend `/reader/stream` endpoint fetches all items via GReader reading-list stream. Frontend is rewritten as 3 sub-components (ReaderSidebar, ArticleRow, Reader orchestrator) with day grouping, filter state, and IntersectionObserver-based infinite scroll.

**Tech Stack:** Express (backend router), React (frontend), SCSS, FreshRSS GReader API

**Design doc:** `docs/plans/2026-02-18-reader-inbox-redesign-design.md`

---

### Task 1: Add `/reader/stream` backend endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/feed.mjs:85` (insert before Headlines section)

**Step 1: Add the stream route**

Insert after line 85 (after the `/reader/items/mark` handler, before the Headlines section comment):

```javascript
  router.get('/reader/stream', asyncHandler(async (req, res) => {
    const { count, continuation, excludeRead, feeds } = req.query;
    const username = getUsername();
    const streamId = 'user/-/state/com.google/reading-list';
    const { items, continuation: nextContinuation } = await freshRSSAdapter.getItems(streamId, username, {
      count: count ? Number(count) : 50,
      continuation,
      excludeRead: excludeRead === 'true',
    });

    // Add isRead flag and plain-text preview to each item
    const READ_TAG = 'user/-/state/com.google/read';
    const enriched = items.map(item => {
      const isRead = (item.categories || []).some(c => c.includes(READ_TAG));
      // Strip HTML for preview
      const preview = item.content
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      // Extract category labels (user/-/label/Foo → Foo)
      const tags = (item.categories || [])
        .filter(c => c.includes('/label/'))
        .map(c => c.split('/label/').pop());
      return { ...item, isRead, preview, tags };
    });

    // Filter by feed IDs if specified
    let filtered = enriched;
    if (feeds) {
      const feedSet = new Set(feeds.split(','));
      filtered = enriched.filter(item => feedSet.has(item.feedId));
    }

    res.json({ items: filtered, continuation: nextContinuation });
  }));
```

**Step 2: Verify endpoint works**

```bash
curl -s "http://localhost:3112/api/v1/feed/reader/stream?count=5" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log('items:',j.items?.length,'cont:',!!j.continuation);j.items?.slice(0,2).forEach(i=>console.log('-',i.title?.slice(0,60),i.isRead,i.tags))"
```

Expected: items listed with `isRead` boolean and `tags` array.

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/feed.mjs
git commit -m "feat(feed): add /reader/stream endpoint for unified inbox"
```

---

### Task 2: Create ReaderSidebar component

**Files:**
- Create: `frontend/src/modules/Feed/Reader/ReaderSidebar.jsx`

**Step 1: Write the component**

```jsx
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
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Reader/ReaderSidebar.jsx
git commit -m "feat(feed): add ReaderSidebar with category grouping and feed filters"
```

---

### Task 3: Create ArticleRow component

**Files:**
- Create: `frontend/src/modules/Feed/Reader/ArticleRow.jsx`

**Step 1: Write the component**

```jsx
import { useState, useRef, useEffect } from 'react';
import { colorFromLabel } from '../Scroll/cards/utils.js';

/**
 * Single article row with collapsed/expanded accordion states.
 * @param {Object} props
 * @param {Object} props.article - article object from /reader/stream
 * @param {Function} props.onMarkRead - (articleId) => void
 */
export default function ArticleRow({ article, onMarkRead }) {
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState(false);
  const contentRef = useRef(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (expanded && contentRef.current) {
      setOverflows(contentRef.current.scrollHeight > 400);
    }
  }, [expanded]);

  const handleExpand = () => {
    if (!expanded) {
      setExpanded(true);
      if (!article.isRead) {
        onMarkRead(article.id);
      }
    } else {
      setExpanded(false);
      setFullHeight(false);
    }
  };

  const formatTime = (published) => {
    if (!published) return '';
    const d = new Date(published);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    // Same year: show month/day + time
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + time;
  };

  const primaryTag = article.tags?.[0];

  return (
    <div className={`article-row ${expanded ? 'expanded' : ''} ${article.isRead ? 'read' : 'unread'}`}>
      <button className="article-row-header" onClick={handleExpand}>
        {primaryTag && (
          <span
            className="article-tag"
            style={{ backgroundColor: colorFromLabel(primaryTag) }}
          >
            {primaryTag}
          </span>
        )}
        <span className="article-title">{article.title}</span>
        {!expanded && (
          <span className="article-preview">{article.preview}</span>
        )}
        <span className="article-time">{formatTime(article.published)}</span>
      </button>

      {expanded && (
        <div className="article-expanded">
          <div className="article-meta">
            {article.feedTitle && <span>{article.feedTitle}</span>}
            {article.author && <span> &middot; {article.author}</span>}
            {article.published && (
              <span> &middot; {new Date(article.published).toLocaleString()}</span>
            )}
          </div>
          <div
            ref={contentRef}
            className={`article-content ${fullHeight ? 'full' : ''}`}
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
          {overflows && !fullHeight && (
            <button className="article-readmore" onClick={(e) => { e.stopPropagation(); setFullHeight(true); }}>
              Read more
            </button>
          )}
          {article.link && (
            <a
              className="article-source-link"
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              Open original &rarr;
            </a>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Reader/ArticleRow.jsx
git commit -m "feat(feed): add ArticleRow with accordion expand, read-more, and mark-read"
```

---

### Task 4: Rewrite Reader.jsx orchestrator

**Files:**
- Modify: `frontend/src/modules/Feed/Reader/Reader.jsx` (full rewrite)

**Step 1: Rewrite Reader.jsx**

```jsx
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
      const params = new URLSearchParams({ count: '50' });
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
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Reader/Reader.jsx
git commit -m "feat(feed): rewrite Reader as 2-col inbox with day grouping and infinite scroll"
```

---

### Task 5: Rewrite Reader.scss

**Files:**
- Modify: `frontend/src/modules/Feed/Reader/Reader.scss` (full rewrite)

**Step 1: Write new styles**

```scss
// =========================================================================
// Reader — 2-column Google Reader-style inbox
// =========================================================================

.reader-view {
  display: grid;
  grid-template-columns: 220px 1fr;
  height: calc(100vh - 42px);
}

// ---- Sidebar ----

.reader-sidebar {
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  background: #f8f9fa;
  padding: 0.5rem 0;
}

.reader-sidebar-title {
  padding: 0.5rem 1rem;
  margin: 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  color: #888;
  letter-spacing: 0.05em;
}

.reader-category-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;
  padding: 0.4rem 1rem;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.8rem;
  font-weight: 600;
  color: #555;
  cursor: pointer;

  &:hover { background: #e9ecef; }
}

.reader-category-arrow {
  display: inline-block;
  font-size: 0.6rem;
  transition: transform 0.15s;
  &.collapsed { transform: rotate(-90deg); }
}

.reader-feed-item {
  display: block;
  width: 100%;
  padding: 0.3rem 1rem 0.3rem 1.75rem;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.8rem;
  cursor: pointer;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover { background: #e9ecef; }
  &.active {
    background: #d0ebff;
    color: #1971c2;
    font-weight: 600;
  }
}

// ---- Main inbox ----

.reader-inbox {
  overflow-y: auto;
  background: #fff;
}

.reader-day-group {
  &:not(:first-child) {
    margin-top: 0.25rem;
  }
}

.reader-day-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.35rem 1rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #888;
  background: #f1f3f5;
  border-bottom: 1px solid #e9ecef;
}

// ---- Article rows ----

.article-row {
  border-bottom: 1px solid #f0f0f0;

  &.unread .article-title {
    font-weight: 700;
  }
  &.read .article-title {
    font-weight: 400;
    color: #666;
  }
  &.read .article-preview {
    color: #bbb;
  }
}

.article-row-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 1rem;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: 0.82rem;
  line-height: 1.4;
  min-height: 36px;

  &:hover { background: #f8f9fa; }
}

.article-tag {
  flex-shrink: 0;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
}

.article-title {
  flex-shrink: 0;
  max-width: 40%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #1a1b1e;
}

.article-preview {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #999;
  font-size: 0.78rem;
}

.article-time {
  flex-shrink: 0;
  color: #aaa;
  font-size: 0.72rem;
  white-space: nowrap;
  margin-left: auto;
}

// ---- Expanded content ----

.article-expanded {
  padding: 0.75rem 1rem 1rem 2.5rem;
  border-top: 1px solid #f0f0f0;
  background: #fafbfc;
}

.article-meta {
  font-size: 0.75rem;
  color: #888;
  margin-bottom: 0.75rem;
}

.article-content {
  font-size: 0.88rem;
  line-height: 1.6;
  color: #333;
  max-height: 400px;
  overflow: hidden;
  position: relative;

  &.full {
    max-height: none;
    overflow: visible;
  }

  &:not(.full)::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: linear-gradient(transparent, #fafbfc);
    pointer-events: none;
  }

  img {
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
    border-radius: 4px;
  }

  a { color: #228be6; }

  pre {
    background: #f1f3f5;
    padding: 0.75rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.82rem;
  }

  blockquote {
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    border-left: 3px solid #dee2e6;
    color: #666;
  }
}

.article-readmore {
  display: block;
  width: 100%;
  padding: 0.35rem;
  margin-top: 0.25rem;
  border: none;
  background: none;
  color: #228be6;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;

  &:hover { text-decoration: underline; }
}

.article-source-link {
  display: inline-block;
  margin-top: 0.75rem;
  font-size: 0.78rem;
  color: #228be6;
  text-decoration: none;
  font-weight: 500;

  &:hover { text-decoration: underline; }
}

// ---- Utility ----

.reader-loading,
.reader-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #aaa;
  font-size: 0.9rem;
}

.reader-sentinel {
  padding: 1.5rem;
  text-align: center;
  color: #aaa;
  font-size: 0.8rem;
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Reader/Reader.scss
git commit -m "feat(feed): rewrite Reader.scss for 2-col inbox layout"
```

---

### Task 6: Smoke test the full flow

**Step 1: Start dev server (if not running)**

```bash
lsof -i :3111
# If nothing, start:
npm run dev
```

**Step 2: Open the reader in browser**

Navigate to `http://localhost:3111/feed/reader`

**Step 3: Verify checklist**

- [ ] Sidebar shows categories with collapsible feed groups
- [ ] Main area shows articles grouped by day with sticky headers
- [ ] Unread articles have bold titles
- [ ] Clicking a row expands the accordion with article content
- [ ] Expanding marks the article as read (bold removed)
- [ ] "Read more" appears for tall content
- [ ] "Open original" link works
- [ ] Source tags appear with colors
- [ ] Preview text fills the row
- [ ] Time is right-aligned
- [ ] Scrolling to bottom loads more articles
- [ ] Clicking a sidebar feed filters articles
- [ ] Ctrl+click selects multiple feeds
- [ ] Clicking active feed deselects it

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(feed): reader smoke test fixes"
```
