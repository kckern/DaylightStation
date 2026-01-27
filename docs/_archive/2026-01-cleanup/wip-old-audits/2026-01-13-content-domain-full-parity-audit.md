# Content Domain & Adapters - Full Schema/Function Parity Audit

**Date:** 2026-01-13
**Scope:** `backend/src/1_domains/content/` and `backend/src/2_adapters/content/`
**Status:** ✅ Implementation Complete (2026-01-13)

---

## Executive Summary

| Component | Parity | Critical Gaps | Status |
|-----------|--------|---------------|--------|
| **Domain Entities** | ~85% | WatchState timestamp format (minor) | ✅ Good |
| **Domain Capabilities** | ~90% | Actions, media IDs, watch state, behavior flags added | ✅ Done |
| **QueueService** | ~95% | Priority, date filtering, day-of-week all implemented | ✅ Done |
| **ContentSourceRegistry** | ~95% | Minor gaps in watchlist resolution | Good |
| **PlexAdapter** | ~90% | getMetadata, getContainerWithChildren added | ✅ Done |
| **FolderAdapter** | ~85% | Missing wait_until sorting | Good |
| **LocalContentAdapter** | ~100% | All 5 content types complete | ✅ Ready |
| **FilesystemAdapter** | ~90% | ID3 tags, household scoping, image MIME types added | ✅ Done |

---

## 1. Domain Entities Audit

### Item.mjs

| Field | DDD Provides | Legacy Expects | Status |
|-------|-------------|----------------|--------|
| id | ✅ | ✅ | MATCH |
| source | ✅ | ✅ | MATCH |
| title | ✅ | ✅ | MATCH |
| type | ✅ (nullable) | ✅ | PARTIAL |
| thumbnail | ✅ | ✅ | MATCH |
| description | ✅ | ✅ | MATCH |
| metadata | ✅ | ✅ | MATCH |

### WatchState.mjs

| Field | DDD Provides | Legacy Expects | Status |
|-------|-------------|----------------|--------|
| itemId | ✅ | ✅ (as key) | MATCH |
| playhead | ✅ | ✅ | MATCH |
| duration | ✅ | ✅ (mediaDuration) | NAME DIFF |
| playCount | ✅ | ✅ | MATCH |
| lastPlayed | ✅ (ISO) | ✅ (YYYY-MM-DD HH.mm.ss) | **FORMAT MISMATCH** |
| watchTime | ✅ | ✅ | MATCH |
| percent | ✅ (calculated) | ✅ (persisted) | BEHAVIOR DIFF |
| title | ❌ | ✅ | **MISSING** |
| parent/parentId | ❌ | ✅ | **MISSING** |
| grandparent/grandparentId | ❌ | ✅ | **MISSING** |
| libraryId | ❌ | ✅ | **MISSING** |
| mediaType | ❌ | ✅ | **MISSING** |
| oldPlexIds | ❌ | ✅ | **MISSING** |

**Critical Issues:**
1. **Timestamp format mismatch**: DDD uses ISO 8601, legacy uses `YYYY-MM-DD HH.mm.ss`
2. **Missing metadata embedding**: Legacy stores item metadata WITH watch state
3. **Calculated vs persisted percent**: Could cause stale data issues

---

## 2. Domain Capabilities Audit

### Item.mjs - Coverage: ~90% ✅

| Field | DDD | Legacy/Frontend | Status |
|-------|-----|-----------------|--------|
| id, title, thumbnail | ✅ | ✅ | OK |
| label (getter) | ✅ | ✅ | ✅ ADDED |
| plex (getter) | ✅ | ✅ | ✅ ADDED |
| media_key (getter) | ✅ | ✅ | ✅ ADDED |
| actions (play/queue/list/open) | ✅ | ✅ | ✅ ADDED |

### PlayableItem - Coverage: ~85% ✅

| Field | DDD | Legacy/Frontend | Status |
|-------|-----|-----------------|--------|
| mediaType, mediaUrl, duration | ✅ | ✅ | OK |
| resumable, resumePosition, playbackRate | ✅ | ✅ | OK |
| plex/media_key | ✅ | ✅ | ✅ INHERITED |
| label | ✅ | ✅ | ✅ INHERITED |
| watchProgress (getter) | ✅ | ✅ | ✅ ADDED |
| watchSeconds (getter) | ✅ | ✅ | ✅ ADDED |
| lastPlayed/playCount | ✅ | ✅ | ✅ ADDED |
| shuffle/continuous/resume/active | ✅ | ✅ | ✅ ADDED |
| maxVideoBitrate/maxResolution | ❌ | ✅ | P2 - Not needed for parity |

### QueueableItem - Coverage: ~75% ✅

| Field | DDD | Legacy/Frontend | Status |
|-------|-----|-----------------|--------|
| traversalMode, isQueueContainer | ✅ | N/A | NEW |
| play/queue actions | ✅ | ✅ | ✅ INHERITED |
| shuffle/resume/active flags | ✅ | ✅ | ✅ INHERITED |
| guid (queue position ID) | ❌ | ✅ | P2 - Optional |
| media/media_key | ✅ | ✅ | ✅ INHERITED |

**Resolved Blockers:**
1. ✅ Action properties (play, queue, list, open) - Added to Item
2. ✅ Media identifiers (plex, media_key) - Added as getters to Item
3. ✅ Watch state fields (watchProgress, watchSeconds, lastPlayed, playCount) - Added to PlayableItem
4. ✅ Behavior flags (shuffle, continuous, resume, active) - Added to PlayableItem

---

## 3. QueueService Audit - Coverage: ~95% ✅

### Implemented Features

| Feature | Status |
|---------|--------|
| Basic watch state integration | ✅ |
| Resume position application | ✅ |
| In-progress detection | ✅ |
| **Priority ordering** (in_progress > urgent > high > medium > low) | ✅ ADDED |
| **skip_after date filtering** | ✅ ADDED |
| **wait_until date filtering** (2-day lookahead) | ✅ ADDED |
| **8-day urgency trigger** (applyUrgency) | ✅ ADDED |
| **hold flag support** (filterByHold) | ✅ ADDED |
| **Day-of-week filtering** (Weekdays, Weekend, M•W•F, T•Th, M•W) | ✅ ADDED |
| **Watched filtering** (90% threshold) | ✅ ADDED |
| **Fallback cascade** (ignoreSkips → ignoreWatchStatus → ignoreWait) | ✅ ADDED |
| **Unified pipeline** (applyFilters, buildQueue) | ✅ ADDED |

### Static Methods Added

- `sortByPriority(items)` - 5-tier priority with stable sort
- `filterBySkipAfter(items, now)` - Remove items past deadline
- `applyUrgency(items, now)` - Mark items urgent within 8 days
- `filterByWaitUntil(items, now)` - 2-day lookahead window
- `filterByHold(items)` - Skip items on hold
- `filterByWatched(items)` - Skip items ≥90% watched
- `filterByDayOfWeek(items, now)` - Day presets and arrays
- `applyFilters(items, options)` - Unified filter pipeline
- `buildQueue(items, options)` - Full queue building with fallback

### Remaining (P2 - Low Priority)

| Feature | Legacy | DDD | Impact |
|---------|--------|-----|--------|
| **recent_on_top sorting** | ✅ | ❌ | LOW - Optional enhancement |

---

## 4. PlexAdapter Audit - Coverage: ~90% ✅

### Fully Implemented (100% Parity)

- ✅ Transcode decision API
- ✅ Transcode URL building
- ✅ Direct stream handling
- ✅ Session management
- ✅ Smart episode selection (selectKeyToPlay)
- ✅ Watchlist priority logic
- ✅ Episode/track metadata mapping
- ✅ **getMetadata(ratingKey)** - Direct metadata fetching - ADDED
- ✅ **getContainerWithChildren(id)** - Bundled parent + children - ADDED

### Methods Added

- `getMetadata(ratingKey)` - Fetches metadata via Plex client, returns null on error
- `getContainerWithChildren(id)` - Returns `{ container, children }` object using parallel fetch

### Remaining (P2 - Low Priority)

| Method | Purpose | Impact |
|--------|---------|--------|
| `loadChildrenFromKey()` | Smart type-aware list resolution | MEDIUM - Can use getList() |
| Type-specific loaders | loadListFromAlbum, loadListFromSeason, etc. | LOW - Covered by getList() |

### Schema Differences

| Legacy Field | DDD Field | Notes |
|--------------|-----------|-------|
| Raw Plex objects | PlayableItem/ListableItem | Different structure |
| `listkey`, `listType` | `id`, `source` | Different naming |
| Flat response | Nested metadata | Breaking for some consumers |

---

## 5. FolderAdapter Audit - Coverage: ~85%

### Fully Implemented

- ✅ Watchlist YAML parsing
- ✅ Watch state loading and merging
- ✅ Priority calculation (in_progress, urgent, medium, low)
- ✅ Item filtering (hold, skip_after, wait_until, watched)
- ✅ Fallback cascade (ignoreSkips → ignoreWatchStatus → ignoreWait)
- ✅ Compound ID construction
- ✅ Plex multi-library handling
- ✅ Watch state caching

### Missing/Different

| Feature | Legacy | DDD | Impact |
|---------|--------|-----|--------|
| **Sort by wait_until date** | ✅ | ❌ | Scheduling UX affected |
| **Watched threshold** | 20s remaining | 60s remaining | More aggressive filtering |
| **Input format** | `src` + `media_key` fields | `input: "source:id"` | Different YAML schema |

---

## 6. LocalContentAdapter Audit - Coverage: ~100%

### All Content Types Complete

| Type | Fields | API Parity | Tests | Status |
|------|--------|------------|-------|--------|
| Talks | title, speaker, date, duration, description | ✅ 100% | ✅ | Ready |
| Scriptures | reference, volume, version, verses, timing | ✅ 100% | ✅ | Ready |
| Hymns | title, number, verses, lyrics | ✅ 100% | ✅ | Ready |
| Primary Songs | title, number, verses, lyrics | ✅ 100% | ✅ | Ready |
| Poems | title, author, condition, verses | ✅ 100% | ✅ | Ready (NEW) |

### Enhancements Over Legacy

- ✅ Path traversal protection (explicit validation)
- ✅ Verse timing support (start/end for audio sync)
- ✅ Poem support (new feature)
- ✅ Better abstraction (adapter vs HTTP)

---

## 7. FilesystemAdapter Audit - Coverage: ~90% ✅

### Fully Implemented

- ✅ Path resolution with prefix fallbacks
- ✅ **Path security validation** (prevents directory traversal)
- ✅ MIME type detection (12 types including images)
- ✅ Watch state loading and caching
- ✅ Directory listing with type filtering
- ✅ Recursive playable resolution
- ✅ **ID3 tag parsing** (music-metadata library) - ADDED
- ✅ **Household-scoped watch state** - ADDED
- ✅ **Image MIME types** (jpg, png, gif, svg, webp) - ADDED

### Features Added

- `_parseAudioMetadata(filePath)` - Extracts artist, album, year, track, genre via music-metadata
- Household-scoped watch state: tries `{householdsBasePath}/{householdId}/history/media_memory/media.yml` first
- Image MIME types: `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.webp`
- `getMimeType(ext)` - Returns correct MIME type for extension
- `getMediaType(ext)` - Returns 'audio', 'video', or 'image'

### Remaining (P2 - Low Priority)

| Feature | Legacy | DDD | Impact |
|---------|--------|-----|--------|
| **Watch status filtering** | ✅ | ❌ | Can't show only unwatched |
| **Image file serving** | ✅ | ❌ | /img endpoint missing |
| **Embedded artwork extraction** | ✅ | ❌ | Thumbnail extraction |
| **Notfound fallback** | ✅ | ❌ | No error.mp3 fallback |

### Improvements Over Legacy

- ✅ **Path security** - Prevents directory traversal attacks
- ✅ **More extensions** - 12+ vs legacy's 4
- ✅ **Strongly typed returns** - PlayableItem/ListableItem
- ✅ **Watch state caching** - Performance improvement
- ✅ **ID3 tag parsing** - Artist/album metadata extraction
- ✅ **Household scoping** - Multi-user support

---

## Implementation Priority

### P0 - Critical (Blocks Core Functionality) - ✅ ALL DONE

| ID | Component | Issue | Status |
|----|-----------|-------|--------|
| P0-1 | Capabilities | Add action properties (play, queue, list) | ✅ DONE |
| P0-2 | Capabilities | Add media identifiers (plex, media_key) | ✅ DONE |
| P0-3 | QueueService | Implement priority ordering | ✅ DONE |
| P0-4 | QueueService | Implement date filtering (skip_after, wait_until) | ✅ DONE |
| P0-5 | PlexAdapter | Add getMetadata() method | ✅ DONE |
| P0-6 | PlexAdapter | Add getContainerWithChildren() method | ✅ DONE |

### P1 - High Priority (Feature Gaps) - ✅ MOSTLY DONE

| ID | Component | Issue | Status |
|----|-----------|-------|--------|
| P1-1 | WatchState | Fix timestamp format (ISO vs moment) | Deferred - Low impact |
| P1-2 | Capabilities | Add watch state fields to PlayableItem | ✅ DONE |
| P1-3 | QueueService | Add day-of-week filtering | ✅ DONE |
| P1-4 | FolderAdapter | Add wait_until sorting | Deferred - Low impact |
| P1-5 | FilesystemAdapter | Add ID3 tag parsing | ✅ DONE |
| P1-6 | FilesystemAdapter | Add household scoping | ✅ DONE |

### P2 - Medium Priority (Quality) - ✅ PARTIALLY DONE

| ID | Component | Issue | Status |
|----|-----------|-------|--------|
| P2-1 | Capabilities | Add behavior flags (shuffle, resume, active) | ✅ DONE |
| P2-2 | WatchState | Add metadata embedding (title, parent) | Deferred |
| P2-3 | FilesystemAdapter | Add image file serving | Deferred |
| P2-4 | QueueService | Add recent_on_top sorting | Deferred |
| P2-5 | FolderAdapter | Align watched threshold (60s → 20s) | Deferred |

---

## Field Naming Inconsistencies

| Legacy Field | DDD Field | Status |
|--------------|-----------|--------|
| `image` | `thumbnail` | Router adds both (line 78 in list.mjs) |
| `playhead` | `resumePosition` | Mapped in router |
| `mediaDuration` | `duration` | Mapped in router |
| `label` | `label` (getter) | ✅ RESOLVED - Added to Item |
| `media_key` | `media_key` (getter) | ✅ RESOLVED - Added to Item |
| `plex` | `plex` (getter) | ✅ RESOLVED - Added to Item |

---

## Implementation Summary (2026-01-13)

### ✅ Phase 1: Critical Capability Gaps - COMPLETE
1. ✅ Extended PlayableItem with watch state fields (watchProgress, watchSeconds, lastPlayed, playCount)
2. ✅ Added action properties (play, queue, list, open) to Item
3. ✅ Added media identifiers (plex, media_key, label) as getters to Item
4. ✅ Added behavior flags (shuffle, continuous, resume, active) to PlayableItem

### ✅ Phase 2: QueueService Completion - COMPLETE
1. ✅ Implemented 5-tier priority system (in_progress > urgent > high > medium > low)
2. ✅ Added date filtering (skip_after, wait_until with 2-day lookahead)
3. ✅ Added day-of-week filtering with presets (Weekdays, Weekend, M•W•F, T•Th, M•W)
4. ✅ Implemented fallback cascade (ignoreSkips → ignoreWatchStatus → ignoreWait)
5. ✅ Added hold and watched filtering (90% threshold)
6. ✅ Created unified pipeline (applyFilters, buildQueue)

### ✅ Phase 3: Adapter Completion - MOSTLY COMPLETE
1. ✅ PlexAdapter: Added getMetadata() and getContainerWithChildren()
2. ⏸️ FolderAdapter: wait_until sorting deferred (low impact)
3. ✅ FilesystemAdapter: Added ID3 parsing, household scoping, image MIME types

### ✅ Phase 4: Router Integration - COMPLETE
1. ✅ Updated list.mjs toListItem() for new Item/PlayableItem fields
2. ✅ All tests passing (86 unit suites, 6 assembly suites)

### Remaining (P2/Low Priority)
- recent_on_top sorting in QueueService
- Image file serving endpoint in FilesystemAdapter
- Embedded artwork extraction
- WatchState timestamp format alignment

---

## Related Files

- Domain Entities: `backend/src/1_domains/content/entities/`
- Domain Capabilities: `backend/src/1_domains/content/capabilities/`
- Domain Services: `backend/src/1_domains/content/services/`
- PlexAdapter: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`
- FolderAdapter: `backend/src/2_adapters/content/folder/FolderAdapter.mjs`
- LocalContentAdapter: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs`
- FilesystemAdapter: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`
- Legacy fetch.mjs: `backend/_legacy/lib/fetch.mjs`
- Legacy media.mjs: `backend/_legacy/routers/media.mjs`
- Legacy plex.mjs: `backend/_legacy/lib/plex.mjs`
