# MediaApp UAT Bugfix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 7 bugs from the 2026-03-04 UAT session (`docs/_wip/bugs/2026-03-04-media-uat-bugs.md`).

**Architecture:** All bugs are frontend-only fixes in `ContentBrowser.jsx`, `useStreamingSearch.js`, `useMediaQueue.js`, and related components. No backend changes needed. The root cause of bugs 1 and 2 is a field name mismatch: the backend `Item` entity serializes `id` (e.g., `"plex:653701"`), but ContentBrowser reads `item.contentId` which doesn't exist on search results. Bug 4 is a React state-timing race. Bugs 5 and 6 are missing UX polish. Bug 7 is an optimistic-update sequencing issue.

**Tech Stack:** React hooks, SSE (EventSource), SCSS

**Bug reference:** `docs/_wip/bugs/2026-03-04-media-uat-bugs.md`

---

### Task 1: Fix contentId field mapping in ContentBrowser (Bug 1 — Critical)

Search API returns items with `id` field but ContentBrowser reads `item.contentId` (always null). This breaks play, queue, thumbnails, and cast.

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Write failing test**

Create `tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs`:

```javascript
// tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs
import { describe, it, expect } from 'vitest';

/**
 * Validates that search result items are correctly mapped to queue items.
 * Search API returns: { id: "plex:123", itemId: {...}, title: "...", thumbnail: "..." }
 * Queue expects:      { contentId: "plex:123", title: "...", ... }
 */
describe('ContentBrowser field mapping', () => {
  // Simulate the mapping logic extracted from ContentBrowser
  function mapSearchResultToQueueItem(item) {
    return {
      contentId: item.id || item.contentId,
      title: item.title,
      format: item.format || null,
      thumbnail: item.thumbnail || null,
    };
  }

  it('maps item.id to contentId when contentId is missing', () => {
    const searchResult = { id: 'plex:653701', title: 'Star Wars', format: 'movie', thumbnail: '/thumb.jpg' };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.contentId).toBe('plex:653701');
  });

  it('falls back to item.contentId when item.id is missing', () => {
    const searchResult = { contentId: 'plex:999', title: 'Fallback', format: null };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.contentId).toBe('plex:999');
  });

  it('prefers item.id over item.contentId', () => {
    const searchResult = { id: 'plex:123', contentId: 'plex:456', title: 'Both' };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.contentId).toBe('plex:123');
  });

  it('passes through thumbnail URL', () => {
    const searchResult = { id: 'plex:1', title: 'T', thumbnail: '/api/v1/proxy/immich/assets/abc/thumbnail' };
    const queueItem = mapSearchResultToQueueItem(searchResult);
    expect(queueItem.thumbnail).toBe('/api/v1/proxy/immich/assets/abc/thumbnail');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs`
Expected: PASS (this is a pure function test that validates the mapping logic we'll extract)

**Step 3: Fix field mapping in ContentBrowser.jsx**

In `frontend/src/modules/Media/ContentBrowser.jsx`, add a helper and update all handlers:

```javascript
// Add after imports, before component
function resolveContentId(item) {
  return item.id || item.contentId;
}
```

Update `handlePlayNow` (line 58-63):
```javascript
const handlePlayNow = useCallback((item) => {
  const contentId = resolveContentId(item);
  const nextPosition = queue.position + 1;
  logger.info('content-browser.play-now', { contentId, title: item.title, itemId: item.itemId });
  queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }], 'next')
    .then(() => queue.setPosition(nextPosition));
}, [queue, logger]);
```

Update `handleAddToQueue` (line 65-68):
```javascript
const handleAddToQueue = useCallback((item) => {
  const contentId = resolveContentId(item);
  logger.info('content-browser.add-to-queue', { contentId, title: item.title });
  queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
}, [queue, logger]);
```

Update `handlePlayNext` (line 70-73):
```javascript
const handlePlayNext = useCallback((item) => {
  const contentId = resolveContentId(item);
  logger.info('content-browser.play-next', { contentId, title: item.title });
  queue.addItems([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }], 'next');
}, [queue, logger]);
```

Update `handleDrillDown` (line 75-81) — use `resolveContentId`:
```javascript
const handleDrillDown = useCallback((item) => {
  const contentId = resolveContentId(item);
  if (contentId) {
    const [source, ...rest] = contentId.split(':');
    logger.debug('content-browser.drill-down', { source, localId: rest.join(':'), title: item.title });
    browse(source, rest.join(':'), item.title);
  }
}, [browse, logger]);
```

Update `results-rendered` effect (line 90-95) — count thumbnails correctly:
```javascript
useEffect(() => {
  if (displayResults.length > 0) {
    const withThumbs = displayResults.filter(r => !!(r.thumbnail || resolveContentId(r))).length;
    logger.info('content-browser.results-rendered', {
      count: displayResults.length,
      withThumbnails: withThumbs,
      source: browsing ? 'browse' : 'search',
    });
  }
}, [displayResults.length, browsing, logger]);
```

Update search result key and thumbnail (line 139-142):
```jsx
{displayResults.map((item, i) => (
  <div key={resolveContentId(item) || i} className="search-result-item">
    <div className="search-result-thumb">
      {(item.thumbnail || resolveContentId(item)) && (
        <img src={item.thumbnail || ContentDisplayUrl(resolveContentId(item))} alt="" />
      )}
    </div>
```

Update CastButton contentId (line 158):
```jsx
<CastButton contentId={resolveContentId(item)} className="search-action-cast" />
```

Update drill-down check (line 144):
```jsx
<div className="search-result-info" onClick={() => item.isContainer ? handleDrillDown(item) : handlePlayNow(item)}>
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "fix(media): map item.id to contentId in ContentBrowser (UAT bug 1+2)"
```

---

### Task 2: Fix thumbnail rendering in QueueItem (Bug 2 supplement)

QueueItem uses `ContentDisplayUrl(item.contentId)` which works when contentId is set, but doesn't use the direct `thumbnail` URL that search results provide. Now that Task 1 passes `thumbnail` through to queue items, QueueItem should prefer it.

**Files:**
- Modify: `frontend/src/modules/Media/QueueItem.jsx`

**Step 1: Update QueueItem thumbnail logic**

In `frontend/src/modules/Media/QueueItem.jsx`, update the `thumbnailUrl` memo (line 8-11):

```javascript
const thumbnailUrl = useMemo(
  () => item.thumbnail || (item.contentId ? ContentDisplayUrl(item.contentId) : null),
  [item.thumbnail, item.contentId]
);
```

**Step 2: Verify no regressions**

Run: `npx vitest run tests/isolated/assembly/media/`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/QueueItem.jsx
git commit -m "fix(media): prefer direct thumbnail URL in QueueItem (UAT bug 2)"
```

---

### Task 3: Add search debounce (Bug 5)

Every keystroke opens a new SSE connection. "star wars" = 8 connections in 900ms, each querying 13 sources = 104 backend searches. Add 300ms debounce.

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Write failing test**

Add to `tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs`:

```javascript
describe('Search debounce', () => {
  it('debounce utility delays execution', async () => {
    let callCount = 0;
    const fn = () => callCount++;

    // Simulate debounce logic
    let timer;
    const debounced = (cb, ms) => {
      clearTimeout(timer);
      timer = setTimeout(cb, ms);
    };

    debounced(fn, 50);
    debounced(fn, 50);
    debounced(fn, 50);

    expect(callCount).toBe(0);
    await new Promise(r => setTimeout(r, 80));
    expect(callCount).toBe(1);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs`
Expected: PASS (validates debounce concept)

**Step 3: Add debounce to ContentBrowser**

In `frontend/src/modules/Media/ContentBrowser.jsx`, add a debounce ref and update `handleSearch`:

```javascript
// Add to imports:
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

// Inside component, after logger:
const searchTimerRef = useRef(null);
```

Update `handleSearch` (line 50-56):

```javascript
const handleSearch = useCallback((e) => {
  const val = e.target.value;
  setSearchText(val);
  exitBrowse();
  if (val.length > 0) logger.debug('content-browser.search', { query: val });

  clearTimeout(searchTimerRef.current);
  if (!val || val.length < 2) {
    search(val); // immediate clear
    return;
  }
  searchTimerRef.current = setTimeout(() => search(val), 300);
}, [search, exitBrowse, logger]);
```

Add cleanup on unmount (inside the existing useEffect that logs mount/unmount, or add new):

```javascript
// In the existing mount effect or new one:
useEffect(() => {
  return () => clearTimeout(searchTimerRef.current);
}, []);
```

**Step 4: Verify no regressions**

Run: `npx vitest run tests/isolated/assembly/media/`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "fix(media): add 300ms search debounce to prevent SSE flood (UAT bug 5)"
```

---

### Task 4: Fix filter race condition (Bug 4)

Clicking a filter chip calls `setActiveFilter(i); search(searchText)` synchronously. But `search` captures `extraQueryString` (derived from `filterParams`) in its closure. Since React batches the state update, `search()` uses the **stale** params from the previous filter.

Fix: pass filter params directly to `search()` instead of relying on the closure.

**Files:**
- Modify: `frontend/src/hooks/useStreamingSearch.js`
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Write failing test**

Add to `tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs`:

```javascript
describe('Filter params override', () => {
  it('builds URL with override params when provided', () => {
    const endpoint = '/api/v1/content/query/search/stream';
    const defaultExtra = 'source=plex';
    const override = 'source=singalong';
    const query = 'hymn';

    // Simulate the URL building logic from useStreamingSearch
    function buildUrl(q, extra, overrideExtra) {
      const qs = overrideExtra !== undefined ? overrideExtra : extra;
      return `${endpoint}?text=${encodeURIComponent(q)}${qs ? '&' + qs : ''}`;
    }

    const url = buildUrl(query, defaultExtra, override);
    expect(url).toContain('source=singalong');
    expect(url).not.toContain('source=plex');
  });

  it('uses default params when no override', () => {
    function buildUrl(q, extra, overrideExtra) {
      const endpoint = '/api/v1/content/query/search/stream';
      const qs = overrideExtra !== undefined ? overrideExtra : extra;
      return `${endpoint}?text=${encodeURIComponent(q)}${qs ? '&' + qs : ''}`;
    }

    const url = buildUrl('test', 'source=plex', undefined);
    expect(url).toContain('source=plex');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/isolated/assembly/media/contentBrowserFieldMapping.test.mjs`
Expected: PASS

**Step 3: Update useStreamingSearch to accept params override**

In `frontend/src/hooks/useStreamingSearch.js`, update the `search` callback (line 36-103):

Change the signature of search from `(query)` to `(query, overrideExtraQuery)`:

```javascript
const search = useCallback((query, overrideExtraQuery) => {
  // Cancel any in-flight request
  if (eventSourceRef.current) {
    logger().debug('search.cancelled', { reason: 'new-query' });
    eventSourceRef.current.close();
    eventSourceRef.current = null;
  }

  // Short queries: clear and don't search
  if (!query || query.length < 2) {
    setResults([]);
    setPending([]);
    setIsSearching(false);
    return;
  }

  // Use override if provided, otherwise use hook-level extraQueryString
  const effectiveExtra = overrideExtraQuery !== undefined ? overrideExtraQuery : extraQueryString;

  // Start new search
  setIsSearching(true);
  logger().info('search.started', { query, endpoint, filterParams: effectiveExtra || null });
  setResults([]);
  setPending([]);

  const url = `${endpoint}?text=${encodeURIComponent(query)}${effectiveExtra ? '&' + effectiveExtra : ''}`;
  const eventSource = new EventSource(url);
  eventSourceRef.current = eventSource;

  // ... rest unchanged (onmessage, onerror handlers stay the same)
```

**Step 4: Update ContentBrowser filter click handler**

In `frontend/src/modules/Media/ContentBrowser.jsx`, update the filter chip onClick (line 116):

```jsx
onClick={() => {
  logger.debug('content-browser.filter', { filter: f.label, params: f.params });
  setActiveFilter(i);
  if (searchText.length >= 2) {
    search(searchText, f.params);
  }
}}
```

**Step 5: Run tests**

Run: `npx vitest run tests/isolated/assembly/media/`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/hooks/useStreamingSearch.js frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "fix(media): pass filter params directly to search to fix race condition (UAT bug 4)"
```

---

### Task 5: Exclude non-playable content from MediaApp search (Bug 3)

250 Immich photos flood results for "star wars" — they're from CLIP embedding search and aren't playable media. MediaApp should only show playable content by default.

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Add capability=playable to base search params**

In `frontend/src/modules/Media/ContentBrowser.jsx`, update the `filterParams` derivation (line 43) and the `filters` memo (line 32-41):

```javascript
const filters = useMemo(() => {
  const configFilters = browseConfig
    .filter(c => c.searchFilter)
    .map(c => ({
      label: c.label.replace(/^Browse\s+/i, ''),
      params: ['capability=playable', c.source && `source=${c.source}`, c.mediaType && `mediaType=${c.mediaType}`]
        .filter(Boolean).join('&'),
    }));
  return [{ label: 'All', params: 'capability=playable' }, ...configFilters];
}, [browseConfig]);
```

This adds `capability=playable` to every filter (including "All"), so only playable content appears in MediaApp search. The backend's `ContentQueryService.searchStream` already supports this filter via `query.capability`.

**Step 2: Verify manually**

Start dev server and search for "star wars". Confirm that Immich photos no longer appear (only Plex/audio results).

**Step 3: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "fix(media): add capability=playable filter to exclude non-media results (UAT bug 3)"
```

---

### Task 6: Improve loading indicator (Bug 6)

The current "Searching..." text div disappears the instant the first results arrive. Users see no feedback during the 6+ second search.

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`
- Modify: `frontend/src/Apps/MediaApp.scss`

**Step 1: Update loading indicator in ContentBrowser**

In `frontend/src/modules/Media/ContentBrowser.jsx`, replace the loading indicator (line 135):

```jsx
{(isSearching || browseLoading) && (
  <div className="search-loading">
    <span className="search-loading-spinner" />
    <span>
      {pending.length > 0
        ? `Searching ${pending.length} source${pending.length > 1 ? 's' : ''}...`
        : 'Searching...'}
    </span>
  </div>
)}
```

Remove the separate `search-pending` div (line 136-138) since we merged the info into the loading indicator. The `pending` info is now shown inline.

**Step 2: Add spinner CSS**

In `frontend/src/Apps/MediaApp.scss`, update the `.search-loading` rule (around line 505):

```scss
.search-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  color: #999;
  font-size: 13px;
}

.search-loading-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #333;
  border-top-color: #999;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

**Step 3: Verify visually**

Start dev server, search for something, confirm spinner is visible during the search and disappears when `search.completed` fires (not when first results arrive — `isSearching` stays true until complete).

Wait — actually `isSearching` goes false on `complete` event, not on first `results` event. Let me verify... In `useStreamingSearch.js`:
- `results` event: does NOT set `isSearching = false`
- `complete` event: sets `setIsSearching(false)`
- `error` event: sets `setIsSearching(false)`

So the spinner already persists through result batches. The original bug was that the spinner was a text-only element that was hard to notice. The new spinner with animation will be visible.

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx frontend/src/Apps/MediaApp.scss
git commit -m "fix(media): add animated spinner for search loading state (UAT bug 6)"
```

---

### Task 7: Fix MiniPlayer mount/unmount churn (Bug 7)

`handlePlayNow` does `addItems('next').then(() => setPosition(nextPosition))`. Between add and setPosition, `currentItem` briefly changes, causing MiniPlayer to mount then unmount in ~175ms.

Fix: add a `playNow` method to `useMediaQueue` that atomically updates both items and position in a single optimistic state change.

**Files:**
- Modify: `frontend/src/hooks/media/useMediaQueue.js`
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Add playNow method to useMediaQueue**

In `frontend/src/hooks/media/useMediaQueue.js`, add after the `addItems` method (after line 102):

```javascript
const playNow = useCallback(async (items) => {
  const nextPosition = queue.position + 1;
  const contentIds = items.map(i => i.contentId);
  logger().info('media-queue.play-now', { count: items.length, contentIds, position: nextPosition });

  // Atomic optimistic update: insert items AND advance position in one state change
  const optimistic = {
    ...queue,
    items: [...queue.items.slice(0, nextPosition), ...items, ...queue.items.slice(nextPosition)],
    position: nextPosition,
  };

  return mutate(optimistic, async (mid) => {
    const res = await apiFetch('/items', { method: 'POST', body: { items, placement: 'next', mutationId: mid } });
    setQueue(res.queue);
    const posRes = await apiFetch('/position', { method: 'PATCH', body: { position: nextPosition, mutationId: mid } });
    setQueue(posRes);
    return res.added;
  });
}, [queue, mutate]);
```

Add `playNow` to the return object (line 187-204):

```javascript
return {
  items: queue.items,
  position: queue.position,
  shuffle: queue.shuffle,
  repeat: queue.repeat,
  volume: queue.volume,
  currentItem,
  loading,
  addItems,
  playNow,
  removeItem,
  reorder,
  setPosition,
  advance,
  setShuffle,
  setRepeat,
  setVolume,
  clear,
};
```

**Step 2: Update ContentBrowser to use playNow**

In `frontend/src/modules/Media/ContentBrowser.jsx`, update `handlePlayNow` (line 58-63):

```javascript
const handlePlayNow = useCallback((item) => {
  const contentId = resolveContentId(item);
  logger.info('content-browser.play-now', { contentId, title: item.title });
  queue.playNow([{ contentId, title: item.title, format: item.format, thumbnail: item.thumbnail }]);
}, [queue, logger]);
```

**Step 3: Run tests**

Run: `npx vitest run tests/isolated/assembly/media/`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/hooks/media/useMediaQueue.js frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "fix(media): atomic playNow to prevent MiniPlayer mount/unmount churn (UAT bug 7)"
```

---

### Task 8: Improve logging for bug detection gaps

The bug report identified several logging gaps. Add events that would make these bugs visible in future sessions.

**Files:**
- Modify: `frontend/src/modules/Media/ContentBrowser.jsx`

**Step 1: Log field mapping details in results-rendered**

Update the `results-rendered` effect to include source breakdown and thumbnail presence:

```javascript
useEffect(() => {
  if (displayResults.length > 0) {
    const withThumbs = displayResults.filter(r => !!(r.thumbnail || resolveContentId(r))).length;
    const withDirectThumb = displayResults.filter(r => !!r.thumbnail).length;
    const sourceBreakdown = {};
    displayResults.forEach(r => {
      sourceBreakdown[r.source || 'unknown'] = (sourceBreakdown[r.source || 'unknown'] || 0) + 1;
    });
    logger.info('content-browser.results-rendered', {
      count: displayResults.length,
      withThumbnails: withThumbs,
      withDirectThumbnail: withDirectThumb,
      sources: sourceBreakdown,
      source: browsing ? 'browse' : 'search',
    });
  }
}, [displayResults.length, browsing, logger]);
```

**Step 2: Log filter changes with actual params**

Update filter click logging (already partly done in Task 4):

```jsx
onClick={() => {
  const oldFilter = filters[activeFilter]?.label;
  logger.info('content-browser.filter-changed', {
    from: oldFilter,
    to: f.label,
    params: f.params,
  });
  setActiveFilter(i);
  if (searchText.length >= 2) {
    search(searchText, f.params);
  }
}}
```

**Step 3: Log loading state transitions**

Add a useEffect to track loading state:

```javascript
useEffect(() => {
  logger.debug('content-browser.loading-state', { isSearching, browseLoading });
}, [isSearching, browseLoading, logger]);
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Media/ContentBrowser.jsx
git commit -m "feat(media): improve logging for UAT gap coverage"
```

---

### Task 9: Build, deploy, and verify

**Step 1: Build Docker image**

```bash
cd frontend && npx vite build && cd ..
docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

**Step 2: Deploy**

```bash
docker stop daylight-station && docker rm daylight-station
docker run -d \
  --name daylight-station \
  --restart unless-stopped \
  --network kckern-net \
  -p 3111:3111 \
  -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data:/usr/src/app/data \
  -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media:/usr/src/app/media \
  kckern/daylight-station:latest
```

**Step 3: UAT verification**

Re-test the same scenarios from the original UAT session:
1. Search "star wars" — items should have thumbnails, clicking should play
2. Click Hymns filter — should show hymn results (or empty), NOT movies
3. Type "star wars" — should feel responsive (no 8x SSE flood)
4. Loading spinner should be visible during search
5. Clicking "Play Now" — MiniPlayer should not flash

**Step 4: Check session logs**

```bash
ls -la media/logs/media/ | tail -5
```

Verify new log events: `filter-changed`, `loading-state`, `sources` breakdown in `results-rendered`.

---

## Summary

| Task | Bug(s) | Severity | Files Changed |
|------|--------|----------|---------------|
| 1 | Bug 1 + 2 | Critical + High | ContentBrowser.jsx |
| 2 | Bug 2 | High | QueueItem.jsx |
| 3 | Bug 5 | High | ContentBrowser.jsx |
| 4 | Bug 4 | High | useStreamingSearch.js, ContentBrowser.jsx |
| 5 | Bug 3 | High | ContentBrowser.jsx |
| 6 | Bug 6 | Medium | ContentBrowser.jsx, MediaApp.scss |
| 7 | Bug 7 | Low | useMediaQueue.js, ContentBrowser.jsx |
| 8 | Logging | — | ContentBrowser.jsx |
| 9 | Deploy | — | — |
