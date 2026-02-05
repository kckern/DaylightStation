# Bug 04: Video Exit - Parent State Refresh

**Date:** 2026-02-04
**Status:** Investigation Complete
**Area:** Video Player - Plex Integration

## Summary

Closing a video (auto or manual) returns the user to the parent list, but the "Watched" status doesn't update without a hard refresh.

## Investigation Findings

### Navigation Stack Architecture

**MenuStack.jsx** manages a stack-based navigation system:
```javascript
const clear = useCallback(() => {
  pop();  // Simply pops the player off the stack
}, [pop]);
```

When video closes:
1. `clear()` is called from Player component
2. Player is popped from navigation stack
3. Previous menu (ShowView/SeasonView) re-renders
4. **BUT**: Parent component state is NOT refreshed - shows cached data

### Data Fetching Pattern

**useFetchPlexData.js** (lines 16-44):
```javascript
useEffect(() => {
  // Only refetches when plexId changes
  // Does NOT refetch on component remount
}, [plexId]);
```

The hook only triggers a fetch when `plexId` prop changes. Popping back to the same view with the same `plexId` doesn't trigger a refetch.

### Available but Unused Infrastructure

**MenuNavigationContext.jsx** has a `replace()` method (lines 92-97):
```javascript
const replace = useCallback((content) => {
  setStack(prev => {
    if (prev.length === 0) return prev;
    return [...prev.slice(0, -1), content];
  });
}, []);
```

This could be used to force a refetch by replacing the current stack entry with fresh props, but it's **not currently wired up** to video close events.

### Data Flow Diagram

```
MenuStack (root)
  ├─ TVMenu (depth 0)
  ├─ PlexMenuRouter (depth 1) → fetches /api/v1/item/plex/:id
  ├─ ShowView/SeasonView (depth 2) → useFetchPlexData(plexId)
  └─ Player (depth 3)
      └─ onEnd → clear() → pop() [returns to depth 2, NO refetch]
```

## Hypothesis

### H1: Missing Cache Invalidation (Confirmed)
When `clear()` pops the player, there's no signal to invalidate cached Plex data. The parent view simply re-renders with stale state.

**Evidence**: `useFetchPlexData` only depends on `plexId`, not a refresh token or timestamp.

### H2: No Refresh Trigger
MenuNavigationContext doesn't provide a mechanism for the Player to signal "please refresh parent data when I close."

### H3: API Response Caching
The `/api/v1/item/plex/:id` endpoint response may be cached at the HTTP level or in a React Query/SWR cache that isn't invalidated.

## Files Involved

| File | Purpose |
|------|---------|
| `frontend/src/modules/Menu/MenuStack.jsx` | Navigation stack, clear() handler |
| `frontend/src/context/MenuNavigationContext.jsx` | Stack management, replace() method |
| `frontend/src/modules/Menu/hooks/useFetchPlexData.js` | Plex data fetching |
| `frontend/src/modules/Menu/Views/SeasonView.jsx` | Episode list rendering |
| `frontend/src/modules/Menu/Views/ShowView.jsx` | Season list rendering |
| `frontend/src/modules/Player/Player.jsx` | Video player, clear prop |

## Proposed Test Strategy

1. **Flow script**:
   - Navigate to episode list
   - Note watched status of target episode
   - Play episode to completion (or simulate via API call)
   - Exit video (auto or manual close)
   - Return to parent view
2. **Assertion**: Parent view's episode entry shows `isWatched: true` immediately without page refresh
3. **DOM check**: Verify watched indicator CSS class is present

## Proposed Fix Direction

### Option A: Refresh Token Pattern
Add a `refreshToken` to `useFetchPlexData`:
```javascript
useEffect(() => {
  fetchData();
}, [plexId, refreshToken]);
```

On video close, increment the refresh token to trigger refetch.

### Option B: Event-Based Refresh
Fire a custom event when video closes that the parent component listens for:
```javascript
// In Player.jsx onClose
window.dispatchEvent(new CustomEvent('plex-content-updated'));

// In SeasonView.jsx
useEffect(() => {
  const handler = () => refetchData();
  window.addEventListener('plex-content-updated', handler);
  return () => window.removeEventListener('plex-content-updated', handler);
}, []);
```

### Option C: Context-Based Callback
Extend MenuNavigationContext to accept an `onReturn` callback:
```javascript
push({ component: Player, onReturn: () => refetchPlexData() });
```

### Option D: Optimistic Update
Update local state immediately when marking as watched, without waiting for parent refetch:
```javascript
// When video completes, update local cache
plexCache.setWatched(episodeId, true);
```

**Recommendation**: Option A (refresh token) is cleanest - minimal changes, follows existing patterns.
