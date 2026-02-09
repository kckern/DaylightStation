# Content Taxonomy Redesign — Implementation Audit

**Date:** 2026-02-09
**Branch:** `feature/content-taxonomy-redesign`
**Worktree:** `.worktrees/content-taxonomy`
**Plan:** `.claude/plans/keen-purring-frog.md` (7 phases)

---

## Executive Summary

The content taxonomy redesign is **roughly 60% implemented** across the 7-phase plan. The backend foundation (Phase 1) is substantially complete. The unified Play API (Phase 2) has format resolution wired in. Frontend decoupling (Phase 3) is partially done — `SinglePlayer` has format-based dispatch but legacy code paths remain. Phases 4-7 are in various stages from stub to not-started.

**Critical anti-pattern found:** `TVApp.jsx` duplicates ContentIdResolver logic with hardcoded source-to-contentId mappings (lines 198-207). This caused 3 production bugs (wrong adapter for `?primary=`, `?talk=`, `?poem=` URLs) that were fixed during this sprint.

---

## Branch State

### Uncommitted Changes

**17 modified files** (existing code):
- `bootstrap.mjs` — ContentIdResolver wired into DI, distributed to 6 routers
- 6 API routers (`play`, `info`, `list`, `queue`, `siblings`, `display`) — resolver integration + `format` field
- `actionRouteParser.mjs` — source-agnostic (hardcoded KNOWN_SOURCES removed)
- `SinglePlayer.jsx` — `CONTENT_FORMAT_COMPONENTS` registry, format-based dispatch
- `TVApp.jsx` — 3 bug fixes in hardcoded mappings
- `contentRenderers.jsx` — rekeyed by format
- `queryParamResolver.js` — loads prefixes from config API
- Various adapters (manifest/prefix registration)

**28 new (untracked) files**:
- Phase 1: `ContentIdResolver.mjs`, `sourceConfigSchema.mjs`, `FilesystemDriver.mjs`, `ScriptureResolver`
- Phase 2: `resolveFormat.mjs`, `fetchPlayInfo.js`
- Phase 4: `AppRegistryDriver.mjs`, `PlayableAppShell.jsx`, `PagedReader.jsx`, `FlowReader.jsx`
- Phase 5: `listConfigNormalizer.mjs`, `migrate-list-configs.mjs`
- Phase 6: `SavedQueryService.mjs`, `QueryDriver.mjs`, `queries.mjs` router
- Tests: 107 isolated test cases across 9 files, 4 Playwright E2E suites
- Docs: `content-id-resolver.md`

---

## Phase-by-Phase Status

### Phase 1: Backend Foundation — COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Content Sampler | Done | `tests/_lib/contentSampler.mjs` |
| 1.2 Regression Test Suite | Done | `tv-content-regression.runtime.test.mjs` |
| 1.3 ContentIdResolver | Done | 5-layer chain, 94 lines, 19 unit tests |
| 1.4 Wire into Bootstrap | Done | Distributed to 6 API routers via `app.set()` |
| 1.5 Source Config Schema | Done | `normalizeSourceConfig()` — legacy + new format |
| 1.6 Filesystem Driver | Done | singalong/readalong/generic modes |
| 1.7 Scripture Resolver | Done | Standalone plugin extracted from `localContent.mjs` |
| 1.8 Regression Gate | Done | All tests pass |

**Assessment:** Solid foundation. ContentIdResolver is the single most impactful change — eliminates scattered ID resolution across routers.

### Phase 2: Unified Play API — MOSTLY COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| 2.1 Format field in responses | Done | `resolveFormat.mjs` — 4-level priority chain |
| 2.2 Extend play router | Done | Singalong/readalong/alias resolution |
| 2.3 Frontend fetchPlayInfo | Partial | File exists but **unused** — `SinglePlayer` uses `fetchMediaInfo()` |
| 2.4 Regression Gate | Done | |

**Issue:** `fetchPlayInfo.js` was created per plan but never integrated. `SinglePlayer` still calls `fetchMediaInfo()` (which hits `/api/v1/play/` and `/api/v1/info/` separately). The plan intended `fetchPlayInfo()` to be the unified entry point. Not blocking — both paths work — but it's dead code.

### Phase 3: Frontend Decoupling — PARTIALLY COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| 3.1 Format-based dispatch | Done | `CONTENT_FORMAT_COMPONENTS` in SinglePlayer |
| 3.2 actionRouteParser source-agnostic | Done | No hardcoded sources |
| 3.3 Remove hardcoded collection knowledge | Partial | `getCategoryFromId()` still exists, legacy prop destructuring preserved |
| 3.4 Rekey contentRenderers by format | Done | Keyed by `singalong`/`readalong` |
| 3.5 Replace canvas adapters with alias | Not started | Canvas adapters still active |
| 3.6 Regression Gate | Blocked on 3.3, 3.5 |

**Issue:** Legacy code paths in `SinglePlayer.jsx` (lines 83-93) still build `effectiveContentId` from destructured legacy props (`hymn`, `primary`, `scripture`, `talk`, `poem`). These should ultimately be handled by TVApp's URL parsing feeding into ContentIdResolver, not by SinglePlayer re-implementing alias logic. But removing them breaks backward compat until TVApp is also fixed.

### Phase 4: PlayableAppShell + Readable — STUBS ONLY

| Task | Status | Notes |
|------|--------|-------|
| 4.1 AppRegistryDriver | Done | Backend driver + manifest + tests |
| 4.2 PlayableAppShell | Stub | Component exists, not wired into format dispatch |
| 4.3 Komga manifest | Done | `manifest.mjs` created |
| 4.4 Readable stubs | Stub | `PagedReader.jsx`, `FlowReader.jsx` — placeholder components |
| 4.5 Regression Gate | Not run |

### Phase 5: List Config Migration — CODE COMPLETE, NOT INTEGRATED

| Task | Status | Notes |
|------|--------|-------|
| 5.1 List normalizer | Done | `listConfigNormalizer.mjs` + 9 unit tests |
| 5.2 Wire into ListAdapter | Not started | ListAdapter still reads old format directly |
| 5.3 Migration CLI tool | Done | `cli/migrate-list-configs.mjs` (dry-run tested) |
| 5.4 Regression Gate | Not run |

**Issue:** The normalizer exists and is tested but not wired into `ListAdapter.mjs`. Running the migration tool would convert YAML files to new format, but the adapter doesn't read the new format yet.

### Phase 6: Query Driver — CODE EXISTS, NOT INTEGRATED

| Task | Status | Notes |
|------|--------|-------|
| 6.1 SavedQueryService | Done | Service + tests |
| 6.2 QueryDriver | Done | Driver + manifest + tests |
| 6.3 Query CRUD routes | Done | `queries.mjs` router |
| 6.4 Regression Gate | Not run |

**Issue:** The query routes exist in `queries.mjs` but may not be mounted in `app.mjs`. Needs verification.

### Phase 7: Documentation + Cleanup — PARTIALLY DONE

| Task | Status | Notes |
|------|--------|-------|
| 7.1 Deprecate localContent.mjs | **Not started** | No deprecation headers |
| 7.2 Extract business logic from routers | Not started | play.mjs still has domain logic |
| 7.3 Standardize error handling | Not started | play.mjs still uses raw try/catch |
| 7.4 Extract Plex-specific routes | Not started | `/plex/mpd/:id` still in play.mjs |
| 7.5 Delete dead code | Not started | Legacy shims still exist |
| 7.6 Update documentation | Partial | Reference docs reorganized, content-id-resolver.md written |
| 7.7 Final regression gate | Not run |

---

## Anti-Patterns Found

### 1. TVApp.jsx Hardcoded Source Mappings (CRITICAL)

**Location:** `frontend/src/Apps/TVApp.jsx:198-207`

```javascript
hymn:      (value) => ({ play: { contentId: `singalong:hymn/${value}`, ... } }),
song:      (value) => ({ play: { contentId: `singalong:song/${value}`, ... } }),
primary:   (value) => ({ play: { contentId: `singalong:primary/${value}`, ... } }),
talk:      (value) => ({ play: { contentId: `talk:${value}`, ... } }),
poem:      (value) => ({ play: { contentId: `poem:${value}`, ... } }),
scripture: (value) => ({ play: { contentId: `readalong:scripture/${value}`, ... } }),
```

**Problem:** This duplicates ContentIdResolver's alias logic in the frontend. When aliases change (e.g., `poem` → `readalong:poetry/` not `readalong:poem/`), this code must be updated in sync. It already caused 3 bugs:
- `primary` mapped to `readalong:primary/` instead of `singalong:primary/`
- `poem` mapped to `readalong:poem/` instead of `readalong:poetry/`
- `talk` had no `contentId` at all

**Fix:** TVApp should pass the raw query param value (e.g., `hymn:166`) as `contentId` and let ContentIdResolver handle it. The backend already supports this.

### 2. Dual ID Resolution in SinglePlayer (MODERATE)

**Location:** `frontend/src/modules/Player/components/SinglePlayer.jsx:83-93`

```javascript
const effectiveContentId = rawContentId
  || (singalong ? `singalong:${singalong}` : null)
  || (readalong ? `readalong:${readalong}` : null)
  || (hymn ? `singalong:hymn/${hymn}` : null)
  || (primary ? `singalong:primary/${primary}` : null)
  || (scripture ? `readalong:scripture/${scripture}` : null);
```

**Problem:** SinglePlayer re-implements alias resolution that should be handled upstream (TVApp URL parsing or backend ContentIdResolver). This creates a second place where alias mappings must be maintained.

**Fix:** Remove legacy prop destructuring from SinglePlayer. All content should arrive as `contentId` already resolved by TVApp or the menu system.

### 3. localContent.mjs Still Active Without Deprecation (MODERATE)

**Location:** `backend/src/4_api/v1/routers/localContent.mjs`

The plan (Task 7.1) calls for adding `Deprecation` and `Sunset` headers. This hasn't been done. The router still handles `/scripture/*`, `/talk/*`, `/poem/*` endpoints with hardcoded scripture resolution logic that overlaps with the ScriptureResolver plugin.

### 4. Unused fetchPlayInfo.js (LOW)

**Location:** `frontend/src/modules/Player/lib/fetchPlayInfo.js`

Created per plan but never imported anywhere. SinglePlayer uses `fetchMediaInfo()` instead. This is dead code.

### 5. Legacy Adapter Shims Still Present (LOW)

**Files:**
- `backend/src/1_adapters/content/singing/SingingAdapter.mjs` — thin wrapper around SingalongAdapter
- `backend/src/1_adapters/content/narrated/NarratedAdapter.mjs` — thin wrapper around ReadalongAdapter

These exist for backward compatibility but add indirection. The plan (Task 7.5) calls for deleting them once all references use canonical names.

---

## DDD Compliance Assessment

### API Layer (4_api)

| Router | Compliance | Issues |
|--------|-----------|--------|
| `play.mjs` | Moderate | `isInProgress()`, `createMediaProgressDTO()`, watch-time calculation are domain logic. POST /log has Plex-specific branching. `/plex/mpd/:id` is adapter-specific route. |
| `info.mjs` | Good | `deriveCapabilities()` is generic, uses `asyncHandler`. Format field via `resolveFormat()`. |
| `list.mjs` | Moderate | `toListItem()` (157 lines) contains Plex conditionals (`isPlex = item.source === 'plex'`), metadata flattening, watch state mapping. Should be application/domain layer. |
| `queue.mjs` | Good | Thin delegator to adapter.resolvePlayables(). |
| `siblings.mjs` | Excellent | Pure delegation to SiblingsService. |
| `display.mjs` | Good | Thin delegation. |
| `localContent.mjs` | Poor | Contains `VOLUME_RANGES`, `resolveScripturePath()`, `getDefaultVersion()` — all domain logic. Should be in ScriptureResolver. |

### Application Layer (3_applications)

| Service | Assessment |
|---------|-----------|
| `ContentIdResolver` | Good — pure resolution logic, no I/O |
| `SavedQueryService` | Good — dependency-injected reader |
| `SiblingsService` | Good — delegates to adapters |
| `ItemSelectionService` | Good — strategy pattern |

### Adapter Layer (1_adapters)

| Adapter | Assessment |
|---------|-----------|
| `SingalongAdapter` | Good — owns format detection, YAML loading, duration calculation |
| `ReadalongAdapter` | Good — scripture resolver, multi-source watch history |
| `PlexAdapter` | Massive (2100 lines) but self-contained — transcode decisions, smart selection |
| `FilesystemDriver` (new) | Good — clean interface, format-configurable |
| `AppRegistryDriver` (new) | Good — simple app lookup |
| `listConfigNormalizer` (new) | Good — pure transformation, no side effects |

---

## Test Coverage

### Isolated Tests (vitest)

| Suite | Tests | Status |
|-------|-------|--------|
| `ContentIdResolver.test.mjs` | 19 | Pass |
| `sourceConfigSchema.test.mjs` | 3 | Pass |
| `FilesystemDriver.test.mjs` | 5 | Pass |
| `ScriptureResolver.test.mjs` | 3 | Pass |
| `AppRegistryDriver.test.mjs` | 3 | Pass |
| `QueryDriver.test.mjs` | ~5 | Pass |
| `listConfigNormalizer.test.mjs` | 9 | Pass |
| `SavedQueryService.test.mjs` | 3 | Pass |
| `actionRouteParser.test.mjs` | ~20 | Pass |
| **Total** | **~70** | |

### Live API Tests (vitest)

| Suite | Status |
|-------|--------|
| `content-id-resolver.test.mjs` | Exists |
| `format-field.test.mjs` | Exists |
| `unified-play.test.mjs` | Exists |

### Playwright E2E Tests

| Suite | Tests | Status |
|-------|-------|--------|
| `tv-content-urls.runtime.test.mjs` | 71 | Pass |
| `tv-content-regression.runtime.test.mjs` | ~40+ (dynamic) | Exists |
| `tv-format-dispatch.runtime.test.mjs` | ~4 | Exists |
| `tv-unified-play-frontend.runtime.test.mjs` | ~2 | Exists |

### Coverage Gaps

1. **No tests for `resolveFormat.mjs`** — the 4-level priority chain has no unit tests
2. **No tests for PlayableAppShell, PagedReader, FlowReader** — stubs with no test coverage
3. **No integration test for list normalizer in ListAdapter** — normalizer tested in isolation but not wired
4. **No test for TVApp URL-to-contentId mapping** — the hardcoded mappings that caused 3 bugs have zero test coverage
5. **No test for `fetchPlayInfo.js`** — dead code, also untested

---

## Configuration Audit

### Content Prefix Config

**Backend source of truth:** `api/v1/config/content-prefixes` endpoint
**Frontend consumer:** `queryParamResolver.js` fetches on load, falls back to hardcoded map

**System aliases (from ContentIdResolver):**
```
hymn       → singalong:hymn
primary    → singalong:primary
scripture  → readalong:scripture
talk       → readalong:talks
poem       → readalong:poetry
local      → watchlist:
singing    → singalong:
narrated   → readalong:
list       → menu:
```

**Household aliases:** None configured yet (empty object in bootstrap).

### Format Resolution Chain

**File:** `backend/src/4_api/v1/utils/resolveFormat.mjs`

Priority order:
1. `item.metadata.contentFormat` (adapter-set during getItem)
2. `adapter.contentFormat` (driver-level default)
3. `item.mediaType` (from media probe)
4. `'video'` (fallback)

**Known formats:** `video`, `audio`, `dash_video`, `singalong`, `readalong`, `app`, `readable_paged`, `readable_flow`

### Data Layout

| Collection | YAML Path | Audio Path | Count |
|-----------|-----------|-----------|-------|
| Hymns | `data/content/singalong/hymn/*.yml` | `media/audio/singalong/hymn/*.mp3` | 401 |
| Primary | `data/content/singalong/primary/*.yml` | `media/audio/singalong/primary/*.mp3` | 239 |
| Scripture | `data/content/readalong/scripture/{vol}/{ver}/*.yml` | `media/audio/readalong/scripture/` | 42,663 verses |
| Talks | `data/content/readalong/talks/ldsgc/**/*.yaml` | `media/video/readalong/talks/ldsgc/` | 71 |
| Poetry | `data/content/readalong/poetry/remedy/*.yaml` | `media/audio/readalong/poetry/remedy/*.mp3` | 74 |
| Menus | `data/household/config/lists/menus/*.yml` | — | 16 files |
| Watchlists | `data/household/config/lists/watchlists/*.yml` | — | 7 files |
| Programs | `data/household/config/lists/programs/*.yml` | — | 5 files |

---

## Recommendations

### Immediate (Before Merge)

1. **Remove or integrate `fetchPlayInfo.js`** — either wire it into SinglePlayer or delete the dead code
2. **Add deprecation headers to `localContent.mjs`** — trivial change, documents intent
3. **Add unit tests for `resolveFormat.mjs`** — critical path with no coverage

### Short-Term (Next Sprint)

4. **Make TVApp URL parsing config-driven** — replace hardcoded mappings with a fetch to `/api/v1/config/content-prefixes` that returns the alias table, then build contentIds from that
5. **Wire listConfigNormalizer into ListAdapter** — the code exists but isn't connected
6. **Remove legacy prop destructuring from SinglePlayer** — once TVApp passes canonical contentIds
7. **Delete legacy adapter shims** (SingingAdapter, NarratedAdapter)

### Medium-Term

8. **Extract domain logic from play.mjs** — move `isInProgress()`, `createMediaProgressDTO()`, watch-time calculation to domain/application layer
9. **Extract `toListItem()` from list.mjs** — 157 lines of transformation with Plex conditionals belongs in application layer
10. **Replace canvas adapters with filesystem aliases** — Phase 3.5 from plan
11. **Implement PagedReader and FlowReader** — currently stubs

---

## File Inventory

### New Files (untracked, not yet committed)

```
backend/src/0_system/config/sourceConfigSchema.mjs
backend/src/1_adapters/content/app-registry/AppRegistryDriver.mjs
backend/src/1_adapters/content/app-registry/manifest.mjs
backend/src/1_adapters/content/filesystem/FilesystemDriver.mjs
backend/src/1_adapters/content/filesystem/manifest.mjs
backend/src/1_adapters/content/filesystem/resolvers/scripture.mjs
backend/src/1_adapters/content/list/listConfigNormalizer.mjs
backend/src/1_adapters/content/query/QueryDriver.mjs
backend/src/1_adapters/content/query/manifest.mjs
backend/src/1_adapters/content/readable/komga/manifest.mjs
backend/src/3_applications/content/ContentIdResolver.mjs
backend/src/3_applications/content/SavedQueryService.mjs
backend/src/4_api/v1/routers/queries.mjs
backend/src/4_api/v1/utils/resolveFormat.mjs
cli/migrate-list-configs.mjs
docs/reference/content/content-id-resolver.md
frontend/src/modules/Player/components/FlowReader.jsx
frontend/src/modules/Player/components/PagedReader.jsx
frontend/src/modules/Player/components/PlayableAppShell.jsx
frontend/src/modules/Player/lib/fetchPlayInfo.js
tests/_lib/contentSampler.mjs
tests/isolated/...  (9 test suites)
tests/live/...      (4 test suites)
```

### Modified Files

```
backend/src/0_system/bootstrap.mjs          — ContentIdResolver DI
backend/src/4_api/v1/routers/play.mjs       — resolver + format
backend/src/4_api/v1/routers/info.mjs       — resolver + format
backend/src/4_api/v1/routers/list.mjs       — resolver
backend/src/4_api/v1/routers/queue.mjs      — resolver
backend/src/4_api/v1/routers/siblings.mjs   — resolver
backend/src/4_api/v1/routers/display.mjs    — resolver
backend/src/4_api/v1/utils/actionRouteParser.mjs — source-agnostic
backend/src/app.mjs                         — route mounting
frontend/src/Apps/TVApp.jsx                 — 3 bug fixes
frontend/src/modules/Player/components/SinglePlayer.jsx — format dispatch
frontend/src/lib/contentRenderers.jsx       — rekeyed by format
frontend/src/lib/queryParamResolver.js      — config-driven prefixes
frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx — format-aware
frontend/src/modules/ContentScroller/ReadalongScroller.jsx — minor
frontend/src/modules/ContentScroller/SingalongScroller.jsx — minor
```

### Archived (moved)

```
docs/reference/content/*.md (10 files) → docs/_archive/content-reference-pre-taxonomy/
docs/_wip/plans/2026-02-08-content-taxonomy-redesign/ (7 files) → docs/reference/content/
```
