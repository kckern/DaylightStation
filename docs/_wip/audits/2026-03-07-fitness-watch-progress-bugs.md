# Fitness Watch Progress Bugs Audit

**Date:** 2026-03-07
**Status:** In Progress

## Summary

Eccentric Upper and Eccentric Lower (P90X3) workouts completed on Mar 2-3 were not showing as watched in the UI. Investigation revealed three distinct bugs:

---

## Bug 1: `toListItem` overwrites classified watchProgress with Plex viewOffset

**Severity:** High — breaks watched badges for all fitness content
**File:** `backend/src/4_api/v1/routers/list.mjs` lines 229-236

### Problem

The `toListItem()` function first correctly reads `watchProgress` and `watchSeconds` from the classified item (lines 120-121), then **unconditionally overwrites** them with Plex's `resumePosition`-derived values (lines 232-235):

```js
// Line 120: Correctly reads classified watchProgress (e.g., 100%)
if (item.watchProgress !== undefined) base.watchProgress = item.watchProgress;

// ... later ...

// Lines 229-236: OVERWRITES with Plex viewOffset (e.g., 17%)
if (item.resumePosition !== undefined && item.resumePosition !== null) {
    base.resumePosition = item.resumePosition;
    base.resumeSeconds = item.resumePosition;
    base.watchSeconds = item.resumePosition;    // <-- OVERWRITES classified value
    if (item.duration && item.duration > 0) {
      base.watchProgress = Math.round((item.resumePosition / item.duration) * 100); // <-- OVERWRITES
    }
}
```

### Impact

- `FitnessPlayableService.#classifyItem()` correctly computes `watchProgress: 100` and `watchSeconds: 1960` from media_memory
- `toListItem()` then overwrites these with `resumePosition: 338` (from Plex `viewOffset`), producing `watchProgress: 17`
- The `isWatched` and `lastPlayed` fields survive (set independently), but progress bars and percent badges show wrong values
- Watched badge only appears when `isWatched: true` AND `watchedDate` is set, so the visual impact depends on the frontend logic

### Fix

Lines 229-236 should NOT overwrite `watchProgress` or `watchSeconds` if they were already set by the classification pipeline. Either:
- Guard with `if (base.watchProgress === undefined)` before overwriting
- Or move the resumePosition block BEFORE the watchProgress assignment

---

## Bug 2: play.log sends `type: 'episode'` instead of `type: 'plex'` for some items

**Severity:** High — progress writes go to wrong storage file
**File:** `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` line 846

### Problem

```js
type: currentItem.source || (currentItem.plex ? 'plex' : null) || currentItem.type || 'files',
```

The `currentItem` comes from `handlePlayEpisode` in FitnessShow.jsx which sets `type: episode.type || 'episode'` (line 608). When `currentItem.source` is undefined and `currentItem.plex` is falsy (or the item came from a code path that didn't set it), the type falls through to `currentItem.type` which is `'episode'`.

### Impact

- `POST /api/v1/play/log` receives `type: 'episode'`, so `getStoragePath()` isn't called on the plex adapter
- Progress is written to `episode.yml` as `episode:600174` instead of `plex/14_fitness.yml` as `plex:600174`
- `enrichWithWatchState` reads from `plex/14_fitness.yml` and never finds the progress
- Evidence: `episode.yml` on prod contained `episode:600174` with correct Mar 2 data; `plex/14_fitness.yml` had stale Sep 2025 data

### Fix

The play.log type resolution should ensure Plex items always send `type: 'plex'`. The `plex` field is set on queue items (line 593 of FitnessShow.jsx), so the `currentItem.plex ? 'plex' : null` check should work — but only if `plex` is truthy. Investigate why it's falsy for some items (may be a `0` or `null` value issue, or an item that bypassed `handlePlayEpisode`).

Also in `toListItem` (list.mjs line 166-167): `plex` is intentionally NOT copied to top-level from metadata. But the frontend's `extractPlexId` reads `episode.plex` (FitnessShow.jsx line 561). If the item went through `toListItem` which stripped `plex` from top-level, then the frontend can't find it. The queue item construction in FitnessShow has its own `extractPlexId` that handles this, but other code paths may not.

---

## Bug 3: Stale duplicate `media_memory/media_memory/` directory

**Severity:** Low — data confusion only, didn't affect runtime
**Status:** RESOLVED

### Problem

A nested `media_memory/media_memory/` directory existed with 520 entries (subset of the 823 in the correct `media_memory/` path). This stale copy was syncing to Dropbox/local machines, causing confusion during investigation.

### Resolution

- Deleted the duplicate directory on 2026-03-07
- Also resolved 3 Dropbox conflicted copies (fitness, tv-shows, episode) by merging unique entries from conflicted copies into main files

---

## Bug 4: Dropbox conflicted copies accumulating

**Severity:** Low — data integrity risk over time
**Status:** RESOLVED (one-time), needs monitoring

### Problem

Three Dropbox conflicted copies found on 2026-03-03, caused by `kckern-server` (dev) and Docker (prod) both writing to the same Dropbox-synced data directory simultaneously.

### Files affected

- `14_fitness (kckern-server's conflicted copy 2026-03-03).yml` — subset of main (no merge needed)
- `8_tv-shows (kckern-server's conflicted copy 2026-03-03).yml` — had 6 entries missing from main (merged)
- `episode (kckern-server's conflicted copy 2026-03-03).yml` — had 1 entry missing from main (merged)

### Resolution

Merged unique entries, deleted conflicted files. Multi-environment dev server writes may continue to cause conflicts.

---

## Data Fixes Applied

1. Updated `plex:600174` (Eccentric Upper) in `14_fitness.yml`: playhead 825->1960, percent 42->100, lastPlayed Sep 2025 -> Mar 2 2026
2. Added `plex:600175` (Eccentric Lower) to `14_fitness.yml`: playhead 2004, percent 100, lastPlayed Mar 3 2026
3. Merged missing entries from Dropbox conflicted copies
4. Deleted stale `media_memory/media_memory/` directory
5. Deleted all Dropbox conflicted copies
