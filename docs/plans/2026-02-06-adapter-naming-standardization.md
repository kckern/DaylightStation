# Adapter Naming Standardization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize the scattered adapter naming (filesystem, local, local-media, folder) into a coherent scheme and consolidate redundant adapters.

**Architecture:** Four phases executed sequentially. Phase 1 removes a dead alias. Phase 2 renames filesystem→media across the codebase. Phase 3 consolidates LocalMediaAdapter into MediaAdapter. Phase 4 absorbs FolderAdapter's features into ListAdapter, retiring the Infinity harvester data pipeline.

**Tech Stack:** Node.js/Express backend (ESM), React frontend, YAML config, Playwright tests

---

## Current State (Problem)

| Adapter | source | prefixes | Data source | Purpose |
|---------|--------|----------|-------------|---------|
| FilesystemAdapter | `'filesystem'` | `media, file, fs, freshvideo` | `mediaBasePath` dirs | Play/list media files |
| LocalMediaAdapter | `'local'` | `local` | `household/config/local-media.yml` | Browse roots, stream, thumbnails, search |
| FolderAdapter | `'folder'` | `folder, local` | `household/state/lists.yml` (Infinity) | Watchlist engine with watch state |
| ListAdapter | `'list'` | `menu, program, watchlist, query` | `household/config/lists/**/*.yml` | Menu/program/schedule navigation |

**Problems:**
1. FolderAdapter registers prefix `'local'`, immediately overwritten by LocalMediaAdapter — dead alias
2. FilesystemAdapter source is `'filesystem'` but its primary prefix is `'media'` — confusing mismatch
3. LocalMediaAdapter and FilesystemAdapter both browse the same `mediaBasePath` — redundant
4. FolderAdapter reads Infinity-harvested `state/lists.yml`; same data exists in `config/lists/` (ListAdapter)

## Target State

| Adapter | source | prefixes | Data source | Purpose |
|---------|--------|----------|-------------|---------|
| **MediaAdapter** | `'media'` | `media, file, fs, freshvideo` | `mediaBasePath` dirs | Play/list/browse/stream media files |
| ~~LocalMediaAdapter~~ | — | — | *(deleted, absorbed into MediaAdapter)* | — |
| FolderAdapter | `'folder'` | `folder` | `household/state/lists.yml` | *(Phase 4: absorbed into ListAdapter)* |
| **ListAdapter** | `'list'` | `menu, program, watchlist, query` | `household/config/lists/**/*.yml` | Menu/program/schedule + watch state |

---

## Phase 1: Remove FolderAdapter's Dead 'local' Alias

**Blast radius:** 3 files

This alias is immediately overwritten by LocalMediaAdapter's registration and serves no purpose.

### Task 1: Remove 'local' prefix from FolderAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/folder/FolderAdapter.mjs:59-63`

**Step 1: Edit FolderAdapter.prefixes**

Change:
```javascript
get prefixes() {
  return [
    { prefix: 'folder' },
    { prefix: 'local' }
  ];
}
```

To:
```javascript
get prefixes() {
  return [
    { prefix: 'folder' }
  ];
}
```

### Task 2: Remove manual 'local' alias from bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:469-473`

**Step 1: Remove the manual alias**

Delete these lines:
```javascript
    // Also register as 'local' for legacy frontend compatibility
    // Legacy endpoints use /data/list/{key} which maps to /list/local/{key}
    registry.adapters.set('local', folderAdapter);
```

### Task 3: Remove 'local' handling from list router

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:318-323`

**Step 1: Simplify the folder source check**

Change:
```javascript
      // 'local' is an alias for 'folder' - both use FolderAdapter which expects folder: prefix
      const isFolderSource = source === 'folder' || source === 'local';
```

To:
```javascript
      const isFolderSource = source === 'folder';
```

### Task 4: Run tests and commit

**Step 1: Run existing tests**

```bash
npx jest tests/isolated/ --passWithNoTests 2>&1 | tail -20
```

Expected: All pass (no test uses `source === 'local'` to mean FolderAdapter).

**Step 2: Commit**

```bash
git add backend/src/1_adapters/content/folder/FolderAdapter.mjs backend/src/0_system/bootstrap.mjs backend/src/4_api/v1/routers/list.mjs
git commit -m "refactor: remove FolderAdapter's dead 'local' alias"
```

---

## Phase 2: Rename filesystem → media

**Blast radius:** ~31 source/test files + 2 directories

This is purely mechanical — rename the source string, class name, directory, and all references.

### Task 5: Rename FilesystemAdapter class → MediaAdapter

**Files:**
- Rename: `backend/src/1_adapters/content/media/filesystem/` → `backend/src/1_adapters/content/media/media/`
- Rename: `backend/src/1_adapters/content/media/filesystem/FilesystemAdapter.mjs` → `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`

**Step 1: Create new directory and copy files**

```bash
mkdir -p backend/src/1_adapters/content/media/media
cp backend/src/1_adapters/content/media/filesystem/FilesystemAdapter.mjs backend/src/1_adapters/content/media/media/MediaAdapter.mjs
cp backend/src/1_adapters/content/media/filesystem/manifest.mjs backend/src/1_adapters/content/media/media/manifest.mjs
```

**Step 2: In MediaAdapter.mjs, rename class and change source**

In `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`:

- Rename `export class FilesystemAdapter` → `export class MediaAdapter`
- Change `get source()` return from `'filesystem'` to `'media'`
- Change all `id: \`filesystem:${localId}\`` → `id: \`media:${localId}\``
- Change all `source: 'filesystem'` → `source: 'media'`
- Update the class comment/jsdoc
- Update `export default FilesystemAdapter` → `export default MediaAdapter`

**Step 3: In manifest.mjs, change provider**

In `backend/src/1_adapters/content/media/media/manifest.mjs`:

Change:
```javascript
export default {
  provider: 'filesystem',
  capability: 'media',
  displayName: 'Local Filesystem',
  implicit: true,
  adapter: () => import('./FilesystemAdapter.mjs'),
  ...
};
```

To:
```javascript
export default {
  provider: 'media',
  capability: 'media',
  displayName: 'Local Media',
  implicit: true,
  adapter: () => import('./MediaAdapter.mjs'),
  ...
};
```

### Task 6: Update package.json import alias

**Files:**
- Modify: `package.json` (if `#adapters` alias exists) or wherever the import map for `#adapters/content/media/filesystem/` is defined

**Step 1: Check import alias config**

Look in `package.json` under `imports` for `#adapters`. The path `#adapters/content/media/filesystem/FilesystemAdapter.mjs` needs to become `#adapters/content/media/media/MediaAdapter.mjs`.

Note: If using directory-based resolution (e.g., `#adapters` maps to `./backend/src/1_adapters/`), no change needed — just update import statements.

### Task 7: Update bootstrap imports and usage

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Update imports (lines 18, 34)**

Change:
```javascript
import { FilesystemAdapter } from '#adapters/content/media/filesystem/FilesystemAdapter.mjs';
import filesystemManifest from '#adapters/content/media/filesystem/manifest.mjs';
```

To:
```javascript
import { MediaAdapter } from '#adapters/content/media/media/MediaAdapter.mjs';
import mediaManifest from '#adapters/content/media/media/manifest.mjs';
```

**Step 2: Update registration (lines 420-428)**

Change:
```javascript
  // Register filesystem adapter
  if (config.mediaBasePath) {
    registry.register(
      new FilesystemAdapter({
        mediaBasePath: config.mediaBasePath,
        mediaProgressMemory,
      }),
      { category: filesystemManifest.capability, provider: filesystemManifest.provider }
    );
  }
```

To:
```javascript
  // Register media adapter
  if (config.mediaBasePath) {
    registry.register(
      new MediaAdapter({
        mediaBasePath: config.mediaBasePath,
        mediaProgressMemory,
      }),
      { category: mediaManifest.capability, provider: mediaManifest.provider }
    );
  }
```

**Step 3: Update canvas-filesystem config reference (line 530)**

The `config.canvas?.filesystem` reference stays — it's about canvas, not this adapter. But check comment at line 529: "Register canvas-filesystem adapter" — this is a separate adapter (`canvas-filesystem` source) and is NOT being renamed in this plan.

### Task 8: Update proxy router

**Files:**
- Modify: `backend/src/4_api/v1/routers/proxy.mjs:24-31`

**Step 1: Change route path and registry lookup**

Change:
```javascript
  router.get('/filesystem/stream/*', asyncHandler(async (req, res) => {
      const filePath = decodeURIComponent(req.params[0] || '');
      const adapter = registry.get('filesystem');
      if (!adapter) {
        return res.status(404).json({ error: 'Filesystem adapter not configured' });
      }
```

To:
```javascript
  router.get('/media/stream/*', asyncHandler(async (req, res) => {
      const filePath = decodeURIComponent(req.params[0] || '');
      const adapter = registry.get('media');
      if (!adapter) {
        return res.status(404).json({ error: 'Media adapter not configured' });
      }
```

### Task 9: Update actionRouteParser

**Files:**
- Modify: `backend/src/4_api/v1/utils/actionRouteParser.mjs`

**Step 1: Update VALID_SOURCES array (line 24)**

Change `'filesystem'` to `'media'` in the array. Also keep `'filesystem'` as a legacy alias that maps to `'media'` in the heuristic detection.

**Step 2: Update auto-detection (line 101)**

Change `return 'filesystem'` to `return 'media'`.

### Task 10: Update MediaKeyResolver

**Files:**
- Modify: `backend/src/2_domains/media/MediaKeyResolver.mjs:29-32`

**Step 1: Replace 'filesystem' with 'media' in known sources and fallback chain**

Change:
```javascript
this.knownSources = config.knownSources || ['plex', 'folder', 'media'];
...
fallbackChain: ['plex', 'folder', 'media']
```

### Task 11: Update ContentSourceRegistry default

**Files:**
- Modify: `backend/src/2_domains/content/services/ContentSourceRegistry.mjs:190`

**Step 1: Change default adapter lookup**

Change:
```javascript
const defaultAdapter = this.#adapterEntries.get('filesystem')?.adapter;
```

To:
```javascript
const defaultAdapter = this.#adapterEntries.get('media')?.adapter;
```

### Task 12: Update cross-adapter references

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs:584`
- Modify: `backend/src/1_adapters/content/folder/FolderAdapter.mjs:250`
- Modify: `backend/src/4_api/v1/routers/localContent.mjs:380`

**Step 1: ListAdapter — update registry.get call**

Change:
```javascript
const filesystemAdapter = this.registry?.get('filesystem');
```
To:
```javascript
const mediaAdapter = this.registry?.get('media');
```

And update all subsequent references from `filesystemAdapter` to `mediaAdapter` in that method.

**Step 2: FolderAdapter — update sourceMap**

Change:
```javascript
media: { source: 'filesystem', category: 'media' }
```
To:
```javascript
media: { source: 'media', category: 'media' }
```

**Step 3: localContent router — update registry.get call**

Change:
```javascript
const fsAdapter = registry.get('filesystem');
```
To:
```javascript
const mediaAdapter = registry.get('media');
```

And update subsequent references.

### Task 13: Update frontend references

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:128`
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (lines 147, 1254 — test data)

**Step 1: Player api.js — update default source**

Change:
```javascript
let source = 'filesystem';
```
To:
```javascript
let source = 'media';
```

**Step 2: ListsItemRow.jsx — update test/example data**

Change `source: 'filesystem'` to `source: 'media'` in the two test data objects.

### Task 14: Delete old filesystem directory

**Step 1: Remove old directory**

```bash
rm -rf backend/src/1_adapters/content/media/filesystem/
```

**Step 2: Commit Phase 2**

```bash
git add -A
git commit -m "refactor: rename FilesystemAdapter to MediaAdapter (source: filesystem → media)"
```

### Task 15: Update all test files

**Files:** (update `'filesystem'` → `'media'` string literals and class references)
- `tests/isolated/adapter/content/FilesystemAdapter.test.mjs` → rename + update
- `tests/isolated/adapter/content/media/filesystem/manifest.test.mjs` → rename + update
- `tests/unit/api/utils/actionRouteParser.test.mjs`
- `tests/unit/domains/media/MediaKeyResolver.test.mjs`
- `tests/integrated/api/content/content.test.mjs`
- `tests/integrated/assembly/bootstrap/adapter-discovery.test.mjs`
- `tests/isolated/assembly/infrastructure/bootstrap.test.mjs`
- `tests/isolated/api/routers/play.test.mjs`
- `tests/isolated/domain/content/entities/Item.test.mjs`
- `tests/isolated/domain/content/capabilities/Playable.test.mjs`
- `tests/isolated/domain/content/capabilities/Displayable.test.mjs`
- `tests/isolated/domain/content/capabilities/Queueable.test.mjs`
- `tests/isolated/domain/content/services/ContentSourceRegistry.test.mjs`
- `tests/_lib/api-test-utils/CAPTURE_MANIFEST.mjs`
- `tests/_lib/api-test-utils/captureQuick.mjs`
- `tests/live/flow/admin/content-search-combobox/10-query-permutations.runtime.test.mjs`

**Step 1: Rename test files**

```bash
mv tests/isolated/adapter/content/FilesystemAdapter.test.mjs tests/isolated/adapter/content/MediaAdapter.test.mjs
```

**Step 2: In each file listed above, replace all `'filesystem'` string literals with `'media'` and `FilesystemAdapter` with `MediaAdapter`.**

This is a mechanical find-replace. Key patterns:
- `'filesystem'` → `'media'`
- `"filesystem"` → `"media"`
- `FilesystemAdapter` → `MediaAdapter`
- `filesystem:audio/` → `media:audio/`
- `filesystem:path/` → `media:path/`
- `filesystemAdapter` (variable name) → `mediaAdapter`

**Step 3: Run all tests**

```bash
npx jest tests/ --passWithNoTests 2>&1 | tail -30
```

Expected: All pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: update all tests for filesystem → media rename"
```

---

## Phase 3: Consolidate LocalMediaAdapter into MediaAdapter

**Blast radius:** ~8 files

LocalMediaAdapter provides `getRoots()`, `search()`, `clearCache()`, and `getFullPath()` that the local.mjs router uses. These should be absorbed into MediaAdapter.

### Task 16: Add getRoots() to MediaAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`

**Step 1: Add constructor params for roots config**

Add to constructor: `dataPath`, `householdId`, `configService`, `cacheBasePath` params.

**Step 2: Copy getRoots() from LocalMediaAdapter**

Copy `getRoots()` method from `LocalMediaAdapter.mjs:94-116` into MediaAdapter. This reads `household/config/local-media.yml` for configured media roots.

### Task 17: Add search() and clearCache() to MediaAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/media/media/MediaAdapter.mjs`

**Step 1: Copy search() and supporting methods from LocalMediaAdapter**

Copy these methods from LocalMediaAdapter:
- `search({ text })` — recursive filename search
- `_searchDirectory()` — helper for recursive search
- `isMediaFile()` — extension check
- `clearCache()` — reset caches
- `getSearchCapabilities()` — for ContentQueryService

### Task 18: Update local.mjs router to use MediaAdapter

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:637-647`

**Step 1: Change local router adapter source**

Change:
```javascript
  // Get LocalMediaAdapter from registry for local router
  const localMediaAdapter = registry.get('local');
  ...
  local: createLocalRouter({ localMediaAdapter, mediaBasePath, ...}),
```

To:
```javascript
  // Get MediaAdapter from registry for local router (browse, stream, thumbnails)
  const mediaAdapter = registry.get('media');
  ...
  local: createLocalRouter({ localMediaAdapter: mediaAdapter, mediaBasePath, ...}),
```

Note: Keep param name `localMediaAdapter` in `createLocalRouter` for now to minimize changes inside local.mjs.

### Task 19: Remove LocalMediaAdapter registration from bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:23,37,476-489`

**Step 1: Remove import**

Delete:
```javascript
import { LocalMediaAdapter } from '#adapters/content/media/local-media/LocalMediaAdapter.mjs';
import localMediaManifest from '#adapters/content/media/local-media/manifest.mjs';
```

**Step 2: Remove registration block**

Delete lines 476-489 (the `// Register LocalMediaAdapter` block).

### Task 20: Delete LocalMediaAdapter files

**Step 1: Remove the adapter directory**

```bash
rm -rf backend/src/1_adapters/content/media/local-media/
```

**Step 2: Run tests**

```bash
npx jest tests/ --passWithNoTests 2>&1 | tail -30
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: absorb LocalMediaAdapter into MediaAdapter, delete dead adapter"
```

---

## Phase 4: Absorb FolderAdapter into ListAdapter

**Blast radius:** ~15+ files
**Complexity:** High — requires design decisions

FolderAdapter reads from the Infinity-harvested `household/state/lists.yml` (a single flat YAML file with items grouped by `folder:` field). ListAdapter reads from `household/config/lists/{menus,programs,watchlists}/*.yml` (individual YAML files). The data is duplicated — same UIDs, same structure.

### Background: What FolderAdapter Does That ListAdapter Doesn't

1. **Watch state enrichment**: `mediaProgressMemory` integration — enriches every item with `percent`, `playhead`, `lastPlayed`, `priority`
2. **Smart playback filtering**: `_shouldSkipForPlayback()` — skips watched >90%, on hold, past skipAfter, waitUntil >2 days
3. **Next-up logic**: `_getNextPlayableFromChild()` — finds single "next up" item based on progress state
4. **Priority sorting**: `_calculatePriority()` — in_progress > urgent > high > medium > low
5. **Nomusic label detection**: Checks Plex labels for music overlay support

### Task 21: Port watch-state enrichment to ListAdapter._buildListItems()

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`

**Step 1: Add mediaProgressMemory injection** (already exists in constructor)

**Step 2: In `_buildListItems()`, enrich items with watch state**

After building each Item, look up watch state from `mediaProgressMemory` using the item's source and localId. Add `percent`, `playhead`, `lastPlayed`, `priority` to metadata — same pattern as FolderAdapter lines 269-280.

### Task 22: Port playback filtering to ListAdapter.resolvePlayables()

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`

**Step 1: Copy `_shouldSkipForPlayback()` from FolderAdapter**

Add this method to ListAdapter. It checks: `hold`, `watched >90%`, `skipAfter passed`, `waitUntil >2 days`.

**Step 2: Apply filtering in resolvePlayables()**

Before resolving each item through the registry, check `_shouldSkipForPlayback()`. Skip items that match.

### Task 23: Port next-up logic to ListAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`

**Step 1: Copy `_getNextPlayableFromChild()` from FolderAdapter**

This method gets all playables from a child source, checks watch state for each, and returns the in-progress or first-unwatched item.

**Step 2: In resolvePlayables(), use next-up logic for `play` action items**

When an item has a `play` action (not `queue`), call `_getNextPlayableFromChild()` instead of getting all playables. This creates daily variety.

### Task 24: Port nomusic overlay support

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`

**Step 1: Add nomusicLabels and musicOverlayPlaylist config**

Add constructor params for these values. Copy `_hasNomusicLabel()` from FolderAdapter.

**Step 2: In `_buildListItems()`, check for nomusic labels and add overlay**

Same pattern as FolderAdapter lines 329-347.

### Task 25: Update frontend folder: references to list:

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx:200`
- Modify: `frontend/src/modules/Player/lib/api.js`
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js`

**Step 1: Change TVApp action builder**

Change:
```javascript
folder: (value) => ({ play: { contentId: `folder:${value}`, folder: value, ...config } }),
```
To:
```javascript
folder: (value) => ({ play: { contentId: `menu:${value}`, folder: value, ...config } }),
```

Note: The `folder` key in the action builder stays (it's the YAML action type name), but the contentId now routes through ListAdapter instead of FolderAdapter.

**Step 2: Update any `source === 'folder'` checks in frontend**

Search and replace as needed.

### Task 26: Update list router to remove folder special-casing

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:318-323`

**Step 1: Remove isFolderSource logic entirely**

The `isFolderSource` check and special `folder:` prefix prepending can be removed. ListAdapter handles its own ID parsing.

### Task 27: Migrate data consumers from state/lists.yml

**Step 1: Verify all config/lists/ files are up-to-date with state/lists.yml**

Compare folder names from `state/lists.yml` with files in `config/lists/`. Any missing lists need to be created.

**Step 2: Update bootstrap to stop passing watchlistPath**

Remove `watchlistPath` from the config object passed to `createContentRegistry()`.

### Task 28: Delete FolderAdapter

**Files:**
- Delete: `backend/src/1_adapters/content/folder/FolderAdapter.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` — remove import and registration
- Modify: `backend/src/4_api/v1/routers/list.mjs` — remove folder-specific flattening in toListItem()

**Step 1: Remove import and registration from bootstrap**

Delete the FolderAdapter import and the registration block (lines 22, 459-473).

**Step 2: Clean up toListItem() in list.mjs**

Remove the FolderAdapter-specific metadata flattening (lines 139-200 that extract `percent`, `priority`, `hold`, `skipAfter`, `waitUntil`, `program`, `src`, `uid`, `folder` from metadata).

These fields should now come from ListAdapter's enriched items directly.

**Step 3: Run all tests**

```bash
npx jest tests/ --passWithNoTests 2>&1 | tail -30
npx playwright test tests/live/flow/ --reporter=line 2>&1 | tail -30
```

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: absorb FolderAdapter into ListAdapter, retire Infinity data pipeline"
```

### Task 29: Clean up Infinity harvester dependency (optional)

**Files:**
- Modify: `backend/src/1_adapters/harvester/other/InfinityHarvester.mjs`

The `householdSaveFile('state/lists', ...)` call in InfinityHarvester writes the state file that FolderAdapter consumed. With FolderAdapter gone, this write target is dead. Either:
- Remove the `state/lists` table from InfinityHarvester config (stop harvesting it)
- Or redirect InfinityHarvester to write directly into `config/lists/` format (individual YAML files)

This is optional and depends on whether Infinity is still actively used for list management.

---

## Verification Checklist

After each phase, verify:

- [ ] `npx jest tests/isolated/ --passWithNoTests` — isolated tests pass
- [ ] `npx jest tests/integrated/ --passWithNoTests` — integration tests pass
- [ ] `npx jest tests/unit/ --passWithNoTests` — unit tests pass
- [ ] Dev server starts: `npm run dev` (check both Vite + backend)
- [ ] Admin UI loads at `http://localhost:3111/admin/content/lists/menus`
- [ ] TVApp menu loads (test `folder:TVApp` → `menu:tvapp` after Phase 4)
- [ ] Media clips play: browse `media:clips` in admin combobox
- [ ] Video thumbnails render for clips

## Phase Dependencies

```
Phase 1 (remove dead alias) → no dependencies
Phase 2 (filesystem → media) → depends on Phase 1
Phase 3 (kill LocalMediaAdapter) → depends on Phase 2
Phase 4 (kill FolderAdapter) → depends on Phase 3, needs own brainstorming for edge cases
```

Phases 1-3 are safe mechanical refactors. Phase 4 involves behavior changes (watch state logic moves between adapters) and needs careful testing with the running app.
