# Action Routes Frontend Fix & /item/ → /list/ Consolidation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all broken frontend API calls (P0 bugs causing tester-reported broken views), migrate remaining `/item/` calls to `/list/` or `/info/`, port `menu-log` and `?select=` features to `/list/` router, and clean up stale backend URLs.

**Architecture:** Frontend calls are broken because they use query-param syntax (`?capability=playable`) that the list router silently ignores (it only supports path modifiers). Fix strategy: change frontend URLs to use path modifiers (`/playable`), migrate all `/item/` calls to `/list/` or `/info/`, then port item-only features (menu-log, select) into the list router so `/item/` can be deprecated.

**Tech Stack:** Express.js (backend routers), React (frontend modules), YAML (menu_memory state)

---

## Task 1: Fix broken `?capability=playable` calls in Player/api.js

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:18,22,107`

**Step 1: Fix flattenQueueItems folder path (line 18)**
```js
// OLD (broken - query param silently ignored):
const { items: nestedItems } = await DaylightAPI(`api/v1/list/folder/${queueKey}?capability=playable${shuffle ? ',shuffle' : ''}`);
// NEW (path modifiers work):
const modifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');
const { items: nestedItems } = await DaylightAPI(`api/v1/list/folder/${queueKey}/${modifiers}`);
```

**Step 2: Fix flattenQueueItems plex path (line 22)**
```js
// OLD:
const { items: plexItems } = await DaylightAPI(`api/v1/list/plex/${item.queue.plex}?capability=playable${shuffle ? ',shuffle' : ''}`);
// NEW:
const plexModifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');
const { items: plexItems } = await DaylightAPI(`api/v1/list/plex/${item.queue.plex}/${plexModifiers}`);
```

**Step 3: Fix initializeQueue folder path (line 107)**
```js
// OLD:
const { items } = await DaylightAPI(`api/v1/list/folder/${queueAssetId}?capability=playable${shuffle ? ',shuffle' : ''}`);
// NEW:
const initModifiers = ['playable', ...(shuffle ? ['shuffle'] : [])].join(',');
const { items } = await DaylightAPI(`api/v1/list/folder/${queueAssetId}/${initModifiers}`);
```

**Step 4: Run dev server and verify queue loading works**

Run: Start dev server, navigate to a fitness queue or playlist that exercises these paths.

**Step 5: Commit**
```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "fix: use path modifiers instead of query params for playable/shuffle in Player API"
```

---

## Task 2: Fix broken `?capability=playable` in SinglePlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:253`

**Step 1: Fix collection expansion call (line 253)**
```js
// OLD (broken):
const { items } = await DaylightAPI(`/api/v1/list/plex/${plex}?capability=playable`);
// NEW:
const { items } = await DaylightAPI(`/api/v1/list/plex/${plex}/playable`);
```

**Step 2: Verify collection playback still works**

Test: Navigate to a Plex collection (show/season) in the player. It should expand to first playable episode.

**Step 3: Commit**
```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "fix: use /playable path modifier in SinglePlayer collection expansion"
```

---

## Task 3: Fix broken shuffle in fetchMediaInfo

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:70,83`

The info router (`info.mjs:114`) discards modifiers. Shuffle needs to go through `/list/` to get items, then pick one randomly. But `fetchMediaInfo` expects a single item's metadata back, not a list. The simplest correct fix: when shuffle is requested, call `/list/.../playable,shuffle` and return info for the first item.

**Step 1: Fix plex shuffle path (line 70)**
```js
// OLD (broken - info router ignores /shuffle modifier):
const base = shuffle ? `api/v1/info/plex/${plex}/shuffle` : `api/v1/info/plex/${plex}`;
// NEW: shuffle goes through /list/ to get shuffled playable items, then fetch info for first
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
  const url = buildUrl(`api/v1/info/plex/${plex}`, queryCommon);
  const infoResponse = await DaylightAPI(url);
  return { ...infoResponse, assetId: infoResponse.plex };
}
```

**Step 2: Fix media shuffle path (line 83)**
```js
// OLD (broken - info router ignores shuffle query param):
const url = buildUrl(`api/v1/info/${source}/${localId}`, { shuffle });
// NEW: shuffle goes through list, non-shuffle goes through info
if (shuffle) {
  const { items: shuffledItems } = await DaylightAPI(`api/v1/list/${source}/${localId}/playable,shuffle`);
  if (shuffledItems?.length > 0) {
    return shuffledItems[0];
  }
  return null;
}
const url = buildUrl(`api/v1/info/${source}/${localId}`, queryCommon);
const infoResponse = await DaylightAPI(url);
return infoResponse;
```

**Step 3: Test shuffle playback**

Test: Navigate to a show/collection and activate shuffle mode. Should pick a random episode.

**Step 4: Commit**
```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "fix: route shuffle through /list/ router instead of broken /info/ modifier"
```

---

## Task 4: Fix Art.jsx broken URLs

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/Art/Art.jsx:18,61`

**Step 1: Fix canvas URL (line 18)**
```js
// OLD (broken - missing /api/v1/ prefix):
const response = await DaylightAPI(`/canvas/current?deviceId=${deviceId}`);
// NEW:
const response = await DaylightAPI(`/api/v1/canvas/current?deviceId=${deviceId}`);
```

**Step 2: Fix content/item URL (line 61)**
```js
// OLD (deprecated):
const data = await DaylightAPI(`api/v1/content/item/${source}/${localId}`);
// NEW:
const data = await DaylightAPI(`api/v1/info/${source}/${localId}`);
```

**Step 3: Commit**
```bash
git add frontend/src/modules/AppContainer/Apps/Art/Art.jsx
git commit -m "fix: correct Art.jsx API paths (canvas prefix, content/item → info)"
```

---

## Task 5: Migrate frontend `/item/` calls to `/list/` (container calls)

These calls fetch containers (items with children) and should use `/list/`.

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx:83`
- Modify: `frontend/src/modules/Menu/Menu.jsx:260`
- Modify: `frontend/src/modules/Fitness/FitnessMenu.jsx:202`

**Step 1: Fix TVApp (line 83)**
```js
// OLD:
const data = await DaylightAPI("api/v1/item/folder/TVApp/recent_on_top");
// NEW:
const data = await DaylightAPI("api/v1/list/folder/TVApp/recent_on_top");
```

**Step 2: Fix Menu.jsx (line 260)**
```js
// OLD:
const data = await DaylightAPI(`api/v1/item/folder/${target}${config ? `/${config}` : ""}`);
// NEW:
const data = await DaylightAPI(`api/v1/list/folder/${target}${config ? `/${config}` : ""}`);
```

**Step 3: Fix FitnessMenu (line 202)**
```js
// OLD:
const response = await DaylightAPI(`/api/v1/item/plex/${collectionId}`);
// NEW:
const response = await DaylightAPI(`/api/v1/list/plex/${collectionId}`);
```

**Step 4: Commit**
```bash
git add frontend/src/Apps/TVApp.jsx frontend/src/modules/Menu/Menu.jsx frontend/src/modules/Fitness/FitnessMenu.jsx
git commit -m "feat: migrate container /item/ calls to /list/ (TVApp, Menu, FitnessMenu)"
```

---

## Task 6: Migrate frontend `/item/` calls to `/info/` (single-item metadata calls)

These calls fetch metadata for a single item (not a container) and should use `/info/`.

**Files:**
- Modify: `frontend/src/modules/Menu/hooks/useFetchPlexData.js:29`
- Modify: `frontend/src/modules/Menu/PlexMenuRouter.jsx:109`

**Step 1: Fix useFetchPlexData (line 29)**
```js
// OLD:
const response = await DaylightAPI(`/api/v1/item/plex/${plexId}`);
// NEW:
const response = await DaylightAPI(`/api/v1/info/plex/${plexId}`);
```

Note: useFetchPlexData is used by PlexMenuRouter to determine item type. The info router returns `type` in the response, matching what the item router returns. However, the info router does NOT return `items[]` -- if callers also need children, they should use `/list/`. Check the caller:

PlexMenuRouter uses `data?.type` to decide which component to render (show → list seasons, season → list episodes, movie → play). The type comes from metadata, which `/info/` provides. The children are fetched separately. So `/info/` is correct here.

**Step 2: Fix PlexMenuRouter (line 109)**
```js
// OLD:
const data = await DaylightAPI(`api/v1/item/plex/${plexId}`);
// NEW:
const data = await DaylightAPI(`api/v1/info/plex/${plexId}`);
```

**Step 3: Verify Menu navigation works**

Test: Navigate through Plex menu hierarchy (libraries → shows → seasons → episodes). Each level should load correctly.

**Step 4: Commit**
```bash
git add frontend/src/modules/Menu/hooks/useFetchPlexData.js frontend/src/modules/Menu/PlexMenuRouter.jsx
git commit -m "feat: migrate single-item /item/ calls to /info/ (useFetchPlexData, PlexMenuRouter)"
```

---

## Task 7: Migrate ContentScroller `/item/` calls to `/info/`

Singing and narrated scrollers fetch leaf items with `.content` field for playback data. The info router needs to pass through the `content` field from adapters.

**Files:**
- Modify: `frontend/src/modules/ContentScroller/SingingScroller.jsx:46`
- Modify: `frontend/src/modules/ContentScroller/NarratedScroller.jsx:43`
- Modify: `backend/src/4_api/v1/routers/info.mjs:59-86` (transformToInfoResponse)

**Step 1: Update info router to pass through `content` field**

In `info.mjs`, `transformToInfoResponse()` currently doesn't include `item.content`. Add it:

```js
// In transformToInfoResponse(), after the mediaUrl/mediaType block (around line 77):
// Pass through content field for singing/narrated scrollers
if (item.content) response.content = item.content;
if (item.category) response.category = item.category;
```

**Step 2: Fix SingingScroller (line 46)**
```js
// OLD:
DaylightAPI(`api/v1/item/singing/${path}`).then(response => {
// NEW:
DaylightAPI(`api/v1/info/singing/${path}`).then(response => {
```

**Step 3: Fix NarratedScroller (line 43)**
```js
// OLD:
DaylightAPI(`api/v1/item/narrated/${path}`).then(response => {
// NEW:
DaylightAPI(`api/v1/info/narrated/${path}`).then(response => {
```

**Step 4: Test singing and narrated playback**

Test: Play a hymn and a scripture passage. Content should load and scroll correctly.

**Step 5: Commit**
```bash
git add backend/src/4_api/v1/routers/info.mjs \
       frontend/src/modules/ContentScroller/SingingScroller.jsx \
       frontend/src/modules/ContentScroller/NarratedScroller.jsx
git commit -m "feat: migrate ContentScroller /item/ calls to /info/, pass through content field"
```

---

## Task 8: Port `POST /menu-log` from item router to list router

The only caller is `Menu.jsx:27`. Move the endpoint to `/list/menu-log` and update the frontend.

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs:646` (add `menuMemoryPath` to list router config)
- Modify: `frontend/src/modules/Menu/Menu.jsx:27`

**Step 1: Add menuMemoryPath to list router config**

In `bootstrap.mjs`, where the list router is created (~line 646):
```js
// OLD:
list: createListRouter({ registry, loadFile, configService, contentQueryService }),
// NEW (resolve menuMemoryPath from configService):
list: createListRouter({ registry, loadFile, configService, contentQueryService, menuMemoryPath: configService.getHouseholdPath('history/menu_memory') }),
```

**Step 2: Add POST /menu-log to list router**

In `list.mjs`, add the import and the POST route **before** the `GET /:source/*` wildcard route:

```js
// At top of file, add import:
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';

// Inside createListRouter, BEFORE router.get('/:source/*', ...):
/**
 * POST /api/v1/list/menu-log
 * Log menu navigation for recent_on_top sorting
 * Body: { assetId: string }
 */
router.post('/menu-log', asyncHandler(async (req, res) => {
  const { assetId } = req.body;
  if (!assetId) {
    return res.status(400).json({ error: 'assetId is required' });
  }
  const menuLog = loadYaml(config.menuMemoryPath) || {};
  const nowUnix = Math.floor(Date.now() / 1000);
  menuLog[assetId] = nowUnix;
  saveYaml(config.menuMemoryPath, menuLog);
  res.json({ [assetId]: nowUnix });
}));
```

Note: The POST route MUST be registered before the `GET /:source/*` wildcard, or Express will try to match `menu-log` as a source param.

**Step 3: Update frontend caller**

In `Menu.jsx:27`:
```js
// OLD:
await DaylightAPI("api/v1/item/menu-log", { assetId: selectedKey });
// NEW:
await DaylightAPI("api/v1/list/menu-log", { assetId: selectedKey });
```

**Step 4: Test menu selection logging**

Test: Open menu, select an item, then reload. Items with `recent_on_top` modifier should reflect the selection order.

**Step 5: Commit**
```bash
git add backend/src/4_api/v1/routers/list.mjs \
       backend/src/0_system/bootstrap.mjs \
       frontend/src/modules/Menu/Menu.jsx
git commit -m "feat: port POST /menu-log from /item/ to /list/ router"
```

---

## Task 9: Fix legacy URL rewrites in api.mjs

**Files:**
- Modify: `frontend/src/lib/api.mjs:132-137`

**Step 1: Update media/plex/img rewrite (line 132-133)**
```js
// OLD (rewrites to deprecated content route):
if (path.startsWith('media/plex/img/')) {
    path = path.replace('media/plex/img/', 'api/v1/content/plex/image/');
}
// NEW (rewrites to action route):
if (path.startsWith('media/plex/img/')) {
    path = path.replace('media/plex/img/', 'api/v1/display/plex/');
}
```

**Step 2: Update media/plex/url rewrite (line 136-137)**
```js
// OLD (rewrites to deprecated mpd sub-route):
if (path.startsWith('media/plex/url/')) {
    path = path.replace('media/plex/url/', 'api/v1/play/plex/mpd/');
}
// NEW (rewrites to action route):
if (path.startsWith('media/plex/url/')) {
    path = path.replace('media/plex/url/', 'api/v1/play/plex/');
}
```

**Step 3: Commit**
```bash
git add frontend/src/lib/api.mjs
git commit -m "fix: update legacy URL rewrites to use action routes (display, play)"
```

---

## Task 10: Fix FitnessApp stale `/play/mpd/` URLs

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx:643,661`

**Step 1: Fix fallback videoUrl (line 643)**
```js
// OLD:
videoUrl: DaylightMediaPath(`api/v1/play/${contentSource}/mpd/${episodeId}`),
// NEW:
videoUrl: DaylightMediaPath(`api/v1/play/${contentSource}/${episodeId}`),
```

**Step 2: Fix main videoUrl (line 661)**
```js
// OLD:
videoUrl: response.mediaUrl || DaylightMediaPath(`api/v1/play/${contentSource}/mpd/${episodeId}`),
// NEW:
videoUrl: response.mediaUrl || DaylightMediaPath(`api/v1/play/${contentSource}/${episodeId}`),
```

**Step 3: Commit**
```bash
git add frontend/src/Apps/FitnessApp.jsx
git commit -m "fix: remove /mpd/ from FitnessApp play URLs"
```

---

## Task 11: Fix stale thumbnail URLs in backend routers

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:373`
- Modify: `backend/src/4_api/v1/routers/item.mjs:224`

**Step 1: Fix list.mjs parent thumbnail URL (line 373)**
```js
// OLD:
thumbnail: item.metadata?.parentThumb || `/api/v1/content/plex/image/${pId}`,
// NEW:
thumbnail: item.metadata?.parentThumb || `/api/v1/display/plex/${pId}`,
```

**Step 2: Fix item.mjs parent thumbnail URL (line 224)**
```js
// OLD:
thumbnail: childItem.metadata?.parentThumb || `/api/v1/content/plex/image/${pId}`,
// NEW:
thumbnail: childItem.metadata?.parentThumb || `/api/v1/display/plex/${pId}`,
```

**Step 3: Commit**
```bash
git add backend/src/4_api/v1/routers/list.mjs backend/src/4_api/v1/routers/item.mjs
git commit -m "fix: update stale thumbnail URLs to use /display/ action route"
```

---

## Task 12: Update audit document and reference docs

**Files:**
- Modify: `docs/_wip/audits/2026-02-06-action-routes-plex-decoupling-progress-audit.md`
- Modify: `docs/reference/content/action-routes.md`

**Step 1: Update audit status**

Mark all P0 and P1 items as completed. Update the metrics section.

**Step 2: Update action-routes.md status line**

Change status to reflect completion of frontend migration:
```
**Status:** Frontend migration complete (2026-02-06). All action routes live. `/item/` deprecated.
```

**Step 3: Commit**
```bash
git add docs/
git commit -m "docs: update audit and action-routes status after frontend migration"
```

---

## Verification

After all tasks are complete:

1. **Start dev server**: `npm run dev` (check port 3111 first with `lsof -i :3111`)
2. **Test P0 fixes (Tasks 1-4)**:
   - Play a queue/playlist → should resolve playable items (not empty)
   - Shuffle a show → should pick random episode
   - Open Art app → should load canvas
3. **Test /item/ → /list/ migration (Tasks 5, 8)**:
   - TVApp → should load with recent_on_top ordering
   - Menu navigation → folder items should load, menu-log should save
   - FitnessMenu → collection shows should load
4. **Test /item/ → /info/ migration (Tasks 6-7)**:
   - PlexMenuRouter → should detect type and route correctly
   - SingingScroller → hymn content should load
   - NarratedScroller → scripture content should load
5. **Run existing tests**: `npm run test:live:flow` if available

---

## Out of Scope (Future Work)

- **Port `?select=` to /list/ router** - Not used from frontend (0 callers found). Defer until needed.
- **Remove `/item/` router entirely** - Keep as deprecated until all consumers confirmed migrated.
- **Remove `GET /play/plex/mpd/:id`** - Backend still supports it; remove after frontend fully migrated.
- **DDD violations in play.mjs** (3x `registry.get('plex')`) - Separate decoupling task.
- **`DaylightPlexPath()` in api.mjs** - Returns raw `/media/plex/` URL that bypasses rewrites. Low priority since it feeds into `DaylightMediaPath` which rewrites.
