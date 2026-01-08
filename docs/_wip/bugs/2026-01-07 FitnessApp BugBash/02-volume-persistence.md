# Bug 02: Volume Persistence Regression

**Severity:** High
**Area:** Playback
**Status:** Open

## Summary

The player fails to honor user volume settings across session states. Volume reverts to default on page reload or video stall/restart.
Not only session states, but mount states as well: remounting the player component also resets volume, which apparently never checks for persisted volume on mount. (i worked before, maybe check git history to see what may have changed?)

## Symptoms

1. On page reload, video reverts to default volume
2. If video stalls and restarts, it reverts to default volume
3. **Workaround:** Opening the Volume UI triggers the player to "remember" and snap back to correct volume

## Root Cause Hypothesis

The persistence wiring is disconnected during initialization but re-engages when the UI component mounts/interacts. This suggests:
- Volume is persisted correctly to localStorage
- Hydration from storage occurs
- But **application to the media element** fails on initial load
- UI interaction forces re-application which succeeds

## Relevant Code

### Volume Storage Layer
**File:** `frontend/src/modules/Fitness/volumeStorage.js`

| Function | Purpose |
|----------|---------|
| `createVolumeStore(options)` | Factory for volume storage system |
| `getVolume(ids)` | Retrieves volume with fallback resolution |
| `setVolume(ids, patch)` | Persists to localStorage |
| `hydrateFromStorage()` | Loads stored volumes on initialization |

**Storage format:** `volume:fitness:{showId}:{seasonId}:{trackId}`

### Volume Application
**File:** `frontend/src/modules/Fitness/VolumeProvider.jsx`

| Function | Purpose |
|----------|---------|
| `applyToPlayer(playerRef, state)` | Applies volume to media element |
| `applyVolumeToMedia(media, state)` | Sets `media.volume` or calls `media.setVolume()` |

### Persistent Volume Hook
**File:** `frontend/src/modules/Fitness/usePersistentVolume.js`

| Function | Purpose |
|----------|---------|
| `usePersistentVolume()` | Main hook for persistent volume |
| `useState(() => getVolume(ids).level)` | Synchronous initialization |
| `useLayoutEffect` | Applies volume before browser paint |

**Note:** Uses `volumeRef` for synchronous access (3B Fix mentioned in comments)

### Player Integration
**File:** `frontend/src/modules/Player/Player.jsx`

- Volume flow through `usePlaybackSession({ sessionKey, defaults })`
- Effective volume resolution (lines 545-555)
- Remount handling preserves volume through session state

### Resilience System
**File:** `frontend/src/modules/Player/hooks/useMediaResilience.js`

- Handles stalls, buffer recovery, player reloads
- **Critical:** Does volume get re-applied after resilience reload?

## Likely Failure Points

1. **Race condition on mount:** `useLayoutEffect` runs before media element is ready
2. **Resilience reload path:** `handleResilienceReload` may not trigger volume re-application
3. **Session hydration timing:** Volume store hydrates but player hasn't subscribed yet
4. **Media element ref timing:** `playerRef.current` may be null during initial application

## Fix Direction

1. **Audit initialization sequence:**
   - Add logging to trace volume application timing
   - Verify `playerRef.current` exists when `applyToPlayer` is called

2. **Add resilience hook for volume:**
   - After `handleResilienceReload`, explicitly re-apply persisted volume
   - Subscribe to resilience status changes

3. **Ensure media ready state:**
   - Wait for `loadedmetadata` or `canplay` event before applying volume
   - Use media element event listeners instead of just useLayoutEffect

4. **Fallback re-application:**
   - On `playing` event, verify volume matches persisted value
   - If mismatch, re-apply

## Testing Approach

Runtime tests should:
1. Set volume to non-default value
2. Reload page, verify volume persists
3. Trigger stall/recovery, verify volume persists
4. Force remount, verify volume persists
5. Test with different volume sources (global, track-specific, season-specific)
