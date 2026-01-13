# Content Adapters & Domain Field Parity Audit

**Date:** 2026-01-13
**Scope:** All content adapters in `backend/src/2_adapters/content/` and domain entities in `backend/src/1_domains/content/`
**Status:** Complete

---

## Executive Summary

| Adapter/Component | Parity | Critical Gaps | Status |
|-------------------|--------|---------------|--------|
| **PlexAdapter** | ~85% | (Fixed in previous commit) | Done |
| **FolderAdapter** | ~90% | (Fixed: watch state, metadata, priority) | Done |
| **LocalContentAdapter** | ~95% | (Fixed: scripture version, talk type/mediaType) | Done |
| **FilesystemAdapter** | ~85% | (Fixed: watch state, HTTP headers) Images, errors remain | Mostly Done |
| **Content Domain** | ~85% | (FolderAdapter fixed, scheduling metadata added) | Mostly Done |
| **Apps Adapter** | 0% | Not implemented (no legacy either) | Greenfield |
| **Games Adapter** | 0% | Not implemented (no legacy either) | Greenfield |

---

## 1. FolderAdapter Audit

**File:** `backend/src/2_adapters/content/folder/FolderAdapter.mjs`

### Critical Gaps

#### P0-1: No Watch State Integration
**Severity:** CRITICAL

Legacy `getChildrenFromWatchlist()` loads watch history and includes:
- `percent` - Watch percentage
- `seconds` - Current playhead
- `priority` - Computed from watch state (in_progress, urgent, normal)

DDD FolderAdapter doesn't load watch state at all.

```javascript
// LEGACY (fetch.mjs:571-573)
const log = loadFile(memoryPath) || {};
const percent = log[media_key]?.percent || itemProgress || 0;
const seconds = log[media_key]?.seconds || 0;

// DDD - No watch state loading
```

#### P0-2: Metadata Structure Mismatch
**Severity:** CRITICAL

Legacy returns flat item objects. DDD nests metadata, breaking frontend code expecting:
- `item.shuffle`
- `item.uid`
- `item.continuous`

```javascript
// LEGACY EXPECTED
{ plex: "12345", label: "Show", shuffle: true, uid: "x" }

// DDD ACTUAL
{ id: "plex:12345", title: "Show", metadata: { shuffle: true, uid: "x" } }
```

#### P1-3: Lost Folder Context
**Severity:** MEDIUM

Legacy preserves `program` (folder name) for grouping. DDD discards this context.

#### P1-4: Missing resolvePlayables()
**Severity:** HIGH

FolderAdapter does NOT implement `resolvePlayables()`, breaking queue functionality for folder items.

### Recommendations

1. Integrate watch state store into FolderAdapter
2. Update `toListItem()` in list.mjs to flatten critical metadata fields
3. Implement `resolvePlayables()` method

---

## 2. LocalContentAdapter Audit

**File:** `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`

### Gaps Found

#### P1-1: Scripture Missing `version` Field - RESOLVED
**Severity:** HIGH
**Status:** Fixed - Added `version` to scripture metadata

```javascript
// Now includes version
metadata: {
  reference: "1 Nephi 1",
  volume: "bom",
  version: "sebom",  // ADDED
  chapter: 31103,
  verses: [...]
}
```

**Fix:** Add `version` to scripture metadata extraction.

#### P1-2: Talk `type` Field Not Set - RESOLVED
**Severity:** MEDIUM
**Status:** Fixed - Now sets `type: 'talk'`

```javascript
// Now correct
type: 'talk'
```

#### P1-3: Talk `mediaType` Incorrect - RESOLVED
**Severity:** MEDIUM
**Status:** Fixed - Now sets `mediaType: 'video'`

```javascript
// Now correct
mediaType: 'video'
```

### Field Parity Summary

| Field | Talk | Scripture | Hymn | Primary | Poem |
|-------|------|-----------|------|---------|------|
| id | OK | OK | OK | OK | OK |
| source | OK | OK | OK | OK | OK |
| title | OK | OK | OK | OK | OK |
| type | OK | OK | OK | OK | OK |
| mediaType | OK | OK | OK | OK | OK |
| mediaUrl | OK | OK | OK | OK | OK |
| duration | OK | OK | OK | OK | OK |
| metadata.version | - | OK | - | - | - |
| metadata.verses | OK | OK | OK | OK | OK |

### Status

All P1 issues have been resolved:
- Scripture now includes `version` in metadata
- Talks now set `type: 'talk'`
- Talks now set `mediaType: 'video'`

---

## 3. FilesystemAdapter Audit

**File:** `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`

### Critical Gaps

#### P0-1: No Watch State Integration - RESOLVED
**Severity:** CRITICAL
**Status:** Fixed - Added `_loadWatchState()` and `_getWatchState()` methods

- `duration` now populated from watch state (mediaDuration)
- `resumePosition` now populated from watch state (playhead/seconds)
- Watch history fields (percent, playhead, watchTime) included in metadata
- `historyPath` config added to constructor and bootstrap.mjs

```javascript
// Now includes watch state in getItem()
const watchState = this._getWatchState(localId);
const resumePosition = watchState?.playhead || watchState?.seconds || null;
const duration = watchState?.mediaDuration || null;
```

#### P0-2: Missing HTTP Headers - RESOLVED
**Severity:** HIGH
**Status:** Fixed - Added headers to proxy router

Now provides comprehensive HTTP headers for caching and security:
- `Cache-Control: public, max-age=31536000`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Access-Control-Allow-Origin: *`

Headers added to both filesystem and local-content streaming endpoints.

#### P1-3: No Error Fallback
**Severity:** MEDIUM

Legacy serves `sfx/error.mp3` for missing files. DDD returns 404 JSON.

#### P1-4: No Image Handling
**Severity:** MEDIUM

- No direct image serving (`GET /img/*`)
- No embedded album art extraction
- No image caching
- No missing image fallback

### Methods Comparison

| Feature | Legacy | DDD | Status |
|---------|--------|-----|--------|
| File Streaming | Yes | Yes (via proxy) | OK |
| Range Requests | Yes | Yes (via proxy) | OK |
| Watch History | Yes | Yes | OK (FIXED) |
| Resume Position | Yes | Yes | OK (FIXED) |
| HTTP Headers | Full | Full | OK (FIXED) |
| Image Service | Yes | No | MISSING |
| Error Fallback | Yes | No | MISSING |
| Path Security | No | Yes | DDD BETTER |
| MIME Detection | Yes | Yes | OK |

### Recommendations

1. Integrate WatchState for `resumePosition` and `duration`
2. Add HTTP headers in proxy router
3. Implement error fallback media
4. Add image endpoint with caching

---

## 4. Content Domain Entities Audit

**Directory:** `backend/src/1_domains/content/`

### Entity Coverage

| Entity | Implemented | Notes |
|--------|-------------|-------|
| Item | Yes | Base entity |
| WatchState | Yes | With computed properties |
| ListableItem | Yes | Capability mixin |
| PlayableItem | Yes | Capability mixin |
| QueueableItem | Yes | Capability mixin |

### Critical Missing Fields in Item

Legacy scheduling/priority fields NOT in Item model:

| Field | Legacy Usage | DDD Status |
|-------|--------------|------------|
| `hold` | Skip item in queue | MISSING |
| `skip_after` | Deadline to play by | MISSING |
| `wait_until` | Don't show until date | MISSING |
| `priority` | Queue ordering | MISSING |
| `program` | Series/folder grouping | MISSING |

### QueueService Gaps

Legacy `getChildrenFromWatchlist()` has complex priority logic:
1. in_progress items first
2. urgent items (skip_after within 8 days)
3. normal priority items
4. Skip items on hold
5. Skip items past skip_after
6. Skip items with wait_until > 2 days ahead

DDD QueueService only implements in_progress > unwatched ordering.

### Missing IContentSource Methods

| Method | FolderAdapter | Status |
|--------|--------------|--------|
| `resolvePlayables()` | NOT IMPLEMENTED | CRITICAL GAP |

### Recommendations

1. Add scheduling fields to Item metadata schema
2. Implement full priority logic in QueueService
3. Add `resolvePlayables()` to FolderAdapter
4. Add day-of-week filtering support

---

## 5. Apps & Games Adapters Audit

**Directories:**
- `backend/src/2_adapters/content/apps/`
- `backend/src/2_adapters/content/games/`

### Status: Not Implemented

Both directories contain only `.gitkeep` files. No legacy code exists for apps or games either.

These are greenfield implementations when needed.

---

## Implementation Priority

### P0 - Critical (Blocks Core Functionality)

| ID | Component | Issue | Effort | Status |
|----|-----------|-------|--------|--------|
| P0-1 | FolderAdapter | No watch state integration | Medium | DONE |
| P0-2 | FolderAdapter | Missing resolvePlayables() | Small | DONE |
| P0-3 | FilesystemAdapter | No watch state integration | Medium | DONE |
| P0-4 | QueueService | Missing priority/deadline logic | Medium | DONE (in FolderAdapter) |

### P1 - High Priority (Feature Gaps)

| ID | Component | Issue | Effort | Status |
|----|-----------|-------|--------|--------|
| P1-1 | LocalContentAdapter | Scripture missing version | Small | DONE |
| P1-2 | LocalContentAdapter | Talk type/mediaType wrong | Small | DONE |
| P1-3 | FolderAdapter | Metadata not flattened | Small | DONE |
| P1-4 | FilesystemAdapter | Missing HTTP headers | Small | DONE |
| P1-5 | Item entity | Missing scheduling fields | Medium | DONE (in FolderAdapter metadata) |

### P2 - Medium Priority (Quality)

| ID | Component | Issue | Effort |
|----|-----------|-------|--------|
| P2-1 | FilesystemAdapter | No error fallback media | Small |
| P2-2 | FilesystemAdapter | No image service | Medium |
| P2-3 | list.mjs | recent_on_top not implemented | Small |

---

## Related Code Locations

- FolderAdapter: `backend/src/2_adapters/content/folder/FolderAdapter.mjs`
- LocalContentAdapter: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- FilesystemAdapter: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`
- Item Entity: `backend/src/1_domains/content/entities/Item.mjs`
- WatchState: `backend/src/1_domains/content/entities/WatchState.mjs`
- QueueService: `backend/src/1_domains/content/services/QueueService.mjs`
- list.mjs Router: `backend/src/4_api/routers/list.mjs`
- Legacy fetch.mjs: `backend/_legacy/lib/fetch.mjs`
- Legacy media.mjs: `backend/_legacy/routers/media.mjs`
