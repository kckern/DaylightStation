# DDD vs Legacy Endpoint Parity Audit

**Date:** 2026-01-12
**Status:** In Progress

## Summary

Ran parity tests comparing DDD endpoints against legacy endpoints. Found 6 failures out of 10 tests.

## Test Results

| Test | Legacy | DDD | Status | Issue |
|------|--------|-----|--------|-------|
| Scripture | `/data/scripture/*` | `/api/local-content/scripture/*` | ✅ PASS | Both errored (path config) |
| Hymn | `/data/hymn/:number` | `/api/local-content/hymn/:number` | ❌ FAIL | DDD returns 404 |
| Primary Song | `/data/primary/:number` | `/api/local-content/primary/:number` | ❌ FAIL | DDD returns 404 |
| Weight History | `/data/lifelog/weight` | `/api/health/weight` | ❌ FAIL | Response structure differs |
| Budget Data | `/data/budget` | `/api/finance/data` | ✅ PASS | |
| Day-to-Day Budget | `/data/budget/daytoday` | `/api/finance/data/daytoday` | ✅ PASS | |
| Entropy | `/home/entropy` | `/api/entropy` | ❌ FAIL | Response structure differs |
| Calendar (home) | `/home/calendar` | `/api/calendar/events` | ❌ FAIL | Response structure differs |
| Calendar (data) | `/data/events` | `/api/calendar/events` | ❌ FAIL | Response structure differs |
| Lifelog | `/api/lifelog` | `/api/lifelog` | ✅ PASS | Same endpoint |

## Root Causes

### 1. LocalContentAdapter Path Configuration (FIXED)

**Issue:** `server.mjs` was passing `dataBasePath` instead of `${dataBasePath}/content` to the LocalContentAdapter.

**Fix Applied:** Updated server.mjs line 263-268:
```javascript
const contentPath = `${dataBasePath}/content`;  // LocalContentAdapter expects content/ subdirectory
const contentRegistry = createContentRegistry({
  mediaBasePath,
  plex: plexConfig,
  dataPath: contentPath,  // Changed from dataBasePath
  watchlistPath
});
```

**Impact:** Fixes hymn, primary, scripture, poem, talk endpoints.

### 2. Response Structure Differences

Several DDD endpoints return different response structures than legacy:

#### Weight History (`/api/health/weight` vs `/data/lifelog/weight`)
- Legacy returns array of `{ date, weight, ... }` keyed by date
- DDD returns `{ status, data: [...] }` wrapper

#### Entropy (`/api/entropy` vs `/home/entropy`)
- Different `items` structure
- Different field names for status indicators

#### Calendar (`/api/calendar/events` vs `/home/calendar`)
- DDD wraps in `{ status, events: [...] }`
- Legacy returns different event structure

### 3. Legacy Endpoint Bugs

Some legacy endpoints also have issues:
- `/data/scripture/*` - ENOENT error for null path
- Path resolution issues in legacy fetch.mjs

## Recommendations

### Immediate Fixes Needed

1. **Restart dev server** to pick up LocalContentAdapter path fix
2. **Update health.mjs** - Match legacy response structure for `/weight`
3. **Update entropy.mjs** - Match legacy response structure
4. **Update calendar.mjs** - Match legacy response structure OR update frontend

### Response Structure Decision

Two options:
1. **DDD matches legacy exactly** - Easier frontend migration, no frontend changes
2. **DDD uses new structure** - Cleaner API, requires frontend updates

Recommend option 1 for parity, then clean up in Phase 6.

## Next Steps

1. Restart dev server with LocalContentAdapter fix
2. Re-run parity tests
3. Fix remaining response structure differences
4. Add more endpoint coverage to parity tests
5. Run full parity suite before frontend migration

## Files Modified

- `backend/src/server.mjs` - Fixed contentPath for LocalContentAdapter
- `tests/integration/api/parity.test.mjs` - Created parity test suite
