# Feed UX Session Logging — Design

**Date:** 2026-02-25

---

## Goal

Instrument the Feed/Scroll module with overkill diagnostics so any UX issue can be debugged from a JSONL session log file alone. Post-mortem replay is the primary use case.

## Decisions

- **Extend feedLog.js** — single entry point, all events route through existing facade
- **Session logging at FeedApp level** — `sessionLog: true` propagated via `configureLogger`
- **All new events at debug level** — promote to info after stabilization
- **Capture everything** — no sampling/throttling initially
- **Card visibility: enter/exit with dwell time** — IntersectionObserver per card
- **Backend logging included** — media proxy, image proxy, detail resolution, YouTube pipeline

---

## Frontend Changes

### 1. FeedApp.jsx — Enable Session Logging

Add `configureLogger({ context: { app: 'feed', sessionLog: true } })` in `FeedLayout` useEffect. Same pattern as FitnessApp/AdminApp. Cleanup resets `sessionLog: false` on unmount.

### 2. feedLog.js — New Categories

Add five new categories to the existing facade:

| Category | Purpose |
|----------|---------|
| `viewport` | Card enter/exit viewport, dwell time |
| `timing` | Load durations (images, API, first-frame) |
| `interaction` | Clicks, external links, idle |
| `session` | Visibility changes, session start/end summary |
| `resolution` | Video stream quality, dimensions |

### 3. Scroll.jsx — Scroll & Viewport Tracking

**Scroll activity:** Attach scroll listener to container. On every scroll event, log:
- `feed-scroll` with `{ scrollY, direction, velocity, timestamp }`
- Velocity = delta Y / delta time since last event

**Card visibility (enter/exit + dwell):** IntersectionObserver on each card element.
- On enter: record `enterTime` in a Map keyed by item ID
- On exit: compute `dwellMs = now - enterTime`, log `feed-viewport` with `{ id, title, source, dwellMs, scrollY }`
- On enter: log `feed-viewport` with `{ id, title, source, action: 'enter', scrollY }`
- Threshold: 0.5 (card 50% visible counts as "visible")

**Scroll restoration:** Log scroll Y before detail open and after restore, with delta.

### 4. FeedCard.jsx / HeroImage — Image Timing

Wrap existing image load phases with `performance.now()`:
- On thumbnail start: record `t0`
- On thumbnail load/error: log `feed-timing` with `{ phase: 'thumbnail', durationMs, src }`
- On full-res start: record `t1`
- On full-res load/error: log `feed-timing` with `{ phase: 'full', durationMs, src }`
- On proxy fallback load/error: log `feed-timing` with `{ phase: 'proxy', durationMs, src }`
- Image failures already logged via `feedLog.image` — add timing data to those events

### 5. FeedCard.jsx / CardYouTubePlayer — YouTube Fallback Chain

Log each step explicitly:
- `feed-resolution` `{ step: 'native-attempt', videoId, quality }`
- `feed-resolution` `{ step: 'native-success', videoId, hasVideo, hasAudio, mode }` (split vs combined)
- `feed-resolution` `{ step: 'native-fail', videoId, error }`
- `feed-resolution` `{ step: 'embed-fallback', videoId, embedUrl }`

### 6. DetailView.jsx — Detail Lifecycle & External Links

**Detail open/close cycle:**
- `feed-detail` `{ action: 'open', id, scrollYBefore }` (already partially logged)
- `feed-timing` `{ phase: 'detail-sections', durationMs, sectionCount }` — wrap section fetch
- `feed-detail` `{ action: 'close', id, scrollYRestored, scrollYDelta }`

**External links:**
- `feed-interaction` `{ action: 'external-link', url, id, title, source }`

**YouTube in detail:**
- Same resolution chain logging as CardYouTubePlayer

### 7. DetailView.jsx — Hero Image Timing

Same pattern as FeedCard HeroImage — wrap phase transitions with `performance.now()`, log duration per phase.

### 8. FeedPlayer.jsx — Media Lifecycle

**Mount/load:**
- `feed-timing` `{ phase: 'player-mount', mode, hasVideo, hasAudio }`
- On `loadedmetadata`: `feed-resolution` `{ width, height, duration, src, mode }`
- On `canplay`: `feed-timing` `{ phase: 'canplay', durationMs }` (from mount)
- On first `playing`: `feed-timing` `{ phase: 'first-frame', durationMs }` (from mount)

**Errors:**
- On `error`: `feed-player` `{ action: 'error', mode, src, errorCode, errorMessage }` (already partially exists)

**State changes:**
- Play/pause/seek/speed already logged via feedLog.player — no changes needed

### 9. FeedPlayerContext.jsx — Volume/Speed/Mute

Already well-logged. No changes needed.

### 10. FeedApp.jsx — Session & Visibility

**Page visibility:**
- `visibilitychange` listener: `feed-session` `{ action: 'visibility', state: 'hidden'|'visible' }`

**Session summary on unmount:**
- `feed-session` `{ action: 'end', durationMs, itemsViewed, detailsOpened, externalLinks }`

### 11. useMasonryLayout.js — Already Logged

Masonry events already comprehensive. No changes needed.

---

## Backend Changes

### 12. feed.mjs Router — Request Logging

Add structured logging to endpoints that currently have none:

| Endpoint | Log Event | Data |
|----------|-----------|------|
| `GET /feed/icon` | `feed.icon.request` / `feed.icon.resolved` | `{ url, source (reddit/youtube/favicon), durationMs, cached }` |
| `GET /feed/image` | `feed.image.request` / `feed.image.resolved` | `{ url, contentType, size, durationMs, fallbackUsed }` |
| `GET /feed/detail/:itemId` | `feed.detail.request` / `feed.detail.resolved` | `{ itemId, quality, sectionCount, durationMs, source }` |
| `GET /feed/readable` | `feed.readable.request` / `feed.readable.resolved` | `{ url, wordCount, hasOgImage, durationMs }` |
| `GET /feed/scroll` | `feed.scroll.request` / `feed.scroll.resolved` | `{ cursor, count, sources, durationMs }` |
| `GET /feed/scroll/item/:slug` | `feed.deeplink.request` / `feed.deeplink.resolved` | `{ slug, found, durationMs }` |

### 13. WebContentAdapter.mjs — Media Resolution Logging

Add success logging (currently only logs failures):

| Method | Log Event | Data |
|--------|-----------|------|
| `resolveIcon()` | `webcontent.icon.resolved` | `{ url, type (reddit/youtube/google), cached, durationMs }` |
| `proxyImage()` | `webcontent.image.proxied` | `{ url, contentType, size, durationMs }` |
| `extractReadableContent()` | `webcontent.readable.extracted` | `{ url, wordCount, hasOgImage, durationMs }` |

### 14. FeedAssemblyService.mjs — Detail Resolution Logging

| Method | Log Event | Data |
|--------|-----------|------|
| `getDetail()` | `feed.detail.resolved` | `{ itemId, adapter, sectionCount, durationMs, fallbackToArticle }` |
| `getItemWithDetail()` | `feed.deeplink.resolved` | `{ slug, found, cached, durationMs }` |

### 15. YouTubeContentPlugin — Enrichment Logging

| Event | Log Event | Data |
|-------|-----------|------|
| Detection | `feed.youtube.detected` | `{ videoId, isShorts, url }` |
| Enrichment | `feed.youtube.enriched` | `{ videoId, embedUrl, thumbnailUrl }` |

---

## Files Modified

### Frontend (7 files)
1. `frontend/src/Apps/FeedApp.jsx` — session logging init, visibility listener, session summary
2. `frontend/src/modules/Feed/Scroll/feedLog.js` — add 5 categories
3. `frontend/src/modules/Feed/Scroll/Scroll.jsx` — scroll tracking, viewport observer, scroll restoration logging
4. `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx` — image timing, YouTube fallback chain
5. `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx` — detail timing, external links, hero timing
6. `frontend/src/modules/Feed/players/FeedPlayer.jsx` — media lifecycle timing, resolution, first-frame
7. `frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx` — interaction logging (play/pause/seek from minibar)

### Backend (5 files)
8. `backend/src/4_api/v1/routers/feed.mjs` — request/response logging on all endpoints
9. `backend/src/1_adapters/feed/WebContentAdapter.mjs` — success logging for icon/image/readable
10. `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` — detail resolution logging
11. `backend/src/1_adapters/feed/plugins/youtube.mjs` — detection/enrichment logging
12. `backend/src/3_applications/feed/services/FeedContentService.mjs` — passthrough timing

---

## JSONL Session Story (Example)

```
feed-session    start           { device, userAgent, viewport }
feed-scroll     fetchInitial    { cursor, durationMs: 180, count: 24 }
feed-viewport   enter           { id: 'reddit:abc', scrollY: 0 }
feed-viewport   enter           { id: 'yt:xyz', scrollY: 0 }
feed-timing     thumbnail       { id: 'reddit:abc', durationMs: 45, src: '...' }
feed-timing     full            { id: 'reddit:abc', durationMs: 220, src: '...' }
feed-scroll     activity        { scrollY: 400, direction: 'down', velocity: 320 }
feed-viewport   exit            { id: 'reddit:abc', dwellMs: 3200 }
feed-viewport   enter           { id: 'rss:def', scrollY: 400 }
feed-interaction click          { id: 'yt:xyz', target: 'play-button' }
feed-detail     open            { id: 'yt:xyz', scrollYBefore: 400 }
feed-timing     detail-sections { id: 'yt:xyz', durationMs: 95, sectionCount: 3 }
feed-resolution native-attempt  { videoId: 'abc123', quality: '720' }
feed-resolution native-fail     { videoId: 'abc123', error: 'No streams' }
feed-resolution embed-fallback  { videoId: 'abc123', embedUrl: '...' }
feed-timing     player-mount    { mode: 'embed', videoId: 'abc123' }
feed-detail     close           { id: 'yt:xyz', scrollYRestored: 400, delta: 0 }
feed-session    visibility      { state: 'hidden' }
feed-session    visibility      { state: 'visible' }
feed-session    end             { durationMs: 45000, itemsViewed: 8, detailsOpened: 1 }
```

---

## Non-Goals

- No UI for viewing session logs (use JSONL files directly)
- No sampling/throttling (capture everything at debug, optimize later)
- No changes to existing event names (backward-compatible)
