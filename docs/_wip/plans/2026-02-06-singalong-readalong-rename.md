# Rename Singing/Narrated → Singalong/Readalong + Folder Reorganization

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the `singing` adapter to `singalong` and the `narrated` adapter to `readalong` across the entire codebase, and reorganize data/media folders so narrated content lives under a dedicated `readalong/` directory (matching how singing content lives under `songs/`).

**Architecture:** Mechanical find-and-replace across ~70 files for the rename, plus filesystem moves for the folder reorg. Legacy prefix support added to NarratedAdapter for backward-compatible watch history reading. Migration script for existing progress YAML keys.

**Tech Stack:** Node.js (ES modules), React (JSX), Express routers, YAML persistence, Playwright tests.

---

## Context

The `singing` and `narrated` adapter names are functional but inconsistent with user-facing semantics. "Singalong" and "readalong" better describe the presentation mode. Additionally, the narrated adapter's `dataPath` points to the entire `data/content/` root (while singing's points to `data/content/songs/`), creating an asymmetry. This plan aligns both: each adapter gets its own dedicated content subfolder.

**Current state:**
| Layer | Singing | Narrated |
|-------|---------|----------|
| Adapter name | `singing` | `narrated` |
| Data folder | `data/content/songs/` | `data/content/` (root) |
| Media folder | `media/audio/songs/` | `media/audio/` (root) |
| ID prefix | `singing:` | `narrated:` |
| Progress files | `singing.yml` | `narrated.yml` + `scriptures.yml` |

**Target state:**
| Layer | Singalong | Readalong |
|-------|-----------|-----------|
| Adapter name | `singalong` | `readalong` |
| Data folder | `data/content/songs/` (unchanged) | `data/content/readalong/` |
| Media folder | `media/audio/songs/` (unchanged) | `media/audio/readalong/` |
| ID prefix | `singalong:` | `readalong:` |
| Progress files | `singalong.yml` | `readalong.yml` + `scriptures.yml` |

**Note:** The singing data/media folders stay as `songs/` — the folder name doesn't need to match the adapter name, and `songs/` is a better content-descriptive name. The narrated side gets `readalong/` to group `scripture/`, `talks/`, `poetry/` together.

---

## Task 1: Move narrated content into `readalong/` directories

Move the data and media files so narrated collections live under a dedicated folder.

**Filesystem operations (on the Dropbox data path):**
```bash
# Data: move scripture, talks, poetry into readalong/
mkdir -p data/content/readalong
mv data/content/scripture data/content/readalong/scripture
mv data/content/talks data/content/readalong/talks
mv data/content/poetry data/content/readalong/poetry

# Media: move scripture, poetry into readalong/
mkdir -p media/audio/readalong
mv media/audio/scripture media/audio/readalong/scripture
mv media/audio/poetry media/audio/readalong/poetry

# Remove old narrated/ symlink directory if it exists
rm -rf data/content/narrated
```

**Update `app.mjs` paths (line ~342):**
```javascript
// Before:
const narratedConfig = {
  dataPath: contentPath,
  mediaPath: path.join(mediaBasePath, 'audio')
};

// After:
const readalongConfig = {
  dataPath: path.join(contentPath, 'readalong'),
  mediaPath: path.join(mediaBasePath, 'audio', 'readalong')
};
```

**Files:**
- Modify: `backend/src/app.mjs` (lines 337-361)

**Commit:** `chore: move narrated content into readalong/ directories`

---

## Task 2: Rename SingingAdapter → SingalongAdapter

Rename the adapter class, directory, source strings, and all internal references.

**Files:**
- Rename directory: `backend/src/1_adapters/content/singing/` → `backend/src/1_adapters/content/singalong/`
- Rename file: `SingingAdapter.mjs` → `SingalongAdapter.mjs`
- Modify: `SingalongAdapter.mjs` — class name, `source`, `prefixes`, `canResolve`, `getStoragePath`, all `singing:` string literals → `singalong:`
- Modify: `manifest.mjs` — provider, capability, playableType, adapter import path, displayName

**Key changes in SingalongAdapter.mjs:**
- `export class SingalongAdapter`
- `get source() { return 'singalong'; }`
- `return [{ prefix: 'singalong' }];`
- `return id.startsWith('singalong:');`
- `id.replace(/^singalong:/, '')`
- All `id:`, `source:`, `category:` literals → `'singalong'`
- `mediaUrl: /api/v1/proxy/local-content/stream/${localId}` (unchanged — uses localId)
- `return 'singalong';` (getStoragePath)
- Collection icon URL: `/api/v1/local-content/collection-icon/singalong/${collection}`

**Commit:** `refactor: rename SingingAdapter to SingalongAdapter`

---

## Task 3: Rename NarratedAdapter → ReadalongAdapter

Same as Task 2 but for the narrated side.

**Files:**
- Rename directory: `backend/src/1_adapters/content/narrated/` → `backend/src/1_adapters/content/readalong/`
- Rename file: `NarratedAdapter.mjs` → `ReadalongAdapter.mjs`
- Keep: `resolvers/scripture.mjs` (no rename needed — it's content-specific)
- Modify: `ReadalongAdapter.mjs` — class name, source, prefixes, canResolve, all `narrated:` string literals → `readalong:`
- Modify: `manifest.mjs` — provider, capability, playableType, adapter import path

**Key changes in ReadalongAdapter.mjs:**
- `export class ReadalongAdapter`
- `get source() { return 'readalong'; }`
- `return [{ prefix: 'readalong' }];`
- `return id.startsWith('readalong:');`
- `id.replace(/^readalong:/, '')`
- All `source:`, `category:` → `'readalong'`
- `getStoragePath(id)` — scripture still returns `'scriptures'`, other returns `'readalong'`
- Collection icon URL: `/api/v1/local-content/collection-icon/readalong/${collection}`

**Legacy watch history compatibility:**
- In `_collectScriptureProgress()`, keep checking `narrated:scripture/` prefix keys in addition to `readalong:scripture/` and `plex:` keys
- In `_getChapterPercent()`, check all three key formats

**Commit:** `refactor: rename NarratedAdapter to ReadalongAdapter`

---

## Task 4: Update bootstrap and app.mjs wiring

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
  - Lines 25-26: Update imports to new paths
  - Lines 36-37: Update manifest imports
  - Registration block: `config.singalong`, `config.readalong`, new class names, new manifest references
- Modify: `backend/src/app.mjs`
  - Lines 337-361: `singingConfig` → `singalongConfig`, `narratedConfig` → `readalongConfig`
  - `createContentRegistry` call: `singing:` → `singalong:`, `narrated:` → `readalong:`

**Commit:** `refactor: update bootstrap wiring for singalong/readalong adapters`

---

## Task 5: Update API routers

**Files:**
- Modify: `backend/src/4_api/v1/routers/stream.mjs`
  - Config param: `singingMediaPath` → `singalongMediaPath`, `narratedMediaPath` → `readalongMediaPath`
  - Route: `router.get('/singing/:collection/:id'` → `router.get('/singalong/:collection/:id'`
  - Route: `router.get('/narrated/:collection/*'` → `router.get('/readalong/:collection/*'`
  - Logger keys: `stream.singing.not_found` → `stream.singalong.not_found`, same for narrated
  - JSDoc comments updated
- Modify: `backend/src/4_api/v1/routers/item.mjs` (line 144)
  - `category === 'singing'` → `category === 'singalong'`
  - `category === 'narrated'` → `category === 'readalong'`
- Modify: `backend/src/4_api/v1/routers/info.mjs` (line 83-87)
  - Update comments
- Modify: `backend/src/4_api/v1/utils/actionRouteParser.mjs` (lines 28-29)
  - KNOWN_SOURCES: `'singing'` → `'singalong'`, `'narrated'` → `'readalong'`

**Also update where stream router is instantiated** — wherever `createStreamRouter({ singingMediaPath, narratedMediaPath })` is called, update the config keys.

**Commit:** `refactor: update API routes for singalong/readalong naming`

---

## Task 6: Update frontend components

**Files:**
- Rename: `SingingScroller.jsx` → `SingalongScroller.jsx`
  - Component name: `SingalongScroller`
  - API path: `api/v1/info/singalong/${path}`
  - ID strip: `.replace(/^singalong:/, '')`
  - CSS class: `singalong-scroller`
  - Key: `singalong-${contentId}`
  - Default cssType/wrapperClass: `'singalong'` / `'singalong-text'`
- Rename: `NarratedScroller.jsx` → `ReadalongScroller.jsx`
  - Component name: `ReadalongScroller`
  - API path: `api/v1/info/readalong/${path}`
  - ID strip: `.replace(/^readalong:/, '')`
  - CSS class: `readalong-scroller`
  - Key: `readalong-${contentId}`
  - Default cssType: `'readalong'`
  - `.narrated-text` → `.readalong-text`
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx`
  - Import: `SingalongScroller`, `ReadalongScroller`
  - Category checks: `'singalong'`, `'readalong'`
  - Legacy contentId construction: `singing:hymn/` → `singalong:hymn/`, `narrated:scripture/` → `readalong:scripture/`
- Modify: `frontend/src/lib/contentRenderers.jsx`
  - `singingRenderers` → `singalongRenderers`
  - `narratedRenderers` → `readalongRenderers`
  - `getSingingRenderer` → `getSingalongRenderer`
  - `getNarratedRenderer` → `getReadalongRenderer`
  - `getCollectionFromContentId`: regex `/^(narrated|singing):/` → `/^(readalong|singalong):/`
- Modify: `frontend/src/lib/queryParamResolver.js`
  - Legacy prefix map: `hymn: 'singalong:hymn'`, `scripture: 'readalong:scripture'`, etc.
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
  - `ADAPTER_TO_CATEGORY`: `hymn: 'singalong'`, `primary: 'singalong'`, `scripture: 'readalong'`
- Modify: `frontend/src/modules/ContentScroller/ContentScroller.scss`
  - `.singing-scroller` → `.singalong-scroller` (if exists)
  - `.narrated-scroller` → `.readalong-scroller` (if exists)
  - `.narrated-text` → `.readalong-text`
  - `.singing-text` → `.singalong-text`

**Commit:** `refactor: rename frontend components for singalong/readalong`

---

## Task 7: Write watch history migration script

Create a script that migrates existing progress YAML keys from old prefixes to new ones.

**Files:**
- Modify: `scripts/migrate-watch-state.mjs` — update KEY_MAPPING and add prefix migration

**Migration logic:**
1. In `singing.yml`: rename all `singing:*` keys to `singalong:*`, copy file to `singalong.yml`
2. In `narrated.yml`: rename all `narrated:*` keys to `readalong:*`, copy file to `readalong.yml`
3. In `scriptures.yml`: rename `narrated:scripture/*` keys to `readalong:scripture/*` (keep `plex:*` keys as-is)
4. Back up originals as `.bak`

**Progress files location:** `data/household/history/media_memory/`

**Commit:** `feat: add watch history key migration for singalong/readalong rename`

---

## Task 8: Update tests

**Files:**
- Rename + update: `tests/unit/adapters/content/singing/` → `tests/unit/adapters/content/singalong/`
  - `SingingAdapter.test.mjs` → `SingalongAdapter.test.mjs`
  - All `'singing'` assertions → `'singalong'`
- Rename + update: `tests/isolated/adapter/content/singing/` → `tests/isolated/adapter/content/singalong/`
  - Same changes
- Rename + update: `tests/unit/adapters/content/narrated/` → `tests/unit/adapters/content/readalong/`
  - `NarratedAdapter.test.mjs` → `ReadalongAdapter.test.mjs`
- Rename + update: `tests/isolated/adapter/content/narrated/` → `tests/isolated/adapter/content/readalong/`
- Modify: `tests/isolated/application/content/ContentQueryService.test.mjs`
  - `singing:hymn` → `singalong:hymn`, `narrated:scripture` → `readalong:scripture`
- Modify: `tests/unit/api/utils/actionRouteParser.test.mjs`
  - KNOWN_SOURCES array: `'singing'` → `'singalong'`, `'narrated'` → `'readalong'`
- Modify: `tests/live/api/content/content-api.regression.test.mjs`
  - `/item/singing/` → `/item/singalong/`
- Modify: `tests/runtime/content-migration/legacy-params.runtime.test.mjs`
  - All `singing` → `singalong`, `narrated` → `readalong` in selectors and URLs
- Modify: `tests/live/flow/admin/content-search-combobox/10-query-permutations.runtime.test.mjs`
  - SOURCES array update
- Modify: `tests/live/flow/tv/tv-scripture-playback.runtime.test.mjs`
  - `.narrated-scroller` → `.readalong-scroller`, `.narrated-text` → `.readalong-text`

**Commit:** `test: update all tests for singalong/readalong rename`

---

## Task 9: Update documentation

**Files:**
- Modify: `docs/reference/content/content-adapters.md` — full update (we just wrote this)
- Modify: `docs/reference/content/query-combinatorics.md` — singing→singalong, narrated→readalong
- Scan and update all `docs/_wip/` files that reference singing/narrated (non-critical, best-effort)

**Commit:** `docs: update documentation for singalong/readalong rename`

---

## Task 10: Run migration and verify

**Steps:**
1. Run the migration script on the data path to rename watch history keys
2. Start the dev server and verify:
   - `curl localhost:3112/api/v1/item/singalong/hymn/1` returns valid item
   - `curl localhost:3112/api/v1/item/readalong/scripture/bom` returns valid item
   - `curl localhost:3112/api/v1/stream/singalong/hymn/1` streams audio
3. Run unit tests: `npm test`
4. Run isolated tests: `npx vitest tests/isolated/`
5. Run Playwright tests if dev server is up: `npx playwright test tests/live/flow/`

---

## Verification Checklist

- [ ] `singalong:hymn/1` resolves to the correct YAML + audio
- [ ] `readalong:scripture/bom` resolves and uses bookmark tracking
- [ ] `readalong:poetry/remedy/*` loads correctly
- [ ] Watch history migration script runs without error
- [ ] Existing scripture progress (plex: and narrated: keys) still detected after rename
- [ ] All unit tests pass
- [ ] All isolated tests pass
- [ ] Frontend renders SingalongScroller and ReadalongScroller correctly
- [ ] Legacy query params (`?hymn=1`, `?scripture=bom`) still work via queryParamResolver
