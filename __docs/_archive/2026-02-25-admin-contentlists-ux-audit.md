# Admin ContentLists UX & Correctness Audit

**Date:** 2026-02-25
**Scope:** `frontend/src/modules/Admin/ContentLists/`, `frontend/src/hooks/admin/useAdminLists.js`, `frontend/src/Apps/AdminApp.jsx`
**Trigger:** EmptyItemRow sectionIndex bug (items landing in wrong section) revealed broader quality issues

---

## Critical

### 1. ACTION_OPTIONS defined in two places with conflicting values

**Files:**
- `ListsItemRow.jsx:38-46` → `Play, Queue, List, Open, Display, Read, Launch`
- `listConstants.js:6-13` → `Play, Queue, List, Open, Display, Shuffle`

`ListSettingsModal` imports from `listConstants.js`. `ListsItemRow` defines its own local copy. Items assigned `Read` or `Launch` actions won't appear in the settings modal dropdown. Items assigned `Shuffle` in settings won't render correctly in the row.

**Fix:** Single source of truth in `listConstants.js` with the full set. Import everywhere.

---

### 2. Move-to-new-section race condition

**File:** `ListsFolder.jsx:235-241`

```javascript
await addSection({ title: `Section ${sections.length + 1}` });
await moveItem(
  { section: sectionIndex, index: itemIndex },
  { section: sections.length, index: 0 }  // stale — sections hasn't updated yet
);
```

After `addSection()` completes, React state hasn't re-rendered, so `sections.length` is still the pre-add value. The move targets the wrong section index.

**Fix:** `addSection` should return the new section index (or the updated sections array) so `moveItem` can use it directly.

---

### 3. ItemDetailsDrawer fetches same endpoint twice

**File:** `ListsItemRow.jsx:2107-2121`

```javascript
const itemResponse = await fetch(`/api/v1/info/${source}/${localId}`);
// ...
const childrenResponse = await fetch(`/api/v1/info/${source}/${localId}`);  // identical URL
```

The second fetch is supposed to get children but hits the same single-item info endpoint. The `setChildren(childData.items || [])` always gets `[]` because `/info/` doesn't return `.items`.

**Fix:** Either add a children endpoint (`/api/v1/info/${source}/${localId}/children`) or fetch from the existing list/item endpoint that returns child data. Or remove the second fetch entirely if children aren't needed.

---

## Important

### 4. Missing ACTION_META for "Launch" and "Shuffle"

**File:** `ListsItemRow.jsx:2017-2024`

`ACTION_META` defines color/icon for `Play, Queue, List, Open, Display, Read` only. Items with `Launch` or `Shuffle` actions fall through to the gray default icon. The preview button doesn't render for these actions (lines 2649-2692 check for specific actions and skip Launch/Shuffle).

**Fix:** Add Launch and Shuffle to ACTION_META. Add preview handling for both.

---

### 5. ListSettingsModal group creation mutates array instead of triggering re-render

**File:** `ListSettingsModal.jsx:176-178`

```javascript
onCreate={(query) => {
  groupOptions.push({ value: query, label: query });  // direct mutation
  return query;
}}
```

`groupOptions` is derived from props. `.push()` mutates the array but doesn't trigger React re-render. The newly created group won't appear in the dropdown until the modal is closed and reopened.

**Fix:** Use Mantine's `creatable` pattern with state, or return the new item from `onCreate` and let Mantine handle it (Mantine's `onCreate` expects the new value to be returned, which it already is — the issue is that `groupOptions` isn't state-managed, so it won't re-render the list).

---

### 6. Module-level contentInfoCache never cleared

**File:** `ListsItemRow.jsx:625-628`

```javascript
const contentInfoCache = new Map();
const inflightRequests = new Map();
```

Module-level maps persist for the entire browser session. Stale metadata (thumbnails, titles) is never refreshed. If the user updates content in Plex, the admin UI shows old data until full page reload.

**Fix:** Either add a TTL-based eviction, clear cache on list navigation, or scope the cache to the ListsContext provider.

---

### 7. fetchContentMetadata has no timeout

**File:** `ListsItemRow.jsx:630-712`

No `AbortController` or fetch timeout. If the backend hangs, all pending metadata fetches block indefinitely. Combined with the preload loop in `ListsFolder.jsx:79-89` that fires one fetch per item, a slow backend can create dozens of hung requests.

**Fix:** Add AbortController with ~5s timeout per fetch.

---

### 8. Preload useEffect missing dependencies

**File:** `ListsFolder.jsx:79-89`

```javascript
useEffect(() => {
  flatItems.forEach(item => {
    if (item.input && !contentInfoMap.has(item.input)) {
      fetchContentMetadata(item.input).then(info => {
        if (info) setContentInfo(item.input, info);
      });
    }
  });
}, [flatItems]); // Missing: contentInfoMap, setContentInfo
```

`contentInfoMap` is read inside the effect but not in the dependency array. This works in practice because `contentInfoMap` changing doesn't need to re-trigger preloading, but it's a React rules violation that could cause subtle bugs if the effect logic is ever modified.

**Fix:** Add `// eslint-disable-next-line react-hooks/exhaustive-deps` with explanation, or restructure to use a ref for the cache check.

---

### 9. DragEnd handler uses raw IDs as array indices

**File:** `ListsFolder.jsx:112-120`

```javascript
const oldIndex = active.id;
const newIndex = over.id;
const reordered = arrayMove(sectionItems, oldIndex, newIndex);
```

`active.id` and `over.id` come from the SortableContext items (line 248: `items={itemsToRender.map((_, i) => i)}`). These are numeric indices. But `arrayMove` expects numbers, and `active.id`/`over.id` are strings. `arrayMove` from `@dnd-kit/sortable` coerces, but this is fragile.

**Fix:** Parse to int: `const oldIndex = Number(active.id);`

---

### 10. Inline label edit has no error feedback

**File:** `ListsItemRow.jsx:2487-2493`

If the user clears the label and presses Enter, the change is silently rejected — edit mode exits but the label reverts. No toast, no red border, no indication of failure.

**Fix:** Show a brief toast or shake animation when validation rejects the change.

---

## Minor

### 11. Duplicate "watchlist" in CONTAINER_TYPES

**File:** `ListsItemRow.jsx:49-52`

```javascript
const CONTAINER_TYPES = [
  'show', 'season', 'artist', 'album', 'collection', 'playlist', 'watchlist', 'container',
  'series', 'channel', 'conference', 'watchlist', 'query', 'menu', 'program', 'console'
];
```

`watchlist` appears twice. No functional impact but indicates copy-paste error.

---

### 12. Preview modal marginLeft hardcoded to sidebar width

**File:** `ListsItemRow.jsx:2700`

```javascript
styles={{ content: { marginLeft: 'var(--app-shell-navbar-width, 250px)' } }}
```

Assumes AdminLayout sidebar exists and uses a CSS var. If the modal is ever used outside AdminLayout (e.g., test harness), positioning breaks.

---

### 13. SectionHeader hides for single anonymous section

**File:** `SectionHeader.jsx:36-39`

Single unnamed sections get no header, so users can't rename them or access section settings without first adding a second section.

---

### 14. ListSettingsModal form state persists after cancel

**File:** `ListSettingsModal.jsx:104-119`

Form resets on open (from `metadata` prop), but if the user changes values and cancels, those changes persist in component state until the next open with different `metadata`. If `metadata` hasn't changed, the stale edits reappear.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| Critical | 3 | Dual ACTION_OPTIONS, race condition, duplicate fetch |
| Important | 7 | Missing action UI, cache issues, silent failures, no timeouts |
| Minor | 4 | Duplicates, hardcoded styles, hidden section headers |
