# DnD Content Swap Race Condition Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the race condition where rapid consecutive content swaps in the admin ListsFolder silently lose data by never persisting to YAML.

**Architecture:** Add a backend `PUT /lists/:type/:name/items/swap` endpoint that atomically swaps two items' content fields in a single read-mutate-write cycle. On the frontend, add a dedicated `swapItems` hook function that calls this endpoint, plus a `swapInProgressRef` lock in `handleDragEnd` to prevent concurrent swaps. Optimistic local state update ensures the UI reflects the swap immediately.

**Tech Stack:** React (frontend hooks + dnd-kit), Express (backend router), YAML persistence via `ListManagementService`

---

## Task 1: Backend — Add `swapItems` to ListManagementService

**Files:**
- Modify: `backend/src/3_applications/content/services/ListManagementService.mjs:396` (add method after `updateItem`)

**Step 1: Write the method**

Add after the `updateItem` method (line 396):

```js
/**
 * Atomically swap content fields between two items.
 * Identity fields (label, image, uid, active) stay with their row.
 * Content fields (input, action, shuffle, continuous, days, hold, priority, skipAfter, waitUntil, group) swap.
 */
swapItems(type, listName, householdId, itemA, itemB) {
  validateType(type);

  const list = this.listStore.getList(type, listName, householdId);
  if (list === null) {
    throw new NotFoundError('List', `${type}/${listName}`);
  }

  const sectionA = list.sections[itemA.section];
  const sectionB = list.sections[itemB.section];
  if (!sectionA || itemA.index >= sectionA.items.length) {
    throw new NotFoundError('Item', `section ${itemA.section} index ${itemA.index}`);
  }
  if (!sectionB || itemB.index >= sectionB.items.length) {
    throw new NotFoundError('Item', `section ${itemB.section} index ${itemB.index}`);
  }

  const a = sectionA.items[itemA.index];
  const b = sectionB.items[itemB.index];

  // Swap content fields only (identity fields stay with the row)
  const contentFields = ['input', 'action', 'shuffle', 'continuous', 'days', 'hold', 'priority', 'skipAfter', 'waitUntil', 'group'];
  for (const field of contentFields) {
    const tmp = a[field];
    a[field] = b[field];
    b[field] = tmp;
  }

  this.listStore.saveList(type, listName, householdId, list);

  this.logger.info?.('admin.lists.items.swapped', {
    type, list: listName, household: householdId,
    a: { section: itemA.section, index: itemA.index },
    b: { section: itemB.section, index: itemB.index },
  });

  return { ok: true, type, list: listName };
}
```

**Key design:** Single `getList` + single `saveList` = atomic. No window for a concurrent write to interleave.

**Step 2: Verify the content fields match `listConstants.js`**

Cross-reference `CONTENT_PAYLOAD_FIELDS` in `frontend/src/modules/Admin/ContentLists/listConstants.js` with the `contentFields` array above. They must be identical. Currently `CONTENT_PAYLOAD_FIELDS` is:
```js
['input', 'action', 'shuffle', 'continuous', 'days', 'hold', 'priority', 'skipAfter', 'waitUntil', 'group']
```
If they differ, update the backend method to match.

**Step 3: Commit**

```bash
git add backend/src/3_applications/content/services/ListManagementService.mjs
git commit -m "feat(admin): add atomic swapItems method to ListManagementService"
```

---

## Task 2: Backend — Add swap route to admin content router

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs` (add route BEFORE the `items/:index` route, same pattern as `items/move` on line 195)

**Step 1: Add the route**

Insert before the `PUT /lists/:type/:name/items/:index` route (before line 204), after the `items/move` route:

```js
/**
 * PUT /lists/:type/:name/items/swap - Atomically swap content between two items
 * NOTE: Must be registered BEFORE items/:index to avoid Express treating "swap" as an index param
 */
router.put('/lists/:type/:name/items/swap', (req, res) => {
  const { type, name: listName } = req.params;
  const householdId = req.query.household || configService.getDefaultHouseholdId();
  const { a, b } = req.body || {};

  try {
    const result = listManagementService.swapItems(type, listName, householdId, a, b);
    res.json(result);
  } catch (error) {
    if (error.httpStatus) throw error;
    logger.error?.('admin.lists.items.swap.failed', { type, list: listName, a, b, error: error.message });
    res.status(500).json({ error: 'Failed to swap items' });
  }
});
```

**Step 2: Verify route ordering**

The route MUST be registered before `items/:index` (line 207). Express matches routes in registration order, and `:index` would capture the string `"swap"` as a param. This follows the same pattern as `items/move` (line 195).

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "feat(admin): add PUT items/swap route for atomic content swaps"
```

---

## Task 3: Frontend — Add `swapItems` to `useAdminLists` hook

**Files:**
- Modify: `frontend/src/hooks/admin/useAdminLists.js` (add new function after `updateItem`, update return object)

**Step 1: Add the `swapItems` function**

Insert after `updateItem` (after line 135):

```js
// Atomically swap content fields between two items (single backend call)
const swapItems = useCallback(async (srcSection, srcIndex, dstSection, dstIndex) => {
  if (!currentType || !currentList) throw new Error('No list selected');
  setLoading(true);
  setError(null);
  try {
    await DaylightAPI(
      `${API_BASE}/lists/${currentType}/${currentList}/items/swap`,
      { a: { section: srcSection, index: srcIndex }, b: { section: dstSection, index: dstIndex } },
      'PUT'
    );
    logger.info('admin.lists.items.swapped', { type: currentType, list: currentList, srcSection, srcIndex, dstSection, dstIndex });
    await fetchList(currentType, currentList);
  } catch (err) {
    setError(err);
    throw err;
  } finally {
    setLoading(false);
  }
}, [currentType, currentList, fetchList, logger]);
```

**Step 2: Add `swapItems` to the return object**

Update the return statement (line 318) to include `swapItems`:

```js
return {
  loading, error, lists, sections, flatItems, listMetadata, currentType, currentList,
  fetchLists, createList, deleteList, fetchList,
  addItem, updateItem, swapItems, deleteItem, reorderItems, toggleItemActive,
  addSection, updateSection, deleteSection, reorderSections, moveItem, splitSection,
  updateListSettings,
  clearError: () => setError(null)
};
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/admin/useAdminLists.js
git commit -m "feat(admin): add swapItems hook function using atomic backend endpoint"
```

---

## Task 4: Frontend — Add swap lock + optimistic update to `handleDragEnd`

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` (lines 1, 17, 145-202)

**Step 1: Add `useRef` import**

Update the React import (line 1):

```js
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
```

**Step 2: Destructure `swapItems` from the hook**

Find where `useAdminLists()` is destructured and add `swapItems`. It's also destructured via `ListsContext`, so find the actual destructuring site and add it.

**Step 3: Add the `swapInProgressRef`**

Add near the top of the component, after other state declarations:

```js
const swapInProgressRef = useRef(false);
```

**Step 4: Replace `handleDragEnd` content swap block (lines 156-202)**

Replace the content swap block inside `handleDragEnd` with:

```js
// Content swap
if (activeId.startsWith('content-')) {
  if (!overId.startsWith('content-')) {
    dndLog().debug('drag.cancel', { activeId, overId, reason: 'invalid_target_type' });
    setActiveContentDrag(null);
    return;
  }

  // Lock: prevent concurrent swaps
  if (swapInProgressRef.current) {
    dndLog().debug('drag.cancel', { activeId, overId, reason: 'swap_in_progress' });
    setActiveContentDrag(null);
    return;
  }

  const srcParts = activeId.replace('content-', '').split('-');
  const dstParts = overId.replace('content-', '').split('-');
  const [srcSi, srcIdx] = [Number(srcParts[0]), Number(srcParts[1])];
  const [dstSi, dstIdx] = [Number(dstParts[0]), Number(dstParts[1])];
  const srcItem = sections[srcSi]?.items?.[srcIdx];
  const dstItem = sections[dstSi]?.items?.[dstIdx];
  if (!srcItem || !dstItem) {
    dndLog().warn('content.swap.invalid', { srcSi, srcIdx, dstSi, dstIdx, reason: 'item_not_found' });
    setActiveContentDrag(null);
    return;
  }

  dndLog().info('content.swap', {
    src: { section: srcSi, index: srcIdx, input: srcItem.input },
    dst: { section: dstSi, index: dstIdx, input: dstItem.input },
  });

  swapInProgressRef.current = true;

  // Optimistic local update: swap content fields immediately
  const { updatesForA, updatesForB } = swapContentPayloads(srcItem, dstItem);
  setSections(prev => {
    const next = prev.map(s => ({ ...s, items: [...s.items] }));
    next[dstSi].items[dstIdx] = { ...next[dstSi].items[dstIdx], ...updatesForA };
    next[srcSi].items[srcIdx] = { ...next[srcSi].items[srcIdx], ...updatesForB };
    return next;
  });

  try {
    await swapItems(srcSi, srcIdx, dstSi, dstIdx);
  } catch (err) {
    dndLog().error('content.swap.failed', { srcSi, srcIdx, dstSi, dstIdx, error: err.message });
  } finally {
    swapInProgressRef.current = false;
  }

  // Flash both rows
  requestAnimationFrame(() => {
    document.querySelectorAll('.item-row.swap-flash').forEach(el => el.classList.remove('swap-flash'));
    const allRows = document.querySelectorAll('[data-testid^="item-row-"]');
    allRows.forEach(row => {
      const testId = row.getAttribute('data-testid');
      if (testId === `item-row-${srcSi}-${srcIdx}` || testId === `item-row-${dstSi}-${dstIdx}`) {
        row.classList.add('swap-flash');
        row.addEventListener('animationend', () => row.classList.remove('swap-flash'), { once: true });
      }
    });
  });
  setActiveContentDrag(null);
  return;
}
```

**Key changes from the original:**
1. `swapInProgressRef` gate at the top — blocks concurrent swaps
2. Optimistic `setSections` — UI updates immediately, no waiting for network
3. Single `await swapItems(...)` — replaces the two sequential `await updateItem(...)` calls
4. `finally` block releases the lock — even on error

**Step 5: Verify `setSections` is accessible**

`setSections` lives in `useAdminLists`. It's currently not exposed. Check if `ListsFolder` accesses `sections` via context or direct hook call. If via context, `setSections` needs to be added to the context value. If via direct hook call, it needs to be in the return object.

Likely approach: Since `swapItems` in the hook already calls `fetchList` which calls `setSections`, the optimistic update in the component needs direct access. **Add `setSections` to the hook's return object** (line 318):

```js
return {
  loading, error, lists, sections, setSections, flatItems, ...
};
```

**Step 6: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx frontend/src/hooks/admin/useAdminLists.js
git commit -m "fix(admin): prevent DnD swap race condition with lock + optimistic update"
```

---

## Task 5: Manual Smoke Test

**Step 1: Start dev server**

```bash
lsof -i :3111  # Check if already running
npm run dev     # Start if needed
```

**Step 2: Open admin lists in browser**

Navigate to the admin UI, open a list with 5+ items (e.g., `menus/fhe`).

**Step 3: Test single swap**

Drag content from one row to another. Verify:
- UI updates immediately (optimistic)
- After network round-trip, data matches
- Refresh page — swap persisted in YAML

**Step 4: Test rapid double swap**

Drag an item, drop it. Immediately drag the same item again (within 1 second). Verify:
- Second drag is blocked (cancelled with `swap_in_progress` log)
- First swap persists correctly
- No data loss

**Step 5: Test error recovery**

Stop the backend mid-swap (kill nodemon). Verify:
- Optimistic UI shows the swap
- Error is logged
- On next `fetchList` (page refresh), state reverts to server truth

**Step 6: Fix the corrupted YAML**

Manually correct line 47 of `data/household/config/lists/menus/fhe.yml`:
```yaml
# Change: input: primary:tell me
# To:     input: primary:57
```

---

## Task 6: Commit final + update bug doc

**Step 1: Update the bug doc**

Edit `docs/_wip/bugs/2026-03-08-content-dnd-swap-not-persisted.md`:
- Change status from `Open` to `Resolved`
- Add resolution summary referencing the atomic swap endpoint + lock approach

**Step 2: Final commit**

```bash
git add docs/_wip/bugs/2026-03-08-content-dnd-swap-not-persisted.md
git commit -m "docs: mark DnD swap race condition as resolved"
```
