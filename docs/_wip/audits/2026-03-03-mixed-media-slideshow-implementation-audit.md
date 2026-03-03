# Mixed Media Slideshow — Implementation Audit

**Date:** 2026-03-03
**Feature:** Mixed media slideshow (photos + videos from Immich queries with Ken Burns, audio layer)
**Design doc:** `docs/plans/2026-03-03-mixed-media-slideshow-design.md`
**Implementation plan:** `docs/plans/2026-03-03-mixed-media-slideshow.md`

---

## What Was Done

### Committed (9 commits, 989db99b..f9930f45)

| Commit | Description |
|--------|-------------|
| `989db99b` | SavedQueryService: pass through `exclude`, `slideshow`, `audio` fields |
| `1788c93c` | QueryAdapter: exclude filter + slideshow stamping on image items |
| `1e68c4ea` | ImmichAdapter: enrich people metadata with face bounding boxes |
| `bdf32f0d` | Registry: add `'image'` to `MEDIA_PLAYBACK_FORMATS` |
| `8dd074cf` | ImageFrame renderer with Ken Burns smart zoom (Web Animations API) |
| `d506ec71` | SinglePlayer: route `format: 'image'` to ImageFrame |
| `2098bd76` | AudioLayer component with pause/duck/skip behaviors |
| `c002184a` | Player.jsx: integrate AudioLayer, remove CompositePlayer gate |
| `f9930f45` | Delete 6 CompositePlayer files + ImageCarousel (~1,869 lines removed) |

### Uncommitted fixes (5 files modified)

These are in the working tree and need to be committed after remaining issues are resolved.

#### 1. `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`

**Change:** In `#searchAssets()` line ~399, changed photo items from `#toListableItem()` to `#toPlayableItem()`.

**Why:** Photos were being returned as ListableItems (no `mediaUrl`, `mediaType`, `format`, `metadata.people`). The queue needs PlayableItems for all media types so the frontend can render them.

```js
// Before: photos had no mediaUrl/mediaType/format
asset.type === 'VIDEO' ? this.#toPlayableItem(asset) : this.#toListableItem(asset)

// After: all items are PlayableItems
this.#toPlayableItem(asset)
```

**Risk:** Other consumers of `ImmichAdapter.search()` may expect ListableItems for photos (e.g., gallery browse UI). If gallery browse breaks, add a `forPlayback` parameter to `search()` to control the behavior.

#### 2. `backend/src/1_adapters/content/query/QueryAdapter.mjs`

**Change:** After `#resolveImmichQuery()` returns, attach `query.audio` to the items array so the queue router can include it in the response.

```js
const items = await this.#resolveImmichQuery(query);
if (query.audio) items.audio = query.audio;
return items;
```

**Note:** Uses the fact that JS arrays are objects — `items.audio` is a non-numeric property that doesn't affect iteration or `Array.isArray()` checks. `queueService.resolveQueue()` iterates the array normally.

#### 3. `backend/src/4_api/v1/routers/queue.mjs`

**Changes:**
- `toQueueItem()` now passes through `slideshow` config and `metadata` (width, height, people) on items
- Queue router reads `playables.audio` and includes it at the response level

**Verified:** `curl /api/v1/queue/mar4-videos-photos` returns:
- Photo items with `mediaUrl`, `mediaType: "image"`, `format: "image"`, `slideshow: {...}`
- Video items with `mediaUrl`, `mediaType: "video"`, `format: "video"`, `duration`
- Top-level `audio: { contentId, behavior, mode }`
- 45 items (39 photos, 6 videos)

#### 4. `frontend/src/modules/Player/renderers/ImageFrame.jsx`

**Changes:**
- Fixed variable ordering bug (used before declared — runtime ReferenceError)
- **Fixed render loop**: `people`, `slideshow`, `peopleNames`, `hasFaces` were creating new array/object references every render, causing `useMemo`/`useEffect` dependency invalidation. Wrapped with `useMemo()`.
- Added rich structured logging: mount/unmount, zoom target computation, animation start, advance, cancel, errors
- Mount useEffect deps narrowed to `[imageId]` to prevent spam

#### 5. `frontend/src/modules/Player/components/AudioLayer.jsx`

**Changes:**
- Added mount/unmount logging
- Enriched resolve log with first 5 track titles
- Added `audio-layer-no-player-ref` warning when media type changes but player isn't attached
- Enriched pause/duck/resume logs with `contentId`, `fromType`/`toType`, volume state

---

## What Still Doesn't Work

### Critical: ImageFrame render loop (FIXED but needs verification)

The `useMemo` fix for `people`/`slideshow`/`peopleNames`/`hasFaces` was applied but not yet tested via Playwright. Before the fix, `image-frame-start` fired 3,557 times in 20 seconds. The timer never reached 5s so the slideshow never advanced to the next photo. **Must verify the fix stops the spam and photos advance.**

### Critical: AudioLayer not rendering

`Player.jsx:845` reads audio config from `play?.audio || queue?.audio || activeSource?.audio`. The queue API response includes `audio` at the top level, but **the frontend queue fetching logic in `useQueueController` likely does not propagate `audio` from the API response to the Player's `queue` prop**.

**To fix:** Trace how `useQueueController` processes the `/api/v1/queue/` response. The `audio` field needs to be extracted from the response and passed to the Player component so `queue?.audio` resolves.

Relevant files:
- `frontend/src/modules/Player/hooks/useQueueController.js` — where queue is fetched and parsed
- `frontend/src/modules/Player/Player.jsx:845` — where `audioConfig` is derived

### Important: Face data not available during playback

Immich's `searchMetadata` API does not return `people.faces` (face bounding boxes). The `getAsset()` API (used by `/api/v1/info/:id`) DOES return them via `getViewable()`.

**Current state:** Ken Burns always uses the "random center 60%" fallback because `metadata.people` is empty on all queue items.

**Options to fix:**
1. **JIT enrichment in ImageFrame** — When ImageFrame mounts, fetch `/api/v1/info/{imageId}` to get people/face data, then compute zoom target. Adds ~200ms latency per photo but gives smart face zoom.
2. **Backend enrichment in QueryAdapter** — After search, call `getAsset()` for each image to get face data. Slow (45 sequential API calls) but no frontend changes.
3. **Backend batch enrichment** — Add a batch face data endpoint that fetches multiple assets in parallel.

**Recommendation:** Option 1 (JIT). The image loads asynchronously anyway, so the `/info/` fetch can race with the image load. Compute zoom target when both are ready.

### Important: `/info/` endpoint `format` field wrong for images

`GET /api/v1/info/immich:{id}` returns `format: "video"` for image assets. The `resolveFormat()` function in `info.mjs` has a bug or fallback that incorrectly maps image types to video format. This will cause issues if `/info/` responses are used to determine rendering paths.

### Minor: `/info/` endpoint not returning people despite `getViewable()` including them

`getViewable()` correctly enriches `metadata.people` with face bounding boxes (lines 329-337). The `transformToInfoResponse()` passes `metadata` through at line 84. However, `curl /api/v1/info/immich:{id}` does not include `people` in the metadata. **Needs investigation** — possibly the Immich `getAsset()` API doesn't include `people.faces` by default, or there's a serialization issue.

### Minor: Orphaned test files

Two test files reference deleted code:
- `tests/live/flow/tv/tv-composite-player.runtime.test.mjs` — tests CompositePlayer which was deleted
- `tests/isolated/assembly/player/useAdvanceController.test.mjs` — tests `useAdvanceController` which was deleted

These should be deleted or rewritten for the new ImageFrame/AudioLayer components.

### Minor: `music:anniversary` audio content ID

The query YAML references `audio.contentId: "music:anniversary"`. This content ID must resolve via ContentIdResolver to a real playlist/queue. If it doesn't exist, the AudioLayer will silently fail (logs `audio-layer-resolve-failed`).

---

## Files Modified (Full Inventory)

### Backend

| File | Status | Changes |
|------|--------|---------|
| `backend/src/3_applications/content/SavedQueryService.mjs` | Committed | Pass through `exclude`, `slideshow`, `audio` |
| `backend/src/1_adapters/content/query/QueryAdapter.mjs` | Committed + Uncommitted | Exclude filter, slideshow stamping, audio passthrough |
| `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs` | Committed + Uncommitted | Face bounding boxes; photos → PlayableItem |
| `backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs` | Committed | Fix breaking consumer (people object→string) |
| `backend/src/4_api/v1/routers/queue.mjs` | Uncommitted | `toQueueItem()` passes slideshow/metadata; audio at response level |

### Frontend

| File | Status | Changes |
|------|--------|---------|
| `frontend/src/modules/Player/lib/registry.js` | Committed | Add `'image'` to `MEDIA_PLAYBACK_FORMATS` |
| `frontend/src/modules/Player/renderers/ImageFrame.jsx` | Created + Uncommitted | Ken Burns renderer; render loop fix; logging |
| `frontend/src/modules/Player/renderers/ImageFrame.scss` | Created | Styling for image frame |
| `frontend/src/modules/Player/components/AudioLayer.jsx` | Created + Uncommitted | Audio player with pause/duck/skip; logging |
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | Committed | Route `format: 'image'` to ImageFrame |
| `frontend/src/modules/Player/Player.jsx` | Committed | AudioLayer integration, CompositePlayer removal |
| `frontend/src/modules/Displayer/Displayer.jsx` | Committed | Fix breaking consumer (people object→string) |

### Deleted (committed in f9930f45)

- `Player/renderers/CompositePlayer.jsx`
- `Player/components/CompositeContext.jsx`
- `Player/components/CompositeControllerContext.jsx`
- `Player/components/VisualRenderer.jsx`
- `Player/components/ImageCarousel.jsx`
- `Player/hooks/useAdvanceController.js`
- `Player/styles/ImageCarousel.scss`

### Config / Data

| File | Status |
|------|--------|
| `data/users/kckern/config/queries/mar4-videos-photos.yml` | Updated |

---

## Verification Checklist

Before considering this feature complete:

- [ ] Commit uncommitted fixes (5 files)
- [ ] Verify render loop fix — `image-frame-start` should log once per photo, not thousands
- [ ] Verify slideshow advances — photo displays for 5s, then next item loads
- [ ] Verify video playback — when queue reaches a video item, VideoPlayer renders
- [ ] Verify photo→video→photo transitions work without errors
- [ ] Fix AudioLayer not rendering — trace `useQueueController` audio propagation
- [ ] Verify audio pauses during video, resumes after
- [ ] Implement JIT face data fetch in ImageFrame (or defer as follow-up)
- [ ] Fix `/info/` `format` field for images
- [ ] Delete orphaned test files
- [ ] End-to-end smoke test on actual TV (Shield TV via FKB)

---

## Query YAML Reference

```yaml
# data/users/kckern/config/queries/mar4-videos-photos.yml
title: Alan Birthday Videos & Photos
type: immich
sort: date_desc
params:
  # omit mediaType to include both photos and videos
  month: 3
  day: 4
  yearFrom: 2021
exclude: []
slideshow:
  duration: 5
  effect: kenburns
  zoom: 1.2
  transition: crossfade
  focusPerson: Alan
audio:
  contentId: music:anniversary
  behavior: pause
  mode: hidden
```

## Architecture Summary

```
Query YAML → SavedQueryService (passes exclude/slideshow/audio)
  → QueryAdapter.resolvePlayables()
    → ImmichAdapter.search() → #toPlayableItem() for ALL assets
    → Exclude filter, slideshow stamping on image items
    → Attach audio config to items array
  → queue.mjs toQueueItem() → passes slideshow + metadata
  → Response: { items: [...], audio: {...} }

Frontend Player:
  → useQueueController fetches /api/v1/queue/
  → Player.jsx reads audioConfig from queue prop  ← BROKEN: audio not propagated
  → SinglePlayer routes format:'image' → ImageFrame
  → ImageFrame: Ken Burns via Web Animations API, auto-advance after duration
  → AudioLayer: resolves contentId, pauses/ducks during video items  ← NOT RENDERING
```
