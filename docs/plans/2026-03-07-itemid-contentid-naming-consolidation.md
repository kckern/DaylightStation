# ItemId/ContentId Naming Consolidation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate naming ambiguity by consolidating to `contentId` for media content, `feedItemId` for feed articles, and `entryId` for nutrition log items.

**Architecture:** Bottom-up rename through DDD layers. Each domain is independent, so content/feed/nutribot can be done in any order. Within the content domain, work from domain entities up through persistence, application, API, and finally frontend. YAML data migration is last since it requires a script.

**Tech Stack:** Node.js (ES modules), React, YAML persistence, Vitest

**Source audit:** `docs/_wip/audits/2026-03-06-itemid-vs-contentid-naming-audit.md`

---

## Phase 1: Content Domain — Backend (rename `itemId` to `contentId`)

### Task 1: MediaProgress Entity

**Files:**
- Modify: `backend/src/2_domains/content/entities/MediaProgress.mjs`
- Test: `tests/isolated/domain/content/MediaProgress.bookmark.test.mjs`

**Step 1: Update test to use `contentId`**

In `MediaProgress.bookmark.test.mjs`, find all instances of `itemId` in test object construction and assertions. Replace with `contentId`:

```javascript
// Before
new MediaProgress({ itemId: 'plex:123', playhead: 50, duration: 100 })
// After
new MediaProgress({ contentId: 'plex:123', playhead: 50, duration: 100 })

// Before
expect(result.itemId).toBe(...)
// After
expect(result.contentId).toBe(...)
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/content/MediaProgress.bookmark.test.mjs`
Expected: FAIL — `MediaProgress requires itemId` (validation error, since props.itemId is now undefined)

**Step 3: Update MediaProgress entity**

In `backend/src/2_domains/content/entities/MediaProgress.mjs`:

```javascript
// Line 7: Update JSDoc
// @property {string} contentId - Compound ID of the item

// Line 25: Update validation
if (!props.contentId) throw new ValidationError('MediaProgress requires contentId', { code: 'MISSING_CONTENT_ID', field: 'contentId' });

// Line 27: Update property assignment
this.contentId = props.contentId;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/content/MediaProgress.bookmark.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/entities/MediaProgress.mjs tests/isolated/domain/content/MediaProgress.bookmark.test.mjs
git commit -m "refactor(content): rename MediaProgress.itemId to .contentId"
```

---

### Task 2: Media Progress Schema

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs`

**Step 1: Update schema serialization**

In `mediaProgressSchema.mjs`, line 56:

```javascript
// Before
itemId: entity.itemId,
// After
contentId: entity.contentId,
```

Update the JSDoc return type (line 52) to match:
```javascript
// @returns {{ contentId: string, playhead: number, ... }}
```

**Step 2: Run related tests**

Run: `npx vitest run tests/isolated/adapter/persistence/YamlWatchStateDatastore.test.mjs`
Expected: May need test updates too (see Step 3)

**Step 3: Update persistence test if needed**

In `YamlWatchStateDatastore.test.mjs`, replace `itemId` with `contentId` in all test fixtures and assertions.

**Step 4: Run test to verify passes**

Run: `npx vitest run tests/isolated/adapter/persistence/`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs tests/isolated/adapter/persistence/
git commit -m "refactor(persistence): rename itemId to contentId in media progress schema"
```

---

### Task 3: IMediaProgressMemory Port + YamlMediaProgressMemory Adapter

**Files:**
- Modify: `backend/src/3_applications/content/ports/IMediaProgressMemory.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`

**Step 1: Update port interface**

In `IMediaProgressMemory.mjs`, rename parameter names in JSDoc and method signatures:

```javascript
// Line 10: @param {string} contentId - Content identifier
// Line 14: async get(contentId, storagePath) {
// Line 54: throw new Error('MediaProgressMemory must implement get(contentId, storagePath)...');
```

**Step 2: Update YAML adapter**

In `YamlMediaProgressMemory.mjs`, rename all `itemId` parameters/variables to `contentId`:

- Line 81 JSDoc: `@param {string} contentId`
- Line 86: `_toDomainEntity(contentId, data) {`
- Line 88: `contentId,` (passed to MediaProgress constructor)
- Line 101 JSDoc: `@param {string} contentId`
- Line 105: `async get(contentId, storagePath) {`
- Line 107: `const stateData = data[contentId];`
- Line 109: `return this._toDomainEntity(contentId, stateData);`
- Line 120: `const { contentId, ...rest } = serializeMediaProgress(state);`
- Line 128: `contentId,` (logging)
- Line 137: `data[contentId] = rest;`
- Line 148-149: `Object.entries(data).map(([contentId, stateData]) => this._toDomainEntity(contentId, stateData))`
- Line 185-186: `for (const [contentId, stateData] of Object.entries(data))`

**Important:** The YAML keys on disk stay unchanged for now — they are still the compound ID strings used as object keys. The *variable name* referencing them changes, but the data format is unchanged. YAML data migration is a separate task.

**Step 3: Run tests**

Run: `npx vitest run tests/isolated/adapter/persistence/`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/3_applications/content/ports/IMediaProgressMemory.mjs backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs
git commit -m "refactor(persistence): rename itemId to contentId in progress memory port and adapter"
```

---

### Task 4: ProgressSyncService

**Files:**
- Modify: `backend/src/3_applications/content/services/ProgressSyncService.mjs`
- Test: `tests/isolated/application/content/ProgressSyncService.test.mjs`

**Step 1: Update test first**

In `ProgressSyncService.test.mjs`, replace all `itemId` references with `contentId` in test fixtures and mock calls.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/content/ProgressSyncService.test.mjs`
Expected: FAIL

**Step 3: Update ProgressSyncService**

Rename all 28 occurrences of `itemId` (as parameter names, map keys, log fields) to `contentId`:

Key changes:
- Line 58: `async reconcileOnPlay(contentId, storagePath, localId) {`
- Line 68: `contentId: local.contentId,` (from MediaProgress entity, already renamed in Task 1)
- Lines 95, 104: `this._skepticalMap.set(contentId, { ... contentId, ... })`
- Line 141: `async onProgressUpdate(contentId, localId, progressData) {`
- Lines 145-152: `this._skepticalMap.has(contentId)`, `.set(contentId, ...)`, `.get(contentId)`
- Line 164: `this.#savePreJumpBookmark(contentId, ...)`
- Line 190: `this.#bufferRemoteWrite(contentId, localId, ...)`
- Lines 213-222: flush loop `entries.map(([contentId, entry]) => ...)`
- Line 262: `#bufferRemoteWrite(contentId, localId, progress) {`
- Lines 264-278: debounce map operations with `contentId`
- Line 292: `#savePreJumpBookmark(contentId, playhead, duration, storagePath) {`
- Line 294: `this.#mediaProgressMemory.get(contentId, storagePath)`
- Line 298: `contentId: existing.contentId,`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/content/ProgressSyncService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/services/ProgressSyncService.mjs tests/isolated/application/content/ProgressSyncService.test.mjs
git commit -m "refactor(content): rename itemId to contentId in ProgressSyncService"
```

---

### Task 5: QueueService + ContentQueryService

**Files:**
- Modify: `backend/src/2_domains/content/services/QueueService.mjs`
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs`
- Test: `tests/isolated/domain/content/services/QueueService.test.mjs`
- Test: `tests/isolated/application/content/ContentQueryService.test.mjs`

**Step 1: Update tests**

In both test files, replace `itemId` references in progress map fixtures:

```javascript
// Before
progressMap.set(p.itemId, p);
// After
progressMap.set(p.contentId, p);
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/domain/content/services/QueueService.test.mjs tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: FAIL

**Step 3: Update source files**

QueueService.mjs:
- Line 308 JSDoc: `Map of contentId -> MediaProgress-like object`
- Line 414: `progressMap.set(p.contentId, p);`

ContentQueryService.mjs (if it has any direct `itemId` references to progress — the explore agent found none, but double-check):
- Search for `p.itemId` or `.itemId` and rename to `.contentId`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/content/services/QueueService.test.mjs tests/isolated/application/content/ContentQueryService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/QueueService.mjs backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/domain/content/services/ tests/isolated/application/content/ContentQueryService.test.mjs
git commit -m "refactor(content): rename itemId to contentId in QueueService and ContentQueryService"
```

---

### Task 6: Content Adapters

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
- Modify: `backend/src/1_adapters/content/singalong/SingalongAdapter.mjs`
- Modify: `backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs`
- Modify: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfAdapter.mjs`
- Modify: `backend/src/1_adapters/content/readable/audiobookshelf/AudiobookshelfClient.mjs`

**Step 1: Update adapter tests first**

Find tests for these adapters under `tests/isolated/adapter/` and update `itemId` references to `contentId`.

Run: `npx vitest run tests/isolated/adapter/singalong/ tests/isolated/adapter/content/`
Check which tests reference `itemId`.

**Step 2: Update each adapter**

For each adapter file, rename local variable/parameter usages of `itemId` to `contentId` where they refer to the compound `source:localId` identifier. Key patterns:

PlexAdapter.mjs (line 1077):
```javascript
// Before
const { id } = this.mediaKeyResolver.parse(state.itemId);
// After
const { id } = this.mediaKeyResolver.parse(state.contentId);
```

SingalongAdapter.mjs — rename parameter/variable `itemId` to `contentId` where it represents the compound ID.

ReadalongAdapter.mjs — rename parameter/variable `itemId` to `contentId`.

AudiobookshelfAdapter.mjs and AudiobookshelfClient.mjs — rename parameter `itemId` to `contentId` (note: in AudiobookshelfClient, `itemId` is the Audiobookshelf-local ID used in API URLs like `/api/items/${itemId}` — this is a **local adapter ID**, not our compound ID. Only rename if it actually holds a compound `source:localId` value. If it holds the Audiobookshelf-native ID, leave it as `itemId` or rename to `absItemId` for clarity).

**Step 3: Run adapter tests**

Run: `npx vitest run tests/isolated/adapter/`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/
git commit -m "refactor(adapters): rename itemId to contentId in content adapters"
```

---

### Task 7: API Routers — play.mjs and content.mjs

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs`
- Modify: `backend/src/4_api/v1/routers/content.mjs`
- Test: `tests/isolated/api/routers/play.test.mjs`
- Test: `tests/isolated/api/routers/play.progressSync.test.mjs`
- Test: `tests/integrated/api/content/content.test.mjs`

**Step 1: Update tests**

In play tests, update response assertions from `itemId` to `contentId`:
```javascript
// Before
expect(response.body.response.itemId).toBe('plex:123');
// After
expect(response.body.response.contentId).toBe('plex:123');
```

In content tests, update DTO construction tests.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/isolated/api/routers/play.test.mjs tests/isolated/api/routers/play.progressSync.test.mjs tests/integrated/api/content/content.test.mjs`
Expected: FAIL

**Step 3: Update play.mjs**

Line 118:
```javascript
// Before
itemId: compoundId,
// After
contentId: compoundId,
```

Line 156 (response):
```javascript
// Before
itemId: newState.itemId,
// After
contentId: newState.contentId,
```

**Step 4: Update content.mjs**

Lines 43-55 — update the DTO class/factory to use `contentId`:
```javascript
// Before
const { itemId, playhead = 0, ... } = props;
this.itemId = itemId;
// After
const { contentId, playhead = 0, ... } = props;
this.contentId = contentId;
```

Lines 163-182 — update compound ID variable name and MediaProgress construction:
```javascript
// Before
const itemId = `${source}:${resolvedLocalId}`;
// After
const contentId = `${source}:${resolvedLocalId}`;
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/isolated/api/routers/play.test.mjs tests/isolated/api/routers/play.progressSync.test.mjs tests/integrated/api/content/content.test.mjs`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs backend/src/4_api/v1/routers/content.mjs tests/isolated/api/routers/play*.test.mjs tests/integrated/api/content/content.test.mjs
git commit -m "refactor(api): rename itemId to contentId in play and content routers"
```

---

### Task 8: Remove Redundant `id` from toQueueItem

**Files:**
- Modify: `backend/src/4_api/v1/routers/queue.mjs`
- Test: `tests/integrated/api/content/queue.test.mjs`

**Step 1: Check frontend usage of `item.id` vs `item.contentId`**

Before removing `id`, verify the frontend doesn't rely on it separately from `contentId`. Search frontend for `item.id` in media/queue contexts. If both are needed for backwards compatibility, keep both but document `id` as deprecated.

**Step 2: Clean up toQueueItem**

If safe to remove `id` (or if `id` should stay for React key purposes):

```javascript
// Option A: Remove id, keep contentId only
export function toQueueItem(item) {
  const qi = {
    contentId: item.id,
    title: item.title,
    source: item.source,
    ...
  };
}

// Option B: Keep id as alias (if frontend uses it for keys)
export function toQueueItem(item) {
  const qi = {
    id: item.id,           // React key / internal reference
    contentId: item.id,    // Canonical content identifier
    ...
  };
}
```

**Step 3: Update queue tests**

In `queue.test.mjs`, update assertions to check `contentId` (already present) and remove `id` assertions if dropped.

**Step 4: Run tests**

Run: `npx vitest run tests/integrated/api/content/queue.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/queue.mjs tests/integrated/api/content/queue.test.mjs
git commit -m "refactor(api): clean up toQueueItem identity fields"
```

---

### Task 9: Frontend Admin Files — Content `itemId` to `contentId`

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (17 occurrences)
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` (8 occurrences)
- Modify: `frontend/src/modules/Admin/ContentLists/siblingsCache.js` (7 occurrences)

These files use `itemId` for compound content IDs (`source:localId`), not feed or nutrition. Rename to `contentId`.

**Step 1: Update tests first**

Find and update any tests for these components:

Run: `npx vitest run tests/isolated/modules/Admin/` (or wherever Admin tests live)

**Step 2: Rename in ListsItemRow.jsx**

Key patterns:
```javascript
// Before
async function doFetchSiblings(itemId, contentInfo) {
  const match = itemId.match(/^([^:]+):\s*(.+)$/);
// After
async function doFetchSiblings(contentId, contentInfo) {
  const match = contentId.match(/^([^:]+):\s*(.+)$/);
```

Apply same rename to all 17 occurrences.

**Step 3: Rename in ContentSearchCombobox.jsx**

Replace 8 occurrences of `itemId` with `contentId` (these are all logging calls using `item.id`):
```javascript
// Before
log.info('item_select', { itemId: item.id, ... });
// After
log.info('item_select', { contentId: item.id, ... });
```

**Step 4: Rename in siblingsCache.js**

Replace 7 occurrences — cache keys and comments:
```javascript
// Before
// Key: itemId (e.g., "plex:12345")
// After
// Key: contentId (e.g., "plex:12345")
```

**Step 5: Run any related tests**

Run: `npx vitest run tests/isolated/modules/`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/
git commit -m "refactor(frontend): rename itemId to contentId in Admin content lists"
```

---

## Phase 2: Feed Domain — Rename `itemId` to `feedItemId`

### Task 10: Feed Backend — Ports and Persistence

**Files:**
- Modify: `backend/src/3_applications/feed/ports/IDismissedItemsStore.mjs`
- Modify: `backend/src/3_applications/feed/ports/ISelectionTrackingStore.mjs`
- Modify: `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs`

**Step 1: Update port interfaces**

Rename `itemIds` parameter to `feedItemIds` in JSDoc and signatures:

IDismissedItemsStore.mjs:
```javascript
// @param {string[]} feedItemIds - IDs of items to mark as dismissed
add(feedItemIds) {
```

ISelectionTrackingStore.mjs:
```javascript
// @param {string[]} feedItemIds - Short IDs of items selected
async incrementBatch(feedItemIds, username) {
```

IFeedSourceAdapter.mjs:
```javascript
// @param {string[]} feedItemIds - Prefixed item IDs
async markRead(feedItemIds, username) {
```

**Step 2: Update persistence adapters**

YamlDismissedItemsStore.mjs — rename `itemIds` parameter to `feedItemIds`:
```javascript
add(feedItemIds) {
  // ...
  for (const id of feedItemIds) {
```

YamlSelectionTrackingStore.mjs — rename `itemIds` to `feedItemIds`:
```javascript
async incrementBatch(feedItemIds, username) {
  if (!feedItemIds.length) return;
  for (const id of feedItemIds) {
```

**Step 3: Run tests**

Run: `npx vitest run tests/isolated/api/feed/`
Expected: PASS (internal variable rename, tests likely use mock implementations)

**Step 4: Commit**

```bash
git add backend/src/3_applications/feed/ports/ backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs backend/src/1_adapters/persistence/yaml/YamlSelectionTrackingStore.mjs
git commit -m "refactor(feed): rename itemIds to feedItemIds in feed ports and persistence"
```

---

### Task 11: Feed Backend — Services and Router

**Files:**
- Modify: `backend/src/3_applications/feed/services/FeedAssemblyService.mjs`
- Modify: `backend/src/3_applications/feed/services/FeedPoolManager.mjs`
- Modify: `backend/src/4_api/v1/routers/feed.mjs`
- Modify: `backend/src/1_adapters/feed/sources/FreshRSSSourceAdapter.mjs`
- Modify: `backend/src/1_adapters/feed/FreshRSSFeedAdapter.mjs`
- Test: `tests/isolated/api/feed/feed.router.test.mjs`

**Step 1: Update tests**

In `feed.router.test.mjs`, rename `itemIds` in request bodies to `feedItemIds`. Also rename route param `itemId` to `feedItemId` if the route changes.

**Step 2: Update FeedAssemblyService.mjs**

Rename `itemId` parameter to `feedItemId` in:
- `getDetail(feedItemId, itemMeta, username, opts)`
- `getItemWithDetail(feedItemId, username)`
- All log calls and internal references

**Step 3: Update FeedPoolManager.mjs**

Rename `itemIds` parameter to `feedItemIds` in `markSeen(username, feedItemIds)`.

**Step 4: Update feed.mjs router**

Key changes:
- Line 73: `const { feedItemIds, action } = req.body;` (this is a **breaking API change** — see note below)
- Line 278: `let feedItemId;`
- Line 302: `const { feedItemIds } = req.body;`
- Line 350: `router.get('/detail/:feedItemId', ...)`
- Line 352: `const { feedItemId } = req.params;`

**API Breaking Change Note:** The POST body field name change (`itemIds` -> `feedItemIds`) affects the frontend. The frontend and backend must be updated together, or the router must accept both field names during migration:
```javascript
const feedItemIds = req.body.feedItemIds || req.body.itemIds; // temporary compat
```

**Step 5: Update FreshRSS adapters**

FreshRSSSourceAdapter.mjs: rename `itemIds` to `feedItemIds`
FreshRSSFeedAdapter.mjs: rename `itemIds` to `feedItemIds`

**Step 6: Run tests**

Run: `npx vitest run tests/isolated/api/feed/`
Expected: PASS

**Step 7: Commit**

```bash
git add backend/src/3_applications/feed/ backend/src/4_api/v1/routers/feed.mjs backend/src/1_adapters/feed/
git commit -m "refactor(feed): rename itemId/itemIds to feedItemId/feedItemIds in feed backend"
```

---

### Task 12: Feed Frontend

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx` (6 occurrences)
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx` (13 occurrences)
- Modify: `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx` (1 occurrence)

**Step 1: Update Scroll.jsx**

Key changes:
- Line 290: `const id = entry.target.dataset.feedItemId;` + update the JSX `data-item-id` → `data-feed-item-id`
- Line 315: `DaylightAPI('/api/v1/feed/scroll/dismiss', { feedItemIds: ids }, 'POST')`
- Line 321: `const queueDismiss = useCallback((feedItemId) => {`
- Update all log calls to use `feedItemId` field name

**Step 2: Update FeedCard.jsx**

Rename `itemId` prop to `feedItemId` in:
- `HeroImage({ src, thumbnail, feedItemId, title })`
- `GalleryHero({ images, feedItemId, title })`
- All logging calls: `{ feedItemId, title }`
- All prop passing: `feedItemId={item.id}`

**Step 3: Update DetailView.jsx**

Line 35:
```javascript
// Before
feedLog.image('detail hero reset', { heroImage, itemId: item.id });
// After
feedLog.image('detail hero reset', { heroImage, feedItemId: item.id });
```

**Step 4: Run flow tests**

Run: `npx playwright test tests/live/flow/feed/ --reporter=line` (if feed flow tests exist)

**Step 5: Commit**

```bash
git add frontend/src/modules/Feed/
git commit -m "refactor(feed-frontend): rename itemId to feedItemId in feed components"
```

---

## Phase 3: Nutribot Domain — Rename `itemId` to `entryId`

### Task 13: NutriLog Entity

**Files:**
- Modify: `backend/src/2_domains/nutrition/entities/NutriLog.mjs`

**Step 1: Rename parameters**

```javascript
// Before (line 299)
removeItem(itemId, timestamp) {
  items: this.#items.filter(i => i.id !== itemId)
// After
removeItem(entryId, timestamp) {
  items: this.#items.filter(i => i.id !== entryId)

// Before (line 314)
updateItem(itemId, updates, timestamp) {
  if (item.id === itemId)
// After
updateItem(entryId, updates, timestamp) {
  if (item.id === entryId)
```

**Step 2: Run tests**

Run: `npx vitest run tests/isolated/domain/nutrition/`
Expected: PASS (parameter rename only, no external contract change — callers pass positional args)

**Step 3: Commit**

```bash
git add backend/src/2_domains/nutrition/entities/NutriLog.mjs
git commit -m "refactor(nutrition): rename itemId to entryId in NutriLog"
```

---

### Task 14: Nutribot Use Cases

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/DeleteListItem.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/SelectItemForAdjustment.mjs`
- Modify: `backend/src/3_applications/nutribot/usecases/ApplyPortionAdjustment.mjs`
- Modify: `backend/src/3_applications/nutribot/ports/INutriListDatastore.mjs`

**Step 1: Rename in use cases**

In all three use case files, rename `itemId` local variables and input destructuring to `entryId`:

DeleteListItem.mjs:
```javascript
// Before
const { userId, conversationId, messageId, itemId: inputItemId } = input;
// After
const { userId, conversationId, messageId, entryId: inputEntryId } = input;
```

SelectItemForAdjustment.mjs:
```javascript
// Before
const { userId, conversationId, messageId, itemId } = input;
flowState: { level: 2, date, itemId },
// After
const { userId, conversationId, messageId, entryId } = input;
flowState: { level: 2, date, entryId },
```

ApplyPortionAdjustment.mjs:
```javascript
// Before
const { userId, conversationId, messageId, factor, itemId: inputItemId } = input;
// After
const { userId, conversationId, messageId, factor, entryId: inputEntryId } = input;
```

**Important:** The `flowState` stores `entryId` for conversation continuity. Check if any existing conversation states in YAML have `itemId` stored — these would need a migration or fallback:
```javascript
entryId = state?.flowState?.entryId || state?.flowState?.itemId; // temporary compat
```

**Step 2: Update port interface**

In `INutriListDatastore.mjs`, update JSDoc for `update()`:
```javascript
// @param {string} entryId - Item UUID or ID
```

**Step 3: Run tests**

Run: `npx vitest run tests/isolated/applications/nutribot/`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/
git commit -m "refactor(nutribot): rename itemId to entryId in nutribot use cases"
```

---

## Phase 4: Gratitude Frontend

### Task 15: Gratitude Component

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx` (4 occurrences)

**Step 1: Determine what `itemId` represents here**

Read the component to understand context. If `itemId` refers to a gratitude option identifier (UUID-style), rename to `optionId` for clarity. If it's a compound ID, use `contentId`.

**Step 2: Rename accordingly**

Replace 4 occurrences with the appropriate domain-specific name.

**Step 3: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx
git commit -m "refactor(gratitude): rename itemId to optionId for clarity"
```

---

## Phase 5: Remaining Test Updates

### Task 16: Sweep All Test Files

**Files:** ~49 test files reference `itemId` or `contentId`

**Step 1: Run full test suite to find failures**

Run: `npx vitest run`

Any test that constructs `MediaProgress` with `itemId`, reads `.itemId` from responses, or mocks progress objects with `itemId` will now fail.

**Step 2: Fix each failing test**

For content domain tests: replace `itemId` with `contentId`
For feed domain tests: replace `itemId`/`itemIds` with `feedItemId`/`feedItemIds`
For nutribot tests: replace `itemId` with `entryId`

Key test files to check:
- `tests/isolated/hooks/usePlaybackBroadcast.test.mjs` (11 occurrences)
- `tests/isolated/hooks/useMediaQueue.test.mjs`
- `tests/isolated/api/routers/mediaRouter.test.mjs` (10+ occurrences)
- `tests/isolated/api/eventbus/playbackState.test.mjs`
- `tests/isolated/modules/Media/*.test.mjs`
- `tests/live/flow/fitness/*.runtime.test.mjs`

**Step 3: Run full suite again**

Run: `npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add tests/
git commit -m "test: update all tests for itemId/contentId/feedItemId/entryId renames"
```

---

## Phase 6: Documentation

### Task 17: Update Documentation

**Files:**
- Modify: `docs/reference/core/coding-standards.md` — add naming convention for domain identifiers
- Move: `docs/_wip/audits/2026-03-06-itemid-vs-contentid-naming-audit.md` → `docs/_archive/`
- Create: brief entry in coding standards documenting the convention:

```markdown
### Domain Identifiers

| Domain | Identifier Name | Format | Example |
|--------|----------------|--------|---------|
| Content/Media | `contentId` | `source:localId` | `plex:12345` |
| Feed | `feedItemId` | `source:localId` | `reddit:abc123` |
| Nutrition | `entryId` | UUID or shortId | `550e8400-...` |

The `ItemId` value object (internal DDD) parses compound `source:localId` strings.
Do not use the generic name `itemId` — use the domain-specific term.
```

**Step 1: Update coding standards**

Add the naming convention table to the appropriate section.

**Step 2: Archive the audit**

```bash
mv docs/_wip/audits/2026-03-06-itemid-vs-contentid-naming-audit.md docs/_archive/
```

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: add domain identifier naming convention, archive naming audit"
```

---

## Execution Notes

### Order Dependencies

```
Task 1 (MediaProgress) → Task 2 (Schema) → Task 3 (Port + Adapter)
Task 1 → Task 4 (ProgressSyncService)
Task 1 → Task 5 (QueueService)
Task 1 → Task 6 (Content Adapters) → Task 7 (API Routers) → Task 8 (toQueueItem)
Task 9 (Admin frontend) — independent
Tasks 10-12 (Feed) — independent of content tasks
Tasks 13-14 (Nutribot) — independent of content/feed tasks
Task 15 (Gratitude) — independent
Task 16 (Test sweep) — after all source changes
Task 17 (Docs) — last
```

### Parallelizable Groups

These can run in parallel worktrees:
- **Group A:** Tasks 1-8 (Content domain, sequential within)
- **Group B:** Tasks 10-12 (Feed domain)
- **Group C:** Tasks 13-14 (Nutribot domain)
- **Group D:** Task 9 + Task 15 (Frontend misc)

### Risk Mitigation

1. **YAML data on disk is NOT changed** — the compound ID strings stored as YAML keys remain the same. Only variable/property names in code change.
2. **API response field names DO change** — `play.mjs` response changes `itemId` → `contentId`. Any external consumer of this API will break. Check if anything outside the frontend reads this.
3. **Feed API body field names change** — `itemIds` → `feedItemIds`. Frontend and backend must deploy together, or add temporary compat in the router.
4. **Nutribot conversation state** — existing Telegram conversations may have `itemId` in stored `flowState`. Add fallback: `state?.flowState?.entryId || state?.flowState?.itemId`.
