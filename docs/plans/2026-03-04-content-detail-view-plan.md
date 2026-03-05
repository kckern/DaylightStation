# Content Detail View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace click-to-play on search results with route-based detail views that show item info (leaves) or children (containers), with play/queue/shuffle actions available from within the detail view.

**Architecture:** Add nested routes to MediaApp (`/media/*`). Clicking a search result navigates to `/media/view/:id`. A new `ContentDetailView` component renders a shared shell (hero image, title, action bar) with a type-specific body section. Containers fetch from `/api/v1/list/`, leaves from `/api/v1/info/`. Recursive drill-down pushes browser history; back button pops.

**Tech Stack:** React 18, React Router v6, existing `/api/v1/info/` and `/api/v1/list/` endpoints, existing queue system via `useMediaApp()`.

---

### Task 1: Add Nested Routing to MediaApp

**Files:**
- Modify: `frontend/src/main.jsx:144`
- Modify: `frontend/src/Apps/MediaApp.jsx:146-153`

**Step 1: Update main.jsx route to accept nested paths**

In `frontend/src/main.jsx`, change line 144 from:
```jsx
<Route path="/media" element={<MediaApp />} />
```
to:
```jsx
<Route path="/media/*" element={<MediaApp />} />
```

**Step 2: Add Routes inside MediaApp browse mode**

In `frontend/src/Apps/MediaApp.jsx`, add `Routes`, `Route`, `useNavigate` imports from `react-router-dom`:

```jsx
import { Routes, Route, useNavigate } from 'react-router-dom';
```

Replace the browse mode div (lines 150-152):
```jsx
<div className={`media-mode-browse${mode !== 'browse' ? ' hidden' : ''}`}>
  <ContentBrowser hasMiniplayer={hasMiniplayer} />
</div>
```
with:
```jsx
<div className={`media-mode-browse${mode !== 'browse' ? ' hidden' : ''}`}>
  <Routes>
    <Route index element={<ContentBrowser hasMiniplayer={hasMiniplayer} />} />
    <Route path="view/:contentId/*" element={<ContentDetailView />} />
  </Routes>
</div>
```

Add the import for `ContentDetailView` (created in Task 3):
```jsx
import ContentDetailView from '../modules/Media/ContentDetailView.jsx';
```

**Step 3: Run dev server and verify `/media` still renders ContentBrowser**

Run: Open browser to `http://localhost:{port}/media`
Expected: ContentBrowser renders as before. No errors in console.

**Step 4: Commit**

```bash
git add frontend/src/main.jsx frontend/src/Apps/MediaApp.jsx
git commit -m "feat(media): add nested routing for detail view"
```

---

### Task 2: Create useContentDetail Hook

**Files:**
- Create: `frontend/src/hooks/media/useContentDetail.js`

**Step 1: Create the hook**

This hook fetches data from either `/api/v1/info/` (leaves) or `/api/v1/list/` (containers) based on the content ID, and returns a unified data shape.

```jsx
// frontend/src/hooks/media/useContentDetail.js
import { useState, useEffect, useCallback } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useContentDetail' });
  return _logger;
}

/**
 * Parse a compound content ID into source and localId.
 * Handles formats like "plex:12345", "readalong:scripture/ot/nirv/1"
 */
function parseContentId(contentId) {
  const colonIdx = contentId.indexOf(':');
  if (colonIdx < 0) return { source: 'plex', localId: contentId };
  return {
    source: contentId.slice(0, colonIdx),
    localId: contentId.slice(colonIdx + 1),
  };
}

export function useContentDetail(contentId) {
  const [data, setData] = useState(null);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError(null);

    const { source, localId } = parseContentId(id);
    logger().info('detail.fetch', { contentId: id, source, localId });

    try {
      // Try info first (works for both leaves and containers)
      const infoRes = await fetch(`/api/v1/info/${source}/${localId}`);
      if (!infoRes.ok) throw new Error(`Info failed: ${infoRes.status}`);
      const infoData = await infoRes.json();

      setData(infoData);

      // If container, also fetch children
      if (infoData.capabilities?.includes('listable') || infoData.type === 'show' || infoData.type === 'artist' || infoData.type === 'album' || infoData.type === 'season' || infoData.type === 'collection' || infoData.type === 'playlist') {
        const listRes = await fetch(`/api/v1/list/${source}/${localId}`);
        if (listRes.ok) {
          const listData = await listRes.json();
          setChildren(listData.items || []);
          // Merge container-level info from list response
          if (listData.image && !infoData.thumbnail) {
            setData(prev => ({ ...prev, thumbnail: listData.image, image: listData.image }));
          }
          logger().info('detail.children-loaded', { contentId: id, childCount: (listData.items || []).length });
        }
      } else {
        setChildren([]);
      }

      logger().info('detail.loaded', { contentId: id, title: infoData.title, type: infoData.type });
    } catch (err) {
      logger().error('detail.fetch-failed', { contentId: id, error: err.message });
      setError(err.message);
      setData(null);
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDetail(contentId);
  }, [contentId, fetchDetail]);

  return { data, children, loading, error, refetch: () => fetchDetail(contentId) };
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/media/useContentDetail.js
git commit -m "feat(media): add useContentDetail hook for detail view data fetching"
```

---

### Task 3: Create ContentDetailView Component (Shell)

**Files:**
- Create: `frontend/src/modules/Media/ContentDetailView.jsx`

**Step 1: Create the component with shared shell**

```jsx
// frontend/src/modules/Media/ContentDetailView.jsx
import React, { useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContentDetail } from '../../hooks/media/useContentDetail.js';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import { ContentDisplayUrl, resolveContentId } from './ContentBrowser.jsx';
import CastButton from './CastButton.jsx';
import getLogger from '../../lib/logging/Logger.js';

const ContentDetailView = () => {
  const { '*': wildcard, contentId: routeId } = useParams();
  // Reconstruct full content ID: route param + wildcard for paths like readalong:scripture/ot/nirv/1
  const contentId = wildcard ? `${routeId}/${wildcard}` : routeId;
  const navigate = useNavigate();
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'ContentDetailView' }), []);
  const { data, children, loading, error } = useContentDetail(contentId);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handlePlayNow = useCallback((item) => {
    const id = item ? resolveContentId(item) : contentId;
    const title = item?.title || data?.title;
    const format = item?.format || data?.format;
    const thumbnail = item?.thumbnail || data?.thumbnail;
    logger.info('detail.play-now', { contentId: id, title });
    queue.playNow([{ contentId: id, title, format, thumbnail }]);
  }, [contentId, data, queue, logger]);

  const handlePlayNext = useCallback((item) => {
    const id = item ? resolveContentId(item) : contentId;
    const title = item?.title || data?.title;
    logger.info('detail.play-next', { contentId: id, title });
    queue.addItems([{ contentId: id, title, format: item?.format || data?.format, thumbnail: item?.thumbnail || data?.thumbnail }], 'next');
  }, [contentId, data, queue, logger]);

  const handleAddToQueue = useCallback((item) => {
    const id = item ? resolveContentId(item) : contentId;
    const title = item?.title || data?.title;
    logger.info('detail.add-to-queue', { contentId: id, title });
    queue.addItems([{ contentId: id, title, format: item?.format || data?.format, thumbnail: item?.thumbnail || data?.thumbnail }]);
  }, [contentId, data, queue, logger]);

  const handleShuffle = useCallback(() => {
    logger.info('detail.shuffle', { contentId });
    // Queue all children shuffled
    if (children.length > 0) {
      const shuffled = [...children].sort(() => Math.random() - 0.5);
      const items = shuffled.map(c => ({
        contentId: c.id || c.contentId,
        title: c.title,
        format: c.format,
        thumbnail: c.thumbnail || c.image,
      })).filter(c => c.contentId);
      queue.playNow(items);
    }
  }, [contentId, children, queue, logger]);

  const handleChildClick = useCallback((child) => {
    const childId = child.id || child.contentId;
    if (!childId) return;
    logger.info('detail.drill-down', { contentId: childId, title: child.title });
    navigate(`/media/view/${childId}`);
  }, [navigate, logger]);

  if (loading) {
    return (
      <div className="content-detail-view">
        <div className="content-detail-header">
          <button className="content-detail-back" onClick={handleBack}>&larr;</button>
        </div>
        <div className="content-detail-loading">Loading...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="content-detail-view">
        <div className="content-detail-header">
          <button className="content-detail-back" onClick={handleBack}>&larr;</button>
        </div>
        <div className="content-detail-error">{error || 'Item not found'}</div>
      </div>
    );
  }

  const heroImage = data.thumbnail || data.image || data.imageUrl || ContentDisplayUrl(contentId);
  const isContainer = children.length > 0;
  const capabilities = data.capabilities || [];

  return (
    <div className="content-detail-view">
      {/* Hero */}
      <div className="content-detail-hero" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="content-detail-hero-overlay">
          <button className="content-detail-back" onClick={handleBack}>&larr;</button>
        </div>
      </div>

      {/* Title Bar */}
      <div className="content-detail-title-bar">
        <h2 className="content-detail-title">{data.title}</h2>
        <div className="content-detail-meta">
          {data.source && <span className="source-badge">{data.source}</span>}
          {data.format && <span className={`format-badge format-badge--${data.format}`}>{data.format}</span>}
          {data.type && <span className="type-badge">{data.type}</span>}
          {data.duration && <span className="duration">{Math.round(data.duration / 60)}m</span>}
        </div>
        {(data.subtitle || data.metadata?.artist || data.metadata?.albumArtist) && (
          <div className="content-detail-subtitle">
            {data.subtitle || data.metadata?.artist || data.metadata?.albumArtist}
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="content-detail-actions">
        {capabilities.includes('playable') && (
          <button className="action-btn action-btn--primary" onClick={() => handlePlayNow(null)}>
            &#9654; Play
          </button>
        )}
        {isContainer && (
          <button className="action-btn action-btn--primary" onClick={() => {
            const items = children.map(c => ({
              contentId: c.id || c.contentId,
              title: c.title,
              format: c.format,
              thumbnail: c.thumbnail || c.image,
            })).filter(c => c.contentId);
            queue.playNow(items);
          }}>
            &#9654; Play All
          </button>
        )}
        {(capabilities.includes('playable') || isContainer) && (
          <>
            <button className="action-btn" onClick={() => handlePlayNext(null)}>&#10549; Next</button>
            <button className="action-btn" onClick={() => handleAddToQueue(null)}>+ Queue</button>
          </>
        )}
        {isContainer && (
          <button className="action-btn" onClick={handleShuffle}>&#8645; Shuffle</button>
        )}
        <CastButton contentId={contentId} className="action-btn" />
      </div>

      {/* Summary / Description */}
      {(data.metadata?.summary || data.metadata?.tagline) && (
        <div className="content-detail-summary">
          {data.metadata?.tagline && <p className="content-detail-tagline">{data.metadata.tagline}</p>}
          {data.metadata?.summary && <p>{data.metadata.summary}</p>}
        </div>
      )}

      {/* Children list (containers) */}
      {isContainer && (
        <div className="content-detail-children">
          {children.map((child, i) => {
            const childId = child.id || child.contentId;
            const childThumb = child.thumbnail || child.image || (childId ? ContentDisplayUrl(childId) : null);
            return (
              <div key={childId || i} className="content-detail-child-item">
                <div className="child-item-thumb" onClick={() => handleChildClick(child)}>
                  {childThumb && <img src={childThumb} alt="" />}
                </div>
                <div className="child-item-info" onClick={() => handleChildClick(child)}>
                  <div className="child-item-title">
                    {child.itemIndex !== undefined && <span className="child-item-index">{child.itemIndex}.</span>}
                    {child.title}
                  </div>
                  <div className="child-item-meta">
                    {child.type && <span className="type-badge">{child.type}</span>}
                    {child.duration && <span>{Math.round(child.duration / 60)}m</span>}
                    {child.artist && <span>{child.artist}</span>}
                  </div>
                  {child.watchProgress > 0 && (
                    <div className="child-item-progress">
                      <div className="child-item-progress-bar" style={{ width: `${child.watchProgress}%` }} />
                    </div>
                  )}
                </div>
                <div className="child-item-actions">
                  {child.play && <button onClick={(e) => { e.stopPropagation(); handlePlayNow(child); }} title="Play">&#9654;</button>}
                  {child.play && <button onClick={(e) => { e.stopPropagation(); handlePlayNext(child); }} title="Play Next">&#10549;</button>}
                  {child.play && <button onClick={(e) => { e.stopPropagation(); handleAddToQueue(child); }} title="Add to Queue">+</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ContentDetailView;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "feat(media): create ContentDetailView component with shell and child list"
```

---

### Task 4: Update ContentBrowser Click Behavior

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx:1-2, 225`

**Step 1: Add useNavigate import and change click handler**

Add `useNavigate` to imports at line 2:
```jsx
import { useNavigate } from 'react-router-dom';
```

Inside the component (after line 19), add:
```jsx
const navigate = useNavigate();
```

**Step 2: Change the info click handler**

Change line 225 from:
```jsx
<div className="search-result-info" onClick={() => item.isContainer ? handleDrillDown(item) : handlePlayNow(item)}>
```
to:
```jsx
<div className="search-result-info" onClick={() => {
  const id = resolveContentId(item);
  if (id) navigate(`/media/view/${id}`);
}}>
```

This makes clicking the info area navigate to the detail view for both containers AND leaves. The inline play/queue/next buttons remain for quick actions.

**Step 3: Verify in browser**

Run: Click a search result's title/info area
Expected: Browser navigates to `/media/view/{contentId}` and shows detail view
Run: Click a search result's play button
Expected: Item plays directly (unchanged behavior)

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "feat(media): navigate to detail view on search result click"
```

---

### Task 5: Add Detail View Styles

**Files:**
- Modify: `frontend/src/Apps/MediaApp.scss`

**Step 1: Add styles for ContentDetailView**

Append the following to `MediaApp.scss`:

```scss
/* ========== Content Detail View ========== */

.content-detail-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  background: #121212;
  color: #e0e0e0;
}

.content-detail-hero {
  position: relative;
  width: 100%;
  height: 200px;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;

  .content-detail-hero-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(18,18,18,1) 100%);
    display: flex;
    align-items: flex-start;
    padding: 12px;
  }
}

.content-detail-back {
  background: rgba(0,0,0,0.5);
  border: none;
  color: #fff;
  font-size: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover { background: rgba(255,255,255,0.2); }
}

.content-detail-loading,
.content-detail-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #888;
}

.content-detail-title-bar {
  padding: 0 16px 8px;

  .content-detail-title {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 4px;
    color: #fff;
  }

  .content-detail-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: #888;

    .duration { color: #aaa; }
  }

  .content-detail-subtitle {
    font-size: 14px;
    color: #aaa;
    margin-top: 4px;
  }
}

.content-detail-actions {
  display: flex;
  gap: 8px;
  padding: 8px 16px 16px;
  flex-wrap: wrap;

  .action-btn {
    background: #282828;
    border: 1px solid #333;
    color: #e0e0e0;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;

    &:hover { background: #333; border-color: #1db954; color: #fff; }

    &--primary {
      background: #1db954;
      border-color: #1db954;
      color: #000;
      font-weight: 600;

      &:hover { background: #1ed760; }
    }
  }
}

.content-detail-summary {
  padding: 0 16px 16px;
  font-size: 13px;
  line-height: 1.5;
  color: #aaa;

  .content-detail-tagline {
    font-style: italic;
    margin-bottom: 8px;
    color: #ccc;
  }

  p { margin: 0 0 8px; }
}

.content-detail-children {
  flex: 1;
  padding: 0 8px;
}

.content-detail-child-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;

  &:hover { background: #1a1a1a; }

  .child-item-thumb {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: 4px;
    overflow: hidden;
    background: #222;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  .child-item-info {
    flex: 1;
    min-width: 0;

    .child-item-title {
      font-size: 13px;
      color: #e0e0e0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      .child-item-index {
        color: #666;
        margin-right: 6px;
        font-variant-numeric: tabular-nums;
      }
    }

    .child-item-meta {
      display: flex;
      gap: 8px;
      font-size: 11px;
      color: #888;
      margin-top: 2px;
    }

    .child-item-progress {
      height: 3px;
      background: #333;
      border-radius: 2px;
      margin-top: 4px;
      overflow: hidden;

      .child-item-progress-bar {
        height: 100%;
        background: #1db954;
        border-radius: 2px;
      }
    }
  }

  .child-item-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;

    button {
      background: transparent;
      border: none;
      color: #888;
      font-size: 14px;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;

      &:hover { color: #1db954; background: #282828; }
    }
  }

  &:hover .child-item-actions { opacity: 1; }
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): add styles for content detail view"
```

---

### Task 6: Verify End-to-End Flow

**Step 1: Start dev server if not running**

```bash
ss -tlnp | grep 3112
# If not running:
cd /root/Code/DaylightStation && npm run dev &
```

**Step 2: Test search → detail → back flow**

1. Open `/media` in browser
2. Search for "star wars"
3. Click a result's title → should navigate to `/media/view/abs:...`
4. Verify hero image, title, metadata, action buttons render
5. Click back arrow → should return to search results with "star wars" still showing

**Step 3: Test container drill-down**

1. Search for a TV show or album
2. Click the result title → detail view with children list
3. Click a child item → navigates to child detail view
4. Browser back → returns to parent detail view

**Step 4: Test play/queue actions**

1. In detail view, click "Play" → item plays, miniplayer appears
2. Click "Queue" on a child → item added to queue
3. Click "Shuffle" on a container → all children queued in random order

**Step 5: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix(media): detail view integration fixes"
```

---

### Task 7: Handle Edge Cases

**Files:**
- Modify: `frontend/src/modules/Media/ContentDetailView.jsx`

**Step 1: Handle items without info API support**

Some sources may not have a `/info/` endpoint. If the info call returns 404, fall back to the list API only:

In `useContentDetail.js`, update the catch to try list-only:

```javascript
try {
  const infoRes = await fetch(`/api/v1/info/${source}/${localId}`);
  // ... existing code
} catch (err) {
  // Fallback: try list API directly (for containers without info support)
  try {
    const listRes = await fetch(`/api/v1/list/${source}/${localId}`);
    if (listRes.ok) {
      const listData = await listRes.json();
      setData({
        contentId: id,
        title: listData.title || localId,
        thumbnail: listData.image,
        source,
        capabilities: ['listable'],
      });
      setChildren(listData.items || []);
      logger().info('detail.fallback-list', { contentId: id, childCount: (listData.items || []).length });
      return;
    }
  } catch { /* fall through to error */ }

  logger().error('detail.fetch-failed', { contentId: id, error: err.message });
  setError(err.message);
  setData(null);
  setChildren([]);
}
```

**Step 2: Handle content IDs with slashes in route params**

Content IDs like `readalong:scripture/ot/nirv/1` have slashes after the colon. The route `view/:contentId/*` captures the first segment in `:contentId` and the rest in `*`. The component already reconstructs this (see Task 3, line with `const contentId = wildcard ? ...`).

Verify this works by testing a scripture search result click.

**Step 3: Commit**

```bash
git add frontend/src/hooks/media/useContentDetail.js frontend/src/modules/Media/ContentDetailView.jsx
git commit -m "fix(media): handle edge cases in detail view (fallback, slash IDs)"
```
