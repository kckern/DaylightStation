# Frontend Plex Decoupling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all frontend awareness of "plex" as a content source, replacing source-specific branching with a unified `contentId` pattern where the backend resolves the source.

**Architecture:** The backend info/display/play routers already support compound IDs (`plex:12345`, `immich:abc`, `folder:path`) via `parseActionRouteId`. However, the **list router does NOT** — it uses `parseModifiers()` with `/:source/*` and requires path segments (`/list/plex/12345/playable`). Phase 0 fixes this so all routers handle compound IDs uniformly. Then the frontend replaces source-specific branching (`plex` vs `media` props) with a single `contentId` prop. The backend `toListItem()` emits uniform action objects (`{ play: { contentId: "plex:12345" } }` alongside legacy keys), and the frontend consumes them generically.

**Tech Stack:** Express.js (backend routers), React (frontend modules), YAML configs

**Audit Reference:** `docs/_wip/audits/2026-02-06-frontend-plex-coupling-audit.md`

---

## Phase 0: List Router Compound ID Support (Prerequisite)

### Task 0: Upgrade list router to use `parseActionRouteId`

The info, display, and play routers use `parseActionRouteId()` which handles compound IDs (`plex:12345`) in the `:source` parameter. The list router uses `parseModifiers()` directly, so `/list/plex:12345/playable` does NOT work — only `/list/plex/12345/playable` works.

This is a prerequisite for the frontend to use `contentId` (compound IDs) in list API calls.

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:278-310`

**Step 1: Import parseActionRouteId**

```js
// Add at top of list.mjs, after existing imports:
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
```

**Step 2: Replace source/path parsing in GET handler**

```js
// OLD (lines 278-310):
router.get('/:source/*', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const rawPath = req.params[0] || '';
    const { modifiers, localId } = parseModifiers(rawPath);

    let adapter = registry.get(source);
    let resolvedLocalId = localId;
    let resolvedViaPrefix = false;

    if (!adapter) {
      const resolved = registry.resolve(`${source}:${localId}`);
      if (resolved) {
        adapter = resolved.adapter;
        resolvedLocalId = resolved.localId;
        resolvedViaPrefix = true;
      }
    }

    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }

    // ...
    const isFolderSource = source === 'folder' || source === 'local';
    const compoundId = isFolderSource ? `folder:${resolvedLocalId}`
      : (resolvedViaPrefix ? resolvedLocalId : `${source}:${resolvedLocalId}`);

// NEW:
router.get('/:source/*', asyncHandler(async (req, res) => {
    const rawSource = req.params.source;
    const rawPath = req.params[0] || '';

    // Use parseActionRouteId to handle compound IDs (plex:12345) in source param
    const { source, localId, compoundId: parsedCompoundId, modifiers } = parseActionRouteId({
      source: rawSource,
      path: rawPath
    });

    // Try exact source match first, then fall back to prefix resolution
    let adapter = registry.get(source);
    let resolvedLocalId = localId;
    let resolvedViaPrefix = false;

    if (!adapter) {
      const resolved = registry.resolve(`${source}:${localId}`);
      if (resolved) {
        adapter = resolved.adapter;
        resolvedLocalId = resolved.localId;
        resolvedViaPrefix = true;
      }
    }

    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }

    // Build compound ID
    const isFolderSource = source === 'folder' || source === 'local';
    const compoundId = isFolderSource ? `folder:${resolvedLocalId}`
      : (resolvedViaPrefix ? resolvedLocalId : `${source}:${resolvedLocalId}`);
```

**Step 3: Verify syntax and test**

Run: `node -c backend/src/4_api/v1/routers/list.mjs`

Test: Both formats should now work:
- `GET /api/v1/list/plex/12345/playable` (path segments — existing)
- `GET /api/v1/list/plex:12345/playable` (compound ID — new)

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs
git commit -m "feat: upgrade list router to use parseActionRouteId for compound ID support"
```

---

## Phase 1: Backend Action Object Unification

### Task 1: Unify `toListItem()` action objects in list.mjs

The core change: `toListItem()` currently branches on `isPlex` to produce `{ plex: localId }` vs `{ media: item.id }`. Change it to always emit `{ contentId: compoundId }`.

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:60-89`

**Step 1: Replace source-branching action computation with unified contentId**

```js
// OLD (lines 62-70):
const isPlex = item.source === 'plex';
const isContainer = item.itemType === 'container';
const localId = item.localId || item.id;
const computedPlay = item.mediaUrl ? (isPlex ? { plex: localId } : { media: item.id }) : undefined;
const computedQueue = isContainer ? (isPlex ? { plex: localId } : { playlist: item.id }) : undefined;
const computedList = isContainer ? (isPlex ? { plex: localId } : { folder: item.id }) : undefined;

// NEW:
const isContainer = item.itemType === 'container';
// Build compound ID: use item.id which is already "source:localId" from Item entity
const contentId = item.id;
const computedPlay = item.mediaUrl ? { contentId } : undefined;
const computedQueue = isContainer ? { contentId } : undefined;
const computedList = isContainer ? { contentId } : undefined;
```

**Step 2: Add backward-compat shims to action objects**

To avoid breaking the entire frontend at once, also include the legacy keys alongside `contentId`:

```js
// After computing contentId, add legacy keys for backward compatibility:
const isPlex = item.source === 'plex';
const localId = item.localId || item.id;

// Emit both new (contentId) and legacy (plex/media/playlist/folder) keys
const computedPlay = item.mediaUrl
  ? { contentId, ...(isPlex ? { plex: localId } : { media: item.id }) }
  : undefined;
const computedQueue = isContainer
  ? { contentId, ...(isPlex ? { plex: localId } : { playlist: item.id }) }
  : undefined;
const computedList = isContainer
  ? { contentId, ...(isPlex ? { plex: localId } : { folder: item.id }) }
  : undefined;
```

**Step 3: Verify backend starts and list responses include contentId**

Run: `node -c backend/src/4_api/v1/routers/list.mjs`
Expected: No syntax errors.

Run: Start dev server, fetch a list response. Verify items have `play.contentId` alongside `play.plex`.

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs
git commit -m "feat: add contentId to action objects in toListItem() (backward compat)"
```

---

### Task 2: Add contentId to info router response

The info router returns metadata for a single item. Add `contentId` to the response for consistency.

**Files:**
- Modify: `backend/src/4_api/v1/routers/info.mjs` (transformToInfoResponse function)

**Step 1: Add contentId field to info response**

In `transformToInfoResponse()`, the response already has `id` (compound) and `source`. Add a `contentId` alias:

```js
// In the response object construction:
const response = {
  contentId: item.id,  // Add this line — compound ID like "plex:12345"
  id: item.id,
  source: item.source || source,
  // ... rest unchanged
};
```

**Step 2: Verify syntax**

Run: `node -c backend/src/4_api/v1/routers/info.mjs`

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/info.mjs
git commit -m "feat: add contentId to info router response"
```

---

## Phase 2: Player Stack — contentId Prop Migration

### Task 3: Update `fetchMediaInfo` in Player/lib/api.js to accept contentId

**Depends on:** Task 0 (list router must support compound IDs for shuffle path)

Currently `fetchMediaInfo` takes `{ plex, media, shuffle, ... }` and branches. Change it to prefer `contentId` while keeping backward compat for `plex` and `media` props.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:49-112`

**Step 1: Add contentId path to fetchMediaInfo**

```js
// At the top of fetchMediaInfo, before the plex/media branches (after line 69):

// New unified path: use contentId directly
if (!plex && !media) {
  // Check for contentId in params (future callers will pass this)
  const { contentId } = arguments[0] || {};
  if (contentId) {
    if (shuffle) {
      const { items: shuffledItems } = await DaylightAPI(
        buildUrl(`api/v1/list/${contentId}/playable,shuffle`, queryCommon)
      );
      if (shuffledItems?.length > 0) {
        const firstItem = shuffledItems[0];
        const firstContentId = firstItem.play?.contentId || firstItem.contentId || firstItem.id;
        if (firstContentId) {
          const infoUrl = buildUrl(`api/v1/info/${firstContentId}`, queryCommon);
          const infoResponse = await DaylightAPI(infoUrl);
          return { ...infoResponse, assetId: infoResponse.contentId || infoResponse.id };
        }
      }
      return null;
    }
    const url = buildUrl(`api/v1/info/${contentId}`, queryCommon);
    const infoResponse = await DaylightAPI(url);
    return { ...infoResponse, assetId: infoResponse.contentId || infoResponse.id };
  }
}
```

Note: The compound contentId (e.g., `plex:12345`) is a single path segment with a colon, which the backend `parseActionRouteId` already handles. So `/api/v1/info/plex:12345` works.

**Step 2: Verify syntax**

Run: `node -c frontend/src/modules/Player/lib/api.js`

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "feat: add contentId support to fetchMediaInfo (alongside plex/media)"
```

---

### Task 4: Update `flattenQueueItems` to use contentId

Currently branches on `item.queue.plex` vs `item.queue.playlist`. Add `item.queue.contentId` path.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:10-36`

**Step 1: Add contentId branch to flattenQueueItems**

```js
// OLD (lines 14-27):
if (item.queue) {
  const shuffle = !!item.queue.shuffle || item.shuffle || false;
  if (item.queue.playlist || item.queue.queue) {
    const queueKey = item.queue.playlist ?? item.queue.queue;
    const modifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');
    const { items: nestedItems } = await DaylightAPI(`api/v1/list/folder/${queueKey}/${modifiers}`);
    // ...
  } else if (item.queue.plex) {
    const plexModifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');
    const { items: plexItems } = await DaylightAPI(`api/v1/list/plex/${item.queue.plex}/${plexModifiers}`);
    // ...
  }
}

// NEW:
if (item.queue) {
  const shuffle = !!item.queue.shuffle || item.shuffle || false;
  const modifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');

  if (item.queue.contentId) {
    // Unified path: contentId is a compound ID like "plex:12345" or "folder:path"
    const { items: nestedItems } = await DaylightAPI(`api/v1/list/${item.queue.contentId}/${modifiers}`);
    const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
    flattened.push(...nestedFlattened);
  } else if (item.queue.playlist || item.queue.queue) {
    // Legacy: folder-based playlists
    const queueKey = item.queue.playlist ?? item.queue.queue;
    const { items: nestedItems } = await DaylightAPI(`api/v1/list/folder/${queueKey}/${modifiers}`);
    const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
    flattened.push(...nestedFlattened);
  } else if (item.queue.plex) {
    // Legacy: plex-specific queue
    const { items: plexItems } = await DaylightAPI(`api/v1/list/plex/${item.queue.plex}/${modifiers}`);
    const nestedFlattened = await flattenQueueItems(plexItems, level + 1);
    flattened.push(...nestedFlattened);
  }
}
```

**Step 2: Verify syntax**

Run: `node -c frontend/src/modules/Player/lib/api.js`

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "feat: add contentId branch to flattenQueueItems"
```

---

### Task 5: Update `SinglePlayer.jsx` to extract contentId

**Depends on:** Task 0 (list router must support compound IDs for collection expansion)

Currently destructures `plex` and `media` from the play object. Add `contentId` and prefer it.

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:34-62,152-165,234-280`

**Step 1: Add contentId to destructuring (line 34-62)**

```js
// OLD (lines 34-62):
const {
  plex,
  media,
  hymn,
  // ...
} = play || {};

// NEW:
const {
  contentId,   // ← NEW: unified content identifier
  plex,        // Legacy: kept for backward compat
  media,       // Legacy: kept for backward compat
  hymn,
  // ... rest unchanged
} = play || {};

// Compute effective contentId from whichever is available
const effectiveContentId = contentId || (plex ? `plex:${plex}` : null) || media || null;
```

**Step 2: Update fetchMediaInfo call (line 237-244)**

```js
// OLD:
const info = await fetchMediaInfo({
  plex,
  media,
  shuffle,
  // ...
});

// NEW:
const info = await fetchMediaInfo({
  contentId: effectiveContentId,
  plex,    // Legacy fallback — fetchMediaInfo handles both
  media,   // Legacy fallback
  shuffle,
  maxVideoBitrate: play?.maxVideoBitrate,
  maxResolution: play?.maxResolution,
  session: plexClientSession
});
```

**Step 3: Update collection expansion (line 250-253)**

```js
// OLD:
if (!isPlayable && plex) {
  const { items } = await DaylightAPI(`/api/v1/list/plex/${plex}/playable`);

// NEW:
if (!isPlayable && effectiveContentId) {
  const { items } = await DaylightAPI(`/api/v1/list/${effectiveContentId}/playable`);
```

**Step 4: Update first-item extraction (line 256)**

```js
// OLD:
const firstItemPlex = firstItem.plex || firstItem.play?.plex || firstItem.metadata?.plex;
if (firstItemPlex) {
  const playableInfo = await fetchMediaInfo({
    plex: firstItemPlex,

// NEW:
const firstItemContentId = firstItem.play?.contentId || firstItem.contentId || firstItem.id
    || firstItem.play?.plex || firstItem.plex;  // Legacy fallback
if (firstItemContentId) {
  const playableInfo = await fetchMediaInfo({
    contentId: String(firstItemContentId).includes(':') ? firstItemContentId : `plex:${firstItemContentId}`,
    plex: firstItem.play?.plex || firstItem.plex,  // Legacy fallback
```

**Step 5: Update playbackSessionKey (lines 152-165)**

```js
// OLD:
const candidates = [
  mediaInfo?.assetId,
  mediaInfo?.key,
  mediaInfo?.plex,
  // ...
  plex,
  mediaKeyProp,
  media
];

// NEW:
const candidates = [
  mediaInfo?.contentId,  // ← NEW: prefer contentId
  mediaInfo?.assetId,
  mediaInfo?.key,
  mediaInfo?.plex,       // Legacy
  mediaInfo?.id,
  mediaInfo?.mediaUrl,
  effectiveContentId,    // ← NEW: replaces bare plex/media
  plex,                  // Legacy
  mediaKeyProp,
  media                  // Legacy
];
```

**Step 6: Verify syntax**

Run: `node -c frontend/src/modules/Player/components/SinglePlayer.jsx` (JSX won't fully parse, but check for gross errors)

**Step 7: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "feat: add contentId support to SinglePlayer (alongside legacy plex/media)"
```

---

### Task 6: Update `useQueueController.js` to use contentId

**Depends on:** Task 0 (list router must support compound IDs for queue init)

Currently has separate `plexKey` and `playlistKey` paths. Add unified `contentId` path.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:42-43,93-107`

**Step 1: Add contentId extraction (after line 43)**

```js
// OLD (lines 42-43):
const playlistKey = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
const plexKey = queue?.plex || play?.plex;

// NEW:
const contentIdKey = play?.contentId || queue?.contentId;
const playlistKey = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
const plexKey = queue?.plex || play?.plex;
```

**Step 2: Add contentId to signature (lines 46-62)**

```js
// Add after line 49:
if (contentIdKey) signatureParts.push(`contentId:${contentIdKey}`);
```

**Step 3: Add contentId branch in initQueue (lines 93-107)**

```js
// After the existing `else if` block (after line 93), add contentId path first:
} else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
  const queue_assetId = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
  const queue_contentId = play?.contentId || queue?.contentId;

  if (queue_contentId && !queue_assetId && !plexKey) {
    // Unified contentId path — compound ID like "plex:12345" or "folder:path"
    const { items } = await DaylightAPI(`api/v1/list/${queue_contentId}/playable${isShuffle ? ',shuffle' : ''}`);
    const flattened = await flattenQueueItems(items);
    newQueue = flattened.map(item => ({ ...item, ...item.play, ...itemOverrides, guid: guid() }));
  } else if (queue_assetId) {
    // Legacy folder-based path (unchanged)
    const { items } = await DaylightAPI(`api/v1/list/folder/${queue_assetId}/playable${isShuffle ? ',shuffle' : ''}`);
    const flattened = await flattenQueueItems(items);
    newQueue = flattened.map(item => ({ ...item, ...item.play, ...itemOverrides, guid: guid() }));
  } else if (queue?.plex || play?.plex) {
    // Legacy plex-specific path (unchanged for now)
    const plexId = queue?.plex || play?.plex;
    const { items } = await DaylightAPI(`api/v1/list/plex/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
    const flattened = await flattenQueueItems(items);
    newQueue = flattened.map(item => ({ ...item, ...item.play, ...itemOverrides, guid: guid() }));
  } else if (play?.media) {
    newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
  }
}
```

Note: `useQueueController.js:96` still has a stale `/item/` URL (`api/v1/item/folder/...`). Fix that while we're here:

```js
// Line 96 OLD:
const { items } = await DaylightAPI(`api/v1/item/folder/${queue_assetId}/playable${isShuffle ? ',shuffle' : ''}`);
// Line 96 NEW:
const { items } = await DaylightAPI(`api/v1/list/folder/${queue_assetId}/playable${isShuffle ? ',shuffle' : ''}`);

// Line 101 OLD:
const { items } = await DaylightAPI(`api/v1/item/plex/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
// Line 101 NEW:
const { items } = await DaylightAPI(`api/v1/list/plex/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
```

**Step 4: Add contentIdKey to effect deps (line 128)**

```js
// OLD:
}, [play, queue, isShuffle, playlistKey, plexKey]);
// NEW:
}, [play, queue, isShuffle, playlistKey, plexKey, contentIdKey]);
```

**Step 5: Verify syntax**

Run: `node -c frontend/src/modules/Player/hooks/useQueueController.js`

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js
git commit -m "feat: add contentId queue init path, fix stale /item/ URLs in useQueueController"
```

---

## Phase 3: Menu Stack — Source-Agnostic Navigation

### Task 7: Update MenuStack.jsx to use contentId instead of `.list?.plex`

Currently checks `selection.list?.plex` to route to ShowView/SeasonView. Should check `selection.list?.contentId` (or fall back to `selection.list?.plex`).

**Files:**
- Modify: `frontend/src/modules/Menu/MenuStack.jsx:42-56`

**Step 1: Replace plex-specific routing with content-type routing**

```js
// OLD (lines 42-56):
if (selection.list?.plex && selection.type === 'show') {
  push({ type: 'show-view', props: selection });
  return;
}
if (selection.list?.plex && selection.type === 'season') {
  push({ type: 'season-view', props: selection });
  return;
}
if (selection.list?.plex && !selection.type) {
  push({ type: 'plex-menu', props: selection });
  return;
}

// NEW:
// Route based on content type, not source. Any listable item with show/season type gets the specialized view.
const listContentId = selection.list?.contentId || selection.list?.plex;
if (listContentId && selection.type === 'show') {
  push({ type: 'show-view', props: selection });
  return;
}
if (listContentId && selection.type === 'season') {
  push({ type: 'season-view', props: selection });
  return;
}
if (listContentId && !selection.type) {
  push({ type: 'plex-menu', props: selection });
  return;
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Menu/MenuStack.jsx
git commit -m "feat: route menu views by type+contentId instead of plex-specific check"
```

---

### Task 8: Update PlexMenuRouter to use contentId

Currently fetches `/info/plex/${plexId}` using the plex ID from `list.plex`. Should use `contentId`.

**Files:**
- Modify: `frontend/src/modules/Menu/PlexMenuRouter.jsx:109`
- Modify: `frontend/src/modules/Menu/hooks/useFetchPlexData.js:29`

**Step 1: Fix PlexMenuRouter API call (line 109)**

```js
// OLD:
const data = await DaylightAPI(`api/v1/info/plex/${plexId}`);

// NEW — prefer contentId, fall back to plex:
const id = selection.list?.contentId || (plexId ? `plex:${plexId}` : plexId);
const data = await DaylightAPI(`api/v1/info/${id}`);
```

Also update the plexId extraction:
```js
// Where plexId is extracted from selection (find the line):
// OLD:
const plexId = selection.list?.plex;
// NEW:
const plexId = selection.list?.plex;  // Keep for legacy
const contentId = selection.list?.contentId;
```

**Step 2: Fix useFetchPlexData hook (line 29)**

```js
// OLD:
const response = await DaylightAPI(`/api/v1/info/plex/${plexId}`);

// NEW — accept contentId OR plexId:
const id = contentId || (plexId ? `plex:${plexId}` : plexId);
const response = await DaylightAPI(`/api/v1/info/${id}`);
```

Update the hook signature to accept `contentId`:
```js
// OLD:
export function useFetchPlexData(plexId) {
// NEW:
export function useFetchPlexData(plexId, contentId = null) {
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Menu/PlexMenuRouter.jsx frontend/src/modules/Menu/hooks/useFetchPlexData.js
git commit -m "feat: use contentId in PlexMenuRouter and useFetchPlexData"
```

---

## Phase 4: Display URL Abstraction

### Task 9: Replace frontend-constructed `/display/plex/` URLs with backend-provided thumbnails

The frontend constructs `DaylightMediaPath(\`api/v1/display/plex/${id}\`)` in ~10 places. The backend already returns `thumbnail` in list item responses via `toListItem()`. Where possible, use the backend-provided URL. Where not available, construct using `contentId` instead of hardcoded `plex`.

**Key finding from audit:** FitnessShow:564 has **wrong priority** — prefers constructed URL over `episode.image`. FitnessShow:969 always constructs without checking `parentsMap`. The `ContentDisplayUrl(thumbnail, contentId)` helper fixes both by always preferring the backend-provided thumbnail.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx:35,108,112,553,564,967,969`
- Modify: `frontend/src/modules/Menu/Menu.jsx:705`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx:456`

**Step 1: Create display URL helper**

Add a utility function that builds a display URL from any content ID (not just plex):

In `frontend/src/lib/api.mjs`, add after line 165:

```js
/**
 * Build a display URL for any content ID.
 * Prefers the item's existing thumbnail URL if available.
 * Falls back to constructing /api/v1/display/{contentId}.
 * @param {string} thumbnail - Pre-existing thumbnail URL from backend
 * @param {string} contentId - Compound content ID (e.g., "plex:12345")
 * @returns {string|null} Display URL
 */
export const ContentDisplayUrl = (thumbnail, contentId) => {
    if (thumbnail) return normalizeImageUrl(thumbnail);
    if (!contentId) return null;
    return DaylightMediaPath(`api/v1/display/${contentId}`);
};
```

**Step 2: Update FitnessShow.jsx display URLs**

For each `DaylightMediaPath(\`api/v1/display/plex/${id}\`)`, replace with `ContentDisplayUrl(item.thumbnail, item.id)` or equivalent:

```js
// Line 35 OLD:
src={type === 'season' && item.id ? DaylightMediaPath(`api/v1/display/plex/${item.id}`) : normalizeImageUrl(item.image)}
// Line 35 NEW:
src={type === 'season' && item.id ? ContentDisplayUrl(item.image, item.id) : normalizeImageUrl(item.image)}

// Line 108 OLD:
const parentImage = normalizeImageUrl(parent.thumbnail || parent.image) || (parentId ? DaylightMediaPath(`api/v1/display/plex/${parentId}`) : normalizeImageUrl(showInfo?.image));
// Line 108 NEW:
const parentImage = normalizeImageUrl(parent.thumbnail || parent.image) || ContentDisplayUrl(null, parentId ? `plex:${parentId}` : null) || normalizeImageUrl(showInfo?.image);

// Line 112 OLD:
: (episode.thumbId ? DaylightMediaPath(`api/v1/display/plex/${episode.thumbId}`) : null);
// Line 112 NEW:
: ContentDisplayUrl(episode.image, episode.thumbId ? `plex:${episode.thumbId}` : episode.id);

// Lines 553, 564, 967, 969: Same pattern — replace DaylightMediaPath(`api/v1/display/plex/${x}`) with ContentDisplayUrl(item.image, item.id || `plex:${x}`)
```

**Step 3: Update Menu.jsx (line 705)**

```js
// OLD:
image = DaylightMediaPath(`/api/v1/display/plex/${val}`);
// NEW:
image = ContentDisplayUrl(null, `plex:${val}`);
```

**Step 4: Update FitnessMusicPlayer.jsx (line 456)**

```js
// OLD:
src={DaylightMediaPath(`api/v1/display/plex/${trackKey}`)}
// NEW:
src={ContentDisplayUrl(track?.thumbnail, track?.id || `plex:${trackKey}`)}
```

**Step 5: Commit**

```bash
git add frontend/src/lib/api.mjs \
       frontend/src/modules/Fitness/FitnessShow.jsx \
       frontend/src/modules/Menu/Menu.jsx \
       frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx
git commit -m "feat: replace hardcoded /display/plex/ URLs with ContentDisplayUrl helper"
```

---

## Phase 5: FitnessContext Helpers

### Task 10: Replace `getPlexIdFromActions` with `getContentIdFromActions`

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:37-59`

**Step 1: Replace helpers**

```js
// OLD (lines 43-45):
const getPlexIdFromActions = (item) => {
  return item?.play?.plex || item?.queue?.plex || item?.list?.plex || null;
};

// NEW:
/**
 * Extract content ID from item's action objects (play, queue, list)
 * Prefers contentId, falls back to legacy plex/media/playlist/folder keys
 * @param {Object} item - Item with action objects
 * @returns {string|null} The content ID or null
 */
const getContentIdFromActions = (item) => {
  // Prefer unified contentId
  const contentId = item?.play?.contentId || item?.queue?.contentId || item?.list?.contentId;
  if (contentId) return contentId;
  // Legacy plex fallback — construct compound ID
  const plex = item?.play?.plex || item?.queue?.plex || item?.list?.plex;
  if (plex) return `plex:${plex}`;
  // Legacy media/playlist/folder fallback
  return item?.play?.media || item?.queue?.playlist || item?.list?.folder || null;
};

// Keep old name as alias for backward compat during migration:
const getPlexIdFromActions = (item) => {
  const contentId = getContentIdFromActions(item);
  // Extract localId from compound ID for legacy callers expecting bare plex IDs
  if (contentId && contentId.startsWith('plex:')) return contentId.slice(5);
  return contentId;
};
```

**Step 2: Update getItemIdentifier**

```js
// OLD (lines 53-58):
const getItemIdentifier = (item) => {
  const actionPlex = getPlexIdFromActions(item);
  if (actionPlex) return actionPlex;
  return item?.id || item?.ratingKey || item?.plex || null;
};

// NEW:
const getItemIdentifier = (item) => {
  const contentId = getContentIdFromActions(item);
  if (contentId) return contentId;
  return item?.id || item?.ratingKey || item?.plex || null;
};
```

**Step 3: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat: replace getPlexIdFromActions with source-agnostic getContentIdFromActions"
```

---

## Phase 6: Remaining Frontend Plex Coupling

### Task 11: Fix useCommonMediaController DASH detection

Currently assumes `meta.source === 'plex'` means DASH. Should check `mediaType` only.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:294`

**Step 1: Remove source-specific DASH check**

```js
// OLD (line 294):
const isDash = meta.mediaType === 'dash_video' || meta.source === 'plex';
// NEW:
const isDash = meta.mediaType === 'dash_video';
```

Note: The backend play router already sets `mediaType: 'dash_video'` for all DASH streams regardless of source. The `meta.source === 'plex'` check is redundant.

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "fix: remove plex source assumption from DASH detection"
```

---

### Task 12: Fix numeric-ID-to-plex heuristic in TVApp.jsx

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx:142-143`

**Step 1: Let backend resolve numeric IDs**

```js
// OLD (lines 142-143):
/^\d+$/.test(value) ? { source: 'plex', id: value } : ...

// NEW — pass bare numeric ID as contentId, let backend resolve:
/^\d+$/.test(value) ? { contentId: value } : ...
```

The backend's heuristic resolution already maps digits → plex. The frontend should not duplicate this.

**Step 2: Commit**

```bash
git add frontend/src/Apps/TVApp.jsx
git commit -m "fix: remove frontend plex heuristic in TVApp, let backend resolve numeric IDs"
```

---

### Task 13: Fix numeric-ID-to-plex heuristic in keyboard/player handlers

**Files:**
- Modify: `frontend/src/lib/Player/useMediaKeyboardHandler.js:139`
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:827`
- Modify: `frontend/src/modules/Player/components/AudioPlayer.jsx:64`

**Step 1: Fix useMediaKeyboardHandler (line 139)**

```js
// OLD:
(meta.plex || /^\d+$/.test(String(assetId))) ? 'plex' : type
// NEW — use source from meta, don't assume plex for numeric IDs:
meta.source || type
```

**Step 2: Fix FitnessPlayer (line 827)**

```js
// OLD:
(currentItem.plex || /^\d+$/.test(String(mediaKey))) ? 'plex' : ...
// NEW:
currentItem.source || ...
```

Note: For this to work, items in the queue need a `source` field. The `toListItem()` function already returns `source` on list responses, and the queue spread (`...item.play`) may not include `source`. Check if `source` is on the item itself vs only in `play`. If not available, leave the plex heuristic but add a `// TODO: remove when source is available on queue items` comment.

**Step 3: Fix AudioPlayer (line 64)**

```js
// OLD:
['track'].includes(type) ? 'plex' : 'media'
// NEW:
['track'].includes(type) ? (meta?.source || 'plex') : 'media'
```

**Step 4: Commit**

```bash
git add frontend/src/lib/Player/useMediaKeyboardHandler.js \
       frontend/src/modules/Fitness/FitnessPlayer.jsx \
       frontend/src/modules/Player/components/AudioPlayer.jsx
git commit -m "fix: reduce plex heuristics in keyboard/player handlers"
```

---

### Task 14: Remove `DaylightPlexPath` helper

**Files:**
- Modify: `frontend/src/lib/api.mjs:163-165`

**Step 1: Check for callers**

Run: `grep -r "DaylightPlexPath" frontend/src/`

If no callers remain, delete the function. If callers exist, replace them with `DaylightMediaPath` (which already handles the `media/plex/` rewrite).

**Step 2: Delete or deprecate**

```js
// OLD (lines 163-165):
export const DaylightPlexPath = (key) => {
    return `${getBaseUrl()}/media/plex/${key}`;
}

// NEW (if callers exist — add deprecation):
/** @deprecated Use DaylightMediaPath() or ContentDisplayUrl() instead */
export const DaylightPlexPath = (key) => {
    return DaylightMediaPath(`media/plex/${key}`);
}

// NEW (if no callers — delete entirely)
```

**Step 3: Commit**

```bash
git add frontend/src/lib/api.mjs
git commit -m "chore: deprecate DaylightPlexPath helper"
```

---

## Phase 7: Config Normalization

### Task 15: Rename `plex:` config key to `content:` in FitnessContext

The YAML configs have a `plex:` section that's really "content source config." Rename to `content:` with backward compat.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:365-387`
- Modify: `frontend/src/modules/Fitness/FitnessMenu.jsx:37,56`
- Modify: `frontend/src/Apps/FitnessApp.jsx:617,623,802`

**Step 1: Update FitnessContext to read `content:` with `plex:` fallback**

```js
// OLD (line 365):
const plex = root?.plex || {};
// NEW:
const contentConfig = root?.content || root?.plex || {};
```

Update all downstream references from `plex` to `contentConfig`:

```js
// OLD (lines 370-376):
const governedLabels = normalizeLabelList(plex?.governed_labels);
const governedTypes = normalizeLabelList(plex?.governed_types);
const nomusicLabels = normalizeLabelList(plex?.nomusic_labels);
// NEW:
const governedLabels = normalizeLabelList(contentConfig?.governed_labels);
const governedTypes = normalizeLabelList(contentConfig?.governed_types);
const nomusicLabels = normalizeLabelList(contentConfig?.nomusic_labels);

// OLD (line 385-387):
contentConfig: plex,
plexConfig: plex,
plex?.music_playlists,
// NEW:
contentConfig: contentConfig,
plexConfig: contentConfig,  // Legacy alias
contentConfig?.music_playlists,
```

**Step 2: Update FitnessMenu**

```js
// OLD (line 37):
fitnessConfig.plex?.nav_items
// NEW:
(fitnessConfig.content || fitnessConfig.plex)?.nav_items

// OLD (line 56):
fitnessConfig?.plex?.app_menus
// NEW:
(fitnessConfig?.content || fitnessConfig?.plex)?.app_menus
```

**Step 3: Update FitnessApp**

```js
// OLD (line 617):
return root?.content_source || 'plex'
// NEW (remove hardcoded default — if no source configured, let backend decide):
return root?.content_source || 'plex'  // Keep for now; YAML configs should eventually specify this

// OLD (line 623):
root?.plex || root?.[contentSource] || {}
// NEW:
root?.content || root?.plex || root?.[contentSource] || {}

// OLD (line 802):
response?.fitness?.plex?.nav_items
// NEW:
(response?.fitness?.content || response?.fitness?.plex)?.nav_items
```

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx \
       frontend/src/modules/Fitness/FitnessMenu.jsx \
       frontend/src/Apps/FitnessApp.jsx
git commit -m "feat: read content: config key with plex: fallback in FitnessContext"
```

---

## Phase 8: Cleanup & Naming

### Task 16: Update plex-specific type literals

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:680,688`
- Modify: `frontend/src/modules/Fitness/FitnessMenu.jsx:41,43,45`

**Step 1: Replace `plex_collection` with `collection`**

These type literals come from YAML config. Update the config YAML to use generic names, and update the frontend to match.

```js
// OLD:
'plex_collection'
'plex_collection_group'
// NEW:
'collection'
'collection_group'
```

Note: This requires updating the YAML config files too (outside frontend). For backward compat, check for both:

```js
// Pattern:
['collection', 'plex_collection'].includes(itemType)
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx \
       frontend/src/modules/Fitness/FitnessMenu.jsx
git commit -m "feat: accept generic collection types alongside plex_collection"
```

---

### Task 17: Rename plex-named modules (optional, low priority)

**Files:**
- Rename: `frontend/src/modules/Menu/PlexMenuRouter.jsx` → `ContentMenuRouter.jsx`
- Rename: `frontend/src/modules/Menu/hooks/useFetchPlexData.js` → `useFetchContentData.js`
- Rename: `frontend/src/modules/Menu/PlexViews.scss` → `ContentViews.scss`
- Update all imports referencing old names

**Step 1: Rename files**

```bash
mv frontend/src/modules/Menu/PlexMenuRouter.jsx frontend/src/modules/Menu/ContentMenuRouter.jsx
mv frontend/src/modules/Menu/hooks/useFetchPlexData.js frontend/src/modules/Menu/hooks/useFetchContentData.js
mv frontend/src/modules/Menu/PlexViews.scss frontend/src/modules/Menu/ContentViews.scss
```

**Step 2: Update imports across all files that reference old names**

Run: `grep -r "PlexMenuRouter\|useFetchPlexData\|PlexViews" frontend/src/`

Update each import to use the new name.

**Step 3: Rename component/hook exports inside the files**

```js
// In ContentMenuRouter.jsx:
// OLD: export function PlexMenuRouter
// NEW: export function ContentMenuRouter

// In useFetchContentData.js:
// OLD: export function useFetchPlexData
// NEW: export function useFetchContentData
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Menu/
git commit -m "chore: rename PlexMenuRouter → ContentMenuRouter, useFetchPlexData → useFetchContentData"
```

---

## Verification

After all tasks are complete:

1. **Backend syntax check**: `node -c backend/src/4_api/v1/routers/list.mjs && node -c backend/src/4_api/v1/routers/info.mjs`
2. **Start dev server**: Check port first with `lsof -i :3111`, then `npm run dev`
3. **Test list responses**: Verify `play.contentId` appears in API responses alongside legacy `play.plex`
4. **Test Player**: Play a plex item, a folder item, an immich item → all should resolve
5. **Test Menu navigation**: Show → Season → Episode flow in Plex menu
6. **Test Fitness**: FitnessShow thumbnails load, queue loads, shuffle works
7. **Test Queue**: Playlist queue flatten, plex queue flatten, shuffle
8. **Grep verification**: `grep -r "\.plex\b" frontend/src/ | grep -v node_modules | grep -v "\.scss" | grep -v "plexClient"` — should return only legacy aliases and comments

---

## Out of Scope (Future Work)

- **Remove legacy plex/media/playlist/folder keys from action objects** — After all frontend callers migrated to contentId, remove the backward-compat shims from `toListItem()`
- **Proxy URL abstraction** — `/proxy/plex/stream/` and `/proxy/plex/photo/` URLs (FitnessShow, FitnessPlayer) need a backend abstraction. These are inherently source-specific and need backend-side resolution.
- **YAML config migration** — Rename `plex:` section to `content:` in actual YAML config files
- **OfficeApp plex heuristic** — `lib/OfficeApp/keyboardHandler.js:79` and `websocketHandler.js:134` — low priority, rarely used
- **FitnessApp content_source default** — Eventually the `|| 'plex'` fallback should be removed once all configs specify `content_source`
- **Remove `getPlexIdFromActions` alias** — After all callers use `getContentIdFromActions`
