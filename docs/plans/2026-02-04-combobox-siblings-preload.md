# Combobox Siblings Preload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preload sibling data so the ContentSearchCombobox opens instantly instead of showing a loading spinner.

**Architecture:** Module-level cache stores processed `{browseItems, currentParent}` data. First 10 rows preload on mount. Subsequent rows preload on hover with radius of 2 (5 rows centered on hovered row). Cache tracks pending/loaded/error states to avoid duplicate requests.

**Tech Stack:** React hooks, module-level Map cache, existing fetch APIs

---

## Task 1: Add Siblings Cache Module

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/siblingsCache.js`

**Step 1: Create the cache module**

```js
// frontend/src/modules/Admin/ContentLists/siblingsCache.js

/**
 * Module-level cache for preloaded siblings data.
 * Stores processed {browseItems, currentParent} ready for immediate use.
 */
const siblingsCache = new Map();
// Key: itemId (e.g., "plex:12345")
// Value: {
//   status: 'pending' | 'loaded' | 'error',
//   data: { browseItems, currentParent } | null,
//   promise: Promise | null
// }

export function getCacheEntry(itemId) {
  return siblingsCache.get(itemId);
}

export function setCacheEntry(itemId, entry) {
  siblingsCache.set(itemId, entry);
}

export function hasCacheEntry(itemId) {
  return siblingsCache.has(itemId);
}

export function clearCache() {
  siblingsCache.clear();
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/siblingsCache.js
git commit -m "feat: add siblings cache module for combobox preloading"
```

---

## Task 2: Extract doFetchSiblings Function

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:817-960`

**Step 1: Extract the fetch logic into a standalone function**

Add this function after the imports (around line 70, after the TYPE_ICONS object):

```js
/**
 * Fetch siblings data for an item. Returns processed data ready for state.
 * This is the core fetch logic extracted for use by both preload and direct calls.
 */
async function doFetchSiblings(itemId, contentInfo) {
  const { source } = contentInfo;
  const localId = itemId.split(':')[1]?.trim();

  // Fetch current item to get parent key or library info
  const response = await fetch(`/api/v1/content/item/${source}/${localId}`);
  if (!response.ok) return null;

  const data = await response.json();
  const parentKey = data.metadata?.parentRatingKey || data.metadata?.parentKey ||
                   data.metadata?.parentId || data.metadata?.albumId || data.metadata?.artistId;
  const libraryId = data.metadata?.librarySectionID;
  const libraryTitle = data.metadata?.librarySectionTitle;

  let childrenUrl = null;
  let parentInfo = null;

  if (parentKey) {
    childrenUrl = `/api/v1/item/${source}/${parentKey}`;
    const parentResponse = await fetch(`/api/v1/content/item/${source}/${parentKey}`);
    if (parentResponse.ok) {
      const parentData = await parentResponse.json();
      parentInfo = {
        id: `${source}:${parentKey}`,
        title: parentData.title || data.metadata?.parentTitle,
        source,
        thumbnail: parentData.thumbnail,
        parentKey: parentData.metadata?.parentRatingKey || null,
        libraryId
      };
    }
  } else if (libraryId) {
    childrenUrl = `/api/v1/item/${source}/library/sections/${libraryId}/all`;
    parentInfo = {
      id: `library:${libraryId}`,
      title: libraryTitle || 'Library',
      source,
      thumbnail: null,
      parentKey: null,
      libraryId
    };
  } else if (['watchlist', 'query', 'menu', 'program'].includes(source)) {
    childrenUrl = `/api/v1/item/list/${source}:`;
    parentInfo = {
      id: `${source}:`,
      title: source.charAt(0).toUpperCase() + source.slice(1) + 's',
      source: 'list',
      thumbnail: null,
      parentKey: null,
      libraryId: null
    };
  } else if (source === 'freshvideo') {
    childrenUrl = `/api/v1/item/filesystem/video/news`;
    parentInfo = {
      id: 'filesystem:video/news',
      title: 'Fresh Video Channels',
      source: 'filesystem',
      thumbnail: null,
      parentKey: null,
      libraryId: null
    };
  } else if (source === 'talk' || source === 'local-content') {
    childrenUrl = `/api/v1/item/local-content/talk:`;
    parentInfo = {
      id: 'talk:',
      title: 'Talk Series',
      source: 'local-content',
      thumbnail: null,
      parentKey: null,
      libraryId: null
    };
  } else if (localId.includes('/')) {
    const parts = localId.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const parentTitle = parts[parts.length - 2] || parentPath;
    childrenUrl = `/api/v1/item/${source}/${parentPath}`;
    parentInfo = {
      id: `${source}:${parentPath}`,
      title: parentTitle,
      source,
      thumbnail: null,
      parentKey: null,
      libraryId: null
    };
  }

  if (!childrenUrl) return null;

  const childrenResponse = await fetch(childrenUrl);
  if (!childrenResponse.ok) return null;

  const childrenData = await childrenResponse.json();
  const childItems = childrenData.items || [];
  const browseItems = childItems.map(item => {
    const itemSource = item.source || item.id?.split(':')[0];
    return {
      value: item.id || `${itemSource}:${item.localId}`,
      title: item.title,
      source: itemSource,
      type: item.metadata?.type || item.type || item.itemType,
      thumbnail: item.thumbnail,
      grandparent: item.metadata?.grandparentTitle,
      parent: item.metadata?.parentTitle,
      library: item.metadata?.librarySectionTitle,
      itemCount: item.metadata?.childCount ?? item.metadata?.leafCount ?? item.childCount ?? null,
      isContainer: isContainerItem(item)
    };
  });

  return { browseItems, currentParent: parentInfo };
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "refactor: extract doFetchSiblings function for reuse"
```

---

## Task 3: Add preloadSiblings Function

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Add import for cache**

At top of file, add:

```js
import { getCacheEntry, setCacheEntry, hasCacheEntry } from './siblingsCache.js';
```

**Step 2: Add preloadSiblings function after doFetchSiblings**

```js
/**
 * Preload siblings for an item into the cache.
 * Skips if already cached or pending. Returns the promise for optional awaiting.
 */
export async function preloadSiblings(itemId, contentInfo) {
  if (!itemId || !contentInfo || contentInfo.unresolved) return null;

  // Skip if already cached or pending
  const existing = getCacheEntry(itemId);
  if (existing) return existing.promise;

  // Mark as pending immediately to prevent duplicate requests
  const promise = doFetchSiblings(itemId, contentInfo);
  setCacheEntry(itemId, { status: 'pending', data: null, promise });

  try {
    const data = await promise;
    setCacheEntry(itemId, { status: 'loaded', data, promise: null });
    return data;
  } catch (err) {
    console.error('Preload siblings failed:', itemId, err);
    setCacheEntry(itemId, { status: 'error', data: null, promise: null });
    return null;
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: add preloadSiblings function with cache integration"
```

---

## Task 4: Update handleStartEditing to Use Cache

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:962-967`

**Step 1: Replace handleStartEditing in ContentSearchCombobox**

Find the existing `handleStartEditing` function (around line 962) and replace it:

```js
  const handleStartEditing = () => {
    setIsEditing(true);
    setSearchQuery(value || '');
    combobox.openDropdown();

    // Check cache first
    const cached = getCacheEntry(value);

    if (cached?.status === 'loaded' && cached.data) {
      // Cache hit - use instantly
      setBrowseItems(cached.data.browseItems);
      setCurrentParent(cached.data.currentParent);
      setLoadingBrowse(false);
      // Find and highlight current item
      const normalizedVal = value?.replace(/:\s+/g, ':');
      const currentIndex = cached.data.browseItems.findIndex(s => s.value === normalizedVal);
      setHighlightedIdx(currentIndex >= 0 ? currentIndex : 0);
      // Scroll to current item
      setTimeout(() => {
        if (optionsRef.current) {
          const currentOption = optionsRef.current.querySelector(`[data-value="${normalizedVal}"]`);
          if (currentOption) {
            currentOption.scrollIntoView({ block: 'center' });
          }
        }
      }, 50);
    } else if (cached?.status === 'pending' && cached.promise) {
      // In flight - wait for it
      setLoadingBrowse(true);
      cached.promise.then(data => {
        if (data) {
          setBrowseItems(data.browseItems);
          setCurrentParent(data.currentParent);
          const normalizedVal = value?.replace(/:\s+/g, ':');
          const currentIndex = data.browseItems.findIndex(s => s.value === normalizedVal);
          setHighlightedIdx(currentIndex >= 0 ? currentIndex : 0);
          setTimeout(() => {
            if (optionsRef.current) {
              const currentOption = optionsRef.current.querySelector(`[data-value="${normalizedVal}"]`);
              if (currentOption) {
                currentOption.scrollIntoView({ block: 'center' });
              }
            }
          }, 50);
        }
        setLoadingBrowse(false);
      });
    } else {
      // Cache miss - fetch normally
      fetchSiblings();
    }
  };
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: use siblings cache in handleStartEditing"
```

---

## Task 5: Add ListsContext for Row Coordination

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ListsContext.js`

**Step 1: Create context**

```js
// frontend/src/modules/Admin/ContentLists/ListsContext.js
import { createContext, useContext } from 'react';

export const ListsContext = createContext({
  items: [],
  contentInfoMap: new Map(),
  setContentInfo: () => {},
  getNearbyItems: () => [],
});

export function useListsContext() {
  return useContext(ListsContext);
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsContext.js
git commit -m "feat: add ListsContext for row coordination"
```

---

## Task 6: Wire Up ListsFolder with Context Provider

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`

**Step 1: Add imports**

```js
import { useCallback } from 'react';
import { ListsContext } from './ListsContext.js';
import { preloadSiblings, fetchContentMetadata } from './ListsItemRow.jsx';
```

Note: Update the existing React import to include `useCallback` if not already there.

**Step 2: Add state and callbacks inside ListsFolder function (after existing useState calls around line 43)**

```js
  // Content info cache for preloading
  const [contentInfoMap, setContentInfoMap] = useState(new Map());

  const setContentInfo = useCallback((itemId, info) => {
    setContentInfoMap(prev => {
      const next = new Map(prev);
      next.set(itemId, info);
      return next;
    });
  }, []);

  const getNearbyItems = useCallback((index, radius = 2) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(items.length - 1, index + radius);
    return items.slice(start, end + 1).map((item, i) => ({
      ...item,
      index: start + i,
      contentInfo: contentInfoMap.get(item.input)
    }));
  }, [items, contentInfoMap]);

  // Preload first 10 rows on mount
  useEffect(() => {
    const first10 = items.slice(0, 10);
    first10.forEach(item => {
      if (item.input && !contentInfoMap.has(item.input)) {
        fetchContentMetadata(item.input).then(info => {
          if (info && !info.unresolved) {
            setContentInfo(item.input, info);
            preloadSiblings(item.input, info);
          }
        });
      }
    });
  }, [items]); // Only run when items change
```

**Step 3: Wrap the content with context provider**

Find the return statement and wrap the Stack with the context provider:

```jsx
  const contextValue = useMemo(() => ({
    items,
    contentInfoMap,
    setContentInfo,
    getNearbyItems,
  }), [items, contentInfoMap, setContentInfo, getNearbyItems]);

  return (
    <ListsContext.Provider value={contextValue}>
      <Stack gap="md" className="lists-view">
        {/* ... existing content ... */}
      </Stack>
    </ListsContext.Provider>
  );
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat: wire up ListsContext with preload for first 10 rows"
```

---

## Task 7: Export fetchContentMetadata from ListsItemRow

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Find the fetchContentMetadata function and export it**

The function is defined around line 390. Change it from:

```js
async function fetchContentMetadata(value) {
```

to:

```js
export async function fetchContentMetadata(value) {
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: export fetchContentMetadata for use by ListsFolder"
```

---

## Task 8: Add Hover Preload to ListsItemRow

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Add context import and hook usage in the main ListsItemRow component**

Find the ListsItemRow component (search for `function ListsItemRow`) and add at the top of the function:

```js
import { useListsContext } from './ListsContext.js';
```

Then inside the component, add:

```js
  const { getNearbyItems, setContentInfo, contentInfoMap } = useListsContext();
```

**Step 2: Add the hover handler**

Add this callback inside ListsItemRow:

```js
  const handleRowHover = useCallback(() => {
    if (!item.input) return;

    const nearbyItems = getNearbyItems(item.index, 2);
    nearbyItems.forEach(nearbyItem => {
      if (!nearbyItem.input) return;

      // Get or fetch content info
      let info = nearbyItem.contentInfo || contentInfoMap.get(nearbyItem.input);

      if (info && !info.unresolved) {
        preloadSiblings(nearbyItem.input, info);
      } else if (!contentInfoMap.has(nearbyItem.input)) {
        // Fetch content info first, then preload
        fetchContentMetadata(nearbyItem.input).then(fetchedInfo => {
          if (fetchedInfo && !fetchedInfo.unresolved) {
            setContentInfo(nearbyItem.input, fetchedInfo);
            preloadSiblings(nearbyItem.input, fetchedInfo);
          }
        });
      }
    });
  }, [item.input, item.index, getNearbyItems, contentInfoMap, setContentInfo]);
```

**Step 3: Attach hover handler to the row container**

Find the outer div of the row (look for `className` containing `item-row`) and add:

```jsx
<div className="item-row" onMouseEnter={handleRowHover}>
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: add hover-based radius preloading to ListsItemRow"
```

---

## Task 9: Manual Testing

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Test the preloading**

1. Navigate to Admin > Content Lists > any list with 10+ items
2. Open browser DevTools Network tab
3. Observe: First 10 rows should trigger API calls on page load
4. Hover over row 11: Should trigger preload for rows 9-13
5. Click to edit any preloaded row: Should open instantly (no spinner)
6. Click to edit a non-preloaded row: Should show brief spinner then load

**Step 3: Verify no duplicate requests**

1. Hover over the same row multiple times
2. Check Network tab: Should only see one set of requests per item

---

## Task 10: Final Commit

**Step 1: Verify all changes**

```bash
git status
git diff --stat HEAD~8
```

**Step 2: Tag completion**

```bash
git tag combobox-preload-complete
```
