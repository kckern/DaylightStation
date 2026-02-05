# Combobox Siblings Preload Design

## Problem

When users click to edit a content item in the admin lists, the `ContentSearchCombobox` takes noticeable time to load because it fetches sibling data (parent's children) on demand. This creates a sluggish editing experience.

## Solution

Preload sibling data before the user clicks:
- **First 10 rows**: Preload eagerly on mount
- **Subsequent rows**: Preload on hover with radius of 2 (row + 2 above + 2 below)

## Design

### 1. Cache Structure

Module-level cache in `ListsItemRow.jsx`:

```js
const siblingsCache = new Map();
// Key: itemId (e.g., "plex:12345")
// Value: {
//   status: 'pending' | 'loaded' | 'error',
//   data: { browseItems, currentParent } | null,
//   promise: Promise | null
// }

function getCacheEntry(itemId) {
  return siblingsCache.get(itemId);
}

function setCacheEntry(itemId, entry) {
  siblingsCache.set(itemId, entry);
}
```

### 2. Preload Function

```js
async function preloadSiblings(itemId, contentInfo) {
  // Skip if already cached or pending
  const existing = getCacheEntry(itemId);
  if (existing) return existing.promise;

  // Mark as pending immediately
  const promise = doFetchSiblings(itemId, contentInfo);
  setCacheEntry(itemId, { status: 'pending', data: null, promise });

  try {
    const data = await promise;
    setCacheEntry(itemId, { status: 'loaded', data, promise: null });
    return data;
  } catch (err) {
    setCacheEntry(itemId, { status: 'error', data: null, promise: null });
    throw err;
  }
}

// Extracted from current fetchSiblings - same logic, returns data instead of setting state
async function doFetchSiblings(itemId, contentInfo) {
  const { source } = contentInfo;
  const localId = itemId.split(':')[1]?.trim();

  // ... existing fetch logic from fetchSiblings ...

  return { browseItems, currentParent };
}
```

### 3. Trigger: Initial Preload (First 10)

In parent component (ListsFolder or ListsIndex) on mount:

```js
useEffect(() => {
  const first10 = items.slice(0, 10);
  first10.forEach(item => {
    if (item.input) {
      fetchContentMetadata(item.input).then(info => {
        if (info && !info.unresolved) {
          preloadSiblings(item.input, info);
        }
      });
    }
  });
}, [items]);
```

### 4. Trigger: Hover-Based Radius Preload

In ListsItemRow:

```js
const handleRowHover = useCallback(() => {
  const radius = 2;
  const nearbyItems = getNearbyItems(rowIndex, radius); // from context

  nearbyItems.forEach(item => {
    if (item.input && item.contentInfo && !item.contentInfo.unresolved) {
      preloadSiblings(item.input, item.contentInfo);
    }
  });
}, [rowIndex, getNearbyItems]);

<div onMouseEnter={handleRowHover}>
```

### 5. Consuming the Cache

In `handleStartEditing`:

```js
const handleStartEditing = () => {
  setIsEditing(true);
  setSearchQuery(value || '');
  combobox.openDropdown();

  const cached = getCacheEntry(value);

  if (cached?.status === 'loaded' && cached.data) {
    // Instant - use cached data
    setBrowseItems(cached.data.browseItems);
    setCurrentParent(cached.data.currentParent);
    setLoadingBrowse(false);
    setHighlightedIdx(0);
  } else if (cached?.status === 'pending' && cached.promise) {
    // In flight - wait for it
    setLoadingBrowse(true);
    cached.promise.then(data => {
      setBrowseItems(data.browseItems);
      setCurrentParent(data.currentParent);
      setLoadingBrowse(false);
      setHighlightedIdx(0);
    });
  } else {
    // Not cached - fetch normally (fallback)
    fetchSiblings();
  }
};
```

### 6. Parent Coordination

ListsFolder provides nearby item access via context:

```js
const itemsWithInfo = useMemo(() =>
  items.map((item, idx) => ({ ...item, index: idx })),
[items]);

const getNearbyItems = useCallback((index, radius = 2) => {
  const start = Math.max(0, index - radius);
  const end = Math.min(items.length - 1, index + radius);
  return itemsWithInfo.slice(start, end + 1);
}, [itemsWithInfo]);

<ListsContext.Provider value={{ getNearbyItems, contentInfoMap }}>
  {items.map((item, idx) => (
    <ListsItemRow key={item.id} item={item} rowIndex={idx} />
  ))}
</ListsContext.Provider>
```

## Implementation Tasks

1. Add cache structure and helper functions to ListsItemRow.jsx
2. Extract `doFetchSiblings` from existing `fetchSiblings` function
3. Create `preloadSiblings` wrapper function
4. Add initial preload effect in ListsFolder
5. Create ListsContext with `getNearbyItems`
6. Add `onMouseEnter` handler to rows for radius preloading
7. Modify `handleStartEditing` to check cache first

## Trade-offs

- **Memory**: Cache grows with browsed items. Could add TTL or LRU eviction if needed.
- **Network**: More requests upfront, but spread out and non-blocking.
- **Complexity**: Adds caching layer, but logic is straightforward.
