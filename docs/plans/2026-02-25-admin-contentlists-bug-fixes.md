# Admin ContentLists Bug Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 11 correctness and UX bugs in the Admin ContentLists module identified in the 2026-02-25 audit.

**Architecture:** All fixes are isolated to `frontend/src/modules/Admin/ContentLists/` and `frontend/src/hooks/admin/useAdminLists.js`. No backend changes needed. Changes are applied in priority order: critical data-corruption bugs first, then UX regressions, then minor cleanup.

**Tech Stack:** React 18, Mantine v6, @dnd-kit/sortable, Vite dev server (port 3111)

---

## Before Starting

Read the audit doc to understand what each bug does:
`docs/_wip/audits/2026-02-25-admin-contentlists-ux-audit.md`

Verify dev server is running:
```bash
lsof -i :3111
```

If not running, start it:
```bash
npm run dev
```

Open the admin UI: `http://localhost:3111/admin/lists`

---

## Task 1: Unify ACTION_OPTIONS — Single Source of Truth

**Audit:** Issue #1 (Critical)

**Problem:** Two conflicting copies of ACTION_OPTIONS exist:
- `listConstants.js:6-13` — has `Shuffle`, missing `Read`, `Launch`
- `ListsItemRow.jsx:38-46` — has `Read`, `Launch`, missing `Shuffle`

Items assigned `Read` or `Launch` actions won't appear in the settings modal dropdown. Items assigned `Shuffle` in settings won't render correctly in the row.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/listConstants.js:6-13`
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:38-46`
- Modify: `frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx` (verify import)

---

**Step 1: Expand ACTION_OPTIONS in listConstants.js**

Current (`listConstants.js:6-13`):
```javascript
export const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Open', label: 'Open' },
  { value: 'Display', label: 'Display' },
  { value: 'Shuffle', label: 'Shuffle' }
];
```

Replace with:
```javascript
export const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Open', label: 'Open' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
  { value: 'Launch', label: 'Launch' },
  { value: 'Shuffle', label: 'Shuffle' },
];
```

**Step 2: Remove the local ACTION_OPTIONS from ListsItemRow.jsx**

Find the local definition at `ListsItemRow.jsx:38-46`:
```javascript
const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  ...
  { value: 'Launch', label: 'Launch' },
];
```

Delete the entire local definition. Then add the import at the top of the file where other listConstants are imported. Search for existing imports:
```bash
grep -n "from.*listConstants" frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
```

Add `ACTION_OPTIONS` to the existing import destructure.

**Step 3: Confirm ListSettingsModal imports from listConstants**

```bash
grep -n "ACTION_OPTIONS\|listConstants" frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx
```

If it imports locally, switch to the listConstants import.

**Step 4: Verify in browser**

1. Open any list in the admin UI
2. Click the action chip on any item — confirm all 8 options appear: Play, Queue, List, Open, Display, Read, Launch, Shuffle
3. Open list settings modal → verify the same 8 options appear in the action dropdown

**Step 5: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/listConstants.js \
        frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx \
        frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx
git commit -m "fix(admin): unify ACTION_OPTIONS in listConstants.js — single source of truth"
```

---

## Task 2: Add Missing ACTION_META Entries for Launch and Shuffle

**Audit:** Issue #4 (Important)

**Problem:** `ACTION_META` at `ListsItemRow.jsx:2017-2024` is missing `Launch` and `Shuffle`. Items with these actions fall through to the gray default. Preview button (lines 2649-2692) also skips these actions.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2017-2024`
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2649-2692` (verify preview logic)

---

**Step 1: Add Launch and Shuffle to ACTION_META**

Current (`ListsItemRow.jsx:2017-2024`):
```javascript
const ACTION_META = {
  Play:    { color: 'blue',   icon: IconPlayerPlayFilled },
  Queue:   { color: 'green',  icon: IconPlaylistAdd },
  List:    { color: 'violet', icon: IconLayoutList },
  Open:    { color: 'gray',   icon: IconAppWindow },
  Display: { color: 'cyan',   icon: IconDeviceDesktop },
  Read:    { color: 'orange', icon: IconBookmark },
};
```

Replace with (add Launch in teal, Shuffle in grape):
```javascript
const ACTION_META = {
  Play:    { color: 'blue',   icon: IconPlayerPlayFilled },
  Queue:   { color: 'green',  icon: IconPlaylistAdd },
  List:    { color: 'violet', icon: IconLayoutList },
  Open:    { color: 'gray',   icon: IconAppWindow },
  Display: { color: 'cyan',   icon: IconDeviceDesktop },
  Read:    { color: 'orange', icon: IconBookmark },
  Launch:  { color: 'teal',   icon: IconRocket },
  Shuffle: { color: 'grape',  icon: IconArrowsShuffle },
};
```

**Step 2: Check imports for the new icons**

```bash
grep -n "IconRocket\|IconArrowsShuffle" frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
```

`IconArrowsShuffle` is likely already imported (used in `listConstants.js` CONFIG_INDICATORS). `IconRocket` may need to be added to the Tabler import at the top of the file. If `IconRocket` isn't in Tabler, use `IconExternalLink` or `IconPlayerSkipForward` as an alternative.

To check what's available:
```bash
grep -r "IconRocket\|IconLaunch" frontend/src/ --include="*.jsx" --include="*.js" | head -5
```

**Step 3: Check the preview button logic**

Read `ListsItemRow.jsx:2649-2692`. Look for conditions that filter actions for the preview button. If it has an explicit allowlist (e.g., `['Play','Queue'].includes(action)`), add Launch and Shuffle.

**Step 4: Verify in browser**

1. Set an item's action to `Launch` — badge should be teal with rocket icon (not gray)
2. Set an item's action to `Shuffle` — badge should be grape with shuffle icon (not gray)

**Step 5: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin): add Launch and Shuffle to ACTION_META with colors and icons"
```

---

## Task 3: Fix Move-to-New-Section Race Condition

**Audit:** Issue #2 (Critical)

**Problem:** In `ListsFolder.jsx:235-241`, after `addSection()` resolves, `sections.length` is read for the target index. This value is ambiguous — capture it before the call to make the intent explicit and immune to state-update timing.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx:225-241`

---

**Step 1: Read the current handler**

```bash
grep -n "new-section\|addSection\|moveItem" frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
```

Find the block (around lines 225-241):
```javascript
} else if (action === 'new-section') {
  await addSection({ title: `Section ${sections.length + 1}` });
  await moveItem(
    { section: sectionIndex, index: itemIndex },
    { section: sections.length, index: 0 }
  );
}
```

**Step 2: Capture the index before the add**

Replace with:
```javascript
} else if (action === 'new-section') {
  const newSectionIndex = sections.length;
  await addSection({ title: `Section ${newSectionIndex + 1}` });
  await moveItem(
    { section: sectionIndex, index: itemIndex },
    { section: newSectionIndex, index: 0 }
  );
}
```

**Step 3: Verify in browser**

1. Open a list with at least 2 items in the first section
2. Hover an item → open its move menu → choose "Move to new section"
3. Confirm the item appears in the newly created section (not remaining in original or disappearing)
4. Repeat with a list that has multiple sections

**Step 4: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "fix(admin): capture newSectionIndex before addSection to avoid stale closure"
```

---

## Task 4: Fix ItemDetailsDrawer Duplicate Fetch

**Audit:** Issue #3 (Critical)

**Problem:** `ListsItemRow.jsx:2107-2121` fetches the same URL twice. The second fetch was meant to get children but hits the same single-item endpoint. `setChildren(childData.items || [])` always gets `[]` because `/info/` doesn't return `.items`.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2107-2121`

---

**Step 1: Read the current fetchItemDetails function**

Read `ListsItemRow.jsx:2086-2130`. Find the two sequential fetches:

```javascript
// Fetch item info
const itemResponse = await fetch(`/api/v1/info/${source}/${localId}`);
// ...
// Fetch children
const childrenResponse = await fetch(`/api/v1/info/${source}/${localId}`);  // identical!
if (childrenResponse.ok) {
  const childData = await childrenResponse.json();
  setChildren(childData.items || []);
}
```

**Step 2: Check if a children endpoint exists**

```bash
grep -r "children\|/info.*children" backend/src/4_api/ --include="*.mjs" | head -10
```

Also check what `/api/v1/info/:source/:id` returns — does it include a `children` or `items` field?

```bash
grep -rn "items\|children" backend/src/4_api/ --include="*.mjs" | grep -i "info" | head -10
```

**Step 3a: If no children endpoint exists — remove the second fetch**

Replace the children fetch block with:
```javascript
// Children would require a separate endpoint; not currently available
setChildren([]);
```

**Step 3b: If a children endpoint exists (e.g., `/api/v1/info/:source/:id/children`)**

Replace:
```javascript
const childrenResponse = await fetch(`/api/v1/info/${source}/${localId}`);
```
With:
```javascript
const childrenResponse = await fetch(`/api/v1/info/${source}/${localId}/children`);
```

**Step 4: Verify**

Open any item's details drawer (click the info icon on a row). Confirm no duplicate network requests appear in browser DevTools → Network tab for the same URL.

**Step 5: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin): remove duplicate fetch in ItemDetailsDrawer — /info endpoint doesn't return children"
```

---

## Task 5: Fix ListSettingsModal groupOptions Mutation

**Audit:** Issue #5 (Important)

**Problem:** `ListSettingsModal.jsx:176-178` calls `groupOptions.push()` which mutates a derived array. React won't re-render on a push, so the newly created group won't appear in the dropdown until the modal is closed and reopened.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx:131-134` and `:176-178`

---

**Step 1: Read the current groupOptions and Select**

Current (`ListSettingsModal.jsx:131-134`):
```javascript
const groupOptions = existingGroups
  .filter(g => g)
  .map(g => ({ value: g, label: g }));
```

Current `onCreate` (`ListSettingsModal.jsx:176-178`):
```javascript
onCreate={(query) => {
  groupOptions.push({ value: query, label: query });
  return query;
}}
```

**Step 2: Lift groupOptions to state**

Add state above the `groupOptions` declaration:
```javascript
const [localGroupOptions, setLocalGroupOptions] = useState([]);

// Reset local options when modal opens
useEffect(() => {
  if (opened) {
    setLocalGroupOptions(
      existingGroups.filter(g => g).map(g => ({ value: g, label: g }))
    );
  }
}, [opened, existingGroups]);
```

Remove the old `const groupOptions = ...` line.

**Step 3: Replace groupOptions reference in the Select**

Change `data={groupOptions}` → `data={localGroupOptions}`

Change the `onCreate`:
```javascript
onCreate={(query) => {
  const newOption = { value: query, label: query };
  setLocalGroupOptions(prev => [...prev, newOption]);
  return query;
}}
```

**Step 4: Verify in browser**

1. Open list settings modal
2. Type a new group name in the Group field and press Enter to create it
3. The new group should immediately appear as an option in the dropdown without closing/reopening the modal

**Step 5: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx
git commit -m "fix(admin): lift groupOptions to state so creatable Select re-renders on new item"
```

---

## Task 6: Fix DragEnd String-to-Number Coercion

**Audit:** Issue #9 (Important)

**Problem:** `ListsFolder.jsx:112-120` uses `active.id` and `over.id` directly as array indices for `arrayMove`. These come from `SortableContext items={itemsToRender.map((_, i) => i)}` which produces numbers — but dnd-kit stringifies IDs. `arrayMove` with string args coerces correctly today but is fragile.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx:112-120`

---

**Step 1: Read the current handleDragEnd**

Current (`ListsFolder.jsx:112-120`):
```javascript
const handleDragEnd = async (event, sectionIndex) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const sectionItems = sections[sectionIndex]?.items || [];
  const oldIndex = active.id;
  const newIndex = over.id;
  const reordered = arrayMove(sectionItems, oldIndex, newIndex);
  await reorderItems(sectionIndex, reordered);
};
```

**Step 2: Parse IDs to numbers**

Replace:
```javascript
const oldIndex = active.id;
const newIndex = over.id;
```
With:
```javascript
const oldIndex = Number(active.id);
const newIndex = Number(over.id);
```

**Step 3: Verify in browser**

1. Open a list with multiple items in a section
2. Drag an item to a different position
3. Confirm the reorder saves correctly (items stay in new order after releasing)

**Step 4: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "fix(admin): parse dnd-kit active/over IDs to Number before arrayMove"
```

---

## Task 7: Add Feedback for Silent Inline Label Rejection

**Audit:** Issue #10 (Important)

**Problem:** `ListsItemRow.jsx:2487-2493` — when the user clears the label and presses Enter, the change is silently rejected. Edit mode exits but no feedback is given.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2487-2493`

---

**Step 1: Read the current label save logic**

```bash
grep -n "editingLabel\|setEditingLabel\|labelValue\|setLabelValue" frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx | head -20
```

Find the save handler around lines 2487-2493. It likely looks like:
```javascript
const handleLabelSave = () => {
  setEditingLabel(false);
  if (!labelValue.trim()) return; // silent rejection
  onUpdate({ label: labelValue.trim() });
};
```

**Step 2: Check what notification/toast system is used**

```bash
grep -n "notifications\|showNotification\|useNotifications\|toast" frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx | head -10
grep -n "notifications\|showNotification" frontend/src/modules/Admin/ContentLists/ListsFolder.jsx | head -5
```

Mantine provides `notifications.show()` from `@mantine/notifications`.

**Step 3: Add a notification import if needed**

If `notifications` isn't already imported:
```javascript
import { notifications } from '@mantine/notifications';
```

**Step 4: Add feedback on validation failure**

Replace the silent `return`:
```javascript
const handleLabelSave = () => {
  if (!labelValue.trim()) {
    notifications.show({
      message: 'Label cannot be empty',
      color: 'red',
      autoClose: 2000,
    });
    setLabelValue(item.label || ''); // revert to original
    setEditingLabel(false);
    return;
  }
  setEditingLabel(false);
  onUpdate({ label: labelValue.trim() });
};
```

**Step 5: Verify in browser**

1. Double-click an item label to enter edit mode
2. Clear the text completely and press Enter
3. A red notification should flash: "Label cannot be empty"
4. The label should revert to its original value

**Step 6: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin): show notification when inline label edit is rejected (empty value)"
```

---

## Task 8: Add AbortController Timeout to fetchContentMetadata

**Audit:** Issue #7 (Important)

**Problem:** `ListsItemRow.jsx:630-712` — `fetchContentMetadata` has no timeout. On a slow backend, the preload loop at `ListsFolder.jsx:79-89` can create dozens of hung requests.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:678-697` (the fetch call inside fetchContentMetadata)

---

**Step 1: Read the fetch call in fetchContentMetadata**

Current (`ListsItemRow.jsx:678-697`):
```javascript
const response = await fetch(`/api/v1/info/${normalizedSource}/${localId}`);
```

**Step 2: Wrap with AbortController**

Replace:
```javascript
const response = await fetch(`/api/v1/info/${normalizedSource}/${localId}`);
```
With:
```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);
let response;
try {
  response = await fetch(`/api/v1/info/${normalizedSource}/${localId}`, { signal: controller.signal });
} finally {
  clearTimeout(timeoutId);
}
```

If `controller.abort()` fires, the `fetch` will throw a `DOMException` with name `'AbortError'`. This will be caught by the existing `catch (err)` block which returns an unresolved object — no further changes needed there.

**Step 3: Verify (dev)**

Open DevTools → Network tab → set throttling to "Slow 3G". Load a list. After ~5 seconds, any pending metadata requests should abort (visible as cancelled in the network tab) rather than hanging indefinitely.

**Step 4: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin): add 5s AbortController timeout to fetchContentMetadata"
```

---

## Task 9: Fix Preload useEffect Missing Dependencies

**Audit:** Issue #8 (Important — lint violation)

**Problem:** `ListsFolder.jsx:79-89` — the preload `useEffect` reads `contentInfoMap` and `setContentInfo` inside but doesn't list them in the dependency array. This is a React rules-of-hooks violation.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx:79-89`

---

**Step 1: Read the current useEffect**

Current:
```javascript
useEffect(() => {
  flatItems.forEach(item => {
    if (item.input && !contentInfoMap.has(item.input)) {
      fetchContentMetadata(item.input).then(info => {
        if (info) setContentInfo(item.input, info);
      });
    }
  });
}, [flatItems]); // Only run when flatItems change
```

**Step 2: Add suppression comment with explanation**

`contentInfoMap` changing doesn't need to re-trigger preloading (that would loop). `setContentInfo` is stable (wrapped in `useCallback`). The correct fix is to document this intentional violation:

```javascript
useEffect(() => {
  flatItems.forEach(item => {
    if (item.input && !contentInfoMap.has(item.input)) {
      fetchContentMetadata(item.input).then(info => {
        if (info) setContentInfo(item.input, info);
      });
    }
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // contentInfoMap intentionally omitted: re-running on every cache update would loop.
  // setContentInfo is stable (useCallback with no deps that change).
}, [flatItems]);
```

**Step 3: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "fix(admin): add eslint-disable comment for intentional preload useEffect dep omission"
```

---

## Task 10: Remove Duplicate 'watchlist' from CONTAINER_TYPES

**Audit:** Issue #11 (Minor)

**Problem:** `ListsItemRow.jsx:49-52` — `'watchlist'` appears twice in the array.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:49-52`

---

**Step 1: Find and fix**

Current:
```javascript
const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'watchlist', 'container',
  'series', 'channel', 'conference', 'watchlist', 'query', 'menu', 'program', 'console'
];
```

Replace with (remove duplicate `watchlist` from second line):
```javascript
const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'watchlist', 'container',
  'series', 'channel', 'conference', 'query', 'menu', 'program', 'console'
];
```

**Step 2: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin): remove duplicate watchlist entry from CONTAINER_TYPES"
```

---

## Task 11: Fix ListSettingsModal Form State Persisting After Cancel

**Audit:** Issue #14 (Minor)

**Problem:** `ListSettingsModal.jsx:104-119` — form resets on `opened` becoming true, but cancel doesn't reset. If user edits and cancels, stale edits reappear on next open (if `metadata` prop hasn't changed).

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx`

---

**Step 1: Read the modal's onClose/cancel wiring**

```bash
grep -n "onClose\|onCancel\|Cancel\|Close" frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx | head -20
```

Find the cancel button and `onClose` prop.

**Step 2: Reset form on close**

The current `useEffect` resets on `opened` becoming `true`. To also reset on close, change the effect:

Current:
```javascript
useEffect(() => {
  if (opened) {
    setFormData({ ... });
  }
}, [opened, metadata]);
```

Replace with (reset whenever opened changes in either direction):
```javascript
useEffect(() => {
  setFormData({
    title: metadata?.title || '',
    description: metadata?.description || '',
    group: metadata?.group || '',
    icon: metadata?.icon || '',
    sorting: metadata?.sorting || LIST_DEFAULTS.sorting,
    days: metadata?.days || null,
    active: metadata?.active !== false,
    defaultAction: metadata?.defaultAction || LIST_DEFAULTS.defaultAction,
    defaultVolume: metadata?.defaultVolume ?? null,
    defaultPlaybackRate: metadata?.defaultPlaybackRate ?? null
  });
}, [opened, metadata]);
```

Removing the `if (opened)` guard means the form resets on both open and close. Since the modal is hidden when closed, the reset on close has no visible effect — but ensures the next open starts clean regardless of whether `metadata` changed.

**Step 3: Verify in browser**

1. Open list settings modal
2. Change the title and group fields
3. Press Cancel (do NOT save)
4. Open the modal again without navigating away
5. Fields should show the original values, not the edited ones

**Step 4: Commit**
```bash
git add frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx
git commit -m "fix(admin): reset ListSettingsModal form state on both open and close"
```

---

## Final Verification

After all tasks are complete:

1. Open a list in the admin UI
2. Confirm all 8 action options show in both the item row chip and the settings modal
3. Confirm Launch and Shuffle show colored badges (not gray)
4. Drag-reorder items in a section — confirm reorder saves
5. Move an item to a new section — confirm it lands in the correct section
6. Clear an item's label and press Enter — confirm the error notification appears
7. Open list settings → create a new group → confirm it appears immediately in the dropdown
8. Edit list settings → cancel → reopen → confirm stale edits are gone

Then update the audit doc to mark issues as resolved:
```bash
# Move audit to archive once all issues are fixed
mv docs/_wip/audits/2026-02-25-admin-contentlists-ux-audit.md \
   docs/_archive/2026-02-25-admin-contentlists-ux-audit.md
git add docs/_archive/2026-02-25-admin-contentlists-ux-audit.md \
        docs/_wip/audits/2026-02-25-admin-contentlists-ux-audit.md
git commit -m "docs: archive resolved admin ContentLists UX audit"
```
