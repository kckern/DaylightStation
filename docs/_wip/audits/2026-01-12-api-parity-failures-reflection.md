# API Parity Failures Reflection & Audit Plan

**Date:** 2026-01-12
**Status:** Post-Mortem
**Severity:** High - Multiple production-impacting issues

---

## Executive Summary

The Content Domain API migration has revealed a systemic failure in achieving parity with legacy endpoints. Multiple issues were discovered during frontend integration testing that should have been caught during initial development. This document catalogs the failures, identifies root causes, and proposes a comprehensive audit plan.

---

## Catalog of Failures

### 1. Missing `info` Object (FitnessShow.jsx)

**Issue:** `/api/list/plex/:id/playable` returned `info: null` instead of show metadata.

**Impact:** Show info panel rendered empty - no poster, title, summary displayed.

**Root Cause:** `list.mjs` router never built the `info` object. No consideration given to FitnessShow's data contract.

**Fix Applied:** Added `getContainerInfo()` method to PlexAdapter, integrated into list router.

---

### 2. Missing `seasons` Object (FitnessShow.jsx)

**Issue:** Season grouping data not returned in API response.

**Impact:** Season selector could not group episodes properly.

**Root Cause:** No analysis of how legacy API structured season data.

**Fix Applied:** Built `seasons` map from episode metadata in list router.

---

### 3. Double Prefix Bug (`plex:plex:id`)

**Issue:** Frontend sent showId as `plex:664455`, creating path `/api/list/plex/plex:664455/playable`.

**Impact:** `getContainerInfo()` failed to parse the ID, returned null.

**Root Cause:** Single `replace(/^plex:/, '')` didn't handle multiple prefixes.

**Fix Applied:** While loop to strip all `plex:` prefixes.

---

### 4. Missing `rating` Field (FitnessMenu.jsx)

**Issue:** Shows not sorted correctly - `rating` field missing from API response.

**Impact:** FitnessMenu's `.sort((a, b) => (b.rating || 0) - (a.rating || 0))` produced wrong order.

**Root Cause:** `_toListableItem()` didn't extract Plex rating fields.

**Fix Applied:** Added `rating: item.userRating ?? item.rating ?? item.audienceRating` to metadata.

---

### 5. Missing Progress/Memory Fields (FitnessShow.jsx)

**Issue:** Episode watch progress not displayed - `watchProgress`, `resumePosition`, `watchSeconds` all null.

**Impact:** Users couldn't see which episodes they'd partially watched.

**Root Cause:** `list.mjs` didn't flatten `resumePosition` from PlayableItem, didn't calculate `watchProgress`.

**Fix Applied:** Added progress field flattening and percentage calculation.

---

### 6. Progress Bar Not Rendering (Pending Investigation)

**Issue:** Even with `watchProgress: 51`, progress bar may not render.

**Suspected Cause:** `isResumable` check in FitnessShow depends on show labels from `info.labels`. If labels empty, `isResumable` is false, progress bar hidden.

**Status:** Not yet fixed.

---

## Root Cause Analysis

### Systemic Failures

1. **No Frontend Contract Analysis**
   - Built API without reading frontend components that consume it
   - Assumed field names without verification
   - No mapping of legacy response → new response

2. **Insufficient Test Coverage**
   - Runtime tests focused on "does it return data" not "is the data correct"
   - No field-by-field parity assertions
   - No frontend integration tests during initial development

3. **Incremental Discovery Pattern**
   - Each fix revealed another missing piece
   - Reactive debugging instead of proactive specification

4. **Metadata Flattening Gap**
   - Domain entities (PlayableItem, ListableItem) had data
   - Router layer failed to expose it in response
   - No systematic review of what frontend expects vs what API returns

---

## Comprehensive Audit Plan

### Phase 1: Document Legacy API Contracts

For each legacy endpoint, capture:
- Full response JSON structure
- All fields with types and example values
- Which frontend components consume it
- Which fields are required vs optional

**Endpoints to Audit:**
| Legacy Endpoint | New Endpoint | Frontend Consumer |
|-----------------|--------------|-------------------|
| `/media/plex/list/:id` | `/api/list/plex/:id` | FitnessMenu, FitnessShow |
| `/media/plex/list/:id/playable` | `/api/list/plex/:id/playable` | FitnessShow |
| `/media/plex/info/:id` | `/api/play/plex/:id` | VideoPlayer |
| `/data/list/:path` | `/api/list/folder/:path` | TVApp Menu |
| `/data/scripture/:ref` | `/api/local-content/scripture/:ref` | OfficeApp |
| `/data/hymn/:num` | `/api/local-content/hymn/:num` | OfficeApp, TVApp |
| `/media/log` | `/api/progress` | FitnessPlayer |

### Phase 2: Create Parity Test Suite

For each endpoint pair, create tests that:
1. Call legacy endpoint, capture response
2. Call new endpoint, capture response
3. Assert field-by-field equality (or documented transformation)

```javascript
test('PARITY: /api/list/plex/:id matches legacy', async () => {
  const legacy = await fetch('/media/plex/list/364853').then(r => r.json());
  const newApi = await fetch('/api/list/plex/364853').then(r => r.json());

  // Assert all expected fields exist
  expect(newApi.items[0]).toHaveProperty('rating');
  expect(newApi.items[0]).toHaveProperty('label');
  expect(newApi.items[0]).toHaveProperty('image');

  // Assert values match (with documented transformations)
  expect(newApi.items[0].rating).toBe(legacy.items[0].rating);
});
```

### Phase 3: Frontend Integration Sweep

For each frontend component using Plex/content APIs:
1. Read component source
2. List all fields accessed from API response
3. Verify new API returns each field
4. Add to parity test suite

**Components to Audit:**
- `FitnessMenu.jsx` - show listing, sorting, thumbnails
- `FitnessShow.jsx` - info panel, episodes, seasons, progress
- `FitnessPlayer.jsx` - playback, progress logging
- `FitnessMusicPlayer.jsx` - playlist, shuffle
- `TVApp.jsx` - menu navigation
- `ContentScroller.jsx` - item rendering
- `VideoPlayer.jsx` - stream URL, resume position

### Phase 4: Runtime Visual Regression Tests

Expand Playwright tests to:
1. Navigate to each view
2. Screenshot key UI states
3. Assert visual elements render (not just "no crash")
4. Check for progress bars, posters, metadata display

---

## Immediate Actions

1. **Fix Progress Bar** - Investigate `isResumable` logic, ensure labels propagate
2. **Create Parity Test File** - `tests/integration/api/plex-parity.test.mjs`
3. **Document All API Contracts** - Add to `docs/reference/core/content-api.md`
4. **Review Remaining Endpoints** - Apply same rigor to folder, local-content, proxy routes

---

## Lessons Learned

1. **Read the consumer first** - Frontend code defines the contract, not backend assumptions
2. **Test at integration level** - Unit tests on adapters miss router-level flattening issues
3. **One-shot migrations are risky** - Should have run legacy + new in parallel with diff testing
4. **Explicit over implicit** - Document every field transformation, don't assume "it's obvious"

---

## Accountability

This migration was executed without adequate specification or verification. The pattern of "discover issue → fix → discover next issue" is unacceptable for production code. A systematic audit before any further migration work is required.
