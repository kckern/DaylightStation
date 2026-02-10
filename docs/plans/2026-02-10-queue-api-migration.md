# Queue API Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all frontend playback consumers from `/api/v1/list/.../playable` to `/api/v1/queue/...`, eliminating client-side recursive flattening and per-item `/play` calls.

**Architecture:** The `/queue` endpoint already exists and resolves containers to flat `PlayableItem[]` server-side. This migration (1) enriches `toQueueItem()` with the missing fields the frontend needs, (2) rewires `useQueueController` and `SinglePlayer` to call `/queue` and use items directly when `mediaUrl` is present, and (3) deprecates the unused `flattenQueueItems()` and `/list/playable` code paths.

**Tech Stack:** Node.js/Express backend (.mjs), React frontend (.jsx), Vitest tests, Playwright runtime tests

**Existing reference:**
- Queue router: `backend/src/4_api/v1/routers/queue.mjs` (119 lines)
- Queue router tests: `tests/integrated/api/content/queue.test.mjs` (52 lines)
- Standardization proposal: `docs/_wip/plans/2026-02-07-queue-endpoint-standardization.md`

---

## Task 1: Enrich `toQueueItem()` with fields the frontend needs

The current `toQueueItem()` is missing fields that the frontend consumes. After the queue controller spreads `...item` and `...item.play`, the queue item needs `contentId`, `image`, `artist`, `album`, `format`, and `active`. Without these, SinglePlayer can't route to the correct renderer and AudioPlayer can't display metadata.

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs:27-48`
- Test: `tests/integrated/api/content/queue.test.mjs`

**Step 1: Write failing test**

Add to `tests/integrated/api/content/queue.test.mjs`, inside the existing `describe` block:

```javascript
test('queue items include contentId and format fields', async () => {
  const res = await request(app).get('/api/v1/queue/files/audio');

  expect(res.status).toBe(200);
  if (res.body.items.length > 0) {
    const item = res.body.items[0];
    // contentId must be present for SinglePlayer to resolve media
    expect(item).toHaveProperty('contentId');
    // format drives component dispatch (video, audio, singalong, readalong, etc.)
    expect(item).toHaveProperty('format');
    // image is used by AudioPlayer for cover art
    expect(item).toHaveProperty('image');
    // active flag is used to filter out disabled items
    expect(item).toHaveProperty('active');
  }
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose
```

Expected: FAIL — `contentId`, `format`, `image`, `active` not in current `toQueueItem` output.

**Step 3: Update `toQueueItem()` implementation**

In `backend/src/4_api/v1/routers/queue.mjs`, replace the `toQueueItem` function (lines 27-48) with:

```javascript
export function toQueueItem(item) {
  return {
    // Identity
    id: item.id,
    contentId: item.id,               // Alias for SinglePlayer's effectiveContentId
    title: item.title,
    source: item.source,

    // Playback
    mediaUrl: item.mediaUrl,
    mediaType: item.mediaType,
    format: item.metadata?.format || item.mediaType,
    duration: item.duration,

    // Display
    thumbnail: item.thumbnail,
    image: item.thumbnail,             // Alias used by AudioPlayer

    // Resume state
    resumable: item.resumable,
    resumePosition: item.resumePosition,
    watchProgress: item.watchProgress,

    // Behavior flags
    shuffle: item.shuffle || false,
    continuous: item.continuous || false,
    resume: item.resume || false,
    active: item.active !== false,

    // Hierarchy context (display only)
    parentTitle: item.metadata?.parentTitle,
    grandparentTitle: item.metadata?.grandparentTitle,
    parentId: item.metadata?.parentId,
    parentIndex: item.metadata?.parentIndex,
    itemIndex: item.metadata?.itemIndex,

    // Audio metadata
    artist: item.metadata?.artist || item.metadata?.grandparentTitle,
    albumArtist: item.metadata?.albumArtist,
    album: item.metadata?.album || item.metadata?.parentTitle,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose
```

Expected: PASS — all tests green.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/queue.mjs tests/integrated/api/content/queue.test.mjs
git commit -m "feat(queue): enrich toQueueItem with contentId, format, image, active, artist, album"
```

---

## Task 2: Rewire `useQueueController` to call `/queue` instead of `/list/playable`

The queue controller currently calls `/list/.../playable` in 3 separate code paths (contentId, watchlist, plex), then runs `flattenQueueItems()` for client-side recursive resolution. The `/queue` endpoint already handles recursive resolution server-side. Replace all 3 paths with a single `/queue` call.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:76-121`
- No new test file — verified by existing Playwright runtime tests

**Step 1: Replace `initQueue()` function body**

In `useQueueController.js`, replace lines 76-121 (the `initQueue` function through the `if (!isCancelled)` block) with:

```javascript
    async function initQueue() {
      let newQueue = [];

      // Extract overrides that should apply to all generated items
      // This ensures that props like 'resume: false' or 'seconds: 0' from CompositePlayer
      // are propagated to items fetched from the API.
      const sourceObj = (play && typeof play === 'object' && !Array.isArray(play)) ? play :
                       (queue && typeof queue === 'object' && !Array.isArray(queue)) ? queue : {};

      const itemOverrides = {};
      if (sourceObj.resume !== undefined) itemOverrides.resume = sourceObj.resume;
      if (sourceObj.seconds !== undefined) itemOverrides.seconds = sourceObj.seconds;
      if (sourceObj.maxVideoBitrate !== undefined) itemOverrides.maxVideoBitrate = sourceObj.maxVideoBitrate;
      if (sourceObj.maxResolution !== undefined) itemOverrides.maxResolution = sourceObj.maxResolution;

      if (Array.isArray(play)) {
        newQueue = play.map(item => ({ ...item, guid: guid() }));
      } else if (Array.isArray(queue)) {
        newQueue = queue.map(item => ({ ...item, guid: guid() }));
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        // Build the compound ID for the /queue endpoint
        const queue_contentId = play?.contentId || queue?.contentId;
        const queue_assetId = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
        const shuffleParam = isShuffle ? '?shuffle=true' : '';

        let queueUrl = null;
        if (queue_contentId && !queue_assetId && !plexKey) {
          queueUrl = `api/v1/queue/${queue_contentId}${shuffleParam}`;
        } else if (queue_assetId) {
          queueUrl = `api/v1/queue/watchlist/${queue_assetId}${shuffleParam}`;
        } else if (queue?.plex || play?.plex) {
          const plexId = queue?.plex || play?.plex;
          queueUrl = `api/v1/queue/plex/${plexId}${shuffleParam}`;
        }

        if (queueUrl) {
          const { items } = await DaylightAPI(queueUrl);
          newQueue = items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
        } else if (play?.media) {
          // Single media file - create queue from this item directly
          newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
        }
      }
      if (!isCancelled) {
        setQueue(newQueue);
        setOriginalQueue(newQueue);
      }
    }
```

**Step 2: Remove `flattenQueueItems` import**

In `useQueueController.js` line 3, delete:

```javascript
import { flattenQueueItems } from '../lib/api.js';
```

**Step 3: Verify dev server compiles**

```bash
# Check the dev server is running, hit the frontend to trigger a compile
curl -s -o /dev/null -w "%{http_code}" http://localhost:3111/
```

Expected: 200 (Vite compiles without errors)

**Step 4: Runtime verification**

Play a Plex queue via the TV interface to confirm the migration works:

```bash
curl -s http://localhost:3112/api/v1/queue/plex/545064?limit=3 | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Count: {d[\"count\"]}, Items: {len(d[\"items\"])}')
for item in d['items'][:3]:
    print(f'  {item[\"id\"]}: {item[\"title\"]}, mediaUrl={\"YES\" if item.get(\"mediaUrl\") else \"NONE\"}, format={item.get(\"format\")}')
"
```

Expected: 3 items with mediaUrl and format populated.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js
git commit -m "feat(queue): migrate useQueueController from /list/playable to /queue endpoint"
```

---

## Task 3: Add direct-play bypass in SinglePlayer

Currently `SinglePlayer.fetchVideoInfoCallback` always calls `fetchMediaInfo()` which hits `/play/{contentId}` for every queue item. When the queue item already has `mediaUrl` (audio/video from `/queue`), skip the API call and use the item directly.

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:220-308`

**Step 1: Add direct-play detection**

In `SinglePlayer.jsx`, find the `fetchVideoInfoCallback` useMemo (around line 220). The current code starts with:

```javascript
const info = await fetchMediaInfo({
  contentId: effectiveContentId,
  ...
});
```

Replace the body of the async function (everything after `if (lastFetchedRef.current === effectiveContentId) return;` through to `setIsReady(true);`) with logic that checks for direct-playable items first:

```javascript
    lastFetchedRef.current = effectiveContentId;

    // Direct-play bypass: if the play prop already contains mediaUrl and format,
    // skip the /play API call entirely. This happens when queue items come from
    // the /queue endpoint with pre-resolved media URLs.
    const directFormat = play?.format;
    const directMediaUrl = play?.mediaUrl;
    if (directMediaUrl && directFormat) {
      const directInfo = {
        ...play,
        id: play.id || play.contentId || effectiveContentId,
        assetId: play.assetId || play.id || play.contentId || effectiveContentId,
        continuous,
        maxVideoBitrate: play?.maxVideoBitrate ?? null,
        maxResolution: play?.maxResolution ?? null,
      };
      if (play?.seconds !== undefined) directInfo.seconds = play.seconds;
      if (play?.resume !== undefined) directInfo.resume = play.resume;
      if (play?.resumePosition !== undefined && directInfo.seconds === undefined) {
        directInfo.seconds = play.resumePosition;
      }
      setMediaInfo(directInfo);
      setIsReady(true);
      return;
    }

    // Standard path: resolve via /play API
    const info = await fetchMediaInfo({
```

Keep all existing code after `const info = await fetchMediaInfo(...)` unchanged.

**Step 2: Verify with a media playback test**

```bash
# Test that a plex audio queue item plays directly (no /play call needed)
curl -s "http://localhost:3112/api/v1/queue/plex/545064?limit=1" | python3 -c "
import json, sys
item = json.load(sys.stdin)['items'][0]
print(f'Has mediaUrl: {bool(item.get(\"mediaUrl\"))}')
print(f'Has format: {bool(item.get(\"format\"))}')
print(f'contentId: {item.get(\"contentId\")}')
"
```

Expected: `Has mediaUrl: True`, `Has format: True`, `contentId: plex:XXXXX`

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "feat(queue): bypass /play API call when queue item has mediaUrl+format"
```

---

## Task 4: Migrate `fetchMediaInfo` legacy shuffle paths

`fetchMediaInfo()` in `frontend/src/modules/Player/lib/api.js` has two legacy shuffle paths that still call `/list/playable,shuffle`. Replace them with `/queue` calls.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:99-142`

**Step 1: Replace the legacy plex shuffle path (lines 100-120)**

Replace:

```javascript
  // Legacy plex path
  if (plex) {
    if (shuffle) {
      // Get shuffled playable items from list router, then fetch info for first item
      const { items: shuffledItems } = await DaylightAPI(
        buildUrl(`api/v1/list/plex/${plex}/playable,shuffle`, queryCommon)
      );
      if (shuffledItems?.length > 0) {
        const firstItem = shuffledItems[0];
        const firstPlex = firstItem.play?.plex || firstItem.plex || firstItem.key;
        if (firstPlex) {
          const infoUrl = buildUrl(`api/v1/info/plex/${firstPlex}`, queryCommon);
          const infoResponse = await DaylightAPI(infoUrl);
          return { ...infoResponse, assetId: infoResponse.plex };
        }
      }
      return null;
    }
```

With:

```javascript
  // Legacy plex path
  if (plex) {
    if (shuffle) {
      const { items } = await DaylightAPI(
        buildUrl(`api/v1/queue/plex/${plex}`, { ...queryCommon, shuffle: true })
      );
      if (items?.length > 0) {
        return { ...items[0], assetId: items[0].id };
      }
      return null;
    }
```

**Step 2: Replace the legacy media shuffle path (lines 132-138)**

Replace:

```javascript
    if (shuffle) {
      const { items: shuffledItems } = await DaylightAPI(`api/v1/list/${source}/${localId}/playable,shuffle`);
      if (shuffledItems?.length > 0) {
        return shuffledItems[0];
      }
      return null;
    }
```

With:

```javascript
    if (shuffle) {
      const { items } = await DaylightAPI(`api/v1/queue/${source}/${localId}?shuffle=true`);
      if (items?.length > 0) {
        return items[0];
      }
      return null;
    }
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "feat(queue): migrate fetchMediaInfo shuffle paths from /list/playable to /queue"
```

---

## Task 5: Migrate SinglePlayer container resolution

`SinglePlayer.jsx` line 250 calls `/list/${id}/playable` when the play target is a collection (not directly playable). Replace with `/queue`.

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:247-280`

**Step 1: Replace the collection resolution block**

Find lines 247-280 (the `!isPlayable && effectiveContentId` block). Replace:

```javascript
      if (!isPlayable && effectiveContentId) {
        // This is a collection - fetch first playable item
        try {
          const { items } = await DaylightAPI(`/api/v1/list/${effectiveContentId}/playable`);
          if (items && items.length > 0) {
            const firstItem = items[0];
            const firstItemId = firstItem.play?.contentId || firstItem.contentId || firstItem.id
                || firstItem.play?.plex || firstItem.plex;
```

With:

```javascript
      if (!isPlayable && effectiveContentId) {
        // This is a collection - fetch first playable item via queue endpoint
        try {
          const { items } = await DaylightAPI(`/api/v1/queue/${effectiveContentId}?limit=1`);
          if (items && items.length > 0) {
            const firstItem = items[0];
            const firstItemId = firstItem.contentId || firstItem.id;
```

Also update line 260 (the `plex` fallback in `fetchMediaInfo` call):

Replace:

```javascript
              const playableInfo = await fetchMediaInfo({
                contentId: resolvedId,
                plex: firstItem.play?.plex || firstItem.plex,
                shuffle: false,
```

With:

```javascript
              const playableInfo = await fetchMediaInfo({
                contentId: resolvedId,
                shuffle: false,
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "feat(queue): migrate SinglePlayer container resolution to /queue endpoint"
```

---

## Task 6: Migrate `initializeQueue()` helper

`initializeQueue()` in `api.js` lines 153-174 is a standalone helper that still calls `/list/playable`. It may be used by other callers. Migrate it too.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:153-174`

**Step 1: Check for callers**

```bash
# Search for imports of initializeQueue
rg 'initializeQueue' frontend/src/ --type js --type jsx
```

If no callers found, delete the function. If callers exist, update it:

Replace:

```javascript
      const initModifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');
      const { items } = await DaylightAPI(`api/v1/list/watchlist/${queueAssetId}/${initModifiers}`);
      const flatItems = await flattenQueueItems(items);
      newQueue = flatItems.map(item => ({ ...item, guid: guid() }));
```

With:

```javascript
      const shuffleParam = shuffle ? '?shuffle=true' : '';
      const { items } = await DaylightAPI(`api/v1/queue/watchlist/${queueAssetId}${shuffleParam}`);
      newQueue = items.map(item => ({ ...item, guid: guid() }));
```

Also remove the `flattenQueueItems` import if this was the last caller.

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "feat(queue): migrate initializeQueue helper to /queue endpoint"
```

---

## Task 7: Deprecate `flattenQueueItems()`

After Tasks 2 and 6, `flattenQueueItems()` should have no callers. Mark it as deprecated.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:10-43`

**Step 1: Check for remaining callers**

```bash
rg 'flattenQueueItems' frontend/src/ --type js --type jsx
```

If no callers remain, add a deprecation JSDoc above the function:

```javascript
/**
 * @deprecated Recursive flattening now happens server-side in /api/v1/queue.
 * This function is retained for backward compatibility but should not be
 * called in new code. Will be removed in a future cleanup.
 */
export async function flattenQueueItems(items, level = 1) {
```

If callers remain, investigate and migrate them first.

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "chore: deprecate flattenQueueItems (recursive flattening now server-side)"
```

---

## Task 8: Runtime verification

Run the full Playwright test suite and manually verify playback scenarios to confirm nothing regressed.

**Step 1: Run existing Playwright flow tests**

```bash
npx playwright test tests/live/flow/ --reporter=line
```

Expected: All tests pass.

**Step 2: Manual verification checklist**

Test each playback scenario by hitting the TV interface:

| Scenario | URL | Expected |
|----------|-----|----------|
| Plex music queue | `http://localhost:3111/tv?queue=plex:545064` | Audio plays, track advances |
| Hymn playback | `http://localhost:3111/tv?hymn=116` | Singalong scroller renders with CSS |
| Talk playback | `http://localhost:3111/tv?talk=ldsgc202510` | Readalong scroller + ambient audio |
| Scripture playback | `http://localhost:3111/tv?scripture=bom/1-nephi/1` | Scripture scroller renders |
| Plex video | `http://localhost:3111/tv?play=plex:{episodeId}` | Video plays with resume |
| Menu → queue | `http://localhost:3111/tv?list=menu:fhe` | Select item → plays correctly |

**Step 3: Run backend integration tests**

```bash
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose
npx vitest run tests/integrated/api/content/list-router.test.mjs --reporter=verbose
```

Expected: All pass. `/list/playable` still works (not removed, just no longer called by frontend).

**Step 4: Final commit**

If any fixes were needed during verification, commit them here.

---

## Verification

```bash
# Backend tests
npx vitest run tests/integrated/api/content/queue.test.mjs --reporter=verbose

# Frontend compile check
curl -s -o /dev/null -w "%{http_code}" http://localhost:3111/

# Runtime flow tests
npx playwright test tests/live/flow/ --reporter=line
```

**Total: 8 tasks across 3 phases (backend enrichment → frontend migration → verification).**
