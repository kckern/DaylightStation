# Watch History System Audit

**Date:** 2026-02-02
**Scope:** DDD compliance, data format inconsistencies, key matching issues
**Commit:** cd2b27e8

---

## Executive Summary

The watch history system had accumulated multiple anti-patterns and inconsistencies over time. This audit documents the underlying issues, evaluates the quality of fixes applied, and identifies remaining technical debt.

**Verdict:** ~60% clean architectural fix, ~40% duct tape over legacy data formats.

---

## Issue 1: DDD Layer Violations

### Problem
API routers (layer 4) were directly calling internal adapter methods:

```javascript
// BEFORE: fitness.mjs, item.mjs, list.mjs
if (typeof adapter._loadViewingHistory === 'function') {
  viewingHistory = adapter._loadViewingHistory();
}
```

The underscore prefix `_loadViewingHistory` indicates a private/internal method. API routers should only interact with application services (layer 3), not reach into adapter internals.

### Root Cause
Organic growth without architectural review. Watch history was bolted on to each router independently, duplicating logic across 4+ files.

### Fix Applied
Created public `enrichWithWatchState()` method on ContentQueryService (application layer):

```javascript
// AFTER: All routers use same interface
items = await contentQueryService.enrichWithWatchState(items, 'plex', containerId);
```

**Quality Assessment:** ✅ **Clean fix** - Proper DDD layering restored.

---

## Issue 2: N+1 Query Pattern

### Problem
The original ContentQueryService enrichment was O(N) file reads:

```javascript
// BEFORE: Called per-item
return Promise.all(items.map(async (item) => {
  const storagePath = await adapter.getStoragePath(item.id);  // API call
  const progress = await this.#mediaProgressMemory.get(item.id, storagePath);  // File read
  ...
}));
```

For a show with 18 episodes, this made 18 API calls + 18 file reads.

### Fix Applied
Batch loading with single storage path resolution:

```javascript
// AFTER: 1 API call + 1 file read
const storagePath = await adapter.getStoragePath(containerId);
const allProgress = await this.#mediaProgressMemory.getAll(storagePath);
const progressMap = new Map(allProgress.map(p => [p.itemId, p]));
// O(1) lookup per item
```

**Quality Assessment:** ✅ **Clean fix** - Proper batch optimization.

---

## Issue 3: Inconsistent YAML Field Names

### Problem
Watch history YAML files use inconsistent field names:

| Library | Duration Field | Playhead Field | Notes |
|---------|---------------|----------------|-------|
| 14_fitness.yml (older) | `mediaDuration` | `playhead` | Legacy Plex format |
| 24_church-series.yml (newer) | `duration` | `playhead` | Canonical format |
| Scripture files | N/A | `seconds` | Different schema entirely |

Example from **14_fitness.yml** (older entries):
```yaml
plex:8316:
  playhead: 40
  mediaDuration: 724      # Legacy field name
  lastPlayed: 2025-12-07 22.54.56
```

Example from **24_church-series.yml** (newer entries):
```yaml
plex:455677:
  playhead: 182
  duration: 182           # Canonical field name
  percent: 100
  watchTime: 0
```

### Fix Applied
Added fallback chain in `YamlMediaProgressMemory._toDomainEntity()`:

```javascript
let duration = data.duration ?? data.mediaDuration ?? 0;
const playhead = data.playhead ?? data.seconds ?? 0;
```

**Quality Assessment:** ⚠️ **Duct tape** - This normalizes on read but doesn't fix the source data. The YAML files remain inconsistent. A migration script should canonicalize all watch history files.

---

## Issue 4: Missing Duration in Watch History

### Problem
Some watch history entries have `playhead` but no `duration`:

```yaml
# Entry from Dig In show - missing duration entirely
plex:672469:
  title: Introducing Dig In
  playhead: 60
  playCount: 8
  lastPlayed: 2026-01-24 10.40.02
  # NO duration field!
```

This causes `percent` to be 0 even when we have playhead data.

### Root Cause
Different Plex recording modes. When playback is tracked via Plex webhooks, duration may not always be captured. Newer recording code includes duration; older entries don't.

### Fix Applied
Calculate percent from item metadata when progress lacks duration:

```javascript
const duration = progress.duration || item.duration || 0;
let percent = progress.percent ?? 0;
if (percent === 0 && playhead > 0 && duration > 0) {
  percent = Math.round((playhead / duration) * 100);
}
```

**Quality Assessment:** ⚠️ **Duct tape** - Relies on Plex API being available to provide item.duration. If Plex is offline, percent calculation fails. The proper fix would be to always store duration in watch history.

---

## Issue 5: Key Format Inconsistencies

### Problem
Multiple key formats existed across the codebase:

| Location | Key Format | Example |
|----------|-----------|---------|
| YAML keys | `plex:672449` | Compound ID with prefix |
| item.id | `plex:672449` | Compound ID (matches) |
| item.localId | `672449` | Bare ID (no prefix) |
| Old router lookups | `itemKey` | Tried multiple formats |

Old code attempted multiple lookups to handle inconsistency:
```javascript
const itemKey = item.localId || item.metadata?.plex || item.metadata?.key;
const watchData = viewingHistory[itemKey] || viewingHistory[String(itemKey)];
```

### Fix Applied
Standardized on compound ID format `plex:672449`:
- YAML keys: `plex:672449`
- progressMap keys: `p.itemId` (compound)
- Lookup: `progressMap.get(item.id)` (compound)

**Quality Assessment:** ✅ **Clean fix** - Single canonical format. But legacy code paths may still exist elsewhere.

---

## Issue 6: Storage Path Resolution

### Problem
Watch history files are partitioned by Plex library:
- `plex/14_fitness.yml`
- `plex/24_church-series.yml`
- etc.

The library ID must be determined by querying Plex metadata. If Plex is offline, storage path resolution fails.

### Fix Applied
Added fallback scanning:

```javascript
if (allProgress.length === 0 && usesFallback) {
  allProgress = await this.#mediaProgressMemory.getAllFromAllLibraries('plex');
}
```

**Quality Assessment:** ⚠️ **Duct tape** - Scanning all library files is O(N) where N = total watch history entries across all libraries. For large libraries, this is expensive. A better solution would be to cache library mappings or store the library ID in the YAML entry.

---

## Summary: Clean Work vs Duct Tape

### Clean Architectural Fixes (60%)
1. ✅ DDD layer separation - ContentQueryService as proper application service
2. ✅ Batch optimization - O(1) storage path + O(1) file read
3. ✅ Key format standardization - Compound IDs throughout
4. ✅ Public API contract - `enrichWithWatchState()` with clear interface

### Duct Tape Over Anti-patterns (40%)
1. ⚠️ Field name normalization - Reading `mediaDuration` as fallback
2. ⚠️ Duration calculation - Using item metadata when history lacks duration
3. ⚠️ Fallback scanning - O(N) scan of all libraries when path resolution fails
4. ⚠️ Legacy field support - `seconds`, `time` field fallbacks

---

## Recommended Follow-up Work

### P0 - Data Migration ✅
Run migration script to canonicalize all watch history YAML files:
- Rename `mediaDuration` → `duration`
- Rename `seconds` → `playhead` (scripture files)
- Add `duration` to entries that lack it (query Plex for metadata)

**Completed:** `cli/migrate-watch-history.mjs` migrated 2252 entries across 21 files.

### P1 - Schema Validation ✅
Add schema validation to `YamlMediaProgressMemory.set()` to ensure new entries use canonical format.

**Completed:**
- `mediaProgressSchema.mjs` defines canonical/legacy field constants
- `validateCanonicalSchema()` detects legacy field usage
- `YamlMediaProgressMemory.set()` logs warning when legacy fields detected (non-blocking)
- 69 unit tests verify schema validation works correctly

**Commits:** 104c322, 3fda072, f5bed4f

### P2 - Library ID Caching
Cache Plex library ID → storage path mappings to avoid API calls on every request.

### P3 - Offline Resilience
Store library ID in each YAML entry so storage path can be determined without Plex API.

---

## Files Changed

| File | Change Type | Notes |
|------|-------------|-------|
| `ContentQueryService.mjs` | **Architectural** | New public method, batch loading |
| `YamlMediaProgressMemory.mjs` | **Duct tape** | Field normalization, fallback scanning |
| `fitness.mjs` | **Cleanup** | Removed direct adapter calls |
| `item.mjs` | **Cleanup** | Removed direct adapter calls |
| `list.mjs` | **Cleanup** | Removed direct adapter calls |
| `content.mjs` | **Cleanup** | Removed direct adapter calls |
| `bootstrap.mjs` | **Wiring** | Pass contentQueryService to routers |
| `app.mjs` | **Wiring** | Pass contentQueryService to fitness |

---

## Appendix: Data Format Examples

### Canonical Format (target)
```yaml
plex:672449:
  playhead: 2043
  duration: 2043
  percent: 100
  playCount: 1
  lastPlayed: '2025-11-24 12:27:51'
  watchTime: 2043
```

### Legacy Format A (Plex webhook)
```yaml
plex:8316:
  playhead: 40
  mediaDuration: 724       # Non-canonical
  playCount: 1
  lastPlayed: 2025-12-07 22.54.56
```

### Legacy Format B (missing duration)
```yaml
plex:672469:
  playhead: 60
  playCount: 8
  lastPlayed: 2026-01-24 10.40.02
  # No duration - requires Plex API lookup
```

### Legacy Format C (scripture)
```yaml
scripture:ot:genesis:1:
  seconds: 120             # Non-canonical field name
  percent: 45
  time: 2025-12-01 08:30   # Non-canonical field name
```
