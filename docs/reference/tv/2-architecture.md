# TV Menu Navigation Architecture Refactor

## Executive Summary

The current TV menu navigation system has accumulated technical debt that led to a critical bug where keyboard navigation failed at the 3rd menu level. The root cause was stale closures capturing outdated state, but the underlying issue is an architectural failure to properly separate concerns and establish a single source of truth for navigation state.

This document outlines the current architecture's failures and proposes a refactored design using React Context and custom hooks.

---

## Current Architecture Failures

### 1. Stale Closure Problem (Symptom of Deeper Issues)

**Current Code:**
```javascript
// TVApp.jsx
function mapSelectionToContent(selection) {
  const depth = contentStack.length + 1;  // ❌ Captures stale contentStack
  const updateSelectionAtDepth = getSelectionUpdater(depth);
  // ...
}
```

**Problem:** `mapSelectionToContent` is a plain function that captures `contentStack` from the render cycle when it was defined. When called from a child menu's `onSelect` callback (which was also created in a previous render), it sees stale state.

**Current Fix:** We added `contentStackLengthRef` to work around this, but this is a band-aid, not a solution.

---

### 2. Single Source of Truth Violation

Menu depth is calculated in **four different places**:

| Location | Calculation | Purpose |
|----------|-------------|---------|
| `mapSelectionToContent` | `contentStackLengthRef.current + 1` | Creating new menu elements |
| Sync effect | `idx + 1` | Updating existing menu props |
| `setCurrentContent` | `oldStack.length + 1` | Ensuring arrays have entries |
| Root `<TVMenu>` | Hardcoded `menuDepth={0}` | Root menu rendering |

**Problem:** Any change to depth logic requires updating multiple locations. The sync effect and `mapSelectionToContent` can disagree about what depth a menu is at.

---

### 3. Encapsulation Failure

`TVApp` manages internal state that should belong to a dedicated navigation layer:

```javascript
// TVApp.jsx - State that doesn't belong here
const [contentStack, setContentStack] = useState([]);
const [menuSelections, setMenuSelections] = useState([{ index: 0, key: null }]);
const [menuRefreshTokens, setMenuRefreshTokens] = useState([0]);
const selectionUpdatersRef = useRef({});
const contentStackLengthRef = useRef(0);
```

**Problem:** `TVApp` has become a "god component" that knows too much about menu internals. It manually manages:
- What's on the navigation stack
- Selection state per depth level
- Callback references per depth level
- Refresh tokens per depth level

---

### 4. DRY Violation

The `onSelectedIndexChange` callback is created in multiple places:

```javascript
// In getSelectionUpdater
selectionUpdatersRef.current[depth] = (newIndex, key) => {
  setMenuSelections((old) => {
    const next = [...old];
    next[depth] = { index: newIndex, key: key ?? null };
    return next;
  });
};

// Previously in sync effect (before fix)
const onSelectedIndexChange = (newIndex, key) => {
  setMenuSelections((old) => {
    const next = [...old];
    next[depth] = { index: newIndex, key: key ?? null };
    return next;
  });
};
```

---

### 5. Leaky Abstraction

`MenuItems` component has intimate knowledge of external state management:

```javascript
function MenuItems({
  selectedIndex: selectedIndexProp,
  selectedKey,
  onSelectedIndexChange,  // Must be stable or causes cascade
  // ...
}) {
  const isControlled = onSelectedIndexChange !== undefined;
  // Component behaves differently based on external wiring
}
```

**Problem:** The component's behavior depends on whether props are provided, creating two different code paths (controlled vs uncontrolled) that must be maintained in parallel.

---

### 6. Fragile Prop Drilling

Props must be manually threaded through multiple layers:

```
TVApp
  └─► TVMenu (selectedIndex, selectedKey, onSelectedIndexChange, refreshToken, menuDepth, onSelect, onEscape)
        └─► MenuItems (same props, minus onSelect/onEscape which become onSelect/onClose)
```

**Problem:** Adding any new navigation feature requires updating:
1. State in `TVApp`
2. Props passed to `TVMenu`
3. Props destructured in `TVMenu`
4. Props passed to `MenuItems`
5. Props destructured in `MenuItems`
6. Sync effect that clones elements

---

### 7. Manual Element Cloning Anti-Pattern

```javascript
// Sync effect manually updates React elements
useEffect(() => {
  setContentStack((prev) => {
    const updated = prev.map((element, idx) => {
      if (element.type !== TVMenu) return element;
      return React.cloneElement(element, {
        selectedIndex,
        selectedKey,
        onSelectedIndexChange,
        refreshToken,
      });
    });
    return hasChanges ? updated : prev;
  });
}, [menuSelections, menuRefreshTokens, getSelectionUpdater]);
```

**Problem:** This is a code smell. If you're manually cloning React elements to update their props, you've lost React's declarative model. State should flow naturally through renders, not be imperatively injected.

---

## Proposed Architecture

### Design Principles

1. **Single Source of Truth:** One place owns navigation state
2. **Context for Cross-Cutting Concerns:** Navigation state shared via Context, not props
3. **Custom Hooks for Logic:** Reusable hooks encapsulate navigation behavior
4. **Declarative over Imperative:** No manual element cloning
5. **Clean Interfaces:** Components receive minimal, focused props

---

### Component Hierarchy

```
<MenuNavigationProvider>           ← Owns all navigation state
  <TVApp>
    <MenuStack>                    ← Renders current stack level
      <TVMenu />                   ← Consumes context, no prop drilling
        <MenuItems />              ← Uses useMenuNavigation() hook
    </MenuStack>
  </TVApp>
</MenuNavigationProvider>
```

---

### New File Structure

```
frontend/src/
├── context/
│   └── MenuNavigationContext.jsx   ← Context + Provider
├── hooks/
│   └── useMenuNavigation.js        ← Navigation logic hook
├── modules/
│   └── Menu/
│       ├── Menu.jsx                ← Simplified TVMenu
│       ├── MenuItems.jsx           ← Simplified, uses hook
│       ├── MenuStack.jsx           ← Stack renderer
│       └── Menu.scss
└── Apps/
    └── TVApp.jsx                   ← Simplified, just renders provider + stack
```

---

### Core Implementation

#### 1. MenuNavigationContext.jsx

```javascript
import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const MenuNavigationContext = createContext(null);

/**
 * Navigation state and actions for the menu system.
 * Single source of truth for all menu navigation.
 */
export function MenuNavigationProvider({ children, onBackAtRoot }) {
  // Navigation stack: array of { content, type, props }
  const [stack, setStack] = useState([]);
  
  // Selection state per depth: { index, key }
  const [selections, setSelections] = useState({});
  
  // Current depth (derived)
  const depth = stack.length;
  
  /**
   * Push new content onto the stack
   */
  const push = useCallback((content) => {
    setStack(prev => [...prev, content]);
    // Initialize selection for new depth
    setSelections(prev => ({
      ...prev,
      [prev.length]: { index: 0, key: null }
    }));
  }, []);
  
  /**
   * Pop from the stack (go back)
   */
  const pop = useCallback(() => {
    setStack(prev => {
      if (prev.length === 0) {
        // At root, trigger external handler
        onBackAtRoot?.();
        return prev;
      }
      return prev.slice(0, -1);
    });
  }, [onBackAtRoot]);
  
  /**
   * Update selection at a specific depth
   */
  const setSelectionAtDepth = useCallback((targetDepth, index, key = null) => {
    setSelections(prev => ({
      ...prev,
      [targetDepth]: { index, key }
    }));
  }, []);
  
  /**
   * Get selection for a specific depth
   */
  const getSelection = useCallback((targetDepth) => {
    return selections[targetDepth] || { index: 0, key: null };
  }, [selections]);
  
  /**
   * Clear entire stack (reset to root)
   */
  const reset = useCallback(() => {
    setStack([]);
    setSelections({ 0: { index: 0, key: null } });
  }, []);

  // Back button capture (popstate handling)
  useEffect(() => {
    const handlePopState = (event) => {
      event.preventDefault();
      pop();
      window.history.pushState(null, '', window.location.href);
      return false;
    };
    
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [pop]);

  const value = {
    // State
    stack,
    depth,
    currentContent: stack[stack.length - 1] || null,
    
    // Selection
    selections,
    getSelection,
    setSelectionAtDepth,
    
    // Navigation
    push,
    pop,
    reset,
  };

  return (
    <MenuNavigationContext.Provider value={value}>
      {children}
    </MenuNavigationContext.Provider>
  );
}

/**
 * Hook to access navigation context
 */
export function useMenuNavigationContext() {
  const context = useContext(MenuNavigationContext);
  if (!context) {
    throw new Error('useMenuNavigationContext must be used within MenuNavigationProvider');
  }
  return context;
}
```

---

#### 2. useMenuNavigation.js

```javascript
import { useCallback, useEffect } from 'react';
import { useMenuNavigationContext } from '../context/MenuNavigationContext';

/**
 * Hook for menu keyboard navigation.
 * Handles arrow keys, Enter, Escape with proper depth awareness.
 */
export function useMenuNavigation({
  items = [],
  columns = 5,
  depth,
  onSelect,
  enabled = true,
}) {
  const { getSelection, setSelectionAtDepth, pop } = useMenuNavigationContext();
  
  const { index: selectedIndex } = getSelection(depth);
  
  const setSelectedIndex = useCallback((newIndex, key = null) => {
    setSelectionAtDepth(depth, newIndex, key);
  }, [depth, setSelectionAtDepth]);

  /**
   * Get a unique key for an item (for selection persistence)
   */
  const getItemKey = useCallback((item) => {
    if (!item) return null;
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    return item?.id ?? item?.key ?? actionVal ?? item?.label ?? null;
  }, []);

  /**
   * Keyboard handler
   */
  const handleKeyDown = useCallback((e) => {
    if (!enabled || !items.length) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        onSelect?.(items[selectedIndex]);
        break;

      case 'ArrowUp':
        e.preventDefault();
        {
          const next = (selectedIndex - columns + items.length) % items.length;
          setSelectedIndex(next, getItemKey(items[next]));
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        {
          const next = (selectedIndex + columns) % items.length;
          setSelectedIndex(next, getItemKey(items[next]));
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        {
          const next = (selectedIndex - 1 + items.length) % items.length;
          setSelectedIndex(next, getItemKey(items[next]));
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        {
          const next = (selectedIndex + 1) % items.length;
          setSelectedIndex(next, getItemKey(items[next]));
        }
        break;

      case 'Escape':
        e.preventDefault();
        pop();
        break;

      default:
        break;
    }
  }, [enabled, items, selectedIndex, columns, onSelect, setSelectedIndex, getItemKey, pop]);

  // Attach keyboard listener
  useEffect(() => {
    if (!enabled) return;
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);

  return {
    selectedIndex,
    setSelectedIndex,
    getItemKey,
  };
}
```

---

#### 3. MenuStack.jsx

```javascript
import React from 'react';
import { useMenuNavigationContext } from '../../context/MenuNavigationContext';
import TVMenu from './Menu';

/**
 * Renders the current menu level from the navigation stack.
 * Only the topmost item is rendered.
 */
export function MenuStack({ rootMenu }) {
  const { currentContent, depth, push } = useMenuNavigationContext();

  /**
   * Handle selection from any menu level.
   * Maps selection to appropriate action (push menu, play content, open app).
   */
  const handleSelect = (selection) => {
    if (!selection) return;

    // Determine content type and push to stack
    if (selection.list || selection.menu) {
      push({ type: 'menu', props: selection });
    } else if (selection.play || selection.queue) {
      push({ type: 'player', props: selection });
    } else if (selection.open) {
      push({ type: 'app', props: selection });
    }
  };

  // If stack is empty, render root menu
  if (!currentContent) {
    return (
      <TVMenu
        list={rootMenu}
        depth={0}
        onSelect={handleSelect}
      />
    );
  }

  // Render based on content type
  const { type, props } = currentContent;

  switch (type) {
    case 'menu':
      return (
        <TVMenu
          list={props.list || props.menu || props}
          depth={depth}
          onSelect={handleSelect}
        />
      );

    case 'player':
      // Import and render Player component
      const Player = React.lazy(() => import('../Player/Player'));
      return (
        <React.Suspense fallback={<div>Loading...</div>}>
          <Player {...props} />
        </React.Suspense>
      );

    case 'app':
      // Import and render AppContainer
      const AppContainer = React.lazy(() => import('../AppContainer/AppContainer'));
      return (
        <React.Suspense fallback={<div>Loading...</div>}>
          <AppContainer open={props.open} />
        </React.Suspense>
      );

    default:
      return <div>Unknown content type: {type}</div>;
  }
}
```

---

#### 4. Simplified TVMenu

```javascript
import React, { useRef } from 'react';
import { useFetchMenuData } from './useFetchMenuData';
import { useMenuNavigation } from '../../hooks/useMenuNavigation';
import { MenuHeader } from './MenuHeader';
import { MenuItems } from './MenuItems';
import './Menu.scss';

/**
 * TVMenu - Simplified menu component.
 * Uses context for navigation state, no prop drilling.
 */
export default function TVMenu({ list, depth, onSelect }) {
  const { menuItems, menuMeta, loaded } = useFetchMenuData(list);
  const containerRef = useRef(null);

  const { selectedIndex } = useMenuNavigation({
    items: menuItems,
    columns: 5,
    depth,
    onSelect,
    enabled: loaded && menuItems.length > 0,
  });

  if (!loaded) {
    return null;
  }

  return (
    <div className="menu-items-container" ref={containerRef}>
      <MenuHeader
        title={menuMeta.title || menuMeta.label}
        itemCount={menuItems.length}
        image={menuMeta.image}
      />
      <MenuItems
        items={menuItems}
        selectedIndex={selectedIndex}
        containerRef={containerRef}
      />
    </div>
  );
}
```

---

#### 5. Simplified TVApp

```javascript
import React, { useEffect, useState, useMemo } from 'react';
import './TVApp.scss';
import { DaylightAPI } from '../lib/api.mjs';
import { MenuNavigationProvider } from '../context/MenuNavigationContext';
import { MenuStack } from '../modules/Menu/MenuStack';
import { getChildLogger } from '../lib/logging/singleton.js';

export function TVAppWrapper({ children }) {
  return (
    <div className="tv-app-container">
      <div className="tv-app">
        <div className="tv-app__content">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function TVApp({ appParam }) {
  const [rootMenu, setRootMenu] = useState(null);
  const logger = useMemo(() => getChildLogger({ app: 'tv' }), []);

  useEffect(() => {
    const fetchData = async () => {
      const data = await DaylightAPI('data/list/TVApp/recent_on_top');
      setRootMenu(data);
      logger.info('tvapp-data-loaded', { count: data?.items?.length ?? 0 });
    };
    fetchData();
  }, [logger]);

  if (!rootMenu) {
    return <TVAppWrapper><div>Loading...</div></TVAppWrapper>;
  }

  return (
    <MenuNavigationProvider>
      <TVAppWrapper>
        <MenuStack rootMenu={rootMenu} />
      </TVAppWrapper>
    </MenuNavigationProvider>
  );
}
```

---

## Migration Strategy

### Phase 1: Create New Components (Non-Breaking)
1. Create `MenuNavigationContext.jsx`
2. Create `useMenuNavigation.js`
3. Create `MenuStack.jsx`
4. Write tests for new components

### Phase 2: Parallel Implementation
1. Create `TVApp.v2.jsx` using new architecture
2. Add feature flag to switch between old/new
3. Test on development devices

### Phase 3: Gradual Migration
1. Migrate `KeypadMenu` to use context
2. Migrate any other menu consumers
3. Remove old prop-drilling code

### Phase 4: Cleanup
1. Remove old state management from `TVApp`
2. Remove sync effect and element cloning
3. Remove `selectionUpdatersRef` and `contentStackLengthRef` hacks
4. Update documentation

---

## Comparison

| Aspect | Current | Proposed |
|--------|---------|----------|
| Lines of state management code | ~150 | ~60 |
| Places depth is calculated | 4 | 1 (context) |
| Props passed to TVMenu | 8 | 3 |
| Manual React.cloneElement | Yes | No |
| Refs needed for workarounds | 2 | 0 |
| Back button handling | In component | In context |
| Testability | Low (coupled) | High (isolated hooks) |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Feature flag, parallel implementation |
| Performance regression | Context selectors, memo where needed |
| Learning curve for new pattern | Documentation, code comments |
| Incomplete migration | Phased approach with checkpoints |

---

## Success Criteria

1. ✅ Keyboard navigation works at all menu depths
2. ✅ Back button captures and navigates up
3. ✅ Selection state persists when navigating back
4. ✅ No stale closure bugs possible
5. ✅ Adding new navigation features requires changes in ≤2 files
6. ✅ Unit tests cover navigation logic independently

---

## Appendix: Current vs Proposed Data Flow

### Current (Problematic)
```
User presses Enter
  → MenuItems.handleKeyDown (captured stale callback)
    → onSelect (stale reference from old render)
      → TVApp.handleSelection (stale contentStack)
        → mapSelectionToContent (uses ref hack to get current length)
          → getSelectionUpdater (cached callback)
            → setMenuSelections
              → sync effect runs
                → React.cloneElement (imperative update)
                  → MenuItems re-renders with new props
```

### Proposed (Clean)
```
User presses Enter
  → useMenuNavigation.handleKeyDown
    → onSelect (from props)
      → MenuStack.handleSelect
        → context.push(newContent)
          → stack state updates
            → MenuStack re-renders with new depth
              → TVMenu renders with new depth from context
                → useMenuNavigation reads selection from context
```

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Create new components | 2-3 hours | None |
| Phase 2: Parallel implementation | 2-3 hours | Phase 1 |
| Phase 3: Testing & migration | 1-2 hours | Phase 2 |
| Phase 4: Cleanup | 1 hour | Phase 3 |
| **Total** | **6-9 hours** | |

---

## Conclusion

The current architecture's complexity led directly to a user-facing bug. The proposed refactor eliminates the categories of bugs that can occur (stale closures, manual element cloning, prop drilling) rather than patching individual instances. The investment in refactoring will pay dividends in reduced debugging time and safer feature development.

---

# Player Architecture

**Version:** 1.0
**Date:** January 2026
**Status:** Implemented

---

## Overview

The Player system handles video and audio playback with unified overlay handling, cross-component communication, and resilience features. Key architectural patterns include the overlay system, ResilienceBridge for state coordination, and accessor registration for media element access.

---

## Overlay System

### Component: PlayerOverlayLoading

A unified overlay component that handles loading, paused, and stalled states with CSS-driven visibility (no JS timers).

```
┌────────────────────────────────────────────────────────────┐
│                    PlayerOverlayLoading                     │
├────────────────────────────────────────────────────────────┤
│  Props:                                                     │
│  ├── shouldRender: boolean    (mount/unmount control)      │
│  ├── isVisible: boolean       (opacity control)            │
│  ├── isPaused: boolean        (pause icon state)           │
│  ├── stalled: boolean         (stall indicator)            │
│  └── waitingToPlay: boolean   (initial loading state)      │
├────────────────────────────────────────────────────────────┤
│  Visibility Logic:                                          │
│  ├── Initial load: waitingToPlay=true → shows spinner      │
│  ├── Paused: isPaused=true → shows pause icon              │
│  ├── Stalled: stalled=true → shows stall indicator         │
│  └── Playing: all false → overlay hidden via CSS opacity   │
└────────────────────────────────────────────────────────────┘
```

### CSS-Driven Visibility

The overlay uses CSS transitions for smooth show/hide, avoiding JS timer complexity:

```css
.loading-overlay {
  opacity: 0;
  transition: opacity 0.3s ease-in-out;
  pointer-events: none;
}

.loading-overlay.visible {
  opacity: 1;
  pointer-events: auto;
}
```

### State Derivation

Overlay visibility is derived from playback metrics, not managed separately:

```javascript
// In SinglePlayer.jsx
const overlayVisible = waitingToPlay || isPaused || stalled;

<PlayerOverlayLoading
  shouldRender={true}
  isVisible={overlayVisible}
  isPaused={isPaused}
  stalled={stalled}
  waitingToPlay={waitingToPlay}
/>
```

---

## ResilienceBridge Pattern

### Purpose

Cross-component communication without prop drilling. Allows Player to coordinate with SinglePlayer, which coordinates with AudioPlayer/VideoPlayer.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           Player                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Creates resilienceBridge object                            │ │
│  │ Receives: playback metrics, startup signals, media access  │ │
│  └─────────────────────────────────┬──────────────────────────┘ │
│                                    │ props.resilienceBridge      │
│                                    ▼                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                       SinglePlayer                          │ │
│  │ Connects resilienceBridge callbacks to useMediaResilience  │ │
│  │ Passes bridge down to media players                        │ │
│  └─────────────────────────────────┬──────────────────────────┘ │
│                                    │ props.resilienceBridge      │
│                       ┌────────────┴────────────┐               │
│                       ▼                         ▼                │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │      AudioPlayer         │  │       VideoPlayer             │ │
│  │ Reports metrics          │  │ Reports metrics               │ │
│  │ Registers media accessors│  │ Registers media accessors    │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Key Callbacks

| Callback | Direction | Purpose |
|----------|-----------|---------|
| `onPlaybackMetrics` | Child → Parent | Report seconds, paused state, stall state |
| `onRegisterMediaAccess` | Child → Parent | Register getMediaEl, hardReset, fetchVideoInfo |
| `seekToIntentSeconds` | Parent → Child | Coordinate seek requests |
| `onSeekRequestConsumed` | Child → Parent | Acknowledge seek completion |
| `onStartupSignal` | Child → Parent | Notify playback started |

### Stability Requirement

**All callbacks must be memoized to prevent re-render loops:**

```javascript
// In useMediaResilience.js
// Stable no-op function to avoid creating new function references on each render
const NOOP = () => {};

return {
  overlayProps,
  state: resilienceState,
  onStartupSignal: NOOP // Stable reference to avoid re-render cascades
};
```

Without stable references, a child receiving a new callback reference triggers re-render, which creates another new callback, causing an infinite loop.

---

## Media Element Access Pattern

### Problem

Parent components need access to child's media element for operations like:
- Seeking
- Getting current time
- Hard reset
- Fetching video info

### Solution: Accessor Registration

Child components register accessor functions with the parent via resilienceBridge:

```javascript
// In AudioPlayer.jsx / VideoPlayer.jsx
useEffect(() => {
  if (resilienceBridge?.registerAccessors) {
    resilienceBridge.registerAccessors({
      getMediaEl: () => mediaRef.current,
      getContainerEl: () => containerRef.current,
      hardReset: () => { /* reset logic */ },
      fetchVideoInfo: () => { /* return video metadata */ }
    });
  }
}, [resilienceBridge]);
```

### Hook: useCommonMediaController

Shared media control logic extracted into a reusable hook:

```javascript
// In useCommonMediaController.js
export function useCommonMediaController({
  resilienceBridge,
  mediaRef,
  containerRef,
}) {
  // Register accessors with parent
  useEffect(() => {
    resilienceBridge?.registerAccessors?.({
      getMediaEl: () => mediaRef.current,
      getContainerEl: () => containerRef.current,
    });
  }, [resilienceBridge, mediaRef, containerRef]);

  // Common playback controls
  const play = useCallback(() => mediaRef.current?.play(), []);
  const pause = useCallback(() => mediaRef.current?.pause(), []);
  const seek = useCallback((time) => {
    if (mediaRef.current) mediaRef.current.currentTime = time;
  }, []);

  return { play, pause, seek };
}
```

### Access Pattern

Parent accesses child's media element through registered accessors:

```javascript
// In Player.jsx
const handleSeek = (targetSeconds) => {
  const mediaEl = resilienceBridge.getMediaEl?.();
  if (mediaEl) {
    mediaEl.currentTime = targetSeconds;
  }
};
```

---

## Shader Diagnostics

### Purpose

Debug blackout shader coverage issues by logging viewport and layer dimensions.

### Hook: useShaderDiagnostics

```javascript
// In useShaderDiagnostics.js
export function useShaderDiagnostics(containerRef, enabled = false) {
  const logger = getLogger();

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const logDimensions = () => {
      const container = containerRef.current;
      const layers = container.querySelectorAll('.blackout-layer');

      logger.info('blackout.dimensions', {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        container: {
          width: container.offsetWidth,
          height: container.offsetHeight,
        },
        layers: Array.from(layers).map(layer => ({
          width: layer.offsetWidth,
          height: layer.offsetHeight,
          top: layer.offsetTop,
          left: layer.offsetLeft,
        })),
      });
    };

    logDimensions();
    window.addEventListener('resize', logDimensions);
    return () => window.removeEventListener('resize', logDimensions);
  }, [enabled, containerRef, logger]);
}
```

### Event: blackout.dimensions

Logged when shader diagnostics are enabled:

```json
{
  "event": "blackout.dimensions",
  "data": {
    "viewport": { "width": 1920, "height": 1080 },
    "container": { "width": 1920, "height": 1080 },
    "layers": [
      { "width": 1920, "height": 1080, "top": 0, "left": 0 }
    ]
  }
}
```

### Usage

Enable via prop or query parameter for debugging production issues:

```javascript
// In AudioPlayer.jsx
useShaderDiagnostics(containerRef, enableDiagnostics);
```

---

## useMediaResilience Hook

### Purpose

Simplified stall recovery and overlay state management.

### Responsibilities

- Track playback state (playing, paused, stalled, waitingToPlay)
- Derive overlay visibility from playback state
- Provide stable callbacks to avoid re-render loops

### Interface

```javascript
const {
  overlayProps,  // { shouldRender, isVisible, isPaused, stalled, waitingToPlay }
  state,         // { playing, paused, stalled, waitingToPlay }
  onStartupSignal, // Stable callback (NOOP)
} = useMediaResilience({
  onPlaybackMetrics, // Callback to report metrics to parent
});
```

### State Machine

```
┌─────────────────┐
│  waitingToPlay  │  ← Initial state
└────────┬────────┘
         │ (media starts playing)
         ▼
┌─────────────────┐
│     playing     │  ← Normal playback
└────────┬────────┘
         │ (user pauses)    (stall detected)
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│     paused      │    │     stalled     │
└─────────────────┘    └─────────────────┘
```

---

## Related Documentation

- **Codebase Reference:** `docs/reference/tv/4-codebase.md` - File locations and function reference
- **Runbook:** `docs/runbooks/frontend-logging-debugging.md` - Debugging playback issues via logs
