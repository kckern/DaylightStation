# Watchlist Namespace DDD Refactor — listId Resolution

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate abstraction leakage in the WRITE path by replacing the frontend-carried `namespace` (a storage path) with `listId` (a domain identifier), resolved server-side.

**Architecture:** The READ path is already clean — `listMetadata.namespace` stays internal to the backend. The WRITE path currently round-trips `namespace` through the frontend as a raw storage directive. This refactor changes the frontend to send `listId` (which list the item came from) and has the backend resolve the namespace from its own config via `ListAdapter.getListNamespace()`.

**Tech Stack:** Express.js backend (DDD layers), React frontend, YAML config files.

---

## Context

After implementing the initial namespace feature, we identified that the WRITE path leaks infrastructure details:

```
Config YAML (namespace) → ListAdapter → Queue API → Frontend → play/log API → storagePath
```

The frontend carries a storage path it doesn't understand. Clean DDD requires:

```
Config YAML (namespace) → ListAdapter (READ path, internal)
Queue API (listId) → Frontend (listId) → play/log API → ListAdapter.getListNamespace(listId) → storagePath
```

The frontend sends domain context ("which list"), the backend resolves infrastructure ("which file").

---

## Tasks

### Task 1: Add `getListNamespace()` to ListAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs`

**Step 1: Add the method**

Add this public method to the ListAdapter class. Place it near the other public methods (after `getList` or `getItem`):

```javascript
/**
 * Resolve the progress-tracking namespace for a watchlist by name.
 * Used by the play/log endpoint to determine storage path from a listId.
 * @param {string} listName - Watchlist file name (e.g., 'kidsscriptures2026')
 * @returns {Promise<string|null>} The namespace from list metadata, or null
 */
async getListNamespace(listName) {
  const listData = await this._loadList('watchlists', listName);
  return listData?.metadata?.namespace || null;
}
```

**Step 2: Replace `namespace` with `listId` in item metadata**

In `_buildListItems()`, in the watchlist metadata object (around line 971), change:

```javascript
// Before
namespace: listMetadata?.namespace || null,

// After
listId: listName || null,
```

**Step 3: Verify syntax**

Run: `node --check backend/src/1_adapters/content/list/ListAdapter.mjs`
Expected: No output (clean parse)

---

### Task 2: Queue response carries `listId` instead of `namespace`

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs`

**Step 1: Replace namespace with listId in toQueueItem**

In the `toQueueItem` function, change:

```javascript
// Before
namespace: item.metadata?.namespace || null,

// After
listId: item.metadata?.listId || null,
```

**Step 2: Verify syntax**

Run: `node --check backend/src/4_api/v1/routers/queue.mjs`
Expected: No output (clean parse)

---

### Task 3: play.mjs resolves `listId` → namespace via ListAdapter

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs`

**Step 1: Accept `listId` instead of `namespace`**

In the POST /log handler, change the destructuring:

```javascript
// Before
const { type, assetId, percent, seconds, title, watched_duration, namespace } = req.body;

// After
const { type, assetId, percent, seconds, title, watched_duration, listId } = req.body;
```

**Step 2: Revert storagePath to default, then resolve from listId**

Replace the current namespace-based storagePath logic:

```javascript
// Before
let storagePath = namespace || type;
// ...
if (!namespace && typeof adapter.getStoragePath === 'function') {
    storagePath = await adapter.getStoragePath(compoundId);
}

// After
let storagePath = type;
// ...
if (typeof adapter.getStoragePath === 'function') {
    storagePath = await adapter.getStoragePath(compoundId);
}

// Override with list namespace when listId is provided
if (listId) {
    const listAdapter = registry.get('watchlist');
    if (listAdapter?.getListNamespace) {
        const ns = await listAdapter.getListNamespace(listId);
        if (ns) storagePath = ns;
    }
}
```

Note: The `registry` is already available in the play router's closure — it's passed as `config.registry` in `createPlayRouter()`. No new dependencies needed.

**Step 3: Verify syntax**

Run: `node -e "import('./backend/src/4_api/v1/routers/play.mjs').then(() => console.log('OK'))"`
Expected: `OK`

---

### Task 4: Frontend — send `listId` instead of `namespace` in all play/log calls

**Files:**
- Modify: `frontend/src/modules/Player/renderers/ContentScroller.jsx`
- Modify: `frontend/src/modules/Player/renderers/ReadalongScroller.jsx`
- Modify: `frontend/src/modules/Player/renderers/SingalongScroller.jsx`
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- Modify: `frontend/src/lib/Player/useMediaKeyboardHandler.js`

**Step 1: ContentScroller — rename prop and usage**

In ContentScroller.jsx props destructuring, rename `namespace` → `listId`:

```javascript
// Before
namespace,

// After
listId,
```

In the play/log call:

```javascript
// Before
await DaylightAPI(`api/v1/play/log`, { title, type, assetId, seconds, percent: Math.round(percent), namespace });

// After
await DaylightAPI(`api/v1/play/log`, { title, type, assetId, seconds, percent: Math.round(percent), listId });
```

**Step 2: ReadalongScroller — rename prop and threading**

In ReadalongScroller.jsx props, rename `namespace` → `listId`. In the ContentScroller render:

```javascript
// Before
namespace={namespace}

// After
listId={listId}
```

**Step 3: SingalongScroller — rename prop and threading**

Same change as ReadalongScroller:

```javascript
// Before
namespace={namespace}

// After
listId={listId}
```

**Step 4: useCommonMediaController — rename in play/log call**

```javascript
// Before
namespace: meta?.namespace || null

// After
listId: meta?.listId || null
```

**Step 5: useMediaKeyboardHandler — rename in play/log call**

```javascript
// Before
namespace: meta?.namespace || null

// After
listId: meta?.listId || null
```

---

### Task 5: Verification

**Step 1: Restart backend**

```bash
pkill -9 -f 'node backend/index.js' && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

Wait 3 seconds, then check startup:

```bash
tail -5 /tmp/backend-dev.log
```

**Step 2: Verify queue items carry `listId` (not `namespace`)**

```bash
curl -s http://localhost:3112/api/v1/queue/kidsscriptures2026 | jq '.items[0] | {listId, namespace}'
```

Expected: `{ "listId": "kidsscriptures2026", "namespace": null }` — `listId` is present, `namespace` is absent (field doesn't exist).

```bash
curl -s http://localhost:3112/api/v1/queue/scriptures2026 | jq '.items[0] | {listId, namespace}'
```

Expected: `{ "listId": "scriptures2026", "namespace": null }`

**Step 3: Verify listId resolution**

Test that play/log correctly resolves listId → namespace → storagePath by sending a test log:

```bash
curl -s -X POST http://localhost:3112/api/v1/play/log \
  -H 'Content-Type: application/json' \
  -d '{"type":"readalong","assetId":"readalong:scripture/readers/41361","percent":50,"seconds":120,"title":"test","listId":"kidsscriptures2026"}' \
  | jq '.response.library'
```

Expected: `"kidsscriptures2026"` — the storagePath should be the namespace from the kids watchlist, not `"readalong"` or `"scriptures"`.

**Step 4: Verify READ path still works**

```bash
curl -s http://localhost:3112/api/v1/queue/kidsscriptures2026 | jq '.items[0].contentId'
```

Should return a content ID (confirms version-aware enrichment still works via the internal namespace).

**Step 5: Confirm no `namespace` field leaks to frontend**

```bash
curl -s http://localhost:3112/api/v1/queue/kidsscriptures2026 | jq '.items[0] | keys' | grep namespace
```

Expected: No output (namespace key should not exist in queue item response).
