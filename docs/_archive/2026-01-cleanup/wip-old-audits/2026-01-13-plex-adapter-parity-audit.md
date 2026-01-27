# Plex Adapter Parity Audit

**Date:** 2026-01-13
**Files Compared:**
- Legacy: `backend/_legacy/lib/plex.mjs` (973 lines)
- DDD: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs` (356 lines)
- DDD Client: `backend/src/2_adapters/content/media/plex/PlexClient.mjs` (66 lines)

**Related Routers:**
- Legacy: `backend/_legacy/routers/media.mjs` (946 lines)
- DDD: `backend/src/4_api/routers/play.mjs`, `backend/src/4_api/routers/list.mjs`

---

## Executive Summary

**Updated 2026-01-13:** The DDD PlexAdapter has been significantly enhanced with all P0/P1 critical functionality:

✅ **Implemented:**
- Transcode decision API (`requestTranscodeDecision()`)
- Media URL generation (`loadMediaUrl()`, `_buildTranscodeUrl()`)
- Smart episode selection (`selectKeyToPlay()`, `_selectEpisodeByPriority()`)
- Viewing history integration (`_loadHistoryFromFiles()`, `_clearHistoryFromFiles()`)
- Playable item loading (`loadPlayableItemFromKey()`)
- Playable queue loading (`loadPlayableQueueFromKey()`)
- Watchlist selection (`loadSingleFromWatchlist()`)
- Full field flattening in list router for legacy compatibility

⚠️ **Remaining (P2/P3):**
- Music-specific loaders (loadArtist, loadTrack, etc.)
- Image URL helpers (artUrl, loadImgFromKey)
- Full show metadata with cast/director

**Estimated parity: ~85% (was ~40%)**

---

## CRITICAL GAPS (P0 - Blocking)

> **All P0 gaps have been resolved as of 2026-01-13**

### 1. ~~No Transcode Decision API~~ ✅ RESOLVED

**Legacy:** `requestTranscodeDecision()` (lines 77-205)
- Generates unique session identifiers (clientIdentifier, sessionIdentifier)
- Requests transcode decision from Plex server
- Handles direct play vs transcode decisions
- Returns stream authorization info

**DDD:** ✅ `requestTranscodeDecision()` implemented with full session management

**Status:** RESOLVED

---

### 2. ~~No Media URL Generation~~ ✅ RESOLVED

**Legacy:** `loadmedia_url()` (lines 207-310), `_buildTranscodeUrl()` (lines 316-337)
- Generates streaming URLs for video and audio
- Handles transcode URLs with proper session management
- Handles direct stream paths
- Supports options: `maxVideoBitrate`, `maxResolution`, `session`, `startOffset`

**DDD:** ✅ `loadMediaUrl()` and `_buildTranscodeUrl()` implemented

**Status:** RESOLVED

---

### 3. ~~No Smart Episode Selection~~ ✅ RESOLVED

**Legacy:** `selectKeyToPlay()` (lines 682-699), `selectEpisodeByPriority()` (lines 723-750), `loadPlexViewingHistory()` (lines 701-720)
- Loads viewing history from YAML files
- Categorizes items as watched/in-progress/unwatched
- Priority selection: unwatched > in-progress > restart watched
- Handles shuffle mode
- Clears watch status when all items watched

**DDD:** ✅ `selectKeyToPlay()`, `_selectEpisodeByPriority()`, `_loadHistoryFromFiles()`, `_clearHistoryFromFiles()` implemented

**Status:** RESOLVED

---

### 4. ~~No loadPlayableItemFromKey()~~ ✅ RESOLVED

**Legacy:** `loadPlayableItemFromKey()` (lines 580-602)
- Loads list from a key
- Uses smart selection to pick one item
- Loads metadata and checks if playable
- Drills down for non-playable items (seasons→episodes)
- Returns rich playable object with resume position

**DDD:** ✅ `loadPlayableItemFromKey()` implemented with smart selection and drill-down

**Status:** RESOLVED

---

## HIGH GAPS (P1 - Degraded Experience)

> **All P1 gaps have been resolved as of 2026-01-13**

### 5. ~~Missing buildPlayableObject() Fields~~ ✅ RESOLVED

**Legacy:** `buildPlayableObject()` returns many top-level fields.

**DDD:** ✅ `_toPlayableItem()` now includes all fields in metadata:
- `show`, `season` for TV episodes
- `artist`, `albumArtist`, `album` for music
- `tagline`, `studio`, `key`
- `Media` object for audio direct stream

Router flattens these fields to top level for legacy compatibility.

**Status:** RESOLVED

---

### 6. ~~No Viewing History Integration~~ ✅ RESOLVED

**Legacy:** Uses `loadPlexViewingHistory()` to load from YAML files.

**DDD:** ✅ `_loadHistoryFromFiles()` and `_clearHistoryFromFiles()` implemented.
- Reads all YAML files from `historyPath` directory
- Supports `playhead`, `mediaDuration`, `percent` fields
- Constructor accepts `historyPath` config option

**Status:** RESOLVED

---

### 7. ~~Missing loadPlayableQueueFromKey()~~ ✅ RESOLVED

**Legacy:** `loadPlayableQueueFromKey()` (lines 611-633)

**DDD:** ✅ `loadPlayableQueueFromKey()` implemented
- Returns array of playable items with viewing history attached
- Supports shuffle option

**Status:** RESOLVED

---

### 8. ~~No Watchlist Functionality~~ ✅ RESOLVED

**Legacy:** `loadSingleFromWatchlist()` (lines 752-809)
- Handles special watchlist containers
- Priority-based selection (in_progress > urgent > normal)
- Handles skip_after, wait_until dates

**DDD:** ✅ `loadSingleFromWatchlist()` implemented
- Priority selection: in_progress > urgent > normal
- Supports skip_after, wait_until, watched, hold filters
- Groups by program and selects by index

**Status:** RESOLVED

---

## MEDIUM GAPS (P2 - Missing Features)

### 9. Missing Music-Specific Loaders

**Legacy methods not in DDD:**
- `loadArtistAlbums()` (line 930)
- `loadArtist()` (lines 935-940)
- `loadTrack()` (lines 943-961)
- `loadTracks()` (lines 964-970)

**Impact:** Music browsing/playback degraded.

---

### 10. Missing Show-Specific Loader

**Legacy:** `loadShow()` (lines 839-877)
- Returns rich show metadata
- Includes genre, director, cast, collection
- Returns seasons array with metadata

**DDD:** `getContainerInfo()` returns partial info but lacks:
- genre, director, cast arrays
- seasons array
- collection tags

---

### 11. Missing Image Loaders

**Legacy:** `loadImgFromKey()` (lines 432-438)
- Returns array of image URLs (thumb, parentThumb, grandparentThumb)

**DDD:** Not implemented

---

### 12. Missing artUrl() Helper

**Legacy:** `artUrl()` (lines 879-881)
- Builds artwork URL paths

**DDD:** Not implemented (thumbnails use different pattern)

---

## LOW GAPS (P3 - Minor/Nice-to-have)

### 13. Missing loadSingleFrom* Methods

These are used for direct single-item loading:
- `loadSingleFromCollection()` (lines 640-644)
- `loadSingleFromArtist()` (lines 647-651)
- `loadSingleFromAlbum()` (lines 654-658)
- `loadSingleFromSeason()` (lines 661-665)
- `loadSingleFromPlaylist()` (lines 668-673)
- `loadSingleFromShow()` (lines 676-680)

All use `selectKeyToPlay()` for smart selection.

---

### 14. Missing Utility Methods

- `shuffleArray()` (line 19) - in-place shuffle
- `getMediaArray()` (lines 635-638) - normalize XML/JSON arrays
- `pruneArray()` / `pickArray()` (lines 894-910) - object filtering
- `flattenTags()` (lines 912-919) - extract tag strings
- `isPlayableType()` (lines 604-608) - type classification

---

## Methods Parity Matrix

**Updated 2026-01-13: P0/P1 Critical Gaps Implemented**

| Legacy Method | Lines | DDD Equivalent | Status |
|---------------|-------|----------------|--------|
| `constructor()` | 22-32 | `constructor()` | ✅ Full |
| `fetch()` | 33-45 | `PlexClient.request()` | ✅ Full |
| `requestTranscodeDecision()` | 77-205 | `requestTranscodeDecision()` | ✅ Full |
| `loadmedia_url()` | 207-310 | `loadMediaUrl()` | ✅ Full |
| `_buildTranscodeUrl()` | 316-337 | `_buildTranscodeUrl()` | ✅ Full |
| `loadMeta()` | 339-350 | `PlexClient.getMetadata()` | ✅ Full |
| `loadChildrenFromKey()` | 351-362 | `getList()` | ✅ Full |
| `loadListFromKey()` | 364-379 | `getList()` | ✅ Full |
| `loadListKeys()` | 381-431 | `_toListableItem()` | ✅ Full |
| `loadImgFromKey()` | 432-438 | - | ❌ Missing (P3) |
| `loadListFromAlbum()` | 440-442 | `getList()` | ✅ Via path |
| `loadListFromSeason()` | 443-445 | `getList()` | ✅ Via path |
| `loadListFromCollection()` | 446-466 | `getList()` | ✅ Via type check |
| `loadListFromShow()` | 467-469 | `getList()` | ✅ Via path |
| `loadListFromArtist()` | 470-472 | `getList()` | ✅ Via path |
| `loadListFromPlaylist()` | 473-513 | `getList()` | ⚠️ Partial (music metadata) |
| `loadListKeysFromPlaylist()` | 514-517 | - | ❌ Missing (P3) |
| `determinemedia_type()` | 519-525 | `_toPlayableItem()` | ✅ Inline |
| `buildPlayableObject()` | 530-577 | `_toPlayableItem()` | ✅ Full (fields flattened in router) |
| `loadPlayableItemFromKey()` | 580-602 | `loadPlayableItemFromKey()` | ✅ Full |
| `isPlayableType()` | 604-608 | `_toPlayableItem()` | ✅ Inline |
| `loadPlayableQueueFromKey()` | 611-633 | `loadPlayableQueueFromKey()` | ✅ Full |
| `getMediaArray()` | 635-638 | - | N/A |
| `loadSingleFrom*()` | 640-681 | `loadPlayableItemFromKey()` | ✅ Via generic method |
| `selectKeyToPlay()` | 682-699 | `selectKeyToPlay()` | ✅ Full |
| `loadPlexViewingHistory()` | 701-720 | `_loadHistoryFromFiles()` | ✅ Full |
| `selectEpisodeByPriority()` | 723-750 | `_selectEpisodeByPriority()` | ✅ Full |
| `loadSingleFromWatchlist()` | 752-809 | `loadSingleFromWatchlist()` | ✅ Full |
| `loadEpisode()` | 811-817 | `getItem()` | ✅ Full |
| `loadMovie()` | 819-825 | `getItem()` | ✅ Full |
| `loadAudioTrack()` | 827-837 | `getItem()` | ✅ Full |
| `loadShow()` | 839-877 | `getContainerInfo()` | ⚠️ Partial (no cast/director) |
| `artUrl()` | 879-881 | - | ❌ Missing (P3) |
| `thumbUrl()` | 883-892 | inline in `_to*Item()` | ✅ Different pattern |
| `loadSinglePlayableItem()` | 922-928 | `loadPlayableItemFromKey()` | ✅ Full |
| `loadArtistAlbums()` | 930-933 | - | ❌ Missing (P2) |
| `loadArtist()` | 935-940 | - | ❌ Missing (P2) |
| `loadTrack()` | 943-961 | - | ❌ Missing (P2) |
| `loadTracks()` | 964-970 | - | ❌ Missing (P2) |

**Legend:** ✅ Full | ⚠️ Partial | ❌ Missing | N/A Not Applicable

**Estimated parity: ~85% (was ~40%)**

---

## Response Shape Differences

### Legacy `/media/plex/list/:key` Response
```json
{
  "plex": "598748",
  "title": "Show Name",
  "image": "/plex_proxy/library/metadata/598748/thumb/...",
  "info": {
    "key": "598748",
    "type": "show",
    "title": "Show Name",
    "summary": "A show about...",
    "year": 2020,
    "studio": "Netflix",
    "tagline": "...",
    "labels": ["comedy", "shuffle"],
    "collections": ["Best Of"],
    "image": "/plex_proxy/..."
  },
  "seasons": {
    "598750": {
      "num": 1,
      "title": "Season 1",
      "img": "/plex_proxy/...",
      "summary": "The first season..."
    }
  },
  "items": [
    {
      "label": "Episode Title",
      "title": "Episode Title",
      "type": "episode",
      "plex": "598751",
      "image": "/plex_proxy/...",
      "thumb_id": "12345",
      "episodeNumber": 1,
      "seasonId": "598750",
      "seasonName": "Season 1",
      "seasonNumber": 1,
      "seasonThumbUrl": "/plex_proxy/...",
      "episodeDescription": "...",
      "duration": 1800,
      "watchProgress": 45,
      "watchSeconds": 810,
      "watchedDate": "2026-01-10 14.30.00",
      "rating": 8
    }
  ],
  "_debug": { ... }
}
```

### DDD `/api/list/plex/:key/playable` Response
```json
{
  "source": "plex",
  "path": "598748",
  "title": "Show Name",
  "label": "Show Name",
  "image": "/plex_proxy/...",
  "info": {
    "title": "Show Name",
    "image": "/plex_proxy/...",
    "summary": "...",
    "tagline": null,
    "year": 2020,
    "studio": "Netflix",
    "type": "show",
    "labels": ["comedy", "shuffle"],
    "duration": null,
    "ratingKey": "598748",
    "childCount": 20
  },
  "seasons": {
    "598750": {
      "id": "598750",
      "title": "Season 1",
      "index": 1,
      "thumbnail": "/plex_proxy/..."
    }
  },
  "items": [
    {
      "id": "plex:598751",
      "title": "Episode Title",
      "label": "Episode Title",
      "itemType": "leaf",
      "thumbnail": "/plex_proxy/...",
      "image": "/plex_proxy/...",
      "plex": "598751",
      "seasonId": "598750",
      "seasonName": "Season 1",
      "seasonNumber": 1,
      "seasonThumbUrl": "/plex_proxy/...",
      "episodeNumber": 1,
      "index": 1,
      "summary": "...",
      "thumb_id": "598751",
      "type": "episode",
      "parent": "598750",
      "parentTitle": "Season 1",
      "parentIndex": 1,
      "parentThumb": "/plex_proxy/...",
      "grandparent": "598748",
      "grandparentThumb": "/plex_proxy/...",
      "duration": 1800,
      "metadata": { ... }
    }
  ]
}
```

### Key Differences

| Field | Legacy | DDD |
|-------|--------|-----|
| ID format | `"plex": "598751"` | `"id": "plex:598751"` |
| Watch progress | `watchProgress`, `watchSeconds`, `watchedDate` | Missing |
| Season info | `num`, `img`, `summary` | `id`, `index`, `thumbnail` (no summary) |
| Info block | Has `collections` | Missing `collections` |
| Episode rating | `rating` | Missing |
| Debug info | `_debug` block | Missing |

---

## Recommendations

### Immediate (Before Production)

1. **Implement `loadmedia_url()`** - Critical for video playback
2. **Implement `requestTranscodeDecision()`** - Required for proper streaming
3. **Implement `loadPlayableItemFromKey()`** - Required for smart selection
4. **Add viewing history integration** - Required for resume functionality

### Short-term (Next Sprint)

5. Implement `selectKeyToPlay()` and priority selection logic
6. Add `watchProgress`, `watchSeconds` to list items
7. Implement `loadPlayableQueueFromKey()` for queue building
8. Add missing fields to `_toPlayableItem()`: show, season, artist, album

### Medium-term

9. Implement watchlist functionality
10. Add music-specific loaders
11. Implement `loadShow()` with full metadata
12. Add `collections` to container info

---

## Files to Update

1. `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`
   - Add `loadmedia_url()`, `requestTranscodeDecision()`, `_buildTranscodeUrl()`
   - Add `loadPlayableItemFromKey()`, `loadPlayableQueueFromKey()`
   - Add `selectKeyToPlay()`, `selectEpisodeByPriority()`
   - Add viewing history loading and integration

2. `backend/src/2_adapters/content/media/plex/PlexClient.mjs`
   - Add transcode decision endpoint support

3. `backend/src/4_api/routers/play.mjs`
   - Update `toPlayResponse()` to include all legacy fields
   - Add watch progress from history

4. `backend/src/4_api/routers/list.mjs`
   - Update `toListItem()` to include watch progress
   - Ensure seasons map includes `num`, `summary`

---

## Test Coverage Needed

- [ ] Video streaming URL generation
- [ ] Transcode vs direct play decision
- [ ] Smart episode selection (unwatched > in-progress > restart)
- [ ] Resume position from history
- [ ] Watch progress in list items
- [ ] Shuffle mode selection
- [ ] Music metadata in playable items
- [ ] Watchlist playback
