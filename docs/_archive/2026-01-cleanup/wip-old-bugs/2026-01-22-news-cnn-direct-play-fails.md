# Bug Report: Direct Play news/cnn Fails in Dev, Works in Prod

**Date Discovered:** 2026-01-22  
**Severity:** High  
**Status:** Open  
**Component:** Frontend - TV App / Player / Local File Playback  
**Test File:** `tests/runtime/tv-app/multi-item-bug-investigation.mjs`

---

## Summary

Direct playback of local media files via URL parameter (`tv?play=news/cnn`) fails in localhost but works correctly in production.

- **Production:** Video loads with source URL and is ready to play
- **Localhost:** No video element created, spinner stuck

---

## Steps to Reproduce

### Manual Testing - Localhost (Bug)
1. Navigate to http://localhost:3111/tv?play=news/cnn
2. Wait for page to load

**Expected:** Video player loads with CNN news content  
**Actual:** Loading spinner, no video element

### Manual Testing - Production (Working)
1. Navigate to https://daylightlocal.kckern.net/tv?play=news/cnn
2. Wait for page to load

**Result:** Video player loads correctly with video source

### Automated Testing
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
node tests/runtime/tv-app/multi-item-bug-investigation.mjs
```

---

## Comparison Data

| Metric | Localhost (Bug) | Production (Working) |
|--------|-----------------|---------------------|
| **Player Components** | 1 | 2 |
| **Video Elements** | 0 ❌ | 1 ✅ |
| **Audio Elements** | 0 | 0 |
| **Loading Spinners** | 6 ❌ (visible) | 6 (but video loaded) |
| **Video Source** | N/A | `https://daylightlocal.kckern.net/media/video/news/cnn/20260122` ✅ |
| **Video Paused** | N/A | true (ready to play) |
| **Video ReadyState** | N/A | 4 (HAVE_ENOUGH_DATA) ✅ |
| **Video Error** | N/A | null ✅ |

---

## Expected Behavior (Production ✅)

```
URL: https://daylightlocal.kckern.net/tv?play=news/cnn

After page load:
  - Player components: 2
  - Video elements: 1 ✅
  - Video source: /media/video/news/cnn/20260122
  - Video paused: true (autoplay may be blocked)
  - Video readyState: 4 (HAVE_ENOUGH_DATA)
  - Video error: null
  - Result: Video loaded and ready to play
```

---

## Actual Behavior (Localhost ❌)

```
URL: http://localhost:3111/tv?play=news/cnn

After page load:
  - Player components: 1
  - Video elements: 0 ❌
  - Loading spinners: 6 (visible, stuck)
  - Result: Player stuck in loading state, no video created
```

---

## Technical Analysis

### Media Path Format

The `play=news/cnn` parameter refers to a local media file path, not a Plex item. This tests the local file playback system.

### Expected Resolution Flow

1. Parse `play=news/cnn` from URL
2. Resolve to media path: `/media/video/news/cnn/YYYYMMDD` (today's file)
3. Create video element with source URL
4. Start playback

### Failure Point (Localhost)

The failure occurs between steps 2 and 3 - the path resolution or video element creation is failing. The Player component is created but never receives valid media data to render a video element.

---

## Potential Causes

1. **Media path resolution differs**: Localhost may not resolve `news/cnn` to the correct file path
2. **File availability**: The media file may not exist or be accessible on localhost
3. **API response differs**: The media info endpoint may return different data
4. **Player initialization**: The SinglePlayer may not handle local files the same way

---

## API Investigation Needed

Compare these endpoints between localhost and production:
```bash
# Local file info endpoint
curl http://localhost:3111/api/v1/content/media/info/news/cnn
curl https://daylightlocal.kckern.net/api/v1/content/media/info/news/cnn
```

---

## Environment

- **OS:** macOS
- **Local Dev Port:** 3111
- **Production:** https://daylightlocal.kckern.net
- **Media Type:** Local file (not Plex)
- **Media Path Pattern:** `/media/video/news/cnn/YYYYMMDD`

---

## Workaround

Access news content via production URL instead of localhost.

---

## Test Output Location

- `/tmp/multi-item-test.log`

---

## Related Issues

- May be related to the folder metadata bug (different code path but similar symptoms)
- Local file playback may use different resolution logic than Plex items
