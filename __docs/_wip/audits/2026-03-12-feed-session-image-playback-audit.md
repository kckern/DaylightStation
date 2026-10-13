# Feed Session Audit: Image Loading Failures & Playback Breakage

**Date:** 2026-03-12
**Session:** `2026-03-12T16-29-38.jsonl` (717 events, 6.5 min, Android Chrome 145, 360×701)
**Report:** User reported "many images failed to load" and "audio cards failed to play"

---

## Executive Summary

Two independent bugs were confirmed:

1. **P0 — All audio/video playback is broken**: `contentId` is dropped in the play callback chain, so PersistentPlayer never mounts, playerRef stays null, and nothing plays. This affects every feed source with a `player` section (Plex, Immich video, Readalong, YouTube native).

2. **P2 — YouTube hero images appear to fail but actually render**: The `YouTubeHero` component renders hero images via a plain `<img>` with no `onLoad`/`onError` handlers, so there is no telemetry confirming load. The images likely loaded fine visually — this is a logging instrumentation gap, not a real failure.

3. **P3 — Source icon failures**: `thestranger.com` favicon failed 3× (triplicate logging from 3 cards sharing the same source).

---

## Finding 1: contentId Dropped in Play Chain (P0)

### Root Cause

`PlayerSection.jsx:15` calls `onPlay?.(item)` but does **not** pass `contentId`, even though it's available in `data.contentId`.

The full broken chain:

| Layer | File:Line | Expected | Actual |
|-------|-----------|----------|--------|
| PlayerSection | `PlayerSection.jsx:15` | `onPlay(item, data.contentId)` | `onPlay(item)` |
| Scroll | `Scroll.jsx:137-140` | `handlePlay(item, contentId)` | `handlePlay(item)` |
| Scroll→Context | `Scroll.jsx:140` | `contextPlay(item, contentId)` | `contextPlay(item)` |
| FeedPlayerContext | `FeedPlayerContext.jsx:160` | `play(item, contentId)` | `play(item, undefined)` |
| Reducer | `FeedPlayerContext.jsx:64-76` | `activeMedia: { item, contentId: 'plex:482029' }` | `activeMedia: { item, contentId: undefined }` |
| PersistentPlayer | `PersistentPlayer.jsx:13` | `{ contentId }` → mount Player | `null` → return null |
| usePlaybackObserver | `usePlaybackObserver.js:34` | poll Player handle | `playerRef.current is null` |

### Evidence from Session Log

```
16:35:42.219  feed-player  play {id: "plex:482029", title: "How to Notice and Name Emotions"}
16:35:42.228  feed-player  observer active — starting 500ms poll
16:35:42.228  feed-player  observer active — starting 500ms poll  ← logged twice (duplicate observer)
16:35:42.729  feed-player  poll: playerRef.current is null
16:35:42.730  feed-player  poll: playerRef.current is null
```

The `player.play` reducer log would show `contentId: undefined` (not logged explicitly, but deduced from PersistentPlayer not mounting).

### Impact

**All playable feed content is broken:**
- Plex videos/audio (e.g., "How to Notice and Name Emotions")
- Immich videos
- Readalong audio (scripture audio)
- YouTube native player (falls back to iframe embed, so YouTube "works" via embed but native player is broken)

Backend correctly builds `{ type: 'player', data: { contentId: 'plex:482029' } }` sections. Frontend `PlayerSection` has `data.contentId` available. The value is simply never passed up the callback chain.

### Fix

**PlayerSection.jsx:15** — pass contentId through the callback:
```jsx
// Before
onPlay?.(item);

// After
onPlay?.(item, data.contentId);
```

**Scroll.jsx:137-140** — forward contentId to context:
```jsx
// Before
const handlePlay = useCallback((item) => {
  if (!item) { feedLog.player('clear activeMedia'); contextStop(); return; }
  feedLog.player('play', { id: item.id, title: item.title, source: item.source });
  contextPlay(item);
}, [contextPlay, contextStop]);

// After
const handlePlay = useCallback((item, contentId) => {
  if (!item) { feedLog.player('clear activeMedia'); contextStop(); return; }
  feedLog.player('play', { id: item.id, title: item.title, source: item.source, contentId });
  contextPlay(item, contentId);
}, [contextPlay, contextStop]);
```

### Secondary Issue: Duplicate Observer Activation

The log shows `observer active — starting 500ms poll` logged twice at the same timestamp. This suggests `usePlaybackObserver` is called twice or the effect fires twice. Investigate whether `activeMedia` is being set in a way that triggers redundant effect runs (e.g., React StrictMode double-invocation, or two `usePlaybackObserver` consumers).

---

## Finding 2: YouTube Hero Image Logging Gap (P2)

### Root Cause

`DetailView.jsx` has two hero image render paths:

1. **Non-YouTube items** (line 186-207): Uses `<img onLoad={...} onError={...}>` — fully instrumented. Fires `detail hero loaded`, `detail hero fallback to proxy`, or `detail hero hidden`.

2. **YouTube items** via `YouTubeHero` (line 305): Uses `<img src={heroImage} alt="">` — **no onLoad/onError handlers**. The `detail hero reset` event fires (line 35 in the shared path), but success/failure is never reported.

### Evidence from Session Log

4 YouTube items opened in detail view:
- `freshrss:..00064c652270bbd3` — "Let God prevail" (ytimg.com thumbnail)
- `freshrss:..00064c629f070bd6` — "Iran Update + Kai Schwemmer..." (ytimg.com thumbnail)
- `youtube:3hZNjc1VSBA` — "Can you review my code?" (ytimg.com thumbnail)
- `freshrss:..00064c6662ac712e` — "Wait… There's a DOUBLE Chiasm..." (ytimg.com thumbnail)

All 4 show `detail hero reset` but no `detail hero loaded`. These images likely loaded fine visually — the `<img>` tag works, it's just not instrumented.

### Impact

- **User-facing:** Likely none — images probably rendered fine
- **Observability:** Blind spot. If YouTube thumbnails genuinely fail to load in the future, we won't know from logs.
- **Misleading audit data:** Makes it look like 4 images failed when they probably succeeded.

### Fix

Add `onLoad`/`onError` handlers to the `YouTubeHero` `<img>` tags (lines 305 and 330), matching the pattern used for non-YouTube hero images.

---

## Finding 3: Source Icon Failures (P3)

### Root Cause

`/api/v1/feed/icon?url=https://www.thestranger.com` failed 3 times. The icon resolution uses Google's Favicon API as a fallback. Either:
- thestranger.com blocks favicon CDN requests
- Google Favicon API returned an error/redirect
- The frontend `<img>` `onError` fired but the image may have been a valid 1×1 or redirect

### Evidence

```
16:29:43.687  feed-image  source icon failed  {url: "/api/v1/feed/icon?url=https%3A%2F%2Fwww.thestranger.com"}
16:29:43.688  feed-image  source icon failed  (same)
16:29:43.689  feed-image  source icon failed  (same)
```

Three Stranger articles in the feed, each card independently trying to load the same icon and failing.

### Impact

Minor — source icons are small decorative elements. Cards still render.

### Fix

- Consider caching failed icon URLs client-side to avoid triplicate requests
- Investigate whether the Google Favicon API returns a valid image for thestranger.com

---

## Session Health Summary

| Metric | Value | Assessment |
|--------|-------|------------|
| Total events | 717 | Normal |
| Session duration | 6.5 min | Normal |
| Scroll smoothness | 100% (25/26 sessions), 97% (1/26) | Excellent |
| Errors/warnings | 0 | Good |
| Images loaded (list) | 36/36 | All succeeded |
| Images loaded (hero) | 13/17 set, 4 uninstrumented | See Finding 2 |
| Items with no image | 6 (by design) | Expected |
| Playback attempts | 1 | All failed (Finding 1) |
| Source icon failures | 3 (1 unique URL) | Minor |

---

## Recommended Fix Priority

1. **Fix contentId passthrough** (Finding 1) — All playback broken. Simple 2-file fix.
2. **Add YouTubeHero image instrumentation** (Finding 2) — Logging blind spot.
3. **Client-side icon failure caching** (Finding 3) — Nice-to-have.
