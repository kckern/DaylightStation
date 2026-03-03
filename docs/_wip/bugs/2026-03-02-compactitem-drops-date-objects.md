# compactItem() Silently Drops Date Objects

**Date:** 2026-03-02
**Status:** Identified, workaround applied
**Severity:** Medium — data silently disappears from API responses

## Summary

`compactItem()` in `backend/src/4_api/v1/routers/list.mjs` silently drops JavaScript `Date` objects from API responses. Any field whose value is a `Date` object (rather than a string) is removed entirely, causing data loss in the API output.

## Root Cause

Two-part issue:

1. **js-yaml parses unquoted timestamps as `Date` objects.** The backend uses `js-yaml` (`yaml.load()`) in `FileIO.mjs`. When a YAML value like `lastPlayed: 2025-08-06 12:38:19.000` is unquoted, `js-yaml` parses it as a JavaScript `Date` object instead of a string.

2. **`compactItem()` drops `Date` objects.** The function (line ~14-56 in `list.mjs`) recursively processes objects and removes "empty" ones. Since `typeof dateObj === 'object'` is true for Date instances, it recurses into `compactItem(dateObj)`. But `Object.keys(new Date())` returns `[]` (no enumerable own properties), so the Date is treated as empty and dropped.

## Impact

Any YAML data file with unquoted timestamp values will have those fields silently removed from API responses after passing through `toListItem()` → `compactItem()`. The data exists on disk but never reaches the frontend.

## Discovered Via

Backfilling `14_fitness.yml` with entries from fitness session history. The CLI script used the `yaml` v2 npm package which writes unquoted timestamps by default. All 301 backfilled entries had `watchedDate=NONE` in the API despite having valid `lastPlayed` values on disk.

## Workaround Applied

Quoted all `lastPlayed` values in `14_fitness.yml` so `js-yaml` parses them as strings. Updated the CLI backfill script to quote dates in its output.

## Proper Fix (TODO)

`compactItem()` should handle `Date` objects — either convert them to ISO strings or pass them through unchanged. Example:

```javascript
// In compactItem(), add early return for Date instances
if (value instanceof Date) return value.toISOString();
```

This would prevent silent data loss regardless of how YAML values are quoted.

## Files Involved

- `backend/src/4_api/v1/routers/list.mjs` — `compactItem()` function
- `backend/src/0_system/utils/FileIO.mjs` — `loadYaml()` uses `js-yaml`
- `data/household/history/media_memory/plex/14_fitness.yml` — data file (workaround applied)
