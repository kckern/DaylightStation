# Plex ID Canonical Location Design

**Date:** 2026-01-23
**Status:** Implemented

## Problem

The dev API endpoint `/api/v1/list/folder/TVApp/recent_on_top` returned items with redundant plex identifiers at two locations:

1. **Top-level:** `item.plex` and `item.media_key`
2. **In action objects:** `item.play.plex`, `item.queue.plex`, `item.list.plex`

This violated the Single Source of Truth principle and caused:
- 7x larger response size compared to prod (25KB vs 3.5KB)
- Confusing data model - which `plex` value is canonical?
- Potential for inconsistent access patterns across frontend components

## Solution

Establish action objects as the **single source of truth** for plex identifiers.

### Backend Changes (list.mjs)

Removed top-level flattening of `plex` and `media_key`:

1. Removed lines 36-37 that copied `item.plex` and `item.media_key` to top-level
2. Removed line 82 that extracted `plex` from metadata to top-level
3. Removed line 135 that extracted `media_key` from metadata to top-level

### Frontend Changes

Updated components to access plex ID from action objects consistently:

**FitnessMenu.jsx:**
- Added `getPlexId(item)` helper: `item.play?.plex || item.queue?.plex || item.list?.plex`
- Added `getItemKey(item)` helper for unique identifiers
- Updated all usages of `item.plex` and `show.plex` to use helpers

**FitnessContext.jsx:**
- Added `getPlexIdFromActions(item)` helper
- Added `getItemIdentifier(item)` helper with backward compatibility fallback
- Updated `trackRecentlyPlayed` to use helper

### Canonical Access Pattern

```javascript
// CORRECT - access from action objects
const plexId = item.play?.plex || item.queue?.plex || item.list?.plex;

// INCORRECT - do not use top-level plex
const plexId = item.plex; // This field no longer exists
```

## Results

| Metric | Before | After Plex Fix | After Active Filter |
|--------|--------|----------------|---------------------|
| Response size | 25,631 bytes | 24,155 bytes | 17,369 bytes |
| Item count | 35 | 35 | 25 |
| Items with top-level `plex` | 35 | 0 | 0 |
| Items with top-level `media_key` | 35 | 0 | 0 |

Prod comparison: 26 items, 3,530 bytes (1 item difference is data variance, not code issue).

Note: The remaining size difference (17KB vs 3.5KB) is due to metadata flattening for FitnessShow compatibility.

## Active Filter Fix

Added `active === false` check to `FolderAdapter._shouldSkipItem()` to match legacy behavior.

Items filtered out: Aladdin, Birthday, Christmas, Christmas Eve, Christmas Movies, Christmas Stage, Classical, News, School, Tab Choir

## Sorting Fix (recent_on_top)

Changed `recent_on_top` sorting to use `menu_memory` (menu selection timestamps) instead of `lastPlayed` (play history).

**Before:** Sorted by when item was last played (watch history)
**After:** Sorted by when item was last selected in the menu (menu_memory)

### Changes

- `ConfigService.mjs`: Added `getHouseholdPath(relativePath, householdId)` method
- `list.mjs`: Load menu_memory using `configService.getHouseholdPath('history/menu_memory')`
- `list.mjs`: Added `getMenuMemoryKey()` helper to extract media key from Item.actions
- `bootstrap.mjs`: Pass `loadFile` and `configService` to createListRouter
- `app.mjs`: Pass `configService` to createApiRouters

## Related Code

- `backend/src/0_infrastructure/config/ConfigService.mjs:101-110` - Added getHouseholdPath method
- `backend/src/4_api/routers/list.mjs:36-37,82,135` - Removed plex/media_key flattening
- `backend/src/4_api/routers/list.mjs:176-193` - Added getMenuMemoryKey helper
- `backend/src/4_api/routers/list.mjs:316-330` - Changed recent_on_top to use menu_memory via configService
- `backend/src/0_infrastructure/bootstrap.mjs:194,201` - Pass configService to list router
- `backend/src/app.mjs:259` - Pass configService to createApiRouters
- `backend/src/2_adapters/content/folder/FolderAdapter.mjs:212` - Added active filter
- `frontend/src/modules/Fitness/FitnessMenu.jsx:7-23` - Added getPlexId/getItemKey helpers
- `frontend/src/context/FitnessContext.jsx:30-50` - Added getPlexIdFromActions/getItemIdentifier helpers
