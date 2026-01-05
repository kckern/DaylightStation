# Menu Selection Persistence Analysis

## Problem Statement

When a user navigates from `TVMenu` → selects an item → opens `Player` or `AppContainer` → presses Escape to return, the menu resets to the first item (index 0) instead of remembering the previously selected item.

This creates a poor UX, especially for users navigating long lists repeatedly.

---

## Current Architecture

### Component Flow
```
TVApp
├── contentStack: React.Element[] (navigation stack)
├── TVMenu (when stack is empty)
│   └── MenuItems
│       └── selectedIndex: useState(0) ← RESETS ON REMOUNT
└── Player / AppContainer (when stack has content)
```

### Key Code Locations

| File | Component | Relevant Code |
|------|-----------|---------------|
| `TVApp.jsx` | `TVApp` | `contentStack` manages navigation stack |
| `Menu.jsx` | `MenuItems` | `useState(0)` for `selectedIndex` |
| `Menu.jsx` | `MenuItems` | `useEffect → setSelectedIndex(0)` on items change |

### Root Cause

1. **Component Unmounting**: When user selects an item, `TVMenu` is replaced by `Player`/`AppContainer` in the render tree. The `MenuItems` component unmounts, losing all local state.

2. **State Reset on Mount**: `MenuItems` initializes `selectedIndex` to `0` and has an effect that resets it when `items` changes:
   ```jsx
   const [selectedIndex, setSelectedIndex] = useState(0);
   
   useEffect(() => {
     setSelectedIndex(0);
   }, [items]);
   ```

3. **No Persistence Layer**: There's no mechanism to save/restore the selected index between mounts.

---

## Proposed Solutions

### Solution 1: Lift State to TVApp (Recommended)

**Approach**: Move `selectedIndex` state up to `TVApp` and pass it down to `TVMenu`/`MenuItems`.

**Pros**:
- State survives navigation since `TVApp` never unmounts
- Clean, explicit data flow
- No external dependencies
- Works immediately on return

**Cons**:
- Requires prop drilling or context
- TVApp becomes slightly more complex

**Implementation**:
```jsx
// TVApp.jsx
const [menuSelectedIndex, setMenuSelectedIndex] = useState(0);

// Pass to TVMenu
<TVMenu
  list={list}
  selectedIndex={menuSelectedIndex}
  onSelectedIndexChange={setMenuSelectedIndex}
  onSelect={handleSelection}
  onEscape={handleEscape}
/>
```

```jsx
// Menu.jsx - TVMenu
export function TVMenu({ list, selectedIndex = 0, onSelectedIndexChange, onSelect, onEscape }) {
  // ...
  return (
    <MenuItems
      items={menuItems}
      selectedIndex={selectedIndex}
      onSelectedIndexChange={onSelectedIndexChange}
      // ...
    />
  );
}
```

```jsx
// Menu.jsx - MenuItems
function MenuItems({ selectedIndex = 0, onSelectedIndexChange, ... }) {
  // Use controlled component pattern
  const handleIndexChange = (newIndex) => {
    onSelectedIndexChange?.(newIndex);
  };
  // Replace setSelectedIndex calls with handleIndexChange
}
```

---

### Solution 2: Keep Menu Mounted (CSS Hidden)

**Approach**: Instead of unmounting `TVMenu`, hide it with CSS while showing `Player`/`AppContainer`.

**Pros**:
- Zero code changes to Menu.jsx
- All menu state preserved automatically
- Faster return (no re-render/re-fetch)

**Cons**:
- Menu stays in DOM (memory overhead)
- May have keyboard focus conflicts
- Less clean architecture

**Implementation**:
```jsx
// TVApp.jsx
return (
  <TVAppWrapper
    content={
      <>
        <div style={{ display: currentContent ? 'none' : 'block' }}>
          <TVMenu ... />
        </div>
        {currentContent}
      </>
    }
  />
);
```

---

### Solution 3: SessionStorage / LocalStorage

**Approach**: Persist `selectedIndex` to storage keyed by menu identifier.

**Pros**:
- Survives page refresh
- Can remember position across sessions

**Cons**:
- Async read on mount (flash of wrong selection)
- Need unique key per menu
- Storage API overhead
- May restore stale index if items changed

**Implementation**:
```jsx
// Menu.jsx
const storageKey = `menu-selected-${menuMeta.title || 'default'}`;

const [selectedIndex, setSelectedIndex] = useState(() => {
  const saved = sessionStorage.getItem(storageKey);
  return saved ? parseInt(saved, 10) : 0;
});

useEffect(() => {
  sessionStorage.setItem(storageKey, selectedIndex.toString());
}, [selectedIndex, storageKey]);
```

---

### Solution 4: React Context

**Approach**: Create a `MenuContext` to store selection state globally.

**Pros**:
- Avoids prop drilling
- Can support multiple menus
- Centralized state management

**Cons**:
- More boilerplate
- Overkill for single menu case
- Context re-renders can affect performance

**Implementation**:
```jsx
// contexts/MenuContext.jsx
const MenuContext = createContext();

export function MenuProvider({ children }) {
  const [selections, setSelections] = useState({});
  
  const getSelectedIndex = (menuId) => selections[menuId] ?? 0;
  const setSelectedIndex = (menuId, index) => 
    setSelections(prev => ({ ...prev, [menuId]: index }));
  
  return (
    <MenuContext.Provider value={{ getSelectedIndex, setSelectedIndex }}>
      {children}
    </MenuContext.Provider>
  );
}
```

---

### Solution 5: URL State (Query Params)

**Approach**: Store selected index in URL query parameters.

**Pros**:
- Survives refresh
- Shareable/bookmarkable state
- Browser back button works naturally

**Cons**:
- URL gets cluttered
- May conflict with existing query params
- Requires careful encoding

**Implementation**:
```jsx
// Use react-router or manual URL manipulation
const [searchParams, setSearchParams] = useSearchParams();
const selectedIndex = parseInt(searchParams.get('menuIdx') || '0', 10);

const updateIndex = (index) => {
  setSearchParams({ ...Object.fromEntries(searchParams), menuIdx: index });
};
```

---

## Recommendation

**Solution 1 (Lift State to TVApp)** is the recommended approach because:

1. **Minimal Changes**: Only requires modifying `TVApp.jsx` and `Menu.jsx`
2. **No Dependencies**: No external storage or context providers needed
3. **Predictable**: State flow is explicit and debuggable
4. **Performance**: No extra re-renders or storage I/O
5. **Scoped**: Only affects the specific TVApp menu, not global

### Implementation Checklist

- [ ] Add `menuSelectedIndex` state to `TVApp`
- [ ] Pass `selectedIndex` and `onSelectedIndexChange` to `TVMenu`
- [ ] Update `TVMenu` to forward props to `MenuItems`
- [ ] Update `MenuItems` to use controlled component pattern
- [ ] Remove the `useEffect` that resets index on items change (or make it conditional)
- [ ] Test navigation: Menu → Player → Escape → verify index preserved
- [ ] Test navigation: Menu → AppContainer → Escape → verify index preserved
- [ ] Test edge case: Items list changes while in Player (index should reset or clamp)

---

## Edge Cases to Handle

1. **Items list changes**: If menu items are re-fetched and the list is different, the saved index might be out of bounds. Solution: `Math.min(savedIndex, items.length - 1)`.

2. **Multiple menu levels**: If user navigates Menu → SubMenu → Player → Escape, which menu index should restore? Solution: Store indices per menu level in an array matching `contentStack`.

3. **Initial load with autoplay**: If `autoplay` triggers on mount, menu never renders initially. Ensure index is `0` for first actual menu display.
