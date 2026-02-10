# Content Reference Compliance Audit

**Date:** 2026-02-09
**Scope:** Full codebase audit against `docs/reference/content/` specifications
**Reference docs:** content-model.md, content-id-resolver.md, content-sources.md, content-configuration.md, content-navigation.md, content-playback.md, content-progress.md, quick-reference.md

---

## Executive Summary

The codebase is **partially compliant** with the content reference documentation. The naming migration (singing->singalong, narrated->readalong) is largely complete, the 5-layer resolution chain is implemented correctly, and format-based dispatch works as documented. However, there are significant gaps: the adapter contract diverges from docs (notably `getPlayInfo()` and `format` field don't exist as documented), collection names are hardcoded throughout backend and frontend code violating the "Collections Are Config, Not Code" principle, the unified source config hasn't been implemented, and several documented APIs/renderers are missing or stubbed.

**Compliance by area:**

| Area | Status | Details |
|------|--------|---------|
| Naming taxonomy (singing/narrated migration) | ~95% | Adapters/components renamed; only test filenames retain legacy names |
| API routes | ~90% | All action routes exist; `GET /api/v1/read/:source/*` missing; legacy `local-content` endpoints still active (with deprecation headers) |
| Adapter contract | ~60% | `getPlayInfo()` not implemented; `format` field doesn't exist (code uses `mediaType`); inconsistent return types |
| Playable Contract (renderers) | ~85% | All documented props passed; VideoPlayer missing `hardReset`; `onStartupSignal` only in scroller renderers |
| Collections as config, not code | ~40% | Extensive hardcoding of collection names in LocalContentAdapter, frontend resolvers, admin UI, and websocket handler |
| Configuration structure | ~75% | Directory structure matches; config still split (not unified `sources:` block); menus still use legacy format |
| Content ID resolution | ~95% | 5-layer chain correctly implemented |

---

## Finding 1: Adapter Contract Diverges from Documentation

**Severity:** High (documentation inaccuracy)
**Reference:** content-sources.md "Adapter Contract", content-model.md "Unified Play API"

### 1a. `getPlayInfo()` documented but not implemented

The docs define `getPlayInfo(localId)` as the playable capability method. **No adapter implements this method.** Instead, adapters return playback data from `getItem()` as `PlayableItem` instances (or plain objects).

**Actual contract** (from `IContentSource.mjs` validation):
- Required: `getItem()`, `getList()`, `resolvePlayables()`, `resolveSiblings()`
- Optional (not validated): `getThumbnail()`, `search()`, `getCapabilities()`, `getContainerType()`

**Action:** Update docs to reflect actual contract, or implement `getPlayInfo()` across adapters.

### 1b. `format` field doesn't exist as documented — code uses `mediaType`

The docs state adapters return a `format` field (e.g., `{ format: 'singalong', ... }`). In reality:
- `PlayableItem` class uses `mediaType` property (values: `audio`, `video`, `dash_video`, `live`, `composite`)
- SingalongAdapter and ReadalongAdapter return plain objects without a `format` or `mediaType` field
- The frontend's SinglePlayer.jsx dispatches by `mediaInfo?.format` — meaning the API layer adds this field via `resolveFormat.mjs` between adapter and HTTP response

**Affected files:**
- `backend/src/3_applications/content/ports/Playable.mjs` — PlayableItem has `mediaType`, not `format`
- `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:667` — sets `mediaType: 'dash_video'`
- `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs:97-116` — returns plain object, no format field
- `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs:166-187` — returns plain object, no format field
- `backend/src/4_api/v1/utils/resolveFormat.mjs` — adds `format` field to API responses (4-level priority chain)

**Action:** Reconcile docs with code. The `resolveFormat.mjs` layer bridges the gap at the API level, but the adapter contract docs should describe what adapters actually return (`mediaType`) vs what the API response includes (`format`).

### 1c. `resolveReadables()` documented but not implemented

Docs list `resolveReadables(localId)` for the `readable` capability. **No adapter implements this method.** AudiobookshelfAdapter and KomgaAdapter return `ReadableItem` from `getItem()` instead.

**Action:** Remove from docs or implement.

### 1d. Inconsistent return types across adapters

| Adapter | Returns | Should Return |
|---------|---------|---------------|
| PlexAdapter | `PlayableItem` / `ListableItem` instances | Correct |
| FileAdapter | `PlayableItem` / `ListableItem` instances | Correct |
| SingalongAdapter | Plain objects | `PlayableItem` instances |
| ReadalongAdapter | Plain objects | `PlayableItem` instances |
| AudiobookshelfAdapter | `PlayableItem` / `ReadableItem` instances | Correct |

**Action:** Refactor SingalongAdapter and ReadalongAdapter to return Item class instances.

### 1e. `getStoragePath()` is de-facto required but undocumented

Multiple adapters implement `getStoragePath()` for watch state persistence (PlexAdapter, SingalongAdapter, ReadalongAdapter, FileAdapter). This is effectively a required method but missing from the documented contract.

**Action:** Add `getStoragePath()` to docs.

---

## Finding 2: Collection Names Hardcoded Throughout Code

**Severity:** High (architectural violation)
**Reference:** content-model.md "Design Principle: Collections Are Config, Not Code"

The docs explicitly state: "The code knows about drivers, formats, capabilities, and the Playable Contract. It knows nothing about collections." The codebase violates this extensively.

### 2a. LocalContentAdapter — hardcoded if/else chains

**File:** `backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs`

Multiple methods branch on collection names:

**`getStoragePath()` (lines 472-480):**
```javascript
if (prefix === 'talk') return 'talk';
if (prefix === 'scripture') return 'scripture';
if (prefix === 'hymn') return 'singalong';
if (prefix === 'primary') return 'singalong';
if (prefix === 'poem') return 'poetry';
```

**`getItem()` (lines 491-511):**
```javascript
if (prefix === 'talk') return this._getTalk(localId);
if (prefix === 'scripture') return this._getScripture(localId);
if (prefix === 'hymn') return this._getSong('hymn', localId);
if (prefix === 'primary') return this._getSong('primary', localId);
if (prefix === 'poem') return this._getPoem(localId);
```

**`listCollection()` (lines 580-596):**
```javascript
if (collection === 'hymn' || collection === 'primary') return this._listSongs(collection);
if (collection === 'talk') return this._listTalkFolders();
if (collection === 'scripture') return this._listScriptureVolumes();
if (collection === 'poem') return this._listPoemCollections();
```

**`_getSong()` (line 1347):**
```javascript
const preferences = collection === 'hymn' ? ['_ldsgc', ''] : [''];
```

**Action:** Replace hardcoded branches with a config-driven collection registry where each collection declares its properties (storage path, handler, content type).

### 2b. Frontend queryParamResolver — hardcoded prefix map

**File:** `frontend/src/lib/queryParamResolver.js:16-22`
```javascript
legacyPrefixMap = {
  hymn: 'singalong:hymn',
  primary: 'singalong:primary',
  scripture: 'readalong:scripture',
  talk: 'readalong:talks',
  poem: 'readalong:poetry'
};
```

The code tries to load this from the backend config endpoint but falls back to hardcoded values. If the backend is unreachable, these hardcoded values take over.

**Action:** Ensure backend config endpoint is always available before frontend needs it, or accept the fallback as intentional resilience.

### 2c. Frontend contentRenderers — hardcoded cssType

**File:** `frontend/src/lib/contentRenderers.jsx:37`
```javascript
const singalongRenderer = { cssType: 'hymn', wrapperClass: 'hymn-text' };
```

ALL singalong collections (hymn, primary, future ones) share this cssType. New singalong collections cannot have their own CSS styling without code changes.

**Action:** CSS type should come from adapter/manifest metadata per collection, not be hardcoded for the entire format.

### 2d. Frontend ReadalongScroller — hardcoded CSS type and ambient rules

**File:** `frontend/src/modules/ContentScroller/ReadalongScroller.jsx`

**Line 118:** Maps `verses` content type to `scriptures` CSS type:
```javascript
const cssType = data.content?.type === 'verses' ? 'scriptures' : (data.type || ...);
```

**Line 160:** Hardcodes which CSS types get ambient audio:
```javascript
ambientMediaUrl={['talk', 'scriptures'].includes(cssType) ? ... : null}
```

Any new readalong collection with `contentType: verses` will get scripture CSS styling. Any new collection wanting ambient audio must be added to this hardcoded array.

**Action:** Both CSS type and ambient eligibility should come from manifest metadata passed through the Play API response, not hardcoded in the renderer.

### 2e. Frontend websocketHandler — hardcoded collection detection

**File:** `frontend/src/lib/OfficeApp/websocketHandler.js:133`
```javascript
const isContentItem = data.hymn || data.scripture || data.talk || data.primary;
```

New collections won't be recognized as content items unless this line is updated.

**Action:** Replace with format-based or capability-based detection.

### 2f. Frontend ListsItemRow — hardcoded icons, colors, labels

**File:** `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Type icons (lines 82-85):** `{ hymn: IconMusic, primary: IconMusic, scripture: IconBook, poem: IconFileText, talk: IconMicrophone }`

**Source colors (lines 173-174):** `{ hymn: 'indigo', primary: 'grape' }`

**Type labels (lines 228-230):** `{ hymn: 'Hymn', primary: 'Primary' }`

**Action:** Move to a central collection registry or load from backend metadata.

---

## Finding 3: API Route Gaps

**Severity:** Medium
**Reference:** content-playback.md, content-navigation.md, quick-reference.md

### 3a. `GET /api/v1/read/:source/*` not implemented

The docs define a `read` route for the `readable` capability. No router file `read.mjs` exists. No frontend code calls this endpoint. AudiobookshelfAdapter and KomgaAdapter exist but there's no dedicated read route.

**Action:** Implement the route, or remove from docs if readable content is served via the play route.

### 3b. Legacy `local-content` endpoints still active

**File:** `backend/src/4_api/v1/routers/localContent.mjs`

These endpoints exist with RFC 8594 deprecation headers (Sunset: 2026-08-01):
- `GET /api/v1/local-content/scripture/*`
- `GET /api/v1/local-content/hymn/:number`
- `GET /api/v1/local-content/primary/:number`
- `GET /api/v1/local-content/talk/*`
- `GET /api/v1/local-content/poem/*`
- `GET /api/v1/local-content/cover/*`
- `GET /api/v1/local-content/collection-icon/:adapter/:collection`
- `GET /api/v1/local-content/collection/:name`

The docs say these should not exist. They have deprecation headers, so this is an intentional migration strategy, but they remain active code paths.

**Action:** Track migration progress. Ensure no new code calls these endpoints. Frontend is confirmed fully migrated.

---

## Finding 4: Playable Contract Gaps

**Severity:** Medium
**Reference:** content-model.md "Playable Contract", content-playback.md

### 4a. No separate ContentResolver component

The docs describe a `ContentResolver` component that resolves content IDs and dispatches by format. This doesn't exist as a separate component. `SinglePlayer.jsx` performs this role directly.

**Action:** Update docs to reference SinglePlayer.jsx instead of ContentResolver.

### 4b. VideoPlayer missing `hardReset`

**File:** `frontend/src/modules/Player/components/VideoPlayer.jsx:122`

VideoPlayer passes `hardReset: null` to `onRegisterMediaAccess`. AudioPlayer correctly passes the actual `hardReset` function. This is a known bug (documented as Bug #13 in player-module-audit).

**Action:** Wire `hardReset` in VideoPlayer.

### 4c. `onStartupSignal` not implemented by media renderers

Only `useMediaReporter` (used by ContentScroller-based renderers) calls `onStartupSignal`. VideoPlayer and AudioPlayer do not call it.

**Action:** Add `onStartupSignal` to `useCommonMediaController` or VideoPlayer/AudioPlayer directly.

### 4d. `onResolvedMeta` called at wrong level

Documented as "Renderer -> Player outbound callback" but actually called by SinglePlayer.jsx, not by individual renderers. This is an inversion of the documented flow.

**Action:** Update docs to reflect actual architecture, or refactor so renderers call it.

### 4e. PlayableAppShell, PagedReader, FlowReader are stubs

All three components exist in code but are minimal stubs:
- `PlayableAppShell.jsx` — delegates to AppContainer, doesn't implement contract callbacks
- `PagedReader.jsx` — placeholder text only
- `FlowReader.jsx` — placeholder text only

The docs mark PlayableAppShell as "Planned" and PagedReader/FlowReader as "Planned". Consistent, but docs could note they exist as stubs.

---

## Finding 5: Configuration Not Yet Unified

**Severity:** Medium
**Reference:** content-configuration.md

### 5a. Source config still split across two files

**Documented (to-be):** Unified `sources:` block in a single config file.
**Actual:** Split across:
- `data/system/config/adapters.yml` — connection details (host, port, token for 25+ services)
- `data/household/config/integrations.yml` — capability declarations (media, gallery, audiobooks, ebooks, etc.)

The docs acknowledge this split exists ("Current config split") and describe the to-be format. The migration hasn't happened yet.

### 5b. Menu configs use legacy format

All menu YAML files use `label`/`input`/`action` format, not the documented to-be format (`title` + action-as-key like `play:`, `open:`, `list:`, `display:`).

**Example** (from `menus/fhe.yml`):
```yaml
- label: Opening Hymn
  input: singalong:hymn/166
  fixed_order: true
```

**Documented to-be:**
```yaml
- title: Opening Hymn
  play:
    contentId: hymn:198
  fixed_order: true
```

The yaml-config driver normalizes both formats, so this works. But the actual files haven't been migrated. A CLI migration tool (`cli/migrate-list-configs.mjs`) exists but hasn't been run.

### 5c. Household aliases not populated

The ContentIdResolver supports household aliases (Layer 5), but the actual household alias config is empty. The infrastructure is ready but unused.

### 5d. Collection manifests correctly implemented

All three readalong collection manifests exist and match documented fields:
- `data/content/readalong/scripture/manifest.yml` — resolver, containerType, contentType, ambient, style, defaults, volumeTitles
- `data/content/readalong/talks/manifest.yml` — contentType, cssType, video, style
- `data/content/readalong/poetry/manifest.yml` — containerType, contentType, ambient, style

**Note:** `talks/manifest.yml` includes a `cssType` field not present in the other manifests or the documented schema. This field is used by the ReadalongScroller to determine CSS styling.

### 5e. Watchlist and program files match documented schemas

Watchlist files use documented fields: `src`, `media_key`, `program`, `priority`, `wait_until`, `skip_after`, `watched`, `progress`, `title`, `uid`.

Program files use documented legacy format: `label`, `input`, `action`, `uid`.

---

## Finding 6: Naming Taxonomy — Largely Compliant

**Severity:** Low
**Reference:** content-model.md, quick-reference.md

### 6a. Adapter/component names correctly migrated

- `SingalongAdapter` (not SingingAdapter) — correct
- `ReadalongAdapter` (not NarratedAdapter) — correct
- `SingalongScroller` (not SingingScroller) — correct
- `ReadalongScroller` (not NarratedScroller) — correct

### 6b. Legacy aliases correctly maintained for backward compatibility

**File:** `backend/src/0_system/bootstrap.mjs:677-679`
```javascript
singing: 'singalong:',
narrated: 'readalong:',
list: 'menu:',
```

These are intentional backward-compatibility aliases in the routing layer. Correct and documented.

### 6c. Legacy key format checks in ReadalongAdapter

**File:** `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs:564-653`

The adapter checks `narrated:` key formats when reading watch history for backward compatibility with existing user data. Correct and necessary.

### 6d. Test file/folder names retain legacy terms

- `tests/isolated/adapter/content/singing/SingingAdapter.test.mjs` — folder named "singing"
- `tests/isolated/adapter/content/narrated/NarratedAdapter.test.mjs` — folder named "narrated"

The actual test code inside references the correct new class names. Cosmetic issue only.

### 6e. Three adapters use "Driver" naming instead of "Adapter"

- `AppRegistryDriver.mjs` (should be AppRegistryAdapter per convention)
- `QueryDriver.mjs` (should be QueryAdapter)
- `FilesystemDriver.mjs` (config builder, not a content source adapter — lives in adapters directory but doesn't implement IContentSource)

### 6f. Canvas adapters exist as separate classes

The docs say canvas is "just an alias to a filesystem instance." In code, dedicated canvas adapter classes exist:
- `backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs`
- `backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs`

These handle the `displayable` capability for image content. The docs could clarify that while `canvas:` is an alias for content IDs, the display/thumbnail functionality has dedicated adapter implementations.

---

## Finding 7: Documentation Describes Things That Don't Exist

**Severity:** Medium

### 7a. Documented but not implemented

| Feature | Reference Doc | Status in Code |
|---------|--------------|----------------|
| `getPlayInfo()` adapter method | content-sources.md | Not implemented; `getItem()` returns PlayableItem instead |
| `resolveReadables()` adapter method | content-sources.md | Not implemented; `getItem()` returns ReadableItem instead |
| `GET /api/v1/read/:source/*` route | quick-reference.md | No router file exists |
| `ContentResolver` component | content-playback.md | SinglePlayer.jsx performs this role |
| Unified `sources:` config block | content-configuration.md | Still split across adapters.yml + integrations.yml |
| Action-as-key menu format | content-configuration.md | All menus still use legacy label/input/action format |
| Household aliases | content-model.md | Infrastructure exists, config is empty |

### 7b. Exists in code but not documented

| Feature | Location | Notes |
|---------|----------|-------|
| `getStoragePath()` adapter method | Multiple adapters | De-facto required for watch state persistence |
| `getSearchCapabilities()` | PlexAdapter, SingalongAdapter | Adapter capability reporting |
| `getQueryMappings()` | PlexAdapter | Query config for structured search |
| `getContainerAliases()` | PlexAdapter | Container navigation shortcuts |
| `getRootContainers()` | PlexAdapter | Root-level container enumeration |
| LocalContentAdapter | `local-content/` directory | Legacy adapter not listed in documented drivers |
| MediaAdapter | `media/media/` directory | Not listed in documented drivers |
| ListAdapter | `list/` directory | Handles yaml-config + watchlist + program types |
| Canvas adapters | `canvas/` directory | Separate adapter classes for display capability |
| AudiobookshelfAdapter source = `abs` | AudiobookshelfAdapter.mjs:48 | Docs say `audiobookshelf`, code uses `abs` |
| `resolveFormat.mjs` | `4_api/v1/utils/` | API-level format field injection (bridges `mediaType` → `format`) |

---

## Prioritized Action Items

### Priority 1: Fix Documentation Accuracy (docs say X, code does Y)

1. **Remove `getPlayInfo()` from adapter contract docs** — or implement it. Code uses `getItem()` returning PlayableItem instead.
2. **Remove `resolveReadables()` from docs** — not implemented anywhere.
3. **Reconcile `format` vs `mediaType`** — docs say adapters return `format`; adapters actually return `mediaType`; `resolveFormat.mjs` adds `format` at the API layer. Document this layering.
4. **Update Player hierarchy docs** — replace "ContentResolver" with "SinglePlayer.jsx".
5. **Add `getStoragePath()` to adapter contract docs** — it's de-facto required.
6. **Add undocumented adapters to docs** — LocalContentAdapter, MediaAdapter, ListAdapter, canvas adapters.
7. **Fix AudiobookshelfAdapter source name** — docs say `audiobookshelf`, code uses `abs`.

### Priority 2: Fix Code to Match Architecture (code violates design principles)

8. **Eliminate collection hardcoding in LocalContentAdapter** — replace if/else chains with config-driven collection registry.
9. **Eliminate collection hardcoding in frontend** — websocketHandler.js, contentRenderers.jsx, ReadalongScroller.jsx, ListsItemRow.jsx.
10. **Make SingalongAdapter/ReadalongAdapter return Item class instances** — not plain objects.
11. **Wire VideoPlayer `hardReset`** — currently passes null.
12. **Add `onStartupSignal` to VideoPlayer/AudioPlayer** — only scroller renderers call it currently.

### Priority 3: Complete Migrations (planned but not done)

13. **Implement `GET /api/v1/read/:source/*`** — or remove from docs if readable content is served via the play route.
14. **Unify source config** — merge adapters.yml + integrations.yml into `sources:` block.
15. **Migrate menu YAML to action-as-key format** — replace label/input/action with title + play/open/list/display. CLI tool exists (`cli/migrate-list-configs.mjs`) but hasn't been wired into ListAdapter.
16. **Rename Driver files to Adapter** — AppRegistryDriver, QueryDriver.
17. **Rename test folders** — singing/ -> singalong/, narrated/ -> readalong/.
18. **Populate household aliases** — infrastructure ready, config empty.
19. **Remove legacy local-content endpoints** — after sunset date (2026-08-01).

---

## Files Audited

### Backend
- `backend/src/0_system/bootstrap.mjs`
- `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs`
- `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs`
- `backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs`
- `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
- `backend/src/1_adapters/content/media/files/FileAdapter.mjs`
- `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`
- `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs`
- `backend/src/1_adapters/content/readable/komga/KomgaAdapter.mjs`
- `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`
- `backend/src/1_adapters/content/app-registry/AppRegistryDriver.mjs`
- `backend/src/1_adapters/content/query/QueryDriver.mjs`
- `backend/src/1_adapters/content/filesystem/FilesystemDriver.mjs`
- `backend/src/1_adapters/content/list/ListAdapter.mjs`
- `backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs`
- `backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs`
- `backend/src/2_domains/content/services/ContentSourceRegistry.mjs`
- `backend/src/3_applications/content/ContentIdResolver.mjs`
- `backend/src/3_applications/content/ports/IContentSource.mjs`
- `backend/src/3_applications/content/ports/Playable.mjs`
- `backend/src/4_api/v1/routers/api.mjs`
- `backend/src/4_api/v1/routers/play.mjs`
- `backend/src/4_api/v1/routers/list.mjs`
- `backend/src/4_api/v1/routers/display.mjs`
- `backend/src/4_api/v1/routers/info.mjs`
- `backend/src/4_api/v1/routers/queue.mjs`
- `backend/src/4_api/v1/routers/siblings.mjs`
- `backend/src/4_api/v1/routers/content.mjs`
- `backend/src/4_api/v1/routers/localContent.mjs`
- `backend/src/4_api/v1/utils/resolveFormat.mjs`
- `backend/src/app.mjs`

### Frontend
- `frontend/src/modules/Player/Player.jsx`
- `frontend/src/modules/Player/components/SinglePlayer.jsx`
- `frontend/src/modules/Player/components/VideoPlayer.jsx`
- `frontend/src/modules/Player/components/AudioPlayer.jsx`
- `frontend/src/modules/Player/components/CompositePlayer.jsx`
- `frontend/src/modules/Player/components/PlayableAppShell.jsx`
- `frontend/src/modules/Player/components/PagedReader.jsx`
- `frontend/src/modules/Player/components/FlowReader.jsx`
- `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- `frontend/src/modules/Player/hooks/useMediaReporter.js`
- `frontend/src/modules/ContentScroller/ContentScroller.jsx`
- `frontend/src/modules/ContentScroller/SingalongScroller.jsx`
- `frontend/src/modules/ContentScroller/ReadalongScroller.jsx`
- `frontend/src/lib/contentRenderers.jsx`
- `frontend/src/lib/queryParamResolver.js`
- `frontend/src/lib/OfficeApp/websocketHandler.js`
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
- `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`

### Configuration
- `data/system/config/adapters.yml`
- `data/household/config/integrations.yml`
- `data/household/config/content-prefixes.yml`
- `data/household/config/lists/menus/*.yml` (19 files)
- `data/household/config/lists/watchlists/*.yml` (7 files)
- `data/household/config/lists/programs/*.yml` (5 files)
- `data/household/config/lists/queries/*.yml` (1 file)
- `data/content/readalong/scripture/manifest.yml`
- `data/content/readalong/talks/manifest.yml`
- `data/content/readalong/poetry/manifest.yml`
