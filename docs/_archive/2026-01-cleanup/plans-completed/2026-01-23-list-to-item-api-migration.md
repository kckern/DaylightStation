# List to Item API Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate frontend from deprecated `/api/v1/list` endpoint to `/api/v1/item` endpoint.

**Architecture:** The `/api/v1/item/:source/:path` endpoint returns items with nested `items[]` array for containers. Frontend code currently calls `/api/v1/list/:source/:path` which returns the same structure. The migration involves updating URL paths and ensuring the response structure (`items[]` array) is used consistently.

**Tech Stack:** React, Express, ES modules

---

## Background

The backend now returns container items with children via `/api/v1/item/:source/:path`:
- Response includes `items[]` array (via `toJSON()` in `ListableItem`)
- Modifiers like `playable`, `shuffle`, `recent_on_top` need to be supported

Current `/api/v1/list/:source/:path` response format:
```json
{
  "source": "folder",
  "path": "TVApp",
  "title": "TV App",
  "items": [...]
}
```

Target `/api/v1/item/:source/:path` response format:
```json
{
  "id": "folder:TVApp",
  "source": "folder",
  "localId": "TVApp",
  "title": "TV App",
  "itemType": "container",
  "items": [...]
}
```

## Files to Update

| File | API Calls | Changes |
|------|-----------|---------|
| `frontend/src/Apps/TVApp.jsx` | 1 | `/list/folder/` → `/item/folder/` |
| `frontend/src/modules/Player/lib/api.js` | 3 | `/list/folder/` → `/item/folder/`, `/list/plex/` → `/item/plex/` |
| `frontend/src/modules/Player/hooks/useQueueController.js` | 2 | `/list/folder/` → `/item/folder/`, `/list/plex/` → `/item/plex/` |
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | 1 | `/list/plex/` → `/item/plex/` |
| `frontend/src/modules/Menu/Menu.jsx` | 1 | `/list/folder/` → `/item/folder/` |
| `frontend/src/modules/Menu/PlexMenuRouter.jsx` | 1 | `/list/plex/` → `/item/plex/` |
| `frontend/src/modules/Menu/hooks/useFetchPlexData.js` | 1 | `/list/plex/` → `/item/plex/` |
| `frontend/src/modules/Fitness/FitnessShow.jsx` | 1 | `/list/plex/` → `/item/plex/` |
| `frontend/src/modules/Fitness/FitnessMenu.jsx` | 1 | `/list/plex/` → `/item/plex/` |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx` | 1 | `/list/plex/` → `/item/plex/` |

---

### Task 1: Update Item Router to Support Modifiers

**Files:**
- Modify: `backend/src/4_api/routers/item.mjs`

The item router needs to support the same modifiers as the list router (`playable`, `shuffle`, `recent_on_top`).

**Step 1: Read the current item router**

Run: `cat backend/src/4_api/routers/item.mjs`

**Step 2: Update item router to support modifiers**

Add modifier parsing and apply to container items. The item router should reuse `parseModifiers` and response transformation from list.mjs.

```javascript
// backend/src/4_api/routers/item.mjs
import express from 'express';
import { toListItem } from './list.mjs';

/**
 * Parse path modifiers (playable, shuffle, recent_on_top)
 */
function parseModifiers(rawPath) {
  const parts = rawPath.split('/');
  const modifiers = {
    playable: false,
    shuffle: false,
    recent_on_top: false
  };
  const cleanParts = [];

  for (const part of parts) {
    if (part === 'playable') {
      modifiers.playable = true;
    } else if (part === 'shuffle') {
      modifiers.shuffle = true;
    } else if (part === 'recent_on_top') {
      modifiers.recent_on_top = true;
    } else if (part.includes(',')) {
      const mods = part.split(',');
      for (const mod of mods) {
        if (mod === 'playable') modifiers.playable = true;
        if (mod === 'shuffle') modifiers.shuffle = true;
        if (mod === 'recent_on_top') modifiers.recent_on_top = true;
      }
    } else if (part) {
      cleanParts.push(part);
    }
  }

  return { modifiers, localId: cleanParts.join('/') };
}

/**
 * Shuffle array in place
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Create item API router
 * @param {Object} options
 * @param {Object} options.registry - ContentSourceRegistry
 * @param {Function} [options.loadFile] - Function to load state files
 * @param {Object} [options.configService] - ConfigService for household paths
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createItemRouter(options = {}) {
  const { registry, loadFile, configService, logger = console } = options;
  const router = express.Router();

  /**
   * Extract media key from item's action objects for menu_memory lookup
   */
  function getMenuMemoryKey(item) {
    const action = item.actions?.play || item.actions?.queue || item.actions?.list || item.actions?.open ||
                   item.play || item.queue || item.list || item.open;
    if (!action) return null;
    const values = Object.values(action);
    return values.length > 0 ? values[0] : null;
  }

  /**
   * GET /item/:source/*
   * Get a single item, optionally with children for containers
   */
  router.get('/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { modifiers, localId } = parseModifiers(rawPath);

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const isFolderSource = source === 'folder' || source === 'local';
      const compoundId = isFolderSource ? `folder:${localId}` : `${source}:${localId}`;

      // Get the item
      const item = await adapter.getItem(compoundId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      // If not a container or no modifiers, return item as-is
      if (item.itemType !== 'container' && !modifiers.playable) {
        return res.json(item);
      }

      // For containers, get children and apply modifiers
      let items = item.children || [];

      // If playable modifier, resolve to playable items
      if (modifiers.playable && adapter.resolvePlayables) {
        items = await adapter.resolvePlayables(compoundId);
      }

      // Merge viewing history for sources that support it
      if (typeof adapter._loadViewingHistory === 'function') {
        const viewingHistory = adapter._loadViewingHistory();
        if (viewingHistory && Object.keys(viewingHistory).length > 0) {
          items = items.map(child => {
            const itemKey = child.localId || child.metadata?.plex || child.metadata?.key;
            const watchData = viewingHistory[itemKey] || viewingHistory[String(itemKey)];
            if (watchData) {
              const playhead = parseInt(watchData.playhead) || parseInt(watchData.seconds) || 0;
              const mediaDuration = parseInt(watchData.mediaDuration) || parseInt(watchData.duration) || 0;
              const percent = mediaDuration > 0 ? (playhead / mediaDuration) * 100 : (watchData.percent || 0);
              return {
                ...child,
                watchProgress: percent,
                watchSeconds: playhead,
                watchedDate: watchData.lastPlayed || null,
                lastPlayed: watchData.lastPlayed || null
              };
            }
            return child;
          });
        }
      }

      // Check for fixed order (folder_color)
      const hasFixedOrder = items.some(child => child.metadata?.folder_color || child.folder_color);

      // Apply shuffle if requested
      if (modifiers.shuffle && !hasFixedOrder) {
        items = shuffleArray([...items]);
      }

      // Apply recent_on_top sorting
      if (modifiers.recent_on_top && !hasFixedOrder) {
        const menuMemoryPath = configService?.getHouseholdPath('history/menu_memory') ?? 'households/default/history/menu_memory';
        const menuMemory = loadFile?.(menuMemoryPath) || {};

        items = [...items].sort((a, b) => {
          const aKey = getMenuMemoryKey(a);
          const bKey = getMenuMemoryKey(b);
          const aTime = aKey ? (menuMemory[aKey] || 0) : 0;
          const bTime = bKey ? (menuMemory[bKey] || 0) : 0;
          return bTime - aTime;
        });
      }

      // Build response matching list router format for compatibility
      const response = {
        id: item.id,
        source: item.source,
        localId: item.localId,
        title: item.title,
        itemType: item.itemType,
        thumbnail: item.thumbnail,
        image: item.thumbnail,
        childCount: items.length,
        items: items.map(toListItem)
      };

      res.json(response);
    } catch (err) {
      logger.error?.('[item] Error:', err) || console.error('[item] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 3: Verify item router is registered with required dependencies**

Check `backend/src/0_infrastructure/bootstrap.mjs` and ensure `createItemRouter` receives `loadFile` and `configService`.

**Step 4: Test item router with modifiers**

Run: `curl http://localhost:3112/api/v1/item/folder/TVApp/recent_on_top`
Expected: JSON with `items[]` array, sorted by recent menu selections

**Step 5: Commit**

```bash
git add backend/src/4_api/routers/item.mjs
git commit -m "feat(item): add modifier support (playable, shuffle, recent_on_top)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Update TVApp.jsx

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx:76`

**Step 1: Update API call**

Change line 76 from:
```javascript
const data = await DaylightAPI("api/v1/list/folder/TVApp/recent_on_top");
```

To:
```javascript
const data = await DaylightAPI("api/v1/item/folder/TVApp/recent_on_top");
```

**Step 2: Test in browser**

Navigate to `http://localhost:3111/tv` and verify the menu loads correctly.

**Step 3: Commit**

```bash
git add frontend/src/Apps/TVApp.jsx
git commit -m "refactor(tv): migrate TVApp to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Update Player lib/api.js

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js:18,22,99`

**Step 1: Update flattenQueueItems API calls**

Line 18 - change:
```javascript
const { items: nestedItems } = await DaylightAPI(`api/v1/list/folder/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
```
To:
```javascript
const { items: nestedItems } = await DaylightAPI(`api/v1/item/folder/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
```

Line 22 - change:
```javascript
const { items: plexItems } = await DaylightAPI(`api/v1/list/plex/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
```
To:
```javascript
const { items: plexItems } = await DaylightAPI(`api/v1/item/plex/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
```

**Step 2: Update initializeQueue API call**

Line 99 - change:
```javascript
const { items } = await DaylightAPI(`api/v1/list/folder/${queue_media_key}/playable${shuffle ? ',shuffle' : ''}`);
```
To:
```javascript
const { items } = await DaylightAPI(`api/v1/item/folder/${queue_media_key}/playable${shuffle ? ',shuffle' : ''}`);
```

**Step 3: Test queue playback**

Navigate to `http://localhost:3111/tv?queue=morning+program` and verify items load.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/lib/api.js
git commit -m "refactor(player): migrate api.js to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Update useQueueController.js

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js:96,101`

**Step 1: Update folder API call**

Line 96 - change:
```javascript
const { items } = await DaylightAPI(`api/v1/list/folder/${queue_media_key}/playable${isShuffle ? ',shuffle' : ''}`);
```
To:
```javascript
const { items } = await DaylightAPI(`api/v1/item/folder/${queue_media_key}/playable${isShuffle ? ',shuffle' : ''}`);
```

**Step 2: Update plex API call**

Line 101 - change:
```javascript
const { items } = await DaylightAPI(`api/v1/list/plex/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
```
To:
```javascript
const { items } = await DaylightAPI(`api/v1/item/plex/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
```

**Step 3: Test queue with plex content**

Navigate to `http://localhost:3111/tv?queue=12345` (use a valid plex ID) and verify.

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js
git commit -m "refactor(player): migrate useQueueController to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Update SinglePlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:230`

**Step 1: Update API call**

Line 230 - change:
```javascript
const { items } = await DaylightAPI(`/api/v1/list/plex/${plex}/playable`);
```
To:
```javascript
const { items } = await DaylightAPI(`/api/v1/item/plex/${plex}/playable`);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "refactor(player): migrate SinglePlayer to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Update Menu.jsx

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx:260`

**Step 1: Update fetchData function**

Line 260 - change:
```javascript
`api/v1/list/folder/${target}${config ? `/${config}` : ""}`
```
To:
```javascript
`api/v1/item/folder/${target}${config ? `/${config}` : ""}`
```

**Step 2: Test menu navigation**

Navigate to `http://localhost:3111/tv`, select menu items and verify submenus load.

**Step 3: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx
git commit -m "refactor(menu): migrate Menu to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 7: Update PlexMenuRouter.jsx

**Files:**
- Modify: `frontend/src/modules/Menu/PlexMenuRouter.jsx:109`

**Step 1: Update API call**

Line 109 - change:
```javascript
const data = await DaylightAPI(`api/v1/list/plex/${plexId}`);
```
To:
```javascript
const data = await DaylightAPI(`api/v1/item/plex/${plexId}`);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Menu/PlexMenuRouter.jsx
git commit -m "refactor(menu): migrate PlexMenuRouter to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Update useFetchPlexData.js

**Files:**
- Modify: `frontend/src/modules/Menu/hooks/useFetchPlexData.js:29`

**Step 1: Update API call**

Line 29 - change:
```javascript
const response = await DaylightAPI(`/api/v1/list/plex/${plexId}`);
```
To:
```javascript
const response = await DaylightAPI(`/api/v1/item/plex/${plexId}`);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Menu/hooks/useFetchPlexData.js
git commit -m "refactor(menu): migrate useFetchPlexData to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 9: Update FitnessShow.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx:248`

**Step 1: Update API call**

Line 248 - change:
```javascript
const response = await DaylightAPI(`/api/v1/list/plex/${showId}/playable`);
```
To:
```javascript
const response = await DaylightAPI(`/api/v1/item/plex/${showId}/playable`);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx
git commit -m "refactor(fitness): migrate FitnessShow to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 10: Update FitnessMenu.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessMenu.jsx:202`

**Step 1: Update API call**

Line 202 - change:
```javascript
const response = await DaylightAPI(`/api/v1/list/plex/${collectionId}`);
```
To:
```javascript
const response = await DaylightAPI(`/api/v1/item/plex/${collectionId}`);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessMenu.jsx
git commit -m "refactor(fitness): migrate FitnessMenu to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 11: Update FitnessMusicPlayer.jsx

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx:193`

**Step 1: Update API call**

Line 193 - change:
```javascript
const response = await DaylightAPI(`/api/v1/list/plex/${selectedPlaylistId}/playable,shuffle`);
```
To:
```javascript
const response = await DaylightAPI(`/api/v1/item/plex/${selectedPlaylistId}/playable,shuffle`);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx
git commit -m "refactor(fitness): migrate FitnessMusicPlayer to /item API

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 12: Add Deprecation Warning to List Router

**Files:**
- Modify: `backend/src/4_api/routers/list.mjs`

**Step 1: Add deprecation logging**

At the start of the route handler (after line 298), add:
```javascript
// Log deprecation warning
console.warn(`[DEPRECATION] /api/v1/list/${source}/${rawPath} - Use /api/v1/item/${source}/${rawPath} instead`);
```

**Step 2: Commit**

```bash
git add backend/src/4_api/routers/list.mjs
git commit -m "chore(api): add deprecation warning to /list endpoint

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 13: Full Integration Test

**Step 1: Restart backend**

```bash
pkill -f 'node backend/index.js' || true
nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
sleep 3
```

**Step 2: Test TV app menu**

Navigate to `http://localhost:3111/tv`
Expected: Menu loads, items display correctly

**Step 3: Test queue playback**

Navigate to `http://localhost:3111/tv?queue=morning+program`
Expected: Queue loads and plays

**Step 4: Test plex content**

Navigate to `http://localhost:3111/tv?list=12345` (use valid plex ID)
Expected: Plex menu loads

**Step 5: Check for deprecation warnings**

```bash
grep -i deprecation /tmp/backend-dev.log
```
Expected: No deprecation warnings (all calls migrated)

**Step 6: Commit summary**

Create a summary commit if all tests pass:
```bash
git add -A
git commit -m "refactor: complete migration from /list to /item API

- Updated 10 frontend files to use /item endpoint
- Added modifier support to item router
- Added deprecation warning to list router
- All TV, Player, Menu, and Fitness components migrated

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This migration involves:
1. Enhancing the item router to support modifiers (playable, shuffle, recent_on_top)
2. Updating 10 frontend files to use `/api/v1/item` instead of `/api/v1/list`
3. Adding deprecation warning to list router for any remaining callers
4. Testing all affected functionality

The response format remains compatible - both endpoints return `items[]` array for containers.
