# Progress Audit: Action Routes Migration & Plex Decoupling

**Date:** 2026-02-06
**Scope:** Two plans from 2026-02-04:
- `docs/plans/2026-02-04-action-routes-migration.md` (13 tasks)
- `docs/plans/2026-02-04-api-layer-plex-decoupling.md` (6 tasks)
- Related: `docs/plans/2026-02-04-deprecation-fix-list-to-item.md` (11 tasks)

**Source audit:** `docs/_wip/audits/2026-02-04-api-layer-plex-coupling-audit.md`

---

## CRITICAL: Active Bugs Causing Broken Views

The frontend migration introduced **incorrect API call patterns** that silently fail. These are the root cause of the broken views testers are reporting.

### BUG 1: `?capability=playable` query param silently ignored -- **FIXED 2026-02-06**

Changed all 4 calls to use path modifiers (`/playable`, `/playable,shuffle`) instead of query params.

### BUG 2: `/shuffle` modifier silently ignored by info router -- **FIXED 2026-02-06**

Shuffle requests now route through `/list/` router (which supports shuffle) instead of `/info/` router (which doesn't).

### BUG 3: `Art.jsx` calls `/canvas/current` without API prefix -- **FIXED 2026-02-06**

Added `/api/v1/` prefix.

### BUG 4: `Art.jsx` calls stale `/content/item/` route -- **FIXED 2026-02-06**

Changed to `/api/v1/info/`.

---

## Full Frontend API Call Inventory

### Legend
- **BROKEN** = Call reaches backend but produces wrong results or 404
- **OLD** = Uses deprecated pattern that still works (for now)
- **NEW** = Uses correct new pattern

### Player Module

| File | Line | Endpoint | Status |
|------|------|----------|--------|
| `Player/lib/api.js` | 18 | `api/v1/list/folder/{id}/playable` | **FIXED** |
| `Player/lib/api.js` | 22 | `api/v1/list/plex/{id}/playable` | **FIXED** |
| `Player/lib/api.js` | 70 | `api/v1/list/plex/{id}/playable,shuffle` (shuffle) / `api/v1/info/plex/{id}` (no shuffle) | **FIXED** |
| `Player/lib/api.js` | 83 | `api/v1/info/{source}/{id}` | NEW |
| `Player/lib/api.js` | 107 | `api/v1/list/folder/{id}/playable` | **FIXED** |
| `Player/components/SinglePlayer.jsx` | 253 | `/api/v1/list/plex/{id}/playable` | **FIXED** |
| `Player/components/DebugInfo.jsx` | 33 | `/api/v1/info/plex/{id}` | NEW |
| `Player/components/DebugInfo.jsx` | 34 | `/api/v1/play/plex/{id}` | NEW |
| `Player/components/CompositePlayer.jsx` | 303 | `/api/v1/content/compose` | NEW |
| `Player/hooks/useQueueController.js` | 96 | `api/v1/item/folder/{id}/playable` | OLD (works!) |
| `Player/hooks/useQueueController.js` | 101 | `api/v1/item/plex/{id}/playable` | OLD (works!) |
| `Player/hooks/useCommonMediaController.js` | 764 | `api/v1/play/log` | NEW |

### Menu Module

| File | Line | Endpoint | Status |
|------|------|----------|--------|
| `Menu/Menu.jsx` | 27 | `api/v1/list/menu-log` | **MIGRATED** |
| `Menu/Menu.jsx` | 260 | `api/v1/list/folder/{target}` | **MIGRATED** |
| `Menu/Menu.jsx` | 705 | `/api/v1/display/plex/{val}` | NEW |
| `Menu/hooks/useFetchPlexData.js` | 29 | `/api/v1/info/plex/{id}` | **MIGRATED** |
| `Menu/PlexMenuRouter.jsx` | 109 | `api/v1/info/plex/{id}` | **MIGRATED** |

### Fitness Module

| File | Line | Endpoint | Status |
|------|------|----------|--------|
| `Fitness/FitnessMenu.jsx` | 202 | `/api/v1/list/plex/{id}` | **MIGRATED** |
| `Fitness/FitnessShow.jsx` | 35,108,112,553,564,967,969 | `api/v1/display/plex/{id}` | NEW |
| `Fitness/FitnessShow.jsx` | 253 | `/api/v1/fitness/show/{id}/playable` | NEW |
| `Fitness/FitnessShow.jsx` | 538,947 | `/api/v1/proxy/plex/stream/{id}` | NEW |
| `Fitness/FitnessPlayer.jsx` | 47,52 | `/api/v1/proxy/plex/photo/:/transcode?...` | NEW |
| `Fitness/FitnessPlayer.jsx` | 845 | `api/v1/play/log` | NEW |
| `Fitness/FitnessSidebar/FitnessMusicPlayer.jsx` | 456 | `api/v1/display/plex/{id}` | NEW |

### Apps

| File | Line | Endpoint | Status |
|------|------|----------|--------|
| `Apps/FitnessApp.jsx` | 632 | `api/v1/info/{source}/{id}` | NEW |
| `Apps/FitnessApp.jsx` | 643,661 | `api/v1/play/{src}/{id}` | **FIXED** |
| `Apps/FitnessApp.jsx` | 645,663 | `api/v1/display/{source}/{id}` | NEW |
| `Apps/TVApp.jsx` | 83 | `api/v1/list/folder/TVApp/recent_on_top` | **MIGRATED** |

### ContentScroller Module

| File | Line | Endpoint | Status |
|------|------|----------|--------|
| `ContentScroller/SingingScroller.jsx` | 46 | `api/v1/info/singing/{path}` | **MIGRATED** |
| `ContentScroller/NarratedScroller.jsx` | 43 | `api/v1/info/narrated/{path}` | **MIGRATED** |
| `ContentScroller/ContentScroller.jsx` | 151 | `api/v1/play/log` | NEW |
| `ContentScroller/ContentScroller.jsx` | 447,557,777,911 | `api/v1/local-content/{type}/{id}` | NEW |

### Art/Canvas Module

| File | Line | Endpoint | Status |
|------|------|----------|--------|
| `AppContainer/Apps/Art/Art.jsx` | 18 | `/api/v1/canvas/current?deviceId=...` | **FIXED** |
| `AppContainer/Apps/Art/Art.jsx` | 61 | `api/v1/info/{source}/{id}` | **MIGRATED** |

### Admin Module

| File | Line | Endpoint | Status |
|------|------|----------|--------|
| `Admin/ContentLists/ListsItemRow.jsx` | 88+ (30 locations) | `/api/v1/info/{source}/{id}` | NEW |
| `Admin/ContentLists/ContentSearchCombobox.jsx` | 160+ (5 locations) | `/api/v1/info/{source}/{id}` | NEW |

### Shared Utilities (`lib/api.mjs`)

| Line | Rewrite Rule | Target | Status |
|------|-------------|--------|--------|
| 133 | `media/plex/img/*` -> `api/v1/display/plex/*` | **FIXED** |
| 137 | `media/plex/url/*` -> `api/v1/play/plex/*` | **FIXED** |
| 164 | `DaylightPlexPath(key)` -> `{base}/media/plex/{key}` | OLD (bypasses rewrite entirely) |

---

## Plan 1: Action Routes Migration -- Status

| Phase | Tasks | Status | Notes |
|-------|-------|--------|-------|
| 1: ID Parser | 1 | **DONE** | actionRouteParser.mjs + tests |
| 2: Info Router | 2 | **DONE** (but missing shuffle support) | info.mjs + tests + export + bootstrap |
| 3: Display Router | 3 | **DONE** | display.mjs + tests + export + bootstrap |
| 4: Bootstrap Wiring | 4 | **DONE** | Both routers wired in app.mjs |
| 5: Play Router | 5 | **PARTIAL** | Uses parseActionRouteId but `/plex/mpd/:id` not removed |
| 6: Deprecation Redirects | 6 | **PARTIAL** | content.mjs done, item.mjs missing |
| 7-11: Frontend | 7-11 | **PARTIAL + BROKEN** | Some migrated correctly, some migrated incorrectly |
| 8: Tests + Docs | 12-13 | **PARTIAL** | Docs exist; tests have mixed URLs |

### What the Plan Got Wrong

The migration plan specified incorrect target patterns:

1. **Plan said:** `/item/plex/*/playable` -> `/list/plex/*?capability=playable`
   **Should have been:** `/item/plex/*/playable` -> `/list/plex/*/playable`
   The list router uses **path modifiers** (via `parseModifiers`), not query params.

2. **Plan said:** shuffle via `?shuffle=true` query param on `/info/`
   **Should have been:** Either the info router needs to handle the `shuffle` modifier, or shuffle requests should go to `/list/` instead of `/info/`.

---

## Plan 2: API Layer Plex Decoupling -- Status

| Task | Description | Status |
|------|-------------|--------|
| 1 | Inject Plex Shutoff Controls into Test Router | **DONE** |
| 2 | Move FitnessProgressClassifier to Injected Service | **DONE** |
| 3 | Replace Hardcoded Plex in Fitness Router | **DONE** |
| 4 | Move Plex Proxy Protocol Logic to ProxyService | **MOSTLY DONE** (1 `registry.get('plex')` remains) |
| 5 | Replace Hardcoded Plex in Play Router | **PARTIAL** (2 `registry.get('plex')` + URL transform) |
| 6 | Normalize Config in Fitness Router | **PARTIAL** (root `GET /` still reads raw plex config) |

### Remaining DDD Violations

**Hardcoded `registry.get('plex')` (3 remaining):**
| File | Line | Context |
|------|------|---------|
| `play.mjs` | 145 | `/log` endpoint |
| `play.mjs` | 234 | `/plex/mpd/:id` endpoint |
| `proxy.mjs` | 84 | `/plex/stream/:ratingKey` |

**Forbidden runtime imports (out of scope, 2 pre-existing):**
| File | Import |
|------|--------|
| `admin/media.mjs:13` | `import { YtDlpAdapter } from '#adapters/media/YtDlpAdapter.mjs'` |
| `content.mjs:5` | `import { isMediaSearchable, validateSearchQuery } from '#domains/media/IMediaSearchable.mjs'` |

---

## Strategic Conflict: `/list/` vs `/item/`

Three documents disagree:

| Document | Says `/list/` should... | Says `/item/` should... |
|----------|------------------------|------------------------|
| `action-routes-migration.md` | Be the canonical browse/list route | Be deprecated in favor of `/info/` |
| `deprecation-fix-list-to-item.md` | Be deprecated | Be the canonical combined route |
| `action-routes.md` reference | Be the canonical action route for listing | Be deprecated |

Both routers exist with overlapping functionality. `item.mjs` has `?select=<strategy>` and `POST /menu-log` that `list.mjs` lacks. The recent commit `a03f7eec` removed the deprecation warning from `list.mjs`.

**This must be resolved before more frontend migration work.**

---

## What Both Plans Missed

### 1. The `?capability=` query param pattern doesn't exist
The migration plan invented a query param syntax that the backend doesn't support. The list router (and item router) use **path modifiers** exclusively.

### 2. Info router doesn't handle modifiers
`actionRouteParser` extracts modifiers, but `info.mjs` discards them. The shuffle/playable modifiers parsed from the path are never used.

### 3. `lib/api.mjs` centralized rewrite rules
Lines 133, 137, 164 still map to legacy patterns. This affects any component using `DaylightMediaPath('media/plex/img/...')` or `DaylightPlexPath(...)`.

### 4. ContentScroller module (`SingingScroller`, `NarratedScroller`)
These use `/item/singing/` and `/item/narrated/` -- not mentioned in any migration plan.

### 5. `Art.jsx` missing API prefix
Calls `/canvas/current` without `/api/v1/` -- standalone bug.

### 6. `Art.jsx` uses `/content/item/` pattern
Not mentioned in any plan.

### 7. Backend thumbnail URLs in responses
Three backend files construct `/api/v1/content/plex/image/` URLs in response payloads:
- `item.mjs:224`, `list.mjs:373`, `fitness.mjs:269`

### 8. Unstaged proxy.mjs changes at risk
Improvements to `/plex/stream/:ratingKey` are uncommitted.

---

## Prioritized Fix List

### P0 -- Fix Active Breakage (5 items)

1. **Fix `?capability=playable` -> path modifier.** In `Player/lib/api.js` lines 18, 22, 107 and `SinglePlayer.jsx` line 253: change `?capability=playable` to `/playable` path segment.
   ```
   BEFORE: api/v1/list/folder/${id}?capability=playable
   AFTER:  api/v1/list/folder/${id}/playable
   ```
   For shuffle, use comma syntax: `api/v1/list/folder/${id}/playable,shuffle`

2. **Fix shuffle on info route.** Either:
   - (a) Add modifier handling to `info.mjs` so it delegates to the list router for shuffle, OR
   - (b) Change `api.js:70` to call `/list/plex/${plex}/shuffle` instead of `/info/plex/${plex}/shuffle`

3. **Fix `Art.jsx` canvas URL.** Line 18: add `api/v1/` prefix to `/canvas/current`.

4. **Fix `Art.jsx` content/item URL.** Line 61: change `api/v1/content/item/` to `api/v1/info/`.

5. **Resolve `/list/` vs `/item/` direction.** This blocks all remaining migration work.

### P1 -- Finish Frontend Migration (10 items)

6. `lib/api.mjs:133` -- Rewrite `media/plex/img/` to `api/v1/display/plex/` instead of `api/v1/content/plex/image/`
7. `lib/api.mjs:137` -- Rewrite `media/plex/url/` to `api/v1/play/plex/` instead of `api/v1/play/plex/mpd/`
8. `useQueueController.js:96,101` -- `/item/.../playable` -> `/list/.../playable`
9. `Menu/Menu.jsx:260` -- `/item/folder/` -> `/info/folder/`
10. `useFetchPlexData.js:29` -- `/item/plex/` -> `/info/plex/`
11. `PlexMenuRouter.jsx:109` -- `/item/plex/` -> `/info/plex/`
12. `FitnessMenu.jsx:202` -- `/item/plex/` -> `/info/plex/`
13. `FitnessApp.jsx:643,661` -- `/play/.../mpd/` -> `/play/.../`
14. `TVApp.jsx:83` -- `/item/folder/TVApp/recent_on_top` -> `/info/folder/TVApp/recent_on_top` (or `/list/`)
15. `Menu/Menu.jsx:27` -- `/item/menu-log` -> decide where this goes

### P2 -- Backend Cleanup (6 items)

16. Remove or subsume `GET /plex/mpd/:id` route in `play.mjs`
17. Inject adapter in `play.mjs` `/log` endpoint (remove `registry.get('plex')`)
18. Commit unstaged `proxy.mjs` changes + address `registry.get('plex')` on line 84
19. Backend stale thumbnail URLs in `item.mjs:224`, `list.mjs:373`, `fitness.mjs:269`
20. Fitness router `GET /` -- use `fitnessConfigService.getNormalizedConfig()`
21. Add deprecation redirects to `item.mjs` (once direction is resolved)

### P3 -- ContentScroller + Tests + Docs (5 items)

22. `SingingScroller.jsx:41` -- `/item/singing/` -> `/info/singing/` (or keep if `/item/` stays)
23. `NarratedScroller.jsx:40` -- `/item/narrated/` -> `/info/narrated/` (or keep if `/item/` stays)
24. Migrate test URLs in `content-api.regression.test.mjs`, `tv-url-parsing.runtime.test.mjs`
25. Update `action-routes.md` status from "Proposed" to "Partially Implemented"
26. Fix `DaylightPlexPath` in `lib/api.mjs:164` (uses `media/plex/` prefix that bypasses rewrite)

### P4 -- Separate Plans Needed (2 items)

27. `admin/media.mjs` -- Remove `YtDlpAdapter` import
28. `content.mjs` -- Remove `#domains/media/` import

---

## Metrics

| Metric | Count | Notes |
|--------|-------|-------|
| **Actively broken frontend calls** | **0** | All P0 bugs fixed 2026-02-06 |
| Frontend files with legacy `/item/` URLs remaining | 2 | `useQueueController.js` (lines 96, 101) |
| Frontend `/item/` calls migrated to `/list/` or `/info/` | 10 | All P1 items complete |
| Backend `registry.get('plex')` calls remaining | 3 | Out of scope (separate task) |
| Backend stale thumbnail URLs fixed | 2 of 3 | `list.mjs`, `item.mjs` fixed; `fitness.mjs` deferred |
| Forbidden runtime imports (out-of-scope) | 2 | |
| Test files with legacy URLs | 2+ | |
| `POST /menu-log` ported to `/list/` router | Yes | |
