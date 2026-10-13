# Bug: Nested Menu Keyboard Handler Stops Working at 3rd Level

**Status: FIXED** (2026-01-02)

## Summary
When navigating through three levels of menus (e.g., Home → Show → Season), keyboard navigation stops working at the third level. Arrow keys, Enter, and potentially Escape no longer respond.

## Reproduction Steps
1. Open TVApp at http://localhost:3111
2. Use arrow keys to navigate to a show with seasons (e.g., "Chosen")
3. Press Enter to open the show menu (2nd level) - keyboard works
4. Navigate to a season and press Enter (3rd level) - **keyboard stops responding**

## Affected Files
- [frontend/src/modules/Menu/Menu.jsx](frontend/src/modules/Menu/Menu.jsx) - `MenuItems` component with keyboard handler
- [frontend/src/Apps/TVApp.jsx](frontend/src/Apps/TVApp.jsx) - Content stack management and menu synchronization

## Root Cause Analysis

### Architecture Overview
The TV app uses a content stack pattern:
- `contentStack` holds React elements representing menu levels
- Only `currentContent` (the topmost element) is rendered
- `menuSelections` array tracks selected index per depth
- A sync effect updates menu props when selections change

### Issue 1: Stale Callback References in Sync Effect

**Location**: [TVApp.jsx#L254-L292](frontend/src/Apps/TVApp.jsx#L254-L292)

The sync effect creates a NEW `onSelectedIndexChange` callback inside `map()` on every render:

```javascript
useEffect(() => {
  setContentStack((prev) => {
    const updated = prev.map((element, idx) => {
      // ...
      const onSelectedIndexChange = (newIndex, key) => {  // NEW function each time!
        setMenuSelections((old) => {
          const next = [...old];
          next[depth] = { index: newIndex, key: key ?? null };
          return next;
        });
      };
      // ...
      return React.cloneElement(element, { onSelectedIndexChange, ... });
    });
    // ...
  });
}, [menuSelections, menuRefreshTokens]);
```

**Problem**: This creates a cascade of updates:
1. `onSelectedIndexChange` changes → cloned element has new props
2. `MenuItems` re-renders with new `onSelectedIndexChange`
3. `setSelectedIndex` callback regenerates (depends on `onSelectedIndexChange`)
4. `handleKeyDown` callback regenerates (depends on `setSelectedIndex`)
5. Keyboard listener effect runs cleanup + setup

At depth 3, this cascade may cause timing issues where the listener is briefly detached or has stale references.

### Issue 2: Missing Dependency in `handleKeyDown`

**Location**: [Menu.jsx#L494-L554](frontend/src/modules/Menu/Menu.jsx#L494-L554)

```javascript
const handleKeyDown = useCallback(
  (e) => {
    // ... uses findKeyForItem
    setSelectedIndex(next, findKeyForItem(items[next]));  // findKeyForItem used here
    // ...
  },
  [items, selectedIndex, onSelect, onClose, columns, setSelectedIndex]  // findKeyForItem MISSING!
);
```

**Problem**: `findKeyForItem` is used inside the callback but not listed in dependencies. While `findKeyForItem` is stable (empty deps array), this is technically a React lint violation that could cause issues in certain edge cases.

### Issue 3: State Update Timing During Push

**Location**: [TVApp.jsx#L174-L211](frontend/src/Apps/TVApp.jsx#L174-L211)

```javascript
const setCurrentContent = useCallback((newContent) => {
  if (!newContent) {
    // popping...
  } else {
    setContentStack((oldStack) => {
      const newDepth = oldStack.length + 1;
      setMenuSelections((oldSelections) => { ... });  // State update inside state update
      setMenuRefreshTokens((oldTokens) => { ... });   // Another state update
      return [...oldStack, newContent];
    });
  }
}, []);
```

**Problem**: Multiple state setters called inside the `setContentStack` callback. While React batches these, calling setState inside another setState's updater function can lead to unexpected intermediate states.

### Issue 4: Depth Calculation Mismatch

When `mapSelectionToContent` calculates depth:
```javascript
const depth = contentStack.length + 1;
```

At the moment of selection:
- `contentStack` might have stale length due to React's async state updates
- The element is created with `depth = N+1`, but `menuSelections[N+1]` may not exist yet

## Proposed Fix

### Option A: Memoize `onSelectedIndexChange` per depth

Create stable callback references instead of recreating them in the effect:

```javascript
// In TVApp.jsx, create stable callbacks using useCallback with depth binding
const createSelectionUpdater = useCallback((depth) => {
  return (newIndex, key) => {
    setMenuSelections((old) => {
      const next = [...old];
      next[depth] = { index: newIndex, key: key ?? null };
      return next;
    });
  };
}, []);  // Stable reference

// Use a ref or memo to cache callbacks per depth
const selectionUpdaters = useRef({});
const getSelectionUpdater = (depth) => {
  if (!selectionUpdaters.current[depth]) {
    selectionUpdaters.current[depth] = createSelectionUpdater(depth);
  }
  return selectionUpdaters.current[depth];
};
```

### Option B: Remove sync effect, pass stable props initially

Instead of syncing contentStack elements post-hoc, pass stable props when creating the element:

```javascript
function mapSelectionToContent(selection) {
  // ... existing code ...
  const depth = contentStack.length + 1;
  
  // Use a stable callback reference
  const updateSelectionAtDepth = useCallback((newIndex, key) => {
    setMenuSelections((old) => {
      const next = [...old];
      next[depth] = { index: newIndex, key: key ?? null };
      return next;
    });
  }, [depth]);  // Will need to handle this differently since depth isn't in scope
  // ...
}
```

This approach would require restructuring to avoid the sync effect entirely.

### Option C: Add `findKeyForItem` to `handleKeyDown` dependencies

In [Menu.jsx](frontend/src/modules/Menu/Menu.jsx#L553):

```javascript
const handleKeyDown = useCallback(
  (e) => { ... },
  [items, selectedIndex, onSelect, onClose, columns, setSelectedIndex, findKeyForItem]  // Add findKeyForItem
);
```

### Option D: Use a single keyboard handler at the app level

Instead of each `MenuItems` managing its own listener, have `TVApp` manage a single global keyboard handler that delegates to the current active menu:

```javascript
// In TVApp.jsx
useEffect(() => {
  const handleKeyDown = (e) => {
    // Find the topmost menu and delegate to it
    const currentMenu = contentStack[contentStack.length - 1];
    if (currentMenu?.props?.onKeyDown) {
      currentMenu.props.onKeyDown(e);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [contentStack]);
```

## Recommended Fix

**Option A** is the most targeted fix. The core issue is that `onSelectedIndexChange` gets recreated on every sync effect run, causing the cascade of callback updates.

Memoizing the callbacks per depth level will prevent unnecessary re-creation and stabilize the keyboard handler attachment.

## Implementation (Applied 2026-01-02)

### Changes Made

**1. [frontend/src/Apps/TVApp.jsx](frontend/src/Apps/TVApp.jsx)**

Added `useRef` to imports and created a ref-cached callback system:

```javascript
// Ref to cache onSelectedIndexChange callbacks per depth level
const selectionUpdatersRef = useRef({});

// Get or create a stable callback for a specific depth
const getSelectionUpdater = useCallback((depth) => {
  if (!selectionUpdatersRef.current[depth]) {
    selectionUpdatersRef.current[depth] = (newIndex, key) => {
      setMenuSelections((old) => {
        const next = [...old];
        next[depth] = { index: newIndex, key: key ?? null };
        return next;
      });
    };
  }
  return selectionUpdatersRef.current[depth];
}, []);
```

Updated `mapSelectionToContent` to use cached callback:
```javascript
const updateSelectionAtDepth = getSelectionUpdater(depth);
```

Updated sync effect to use cached callback and added `getSelectionUpdater` to dependencies.

**2. [frontend/src/modules/Menu/Menu.jsx](frontend/src/modules/Menu/Menu.jsx)**

Added missing `findKeyForItem` to `handleKeyDown` dependency array:
```javascript
[items, selectedIndex, onSelect, onClose, columns, setSelectedIndex, findKeyForItem]
```

## Testing

After applying the fix:
1. Navigate Home → Chosen → Season 1 → verify arrow keys work
2. Navigate Home → Living Scriptures → any show → any season → verify 4 levels work
3. Press Escape at each level → verify navigation back works
4. Mix keyboard and mouse navigation → verify no conflicts

## Related Issues

- React strict mode can cause double-mounting which might expose this timing issue
- Fast navigation (rapid Enter presses) may exacerbate the race condition
