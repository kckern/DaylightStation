# Feed UX Session Logging — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instrument the Feed/Scroll module with comprehensive session logging so any UX issue can be debugged from a JSONL file alone.

**Architecture:** Extend existing `feedLog.js` facade with 5 new categories. Enable session logging at `FeedApp.jsx` level (same pattern as FitnessApp). Add timing, viewport tracking, scroll activity, and media resolution logging throughout. Add structured logging to backend feed endpoints.

**Tech Stack:** Existing logging framework (`getLogger`, `configureLogger`), IntersectionObserver, `performance.now()`, Web API events.

---

### Task 1: Enable Session Logging in FeedApp.jsx

**Files:**
- Modify: `frontend/src/Apps/FeedApp.jsx`

**Step 1: Add session logging init**

In `FeedApp.jsx`, change the logger creation and add `configureLogger` import + useEffect:

```javascript
// Change line 13:
import getLogger, { configure as configureLogger } from '../lib/logging/Logger.js';

// Change line 16 — add sessionLog + app context:
const log = getLogger().child({ app: 'feed', module: 'feed-app', sessionLog: true });
```

In `FeedLayout`, add a useEffect right after `useFeedPWA()` (after line 48):

```javascript
useEffect(() => {
  configureLogger({ context: { app: 'feed', sessionLog: true } });
  log.info('feed-session.start', {
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
  });
  return () => {
    log.info('feed-session.end');
    configureLogger({ context: { sessionLog: false } });
  };
}, []);
```

**Step 2: Add page visibility tracking**

In `FeedLayout`, add after the session logging useEffect:

```javascript
useEffect(() => {
  const handler = () => {
    log.debug('feed-session.visibility', { state: document.visibilityState });
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, []);
```

**Step 3: Verify session logging works**

Run: `npm run dev` (if not already running)
Open browser to feed app, check backend `media/logs/feed/` for a new JSONL file.
Expected: File exists with `session-log.start` and `feed-session.start` events.

**Step 4: Commit**

```bash
git add frontend/src/Apps/FeedApp.jsx
git commit -m "feat(feed): enable session logging in FeedApp"
```

---

### Task 2: Extend feedLog.js with New Categories

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/feedLog.js`

**Step 1: Add 5 new categories**

Replace the entire file:

```javascript
/**
 * Feed scroll diagnostic logger.
 *
 * Uses the DaylightStation logging framework with a child logger
 * scoped to the feed-scroll component. Events are emitted at debug
 * level with structured data and routed through all configured
 * transports (console, WebSocket, session file).
 *
 * Enable debug output:  window.DAYLIGHT_LOG_LEVEL = 'debug'
 *                    or configure({ level: 'debug' })
 *
 * Categories: scroll, image, player, dismiss, detail, nav, assembly,
 *             masonry, viewport, timing, interaction, session, resolution
 */

import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'feed-scroll' });
  return _logger;
}

function emit(category, detail, data) {
  const payload = typeof data === 'object' && data !== null ? { ...data } : {};
  if (typeof data === 'string') payload.info = data;
  payload.detail = detail;
  logger().debug(`feed-${category}`, payload);
}

export const feedLog = {
  scroll:      (detail, data) => emit('scroll', detail, data),
  image:       (detail, data) => emit('image', detail, data),
  player:      (detail, data) => emit('player', detail, data),
  dismiss:     (detail, data) => emit('dismiss', detail, data),
  detail:      (detail, data) => emit('detail', detail, data),
  nav:         (detail, data) => emit('nav', detail, data),
  assembly:    (detail, data) => emit('assembly', detail, data),
  masonry:     (detail, data) => emit('masonry', detail, data),
  viewport:    (detail, data) => emit('viewport', detail, data),
  timing:      (detail, data) => emit('timing', detail, data),
  interaction: (detail, data) => emit('interaction', detail, data),
  session:     (detail, data) => emit('session', detail, data),
  resolution:  (detail, data) => emit('resolution', detail, data),
};
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/feedLog.js
git commit -m "feat(feed): add viewport/timing/interaction/session/resolution log categories"
```

---

### Task 3: Scroll Activity & Viewport Tracking in Scroll.jsx

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`

**Step 1: Add scroll activity tracking**

Add a useEffect after the existing `observerRef` infinite scroll effect (after line 232). This logs scroll position, direction, and velocity on every scroll event:

```javascript
// Scroll activity tracking — logs every scroll event at debug level
useEffect(() => {
  const container = window;
  let lastY = window.scrollY;
  let lastTime = performance.now();

  const handler = () => {
    const now = performance.now();
    const y = window.scrollY;
    const dy = y - lastY;
    const dt = now - lastTime;
    const velocity = dt > 0 ? Math.round((dy / dt) * 1000) : 0; // px/s
    feedLog.scroll('activity', {
      scrollY: Math.round(y),
      direction: dy > 0 ? 'down' : dy < 0 ? 'up' : 'idle',
      velocity,
      dt: Math.round(dt),
    });
    lastY = y;
    lastTime = now;
  };

  container.addEventListener('scroll', handler, { passive: true });
  return () => container.removeEventListener('scroll', handler);
}, []);
```

**Step 2: Add card viewport tracking (enter/exit with dwell time)**

Add a useEffect that creates an IntersectionObserver for all visible cards. Place after the scroll activity effect:

```javascript
// Card viewport tracking — enter/exit with dwell time
const enterTimesRef = useRef(new Map());
const viewportObserverRef = useRef(null);

useEffect(() => {
  viewportObserverRef.current = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = entry.target.dataset.itemId;
        if (!id) continue;
        if (entry.isIntersecting) {
          enterTimesRef.current.set(id, performance.now());
          feedLog.viewport('enter', { id, scrollY: Math.round(window.scrollY) });
        } else if (enterTimesRef.current.has(id)) {
          const dwellMs = Math.round(performance.now() - enterTimesRef.current.get(id));
          enterTimesRef.current.delete(id);
          feedLog.viewport('exit', { id, dwellMs, scrollY: Math.round(window.scrollY) });
        }
      }
    },
    { threshold: 0.5 }
  );
  return () => viewportObserverRef.current?.disconnect();
}, []);
```

**Step 3: Wire viewport observer to ScrollCard**

In the `ScrollCard` component, add a `data-item-id` attribute and observe/unobserve via the viewport observer. Modify `ScrollCard` to accept `viewportObserver`:

Add `viewportObserver` prop to ScrollCard and wire it:

```javascript
function ScrollCard({ item, colors, onDismiss, onPlay, onClick, style, itemRef, viewportObserver }) {
  const wrapperRef = useRef(null);
  const touchRef = useRef(null);

  const setRefs = useCallback((node) => {
    // Unobserve old node
    if (wrapperRef.current && viewportObserver) {
      viewportObserver.unobserve(wrapperRef.current);
    }
    wrapperRef.current = node;
    if (itemRef) itemRef(node);
    // Observe new node
    if (node && viewportObserver) {
      viewportObserver.observe(node);
    }
  }, [itemRef, viewportObserver]);
```

And add `data-item-id` to the wrapper div:

```jsx
<div
  ref={setRefs}
  className="scroll-item-wrapper"
  data-item-id={item.id}
  style={style}
  ...
```

In the render, pass `viewportObserverRef.current`:

```jsx
<ScrollCard
  key={item.id || i}
  item={item}
  ...
  viewportObserver={viewportObserverRef.current}
/>
```

**Step 4: Enhance scroll restoration logging**

In the `handleCardClick` callback (around line 366), add timing context:

```javascript
const handleCardClick = useCallback((e, item) => {
  e.preventDefault();
  savedScrollRef.current = window.scrollY;
  feedLog.nav('card click', { scrollY: Math.round(window.scrollY), id: item.id, title: item.title, source: item.source, tier: item.tier });
  navigate(`/feed/scroll/${encodeItemId(item.id)}`);
}, [navigate]);
```

In the scroll restore effect (around line 326), log the delta:

```javascript
useEffect(() => {
  if (!urlSlug) {
    const savedY = savedScrollRef.current;
    feedLog.nav('back to list', { savedY, itemCount: items.length });
    setDetailData(null);
    setDetailLoading(false);
    setDeepLinkedItem(null);
    prevSlugRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo(0, savedY);
      requestAnimationFrame(() => {
        feedLog.nav('scroll restored', { targetY: savedY, actualY: Math.round(window.scrollY), delta: Math.round(window.scrollY - savedY) });
      });
    });
  }
}, [urlSlug]);
```

**Step 5: Add fetch timing to fetchItems**

Wrap the DaylightAPI call with `performance.now()`:

In `fetchItems`, before the API call (after line 170):

```javascript
const fetchStart = performance.now();
```

After result received (after line 172, before processing):

```javascript
feedLog.timing('scroll-fetch', { durationMs: Math.round(performance.now() - fetchStart), append, cursor, count: (result.items || []).length });
```

And for detail fetches — in the URL slug effect (around line 286):

Before `DaylightAPI` call for in-batch detail:
```javascript
const detailStart = performance.now();
```

In `.then()`:
```javascript
feedLog.timing('detail-sections', { durationMs: Math.round(performance.now() - detailStart), id: fullId, sectionCount: result.sections?.length || 0 });
```

Same pattern for deep-link fetch.

**Step 6: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "feat(feed): add scroll activity, viewport tracking, and fetch timing"
```

---

### Task 4: Image Load Timing in FeedCard.jsx

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx`

**Step 1: Add timing to HeroImage**

In `HeroImage`, add a ref to track load start time. After the existing state declarations (line 30):

```javascript
const loadStartRef = useRef(performance.now());
```

Reset it when src changes — in the existing useEffect (line 31-35), add:

```javascript
loadStartRef.current = performance.now();
```

Add an `onLoad` handler to the `<img>` element (around line 88):

```javascript
onLoad={() => {
  const durationMs = Math.round(performance.now() - loadStartRef.current);
  feedLog.timing('card-image', { phase, durationMs, src: imgSrc });
}}
```

In the full-res preload `img.onload` (line 41), add timing:

```javascript
img.onload = () => {
  const durationMs = Math.round(performance.now() - loadStartRef.current);
  feedLog.timing('card-image-preload', { phase: 'full', durationMs, src });
  setImgSrc(src);
  setPhase('original');
  loadStartRef.current = performance.now(); // reset for display timing
  requestAnimationFrame(() => setFullLoaded(true));
};
```

In `handleError`, add timing:

```javascript
const handleError = () => {
  const durationMs = Math.round(performance.now() - loadStartRef.current);
  if (phase === 'thumbnail' && src && src !== thumbnail) {
    feedLog.image('card hero thumbnail failed', { thumbnail, src, durationMs });
    setPhase('original');
    setImgSrc(src);
    setFullLoaded(true);
    loadStartRef.current = performance.now();
  } else if ((phase === 'original' || phase === 'thumbnail') && proxied) {
    feedLog.image('card hero fallback to proxy', { original: src, proxy: proxied, durationMs });
    setPhase('proxy');
    setImgSrc(proxied);
    setFullLoaded(true);
    loadStartRef.current = performance.now();
  } else {
    feedLog.image('card hero hidden', { src, durationMs });
    setPhase('hidden');
  }
};
```

**Step 2: Add YouTube fallback chain logging to CardYouTubePlayer**

In `CardYouTubePlayer` (line 332), add logging to the fetch and fallback:

In the useEffect fetch (around line 337):

```javascript
useEffect(() => {
  const fetchStart = performance.now();
  const params = new URLSearchParams();
  params.set('quality', '720p');
  if (item.meta) params.set('meta', JSON.stringify(item.meta));

  feedLog.resolution('native-attempt', { videoId: item.meta?.videoId, quality: '720p' });

  DaylightAPI(`/api/v1/feed/detail/${encodeURIComponent(item.id)}?${params}`)
    .then(result => {
      const durationMs = Math.round(performance.now() - fetchStart);
      const section = result?.sections?.find(s => s.type === 'player' && s.data?.provider === 'youtube');
      if (section) {
        feedLog.resolution('native-resolved', {
          videoId: item.meta?.videoId,
          hasVideoUrl: !!section.data?.videoUrl,
          hasAudioUrl: !!section.data?.audioUrl,
          hasUrl: !!section.data?.url,
          mode: (section.data?.videoUrl && section.data?.audioUrl) ? 'split' : 'combined',
          durationMs,
        });
        setPlayerData(section.data);
      } else {
        feedLog.resolution('native-no-player-section', { videoId: item.meta?.videoId, durationMs, sectionCount: result?.sections?.length || 0 });
      }
      setFetchDone(true);
    })
    .catch((err) => {
      feedLog.resolution('native-fetch-error', { videoId: item.meta?.videoId, error: err.message });
      setFetchDone(true);
    });
}, [item.id, item.meta]);
```

Change the `handleStreamError`:

```javascript
const handleStreamError = useCallback(() => {
  feedLog.resolution('embed-fallback', { videoId: item.meta?.videoId, reason: 'stream-error' });
  setUseEmbed(true);
}, [item.meta?.videoId]);
```

Log when embed renders (at the iframe return, around line 370):

Add before the iframe return:

```javascript
// Log embed render
if (!playerData || useEmbed || !(playerData.videoUrl || playerData.url)) {
  feedLog.resolution('embed-render', { videoId: item.meta?.videoId, useEmbed, hasPlayerData: !!playerData });
}
```

Actually, cleaner to log once when the component decides embed. The current structure returns early, so add to the `handlePlay` in `FeedCard`:

```javascript
const handlePlay = (e) => {
  e.stopPropagation();
  if (canPlayInline) {
    feedLog.interaction('inline-play', { id: item.id, contentType: item.contentType, videoId: item.meta?.videoId });
    setPlayingInline(true);
  } else {
    feedLog.interaction('remote-play', { id: item.id, contentType: item.contentType });
    onPlay?.(item);
  }
};
```

**Step 3: Add `useRef` to imports**

Add `useRef` to the import line at the top of FeedCard.jsx:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx
git commit -m "feat(feed): add image timing and YouTube fallback chain logging"
```

---

### Task 5: Detail View Logging in DetailView.jsx

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx`

**Step 1: Add image timing to detail hero**

Add `useRef` to the import (already imported). Add a load start ref after existing refs (around line 24):

```javascript
const heroLoadStartRef = useRef(performance.now());
```

Reset on hero image change — in the existing reset useEffect (line 29-33):

```javascript
useEffect(() => {
  feedLog.image('detail hero reset', { heroImage, itemId: item.id });
  setImageLoaded(false);
  setImagePhase('original');
  heroLoadStartRef.current = performance.now();
}, [heroImage]);
```

In the `onLoad` handler of the hero `<img>` (line 182):

```javascript
onLoad={() => {
  const durationMs = Math.round(performance.now() - heroLoadStartRef.current);
  feedLog.image('detail hero loaded', { src: imgSrc, phase: imagePhase, durationMs });
  feedLog.timing('detail-hero-image', { phase: imagePhase, durationMs, src: imgSrc });
  setImageLoaded(true);
}}
```

In the `onError` handler (line 183-190):

```javascript
onError={() => {
  const durationMs = Math.round(performance.now() - heroLoadStartRef.current);
  if (imagePhase === 'original' && proxyImage(heroImage)) {
    feedLog.image('detail hero fallback to proxy', { original: heroImage, proxy: proxyImage(heroImage), durationMs });
    setImagePhase('proxy');
    heroLoadStartRef.current = performance.now();
  } else {
    feedLog.image('detail hero hidden', { heroImage, phase: imagePhase, durationMs });
    setImagePhase('hidden');
  }
}}
```

**Step 2: Add external link tracking**

Find the "open in browser" link (line 203). Wrap it with an onClick:

```jsx
<a
  href={item.meta?.paywall && item.meta?.paywallProxy ? item.meta.paywallProxy + item.link : item.link}
  target="_blank"
  rel="noopener noreferrer"
  className="detail-open-link"
  onClick={() => {
    feedLog.interaction('external-link', {
      id: item.id,
      title: item.title,
      source: item.source,
      url: item.link,
      paywall: !!item.meta?.paywall,
    });
  }}
>
```

**Step 3: Add YouTube fallback chain logging to YouTubeHero**

In `YouTubeHero`, add logging for play button click:

```javascript
<button
  onClick={() => {
    feedLog.interaction('youtube-play', { id: item.id, videoId: item.meta?.videoId });
    setYtPlaying(true);
  }}
```

Log when native player renders vs embed fallback. After `sectionsLoaded` check (around line 295):

```javascript
if (playerSection && !useEmbed) {
  const data = playerSection.data;
  if (data.videoUrl || data.url) {
    feedLog.resolution('detail-native-render', {
      videoId: item.meta?.videoId,
      mode: (data.videoUrl && data.audioUrl) ? 'split' : 'combined',
    });
    return (
      <FeedPlayer ...
```

And before the embed iframe return (around line 309):

```javascript
feedLog.resolution('detail-embed-render', { videoId: item.meta?.videoId, useEmbed, hasPlayerSection: !!playerSection });
```

Add the handleStreamError logging:

```javascript
const handleStreamError = useCallback(() => {
  feedLog.resolution('detail-embed-fallback', { videoId: item.meta?.videoId, reason: 'stream-error' });
  setUseEmbed(true);
}, [item.meta?.videoId]);
```

**Step 4: Log sticky header visibility changes**

In the existing sticky header animation effect (around line 62), add:

```javascript
useEffect(() => {
  const el = stickyRef.current;
  if (!el) return;
  if (stickyInitRef.current) { stickyInitRef.current = false; return; }
  feedLog.nav(stickyVisible ? 'sticky-visible' : 'sticky-hidden', { id: item.id });
  ...
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/detail/DetailView.jsx
git commit -m "feat(feed): add detail view image timing, external link, and YouTube logging"
```

---

### Task 6: FeedPlayer Media Lifecycle Logging

**Files:**
- Modify: `frontend/src/modules/Feed/players/FeedPlayer.jsx`

**Step 1: Add timing and resolution logging**

Add a mount time ref after existing refs (around line 55):

```javascript
const mountTimeRef = useRef(performance.now());
const firstFrameLoggedRef = useRef(false);
```

Reset on playerData change:

```javascript
useEffect(() => {
  mountTimeRef.current = performance.now();
  firstFrameLoggedRef.current = false;
}, [playerData]);
```

For combined mode, add event handlers to the `<video>` element (around line 203-213):

```jsx
<video
  ref={videoRef}
  src={playerData.url}
  autoPlay
  playsInline
  onPlay={handlePlay}
  onPause={handlePause}
  onLoadedMetadata={() => {
    const v = videoRef.current;
    if (!v) return;
    log.debug('feedPlayer.loadedMetadata', {
      mode: 'combined',
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
      src: playerData.url,
    });
  }}
  onCanPlay={() => {
    log.debug('feedPlayer.canplay', {
      mode: 'combined',
      durationMs: Math.round(performance.now() - mountTimeRef.current),
    });
  }}
  onPlaying={() => {
    if (!firstFrameLoggedRef.current) {
      firstFrameLoggedRef.current = true;
      log.info('feedPlayer.firstFrame', {
        mode: 'combined',
        durationMs: Math.round(performance.now() - mountTimeRef.current),
      });
    }
  }}
  onError={() => { log.error('feedPlayer.error', { mode: 'combined', src: playerData.url }); onError?.('stream-error'); }}
  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
/>
```

For split mode (RemuxPlayer), update the `onPlaybackMetrics` callback:

```javascript
onPlaybackMetrics={({ isPaused }) => {
  if (typeof isPaused === 'boolean') {
    const wasPlaying = playing;
    setPlaying(!isPaused);
    if (!isPaused && !wasPlaying && !firstFrameLoggedRef.current) {
      firstFrameLoggedRef.current = true;
      log.info('feedPlayer.firstFrame', {
        mode: 'split',
        durationMs: Math.round(performance.now() - mountTimeRef.current),
      });
    }
  }
}}
```

**Step 2: Log stream URLs and resolution data in mount effect**

Enhance the existing mount log (line 64-73):

```javascript
useEffect(() => {
  log.info('feedPlayer.mount', {
    mode: isSplit ? 'split' : 'combined',
    hasVideo: !!playerData.videoUrl,
    hasAudio: !!playerData.audioUrl,
    hasUrl: !!playerData.url,
    provider: playerData.provider,
    videoUrl: playerData.videoUrl || null,
    audioUrl: playerData.audioUrl || null,
    url: playerData.url || null,
  });
  return () => log.info('feedPlayer.unmount');
}, []);
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/players/FeedPlayer.jsx
git commit -m "feat(feed): add media lifecycle timing, resolution, and first-frame logging"
```

---

### Task 7: Backend Feed Router Logging

**Files:**
- Modify: `backend/src/4_api/v1/routers/feed.mjs`

**Step 1: Add request/response logging to feed endpoints**

Add timing to the `/scroll` endpoint (around line 246):

```javascript
router.get('/scroll', asyncHandler(async (req, res) => {
  const start = Date.now();
  const username = getUsername();
  const { cursor, limit, focus, source, nocache, filter } = req.query;

  const result = await feedAssemblyService.getNextBatch(username, {
    limit: limit ? Number(limit) : undefined,
    cursor,
    focus: focus || null,
    sources: source ? source.split(',').map(s => s.trim()) : null,
    nocache: nocache === '1',
    filter: filter || null,
  });

  logger.info?.('feed.scroll.served', {
    durationMs: Date.now() - start,
    cursor: cursor || null,
    itemCount: result.items?.length || 0,
    hasMore: result.hasMore,
  });

  res.json(result);
}));
```

Add timing to `/detail/:itemId` (around line 335):

```javascript
router.get('/detail/:itemId', asyncHandler(async (req, res) => {
  const start = Date.now();
  const { itemId } = req.params;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });

  const username = getUsername();
  let meta = {};
  if (req.query.meta) {
    try { meta = JSON.parse(req.query.meta); } catch { /* ignore */ }
  }
  if (req.query.link) meta.link = req.query.link;

  const quality = req.query.quality || undefined;
  const result = await feedAssemblyService.getDetail(itemId, meta, username, { quality });

  logger.info?.('feed.detail.served', {
    durationMs: Date.now() - start,
    itemId,
    quality: quality || null,
    sectionCount: result?.sections?.length || 0,
    found: !!result,
  });

  if (!result) return res.status(404).json({ error: 'No detail available' });
  res.json(result);
}));
```

Add timing to `/scroll/item/:slug` (around line 264):

```javascript
router.get('/scroll/item/:slug', asyncHandler(async (req, res) => {
  const start = Date.now();
  const { slug } = req.params;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  let itemId;
  try {
    let s = slug.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    itemId = Buffer.from(s, 'base64').toString('utf-8');
  } catch {
    return res.status(400).json({ error: 'Invalid slug' });
  }

  const username = getUsername();
  const result = await feedAssemblyService.getItemWithDetail(itemId, username);

  logger.info?.('feed.deeplink.served', {
    durationMs: Date.now() - start,
    slug,
    itemId,
    found: !!result,
  });

  if (!result) return res.status(404).json({ error: 'Item not found or expired' });
  res.json(result);
}));
```

Add logging to `/icon` (around line 357):

```javascript
router.get('/icon', asyncHandler(async (req, res) => {
  const start = Date.now();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  const result = await feedContentService.resolveIcon(url);

  logger.debug?.('feed.icon.served', {
    durationMs: Date.now() - start,
    url,
    found: !!result,
    contentType: result?.contentType || null,
  });

  if (!result) return res.status(404).json({ error: 'Icon not found' });
  res.set('Content-Type', result.contentType);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(result.data);
}));
```

Add logging to `/image` (around line 373):

```javascript
router.get('/image', asyncHandler(async (req, res) => {
  const start = Date.now();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  const result = await feedContentService.proxyImage(url);

  logger.debug?.('feed.image.served', {
    durationMs: Date.now() - start,
    url,
    contentType: result.contentType,
    size: result.data?.length || 0,
    isFallback: result.contentType === 'image/svg+xml',
  });

  res.set('Content-Type', result.contentType);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(result.data);
}));
```

Add logging to `/readable` (around line 387):

```javascript
router.get('/readable', asyncHandler(async (req, res) => {
  const start = Date.now();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  try {
    const result = await feedContentService.extractReadableContent(url);
    logger.debug?.('feed.readable.served', {
      durationMs: Date.now() - start,
      url,
      wordCount: result.wordCount,
      hasOgImage: !!result.ogImage,
    });
    res.json(result);
  } catch (err) {
    logger.warn?.('feed.readable.error', { url, error: err.message, durationMs: Date.now() - start });
    res.status(502).json({ error: err.message || 'Failed to extract content' });
  }
}));
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/feed.mjs
git commit -m "feat(feed): add request timing and structured logging to all feed endpoints"
```

---

### Task 8: Backend WebContentAdapter Logging

**Files:**
- Modify: `backend/src/1_adapters/feed/WebContentAdapter.mjs`

**Step 1: Add success logging to resolveIcon**

In `resolveIcon()` (line 52-74), add timing and success logging:

After line 53 (cache check), add cache hit log:

```javascript
if (cached && Date.now() - cached.time < ICON_TTL) {
  this.#logger.debug?.('webcontent.icon.cacheHit', { url });
  return { data: cached.data, contentType: cached.contentType };
}
```

After line 58, add timing start:

```javascript
const start = Date.now();
```

After line 68 (successful cache set), add:

```javascript
this.#logger.debug?.('webcontent.icon.resolved', {
  url,
  contentType,
  size: buffer.length,
  durationMs: Date.now() - start,
});
```

**Step 2: Add success logging to proxyImage**

In `proxyImage()` (line 176-191), add timing:

After line 177 (`try {`), add:

```javascript
const start = Date.now();
```

After line 185 (successful buffer creation), add before return:

```javascript
this.#logger.debug?.('webcontent.image.proxied', {
  url,
  contentType,
  size: buffer.length,
  durationMs: Date.now() - start,
});
```

For fallback case (line 182), add:

```javascript
if (!res.ok) {
  this.#logger.debug?.('webcontent.image.fallback', { url, status: res.status, durationMs: Date.now() - start });
  return { data: PLACEHOLDER_SVG, contentType: 'image/svg+xml' };
}
```

**Step 3: Add logging to extractReadableContent**

In `extractReadableContent()` (line 204-218), add timing:

```javascript
async extractReadableContent(url) {
  const start = Date.now();
  const pageRes = await fetch(url, {
    ...
  });

  if (!pageRes.ok) {
    this.#logger.warn?.('webcontent.readable.upstream-error', { url, status: pageRes.status, durationMs: Date.now() - start });
    const err = new Error(`Upstream returned ${pageRes.status}`);
    err.upstreamStatus = pageRes.status;
    throw err;
  }

  const html = await pageRes.text();
  const result = this.#parseHtml(html);

  this.#logger.debug?.('webcontent.readable.extracted', {
    url,
    wordCount: result.wordCount,
    hasOgImage: !!result.ogImage,
    durationMs: Date.now() - start,
  });

  return result;
}
```

**Step 4: Commit**

```bash
git add backend/src/1_adapters/feed/WebContentAdapter.mjs
git commit -m "feat(feed): add success/timing logging to WebContentAdapter"
```

---

### Task 9: Backend FeedAssemblyService & YouTube Plugin Logging

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `backend/src/1_adapters/feed/plugins/youtube.mjs`

**Step 1: Add detail resolution logging to FeedAssemblyService**

In `getDetail()` (around line 223), add timing:

```javascript
async getDetail(itemId, itemMeta, username, opts = {}) {
  const start = Date.now();
  const colonIdx = itemId.indexOf(':');
  if (colonIdx === -1) return null;

  const source = itemId.slice(0, colonIdx);
  const localId = itemId.slice(colonIdx + 1);

  const adapter = this.#sourceAdapters.get(source);
  if (adapter && typeof adapter.getDetail === 'function') {
    const result = await adapter.getDetail(localId, itemMeta || {}, username, opts);
    if (result) {
      this.#logger.debug?.('feed.detail.resolved', {
        itemId, source, adapter: true,
        sectionCount: result.sections?.length || 0,
        durationMs: Date.now() - start,
      });
      return result;
    }
  }

  if (itemMeta?.link) {
    const result = await this.#getArticleDetail(itemMeta.link);
    this.#logger.debug?.('feed.detail.resolved', {
      itemId, source, adapter: false, fallbackToArticle: true,
      sectionCount: result?.sections?.length || 0,
      durationMs: Date.now() - start,
    });
    return result;
  }

  this.#logger.debug?.('feed.detail.notFound', { itemId, source, durationMs: Date.now() - start });
  return null;
}
```

In `getItemWithDetail()` (around line 251), add logging:

```javascript
async getItemWithDetail(itemId, username) {
  const item = this.#itemCache.get(itemId);
  if (!item) {
    this.#logger.debug?.('feed.deeplink.cacheMiss', { itemId });
    return null;
  }

  this.#logger.debug?.('feed.deeplink.cacheHit', { itemId });
  const detail = await this.getDetail(itemId, item.meta || {}, username);
  return {
    item,
    sections: detail?.sections || [],
    ogImage: detail?.ogImage || null,
    ogDescription: detail?.ogDescription || null,
  };
}
```

Note: FeedAssemblyService needs a `#logger` field. Check if it exists — if the constructor accepts `logger`, use `this.#logger`. If not, add it.

**Step 2: Add detection/enrichment logging to YouTubeContentPlugin**

In `youtube.mjs`, the plugin doesn't have a logger. Add one via constructor:

```javascript
export class YouTubeContentPlugin extends IContentPlugin {
  #logger;

  constructor({ logger = console } = {}) {
    super();
    this.#logger = logger;
  }

  get contentType() { return 'youtube'; }

  detect(item) {
    if (!item.link) return false;
    const match = YT_URL_PATTERN.test(item.link);
    if (match) {
      this.#logger.debug?.('feed.youtube.detected', {
        videoId: item.link.match(YT_URL_PATTERN)?.[1],
        isShorts: YT_SHORTS_PATTERN.test(item.link),
        url: item.link,
      });
    }
    return match;
  }

  enrich(item) {
    const match = item.link?.match(YT_URL_PATTERN);
    if (!match) return {};

    const videoId = match[1];
    const isShort = YT_SHORTS_PATTERN.test(item.link);

    this.#logger.debug?.('feed.youtube.enriched', {
      videoId,
      isShort,
      thumbnailUrl: !item.image ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null,
    });

    // ... rest unchanged
```

Note: Check the bootstrap code where `YouTubeContentPlugin` is instantiated to pass the logger. This is likely in an `app.mjs` or composition root file.

**Step 3: Commit**

```bash
git add backend/src/3_applications/feed/services/FeedAssemblyService.mjs backend/src/1_adapters/feed/plugins/youtube.mjs
git commit -m "feat(feed): add detail resolution and YouTube enrichment logging to backend"
```

---

### Task 10: Verify End-to-End Session Logging

**Step 1: Start dev server**

```bash
# Check if already running
lsof -i :3111
# If not: npm run dev
```

**Step 2: Open feed app in browser, browse through items**

1. Open feed scroll view
2. Scroll through several cards
3. Click into a detail view
4. Click "open in browser" on an item with a link
5. Play a YouTube video (if available)
6. Navigate back to scroll list

**Step 3: Check JSONL file**

```bash
ls -la media/logs/feed/
cat media/logs/feed/<latest>.jsonl | head -50
```

Expected: JSONL file with events covering the full session:
- `session-log.start`
- `feed-session.start`
- `feed-scroll` (fetchInitial, activity)
- `feed-timing` (scroll-fetch, card-image)
- `feed-viewport` (enter/exit with dwellMs)
- `feed-detail` (open, loaded)
- `feed-interaction` (external-link, inline-play)
- `feed-resolution` (native-attempt, native-resolved or embed-fallback)
- `feed-timing` (detail-sections, first-frame)

**Step 4: Check backend logs**

```bash
tail -30 backend/dev.log
```

Expected: `feed.scroll.served`, `feed.detail.served`, `feed.image.served` events with timing.

**Step 5: Final commit (if any cleanup needed)**

```bash
git commit -m "feat(feed): complete feed UX session logging implementation"
```
