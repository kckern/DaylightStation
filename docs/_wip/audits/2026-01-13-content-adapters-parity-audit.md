# Content Adapters & Domain Field Parity Audit

**Date:** 2026-01-13
**Scope:** All content adapters in `backend/src/2_adapters/content/` and domain entities in `backend/src/1_domains/content/`
**Status:** Complete

---

## Executive Summary

| Adapter/Component | Parity | Critical Gaps | Status |
|-------------------|--------|---------------|--------|
| **PlexAdapter** | ~85% | (Already fixed in previous commit) | Done |
| **FolderAdapter** | ~60% | Watch state, metadata flattening, field names | Needs Work |
| **LocalContentAdapter** | ~90% | Scripture version, talk mediaType/type | Minor Fixes |
| **FilesystemAdapter** | ~50% | Watch state, HTTP headers, images, errors | Needs Work |
| **Content Domain** | ~75% | Scheduling metadata, FolderAdapter.resolvePlayables() | Needs Work |
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

#### P1-1: Scripture Missing `version` Field
**Severity:** HIGH

DDD adapter does not preserve the scripture version field (sebom, msg, etc.)

```javascript
// LEGACY has
version: "sebom"

// DDD metadata has NO version
metadata: {
  reference: "1 Nephi 1",
  volume: "bom",
  chapter: 31103,
  verses: [...]
  // version: undefined - MISSING
}
```

**Fix:** Add `version` to scripture metadata extraction.

#### P1-2: Talk `type` Field Not Set
**Severity:** MEDIUM

Talks return `type: null` instead of `type: 'talk'`.

```javascript
// Expected
type: 'talk'

// Actual
type: null
```

#### P1-3: Talk `mediaType` Incorrect
**Severity:** MEDIUM

Talks are video but adapter sets `mediaType: 'audio'`.

```javascript
// Current (WRONG for talks)
mediaType: 'audio'

// Should be
mediaType: 'video'
```

### Field Parity Summary

| Field | Talk | Scripture | Hymn | Primary | Poem |
|-------|------|-----------|------|---------|------|
| id | OK | OK | OK | OK | OK |
| source | OK | OK | OK | OK | OK |
| title | OK | OK | OK | OK | OK |
| type | NULL | OK | OK | OK | OK |
| mediaType | WRONG | OK | OK | OK | OK |
| mediaUrl | OK | OK | OK | OK | OK |
| duration | OK | OK | OK | OK | OK |
| metadata.version | - | MISSING | - | - | - |
| metadata.verses | OK | OK | OK | OK | OK |

### Recommendations

1. Add `version` to scripture metadata
2. Set `type: 'talk'` for talks
3. Set `mediaType: 'video'` for talks

---

## 3. FilesystemAdapter Audit

**File:** `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`

### Critical Gaps

#### P0-1: No Watch State Integration
**Severity:** CRITICAL

- `duration` never populated (would need metadata parsing)
- `resumePosition` never populated (requires watch state integration)
- Watch history fields (`playCount`, `lastPlayed`, `playhead`, `watchTime`) missing

#### P0-2: Missing HTTP Headers
**Severity:** HIGH

Legacy provides comprehensive HTTP headers for caching and security:
- `Cache-Control: public, max-age=31536000`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Access-Control-Allow-Origin: *`

DDD proxy provides minimal headers only.

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
| Watch History | Yes | No | MISSING |
| Resume Position | Yes | No | MISSING |
| HTTP Headers | Full | Minimal | INCOMPLETE |
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

| ID | Component | Issue | Effort |
|----|-----------|-------|--------|
| P0-1 | FolderAdapter | No watch state integration | Medium |
| P0-2 | FolderAdapter | Missing resolvePlayables() | Small |
| P0-3 | FilesystemAdapter | No watch state integration | Medium |
| P0-4 | QueueService | Missing priority/deadline logic | Medium |

### P1 - High Priority (Feature Gaps)

| ID | Component | Issue | Effort |
|----|-----------|-------|--------|
| P1-1 | LocalContentAdapter | Scripture missing version | Small |
| P1-2 | LocalContentAdapter | Talk type/mediaType wrong | Small |
| P1-3 | FolderAdapter | Metadata not flattened | Small |
| P1-4 | FilesystemAdapter | Missing HTTP headers | Small |
| P1-5 | Item entity | Missing scheduling fields | Medium |

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
