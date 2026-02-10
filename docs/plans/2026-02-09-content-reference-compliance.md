# Content Reference Compliance — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the codebase to 100% compliance with `docs/reference/content/` specifications — fix all 19 action items from the 2026-02-09 compliance audit.

**Architecture:** Three-track approach: (1) update docs where code is correct but docs are wrong, (2) update code where docs describe the intended architecture but code deviates, (3) complete planned migrations that are partially done. Each phase is independently testable and committable.

**Tech Stack:** Node.js/Express backend (ES modules, .mjs), React frontend (.jsx), Vitest/Jest tests, YAML configs

**Audit reference:** `docs/_wip/audits/2026-02-09-content-reference-compliance-audit.md`

---

## Phase 1: Documentation Accuracy (docs say X, code does Y)

These are doc-only changes. No code risk. Fixes Findings 1a-1e and 7a-7b from the audit.

### Task 1.1: Fix Adapter Contract in content-sources.md

**Files:**
- Modify: `docs/reference/content/content-sources.md`

**Step 1: Update the Adapter Contract section**

Replace the current Required/Optional method tables with what actually exists:

**Required** (validated by `IContentSource.mjs`):
| Method | Purpose |
|--------|---------|
| `getItem(localId)` | Return metadata for a single item |
| `getList(localId)` | Return children of a container |
| `resolvePlayables(localId)` | Flatten a container to ordered playable list |
| `resolveSiblings(localId)` | Return peer items + parent info |

**Optional** (capability-based, not validated):
| Method | Capability | Purpose |
|--------|-----------|---------|
| `search(query)` | searchable | Return items matching text query |
| `getThumbnail(localId)` | displayable | Return thumbnail URL |
| `getCapabilities(localId)` | — | Return capability list for an item |
| `getContainerType(id)` | — | Return container type for selection strategy |
| `getStoragePath(id)` | — | Return persistence key for watch state |
| `getSearchCapabilities()` | searchable | Report supported search filters |

**Remove** these documented-but-nonexistent methods:
- ~~`getPlayInfo(localId)`~~ — adapters return playback data from `getItem()` as PlayableItem
- ~~`resolveReadables(localId)`~~ — adapters return ReadableItem from `getItem()`

**Step 2: Update the getPlayInfo Response section**

Replace with explanation of the actual flow: adapters return `PlayableItem` (or plain objects for singalong/readalong) from `getItem()`. The API layer adds a `format` field via `resolveFormat.mjs` (priority: `item.metadata.contentFormat` → `adapter.contentFormat` → `item.mediaType` → fallback `'video'`).

**Step 3: Add undocumented adapters to Built-in Drivers section**

Add entries for:
- `LocalContentAdapter` — Legacy adapter handling hymn/primary/scripture/talk/poem via hardcoded branches. Deprecated; being replaced by SingalongAdapter + ReadalongAdapter.
- `ListAdapter` — Handles yaml-config lists (menus, watchlists, programs). Implements listable + queueable.
- Canvas adapters (`FilesystemCanvasAdapter`, `ImmichCanvasAdapter`) — Handle displayable capability for image content. Not content source drivers — they serve thumbnails/display images.

**Step 4: Fix AudiobookshelfAdapter source name**

Change docs from `audiobookshelf` to `abs` (the actual `source` property value).

**Step 5: Commit**
```bash
git add docs/reference/content/content-sources.md
git commit -m "docs: fix adapter contract to match actual implementation"
```

---

### Task 1.2: Fix Content Model and Playback Docs

**Files:**
- Modify: `docs/reference/content/content-model.md`
- Modify: `docs/reference/content/content-playback.md`

**Step 1: Update Unified Play API section in content-model.md**

Add a note that `format` is added at the API layer by `resolveFormat.mjs`, not returned directly by adapters. Adapters return `mediaType` on PlayableItem or set `metadata.contentFormat`. The `resolveFormat()` utility in `backend/src/4_api/v1/utils/resolveFormat.mjs` bridges the gap.

**Step 2: Update Player Component Hierarchy in content-playback.md**

Replace `ContentResolver` with `SinglePlayer`:
```
Player.jsx (orchestrator)
├─ Composite props → CompositePlayer
└─ Single item → SinglePlayer.jsx
   ├─ Step 1: Resolve via fetchMediaInfo() → /api/v1/play/ + /api/v1/info/
   └─ Step 2: Dispatch by format field
      ├─ video / dash_video → VideoPlayer
      ├─ audio → AudioPlayer
      ├─ singalong → SingalongScroller
      ├─ readalong → ReadalongScroller
      ├─ app → PlayableAppShell
      ├─ readable_paged → PagedReader (stub)
      └─ readable_flow → FlowReader (stub)
```

**Step 3: Update Playable Contract implementation table**

Note that `onResolvedMeta` is called at the SinglePlayer level (not by individual renderers). Note that `onStartupSignal` is currently only implemented by ContentScroller-based renderers (via `useMediaReporter`), not by VideoPlayer/AudioPlayer.

**Step 4: Remove `GET /api/v1/read/:source/*` from documented routes**

The readable capability is served through the play route. PagedReader and FlowReader receive data from the same `/api/v1/play/` endpoint. Remove the read route from content-model.md, content-playback.md, and quick-reference.md.

**Step 5: Commit**
```bash
git add docs/reference/content/content-model.md docs/reference/content/content-playback.md
git commit -m "docs: fix player hierarchy, remove nonexistent read route"
```

---

### Task 1.3: Fix Quick Reference and Navigation Docs

**Files:**
- Modify: `docs/reference/content/quick-reference.md`
- Modify: `docs/reference/content/content-navigation.md`

**Step 1: Remove read route from quick-reference.md API Surface table**

Remove the row: `GET /api/v1/read/:source/*` | readable | Resolve readable content

**Step 2: Update Adapter Contract table in quick-reference.md**

Match the corrected contract from Task 1.1 (remove `getPlayInfo`, `resolveReadables`; add `getStoragePath`, `getSearchCapabilities`).

**Step 3: Update Implementation Status table**

Note PlayableAppShell exists as minimal stub (delegates to AppContainer). Note PagedReader/FlowReader are placeholder stubs.

**Step 4: Commit**
```bash
git add docs/reference/content/quick-reference.md docs/reference/content/content-navigation.md
git commit -m "docs: sync quick-reference and navigation with actual codebase"
```

---

## Phase 2: Naming & Cosmetic Cleanup (low-risk code changes)

Fixes Finding 6e (Driver→Adapter naming) and 6d (test folder names).

### Task 2.1: Rename Driver Files to Adapter

**Files:**
- Rename: `backend/src/1_adapters/content/app-registry/AppRegistryDriver.mjs` → `AppRegistryAdapter.mjs`
- Rename: `backend/src/1_adapters/content/query/QueryDriver.mjs` → `QueryAdapter.mjs`
- Modify: all files that import these (bootstrap.mjs, tests, manifests)

**Step 1: Write failing tests**

Check existing tests reference the old class names:
- `tests/isolated/adapter/content/` — find AppRegistryDriver and QueryDriver test files
- Update imports to use new names, verify tests fail

Run: `npm run test:isolated -- --testPathPattern="AppRegistry|Query" 2>&1 | head -30`
Expected: FAIL (module not found)

**Step 2: Rename the files and update class names**

In `AppRegistryDriver.mjs`:
- Rename file to `AppRegistryAdapter.mjs`
- Change `class AppRegistryDriver` → `class AppRegistryAdapter`
- Update `export { AppRegistryAdapter }`

In `QueryDriver.mjs`:
- Rename file to `QueryAdapter.mjs`
- Change `class QueryDriver` → `class QueryAdapter`
- Update `export { QueryAdapter }`

**Step 3: Update all imports**

Search for `AppRegistryDriver` and `QueryDriver` across:
- `backend/src/0_system/bootstrap.mjs`
- `backend/src/1_adapters/content/app-registry/manifest.mjs`
- `backend/src/1_adapters/content/query/manifest.mjs`
- All test files referencing these

**Step 4: Run tests**

Run: `npm run test:isolated -- --testPathPattern="AppRegistry|Query"`
Expected: PASS

**Step 5: Commit**
```bash
git add -A backend/src/1_adapters/content/app-registry/ backend/src/1_adapters/content/query/ backend/src/0_system/bootstrap.mjs tests/
git commit -m "refactor: rename AppRegistryDriver and QueryDriver to Adapter convention"
```

---

### Task 2.2: Rename Test Folders

**Files:**
- Rename: `tests/isolated/adapter/content/singing/` → `tests/isolated/adapter/content/singalong/`
- Rename: `tests/isolated/adapter/content/narrated/` → `tests/isolated/adapter/content/readalong/`
- Rename test files inside to match (SingingAdapter.test.mjs → SingalongAdapter.test.mjs, etc.)

**Step 1: Rename directories and files**

```bash
# These are git mv operations
git mv tests/isolated/adapter/content/singing tests/isolated/adapter/content/singalong
git mv tests/isolated/adapter/content/singalong/SingingAdapter.test.mjs tests/isolated/adapter/content/singalong/SingalongAdapter.test.mjs
git mv tests/isolated/adapter/content/narrated tests/isolated/adapter/content/readalong
git mv tests/isolated/adapter/content/readalong/NarratedAdapter.test.mjs tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs
```

**Step 2: Run tests to confirm paths resolve**

Run: `npm run test:isolated -- --testPathPattern="singalong|readalong"`
Expected: PASS

**Step 3: Commit**
```bash
git commit -m "refactor: rename test folders to match canonical adapter names"
```

---

## Phase 3: Playable Contract Fixes (targeted frontend fixes)

Fixes Findings 4b, 4c, 4e from the audit.

### Task 3.1: Wire VideoPlayer hardReset

**Files:**
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx:127`

**Step 1: Identify the fix**

At line 127, VideoPlayer passes `hardReset: null`. AudioPlayer (at its equivalent line) correctly passes the `hardReset` function from `useCommonMediaController`. The fix is to pass the actual `hardReset` from the controller.

**Step 2: Apply the fix**

In VideoPlayer.jsx, find the `useEffect` that calls `resilienceBridge.onRegisterMediaAccess`. Change:
```javascript
hardReset: null,
```
to:
```javascript
hardReset,
```

Also add `hardReset` to the useEffect dependency array on the same block.

The `hardReset` variable comes from `useCommonMediaController` — verify it's destructured from the hook return value (it should already be, since AudioPlayer uses it).

**Step 3: Verify no regression**

Run: `npm run test:isolated -- --testPathPattern="VideoPlayer"`
Then manual verification: play a video, verify resilience bridge recovery works.

**Step 4: Commit**
```bash
git add frontend/src/modules/Player/components/VideoPlayer.jsx
git commit -m "fix: wire hardReset in VideoPlayer onRegisterMediaAccess"
```

---

### Task 3.2: Implement PlayableAppShell Contract

**Files:**
- Modify: `frontend/src/modules/Player/components/PlayableAppShell.jsx`

**Step 1: Understand current state**

Current file (18 lines) just parses contentId and delegates to AppContainer. It accepts `clear` and `advance` but doesn't implement onPlaybackMetrics, onStartupSignal, or other contract callbacks.

**Step 2: Add minimal contract compliance**

```jsx
import { useEffect } from 'react';
import AppContainer from '../../AppContainer/AppContainer.jsx';

export default function PlayableAppShell({
  contentId,
  clear,
  advance,
  onStartupSignal,
  onPlaybackMetrics,
  onResolvedMeta,
  onRegisterMediaAccess
}) {
  const localId = contentId?.replace(/^app:/, '') || '';

  // Signal startup when mounted
  useEffect(() => {
    onStartupSignal?.();
  }, []);

  // Report resolved metadata
  useEffect(() => {
    if (localId) {
      onResolvedMeta?.({ title: localId, contentId });
    }
  }, [localId]);

  // Register empty media access (apps have no media element)
  useEffect(() => {
    onRegisterMediaAccess?.({ getMediaEl: () => null, hardReset: null });
  }, []);

  return <AppContainer open={localId} clear={clear || advance || (() => {})} />;
}
```

**Step 3: Verify rendering**

Run: `npm run test:isolated -- --testPathPattern="PlayableAppShell"`
If no test exists, verify manually: play an app content item (e.g., `?play=app:webcam`).

**Step 4: Commit**
```bash
git add frontend/src/modules/Player/components/PlayableAppShell.jsx
git commit -m "feat: implement Playable Contract in PlayableAppShell"
```

---

## Phase 4: Frontend Collection Decoupling

Fixes Finding 2c-2f. Makes the frontend extensible to new collections without code changes.

### Task 4.1: Fix ReadalongScroller — CSS Type and Ambient from Data

**Files:**
- Modify: `frontend/src/modules/ContentScroller/ReadalongScroller.jsx` (~lines 118, 160)

**Step 1: Fix CSS type derivation (line ~118)**

Current (hardcoded):
```javascript
const cssType = data.content?.type === 'verses' ? 'scriptures'
  : (data.type || data.metadata?.cssType || renderer?.cssType || 'readalong');
```

Fixed (data-driven — remove the hardcoded `verses → scriptures` mapping):
```javascript
const cssType = data.type || data.metadata?.cssType || renderer?.cssType || 'readalong';
```

The backend already sets `type` and `metadata.cssType` from the manifest. Scripture content already comes with `type: 'scripture'` from LocalContentAdapter (line 1046: `type: 'scripture'`). Talks come with `type: 'talk'` (from manifest `cssType`). No frontend guessing needed.

**Step 2: Fix ambient audio eligibility (line ~160)**

Current (hardcoded):
```javascript
ambientMediaUrl={data.ambientUrl || (['talk', 'scriptures'].includes(cssType) ? DaylightMediaPath(`media/audio/ambient/${ambientTrack}`) : null)}
```

Fixed (data-driven — the backend's `ambientUrl` field already carries this):
```javascript
ambientMediaUrl={data.ambientUrl}
```

The ReadalongAdapter already sets `ambientUrl` when the manifest declares `ambient: true`. The fallback generation of a random ambient track URL should move to the backend adapter (ReadalongAdapter.mjs `getItem()`), where it already partially lives. If `data.ambientUrl` is set by the backend, no frontend logic needed.

**Prerequisite check:** Verify ReadalongAdapter sets `ambientUrl` for scripture and talk content. If it only sets it for its own items (not LocalContentAdapter items), the LocalContentAdapter's talk/scripture return shapes need `ambientUrl` added too. Check `LocalContentAdapter.mjs` lines 877-905 (talk) and 1046-1065 (scripture) — if `ambientUrl` is missing, add it there using the same pattern as ReadalongAdapter.

**Step 3: Run tests**

Run: `npm run test:isolated -- --testPathPattern="Readalong"`
Manual: play a scripture and a talk, verify ambient audio plays and CSS styling is correct.

**Step 4: Commit**
```bash
git add frontend/src/modules/ContentScroller/ReadalongScroller.jsx
git commit -m "refactor: derive cssType and ambient from backend data, remove hardcoded collection checks"
```

---

### Task 4.2: Fix contentRenderers — CSS Type from API Data

**Files:**
- Modify: `frontend/src/lib/contentRenderers.jsx` (line 37)

**Step 1: Remove hardcoded singalong cssType**

Current:
```javascript
const singalongRenderer = { cssType: 'hymn', wrapperClass: 'hymn-text' };
```

The `cssType` should come from the Play API response data (which the backend populates from the item's `type` field). The SingalongScroller should use `data.type` or `data.metadata?.cssType` instead of a hardcoded renderer default.

Check SingalongScroller.jsx to see how it uses `getSingalongRenderer()`. If it reads `renderer.cssType` as a fallback, we can keep a generic default:

```javascript
const singalongRenderer = { cssType: 'singalong', wrapperClass: 'singalong-text' };
```

Then update `ContentScroller.scss` to add a `.singalong-text` class that mirrors the existing `.hymn-text` styles (or rename `.hymn-text` to `.singalong-text` and add `.hymn-text` as an alias).

**Step 2: Update CSS**

In `frontend/src/modules/ContentScroller/ContentScroller.scss`, find `.hymn-text` (line ~179) and:
- Add `.singalong-text` as an additional selector on the same rule
- This way both old and new class names work

**Step 3: Run tests and verify visually**

Run: `npm run test:isolated -- --testPathPattern="contentRenderer|Singalong"`
Manual: play a hymn, verify styling is preserved.

**Step 4: Commit**
```bash
git add frontend/src/lib/contentRenderers.jsx frontend/src/modules/ContentScroller/ContentScroller.scss
git commit -m "refactor: use generic singalong cssType instead of hardcoded 'hymn'"
```

---

### Task 4.3: Fix websocketHandler — Content Detection

**Files:**
- Modify: `frontend/src/lib/OfficeApp/websocketHandler.js` (~line 133)

**Step 1: Replace hardcoded collection detection**

Current:
```javascript
const isContentItem = data.hymn || data.scripture || data.talk || data.primary;
```

Fixed (detect by `contentId` or `play` key presence, not by collection name):
```javascript
const isContentItem = data.play || data.contentId || data.content;
```

If the websocket messages use collection-specific keys (e.g., `{ hymn: '166' }`), we need backward compatibility. A better approach:

```javascript
// Content items have a play action or are recognized by the presence of a contentId
const hasContentId = data.play || data.contentId;
// Legacy: specific collection keys indicate a play action
const hasLegacyContentKey = data.hymn || data.scripture || data.talk || data.primary || data.poem;
const isContentItem = hasContentId || hasLegacyContentKey;
```

This preserves backward compat while also supporting any new content that uses `play` or `contentId` keys.

**Step 2: Commit**
```bash
git add frontend/src/lib/OfficeApp/websocketHandler.js
git commit -m "refactor: detect content items by contentId/play key, not hardcoded collection names"
```

---

### Task 4.4: Fix ListsItemRow — Icons, Colors, Labels from Backend

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (~lines 82-85, 173-174, 228-230)

**Step 1: Add generic fallbacks for collection-specific entries**

The TYPE_ICONS, SOURCE_COLORS, and TYPE_LABELS maps contain collection-specific entries (`hymn`, `primary`, `scripture`, `poem`, `talk`). These should fall through to format-based or generic defaults.

For TYPE_ICONS, add format-based entries:
```javascript
// Format-based icons (preferred over collection-specific)
singalong: IconMusic,
readalong: IconBook,
app: IconApps,
// Legacy collection names (backward compat, will be removed when backend sends format)
hymn: IconMusic,
primary: IconMusic,
scripture: IconBook,
poem: IconFileText,
talk: IconMicrophone,
```

For SOURCE_COLORS, keep the existing entries (they're display hints, not logic). Add format-based entries alongside:
```javascript
singalong: 'indigo',
readalong: 'orange',
```

For TYPE_LABELS, add format-based:
```javascript
singalong: 'Song',
readalong: 'Reading',
```

**Step 2: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "refactor: add format-based icons/colors/labels alongside collection-specific ones"
```

---

## Phase 5: Adapter Return Type Consistency

Fixes Finding 1d. Makes SingalongAdapter and ReadalongAdapter return PlayableItem instances.

### Task 5.1: SingalongAdapter — Return PlayableItem

**Files:**
- Modify: `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs` (~lines 97-117)
- Test: `tests/isolated/adapter/content/singalong/SingalongAdapter.test.mjs`

**Step 1: Write a failing test**

Add a test that checks the return type:
```javascript
it('getItem returns a PlayableItem instance', async () => {
  // Setup mocks for a valid hymn
  loadYamlByPrefix.mockReturnValue({ title: 'Test Hymn', verses: [['line1']] });
  findMediaFileByPrefix.mockReturnValue('/mock/audio.mp3');

  const item = await adapter.getItem('hymn/1');
  expect(item).toBeInstanceOf(PlayableItem);
  expect(item.mediaType).toBe('audio');
  expect(item.content).toBeDefined();
});
```

Run: `npm run test:isolated -- --testPathPattern="SingalongAdapter"`
Expected: FAIL (returns plain object, not PlayableItem)

**Step 2: Refactor getItem() to return PlayableItem**

Import PlayableItem at top of SingalongAdapter.mjs:
```javascript
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
```

Change the return statement (lines 97-117) from a plain object to:
```javascript
return new PlayableItem({
  id: `singalong:${localId}`,
  source: 'singalong',
  localId,
  title: metadata.title || `${collection} ${itemId}`,
  subtitle: metadata.subtitle || `${collection} #${metadata.number || itemId}`,
  thumbnail: this._collectionThumbnail(collection),
  mediaUrl: `/api/v1/stream/singalong/${localId}`,
  mediaType: 'audio',
  duration,
  content: { type: contentType, data: metadata.verses || [] },
  style,
  type: collection,
  metadata: { number: metadata.number, contentFormat: 'singalong', ...metadata }
});
```

**Step 3: Run tests**

Run: `npm run test:isolated -- --testPathPattern="SingalongAdapter"`
Expected: PASS

**Step 4: Commit**
```bash
git add backend/src/1_adapters/content/singalong/SingalongAdapter.mjs tests/
git commit -m "refactor: SingalongAdapter.getItem returns PlayableItem instance"
```

---

### Task 5.2: ReadalongAdapter — Return PlayableItem

**Files:**
- Modify: `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs` (~lines 166-188)
- Test: `tests/isolated/adapter/content/readalong/ReadalongAdapter.test.mjs`

**Step 1: Write a failing test** (same pattern as 5.1)

**Step 2: Refactor getItem() to return PlayableItem**

Same pattern: import PlayableItem, wrap the return object in `new PlayableItem({...})`, ensure `mediaType` is set (`'audio'` for audio-backed content, `'video'` for video-backed talks).

**Step 3: Run tests**

Run: `npm run test:isolated -- --testPathPattern="ReadalongAdapter"`
Expected: PASS

**Step 4: Commit**
```bash
git add backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs tests/
git commit -m "refactor: ReadalongAdapter.getItem returns PlayableItem instance"
```

---

## Phase 6: Backend Ambient URL Consolidation

Ensures the backend always provides `ambientUrl` in the Play API response (prerequisite for Task 4.1's frontend simplification).

### Task 6.1: Add ambientUrl to LocalContentAdapter Returns

**Files:**
- Modify: `backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs`

**Step 1: Check which returns are missing ambientUrl**

The `_getTalk()` return (lines 877-905) and `_getScripture()` return (lines 1046-1065) likely don't include `ambientUrl`. The ReadalongAdapter already generates it from the manifest's `ambient: true` setting.

**Step 2: Add ambientUrl generation**

In `_getTalk()` and `_getScripture()`, add ambient URL generation:
```javascript
// Generate ambient URL when manifest declares ambient: true
const ambientUrl = manifest.ambient
  ? `/api/v1/stream/media/audio/ambient/${Math.floor(Math.random() * 115) + 1}.mp3`
  : null;
```

Include `ambientUrl` in the PlayableItem constructor call.

**Step 3: Run tests**

Run: `npm run test:isolated -- --testPathPattern="LocalContent"`
Expected: PASS

**Step 4: Commit**
```bash
git add backend/src/1_adapters/content/local-content/LocalContentAdapter.mjs
git commit -m "feat: add ambientUrl to LocalContentAdapter talk/scripture responses"
```

---

## Phase 7: Config List Migration Wiring

Fixes Finding 5b. The `listConfigNormalizer.mjs` exists and is tested but not wired into ListAdapter.

### Task 7.1: Wire listConfigNormalizer into ListAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`
- Read: `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`

**Step 1: Understand the normalizer**

Read `listConfigNormalizer.mjs` to understand its input/output contract. It should accept both legacy format (label/input/action) and new format (title/play/open/list/display) and produce a canonical internal representation.

**Step 2: Import and wire**

In ListAdapter.mjs, after loading YAML list data, pass it through the normalizer before processing:

```javascript
import { normalizeListConfig } from './listConfigNormalizer.mjs';

// In the method that loads list items:
const rawConfig = await loadYaml(listPath);
const normalized = normalizeListConfig(rawConfig);
// Use normalized instead of rawConfig for further processing
```

**Step 3: Run existing tests**

Run: `npm run test:isolated -- --testPathPattern="ListAdapter|listConfigNormalizer"`
Expected: PASS (normalizer is already tested; ListAdapter tests should still pass with normalized input)

**Step 4: Commit**
```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs
git commit -m "feat: wire listConfigNormalizer into ListAdapter for dual-format support"
```

---

## Phase 8: Legacy local-content Deprecation Tracking

Fixes Finding 3b. Ensure deprecation headers are set and track frontend migration.

### Task 8.1: Verify Deprecation Headers

**Files:**
- Read: `backend/src/4_api/v1/routers/localContent.mjs`

**Step 1: Verify existing deprecation headers**

The audit says RFC 8594 headers are already set. Confirm each endpoint has:
```
Deprecation: true
Sunset: Sat, 01 Aug 2026 00:00:00 GMT
```

If any are missing, add them.

**Step 2: Add a deprecation comment to the router**

Add a file-level comment documenting the sunset plan and what replaces each endpoint:
```javascript
/**
 * DEPRECATED: All endpoints in this router are deprecated.
 * Sunset date: 2026-08-01
 *
 * Replacements:
 *   GET /local-content/hymn/:number     → GET /play/singalong/hymn/:number
 *   GET /local-content/primary/:number  → GET /play/singalong/primary/:number
 *   GET /local-content/scripture/*      → GET /play/readalong/scripture/*
 *   GET /local-content/talk/*           → GET /play/readalong/talks/*
 *   GET /local-content/poem/*           → GET /play/readalong/poetry/*
 */
```

**Step 3: Commit**
```bash
git add backend/src/4_api/v1/routers/localContent.mjs
git commit -m "docs: add deprecation mapping comments to localContent router"
```

---

## Verification

After all phases are complete, run the full verification:

### Automated Tests
```bash
# All isolated tests
npm run test:isolated

# Content-specific tests
npm run test:isolated -- --testPathPattern="content|Singalong|Readalong|ContentId|ListAdapter|AppRegistry|Query"
```

### Manual Verification Checklist

1. **Play a hymn** (`?play=hymn:198`) — verify singalong format, correct CSS styling, audio plays
2. **Play a scripture** (`?play=scripture:john-3-16`) — verify readalong format, ambient audio plays, verse styling correct
3. **Play a talk** (`?play=talk:ldsgc/ldsgc202510/11`) — verify readalong format, video plays, ambient audio, correct CSS
4. **Play a poem** (`?play=poem:remedy/01`) — verify readalong format, audio plays
5. **Play an app** (`?play=app:webcam`) — verify PlayableAppShell renders, advance works
6. **Browse a menu** (`?list=menu:fhe`) — verify items display with correct icons and colors
7. **Admin UI** — open ListsItemRow editor, verify icons/colors for different content types
8. **WebSocket** — send a content command from Office, verify it's recognized

### Documentation Verification

Reread all files in `docs/reference/content/` and verify every claim matches the codebase:
- Every API route listed exists
- Every adapter method documented exists
- Every renderer listed exists with correct format dispatch
- No phantom features (documented but not implemented)
- No undocumented features (implemented but not in docs)

---

## Summary

| Phase | Tasks | Risk | Estimated Effort |
|-------|-------|------|-----------------|
| 1. Doc accuracy | 1.1-1.3 | None (docs only) | Small |
| 2. Naming cleanup | 2.1-2.2 | Low (renames) | Small |
| 3. Playable Contract | 3.1-3.2 | Medium (frontend) | Small |
| 4. Frontend decoupling | 4.1-4.4 | Medium (frontend) | Medium |
| 5. Adapter return types | 5.1-5.2 | Medium (backend) | Medium |
| 6. Backend ambient URL | 6.1 | Low (additive) | Small |
| 7. Config normalizer | 7.1 | Medium (backend) | Small |
| 8. Deprecation tracking | 8.1 | None (comments) | Small |

**Total: 14 tasks across 8 phases.**
