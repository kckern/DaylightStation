# BUG-06 Deep Dive: Zoom-Seek Offset Bug - NOT Actually Fixed

**Investigation Date:** 2026-01-09  
**Status:** ✅ FIX IMPLEMENTED - Original fix was ineffective, correct fix now applied  

---

## Executive Summary

The original "fix" for BUG-06 **does not work** because it calls methods that don't exist on the object being used. The fix code silently fails due to typeof guards, leaving the underlying bug fully intact.

---

## Original Bug Symptoms (Still Present)

After zooming into a thumbnail segment and then zooming back out:
1. User clicks a thumbnail to seek
2. Video seeks to the **wrong time** with a cumulative offset
3. Each zoom-seek cycle adds more offset

---

## Why The "Fix" Doesn't Work

### The Fix Code (Lines 140-157 of FitnessPlayerFooterSeekThumbnails.jsx):

```javascript
useEffect(() => {
  if (!playerRef?.current) return;
  const controller = playerRef.current;  // ❌ This is Player imperative handle
  
  // Clear any pending auto-seek from previous zoom
  if (typeof controller.clearPendingAutoSeek === 'function') {  // ❌ Returns false!
    controller.clearPendingAutoSeek();
    logger.info('cleared-pending-autoseek-on-zoom-change', { zoomRange });
  }
  
  // Also clear the resilience system's seek intent
  if (typeof controller.recordSeekIntentMs === 'function' && !zoomRange) {  // ❌ Returns false!
    controller.recordSeekIntentMs(null, 'zoom-range-reset');
    logger.info('cleared-seek-intent-on-unzoom');
  }
}, [zoomRange, playerRef]);
```

### Problem 1: Wrong Object Being Accessed

`playerRef.current` is the **Player imperative handle** (from `useImperativeHandle`), which exposes:
- `seek()`, `play()`, `pause()`, `toggle()`, `advance()`
- `getCurrentTime()`, `getDuration()`
- `getMediaElement()`, `getMediaController()`
- `getMediaResilienceController()` ← **This is what should be used!**
- `getMediaResilienceState()`, `resetMediaResilience()`
- `forceMediaReload()`, `forceMediaInfoFetch()`
- `getPlaybackState()`

It does **NOT** expose `clearPendingAutoSeek` or `recordSeekIntentMs`.

### Problem 2: clearPendingAutoSeek is on the Wrong Layer

The `clearPendingAutoSeek` function was added to the `transport` object in `useCommonMediaController.js`:

```javascript
// Line 814 of useCommonMediaController.js
const transport = useMemo(() => ({
  // ...
  clearPendingAutoSeek: () => {
    pendingAutoSeekRef.current = null;
  }
}), [...]);
```

But this is **never exposed** to the Player imperative handle.

### Problem 3: Accessing recordSeekIntentMs

The `recordSeekIntentMs` method exists on the **resilience controller**, which can be accessed via:
```javascript
playerRef.current.getMediaResilienceController()?.recordSeekIntentMs(...)
```

Not directly on `playerRef.current`.

### Why The Fix Silently Fails

Due to the `typeof ... === 'function'` guards, the code simply doesn't execute - no errors, no effect:
- `typeof playerRef.current.clearPendingAutoSeek === 'function'` → `false` → skipped
- `typeof playerRef.current.recordSeekIntentMs === 'function'` → `false` → skipped

---

## Root Cause Analysis (The Real Bug)

Now that we've established the fix doesn't work, what's the actual root cause?

### Hypothesis 1: Stale Seek Intent from Resilience System

The resilience system (useMediaResilience) tracks `lastKnownSeekIntentMsRef` and `sessionTargetTimeSeconds`. When zoomed and seeking, these values get set. When unzooming, if a recovery/remount happens, these stale values are restored.

**Evidence:**
- Line 973: `recordSeekIntentMs` persists seek to `sessionTargetTimeSeconds`
- Line 1024: `resolveSeekIntentMs` returns stale `lastKnownSeekIntentMsRef.current`
- These values survive zoom state changes

### Hypothesis 2: pendingAutoSeekRef Stale Value

The `pendingAutoSeekRef` in `useCommonMediaController` stores seek targets for deferred application. If a seek is queued during zoom and the video remounts, this stale value could be applied.

**Evidence:**
- Line 113: `pendingAutoSeekRef = useRef(null)`
- Line 395-406: On video `canplay`, if `pendingAutoSeekRef.current` has a value, it seeks to it
- This value is never cleared when zoom changes

### Hypothesis 3: Multiple Seek Intents Accumulating

Looking at the seek flow:
1. `handleThumbnailSeek` calls `commit(resolvedTarget)`
2. `commit` calls `recordSeekIntent(normalizedTarget)` → Sets resilience intent
3. `commit` calls `seek(normalizedTarget)` → Sets video currentTime
4. If zoom changes mid-seek, the resilience intent persists while new seeks add more

---

## Correct Fix Approach

### Fix 1: Expose clearPendingAutoSeek on Player Imperative Handle

In [Player.jsx](../../../frontend/src/modules/Player/Player.jsx#L612-L637), add:

```javascript
useImperativeHandle(isValidImperativeRef ? ref : null, () => ({
  // ... existing methods ...
  clearPendingAutoSeek: () => {
    controllerRef.current?.transport?.clearPendingAutoSeek?.();
  },
  // ... 
}), [...]);
```

### Fix 2: Correct the Zoom Effect Code

```javascript
useEffect(() => {
  if (!playerRef?.current) return;
  
  // Access the transport layer for pendingAutoSeek
  const mediaController = playerRef.current.getMediaController?.();
  const transport = mediaController?.transport;
  if (typeof transport?.clearPendingAutoSeek === 'function') {
    transport.clearPendingAutoSeek();
    logger.info('cleared-pending-autoseek-on-zoom-change', { zoomRange });
  }
  
  // Access resilience controller for seek intent
  const resilienceController = playerRef.current.getMediaResilienceController?.();
  if (!zoomRange && typeof resilienceController?.recordSeekIntentMs === 'function') {
    resilienceController.recordSeekIntentMs(null, 'zoom-range-reset');
    logger.info('cleared-seek-intent-on-unzoom');
  }
}, [zoomRange, playerRef]);
```

### Fix 3: Clear lastKnownSeekIntentMsRef on Zoom Out

In useMediaResilience, the controller should have a `clearSeekIntent()` method that resets:
- `lastKnownSeekIntentMsRef.current = null`
- `sessionTargetTimeSeconds` (via `updateSessionTargetTimeSeconds`)

---

## Additional Issues Found

### Issue A: recordSeekIntentMs(null, ...) Does Nothing

Looking at the implementation:
```javascript
const recordSeekIntentMs = useCallback((valueMs, reason = 'seek-intent') => {
  if (!Number.isFinite(valueMs) || valueMs < 0) return;  // ← null fails this check!
  persistSeekIntentMs(valueMs);
  // ...
}, [...]);
```

Even if the fix code reached `recordSeekIntentMs`, passing `null` would early-return without clearing anything!

### Issue B: No Clear Mechanism

There's no existing method to **clear** a seek intent. The system can only **set** new intents, never remove them.

---

## Recommended Implementation

### 1. Add clearSeekIntent to useMediaResilience Controller

```javascript
// In useMediaResilience.js controller useMemo
clearSeekIntent: (reason = 'external-clear') => {
  lastKnownSeekIntentMsRef.current = null;
  updateSessionTargetTimeSeconds(null);
  logResilienceEvent('seek-intent-cleared', { reason });
},
```

### 2. Expose clearPendingAutoSeek from Player

```javascript
// In Player.jsx useImperativeHandle
clearPendingAutoSeek: () => {
  controllerRef.current?.transport?.clearPendingAutoSeek?.();
},
```

### 3. Update the Zoom Effect

```javascript
// In FitnessPlayerFooterSeekThumbnails.jsx
useEffect(() => {
  if (!playerRef?.current) return;
  
  // Clear pending auto-seek from transport layer
  playerRef.current.clearPendingAutoSeek?.();
  
  // Clear resilience seek intent when unzooming
  if (!zoomRange) {
    const resilience = playerRef.current.getMediaResilienceController?.();
    resilience?.clearSeekIntent?.('zoom-range-reset');
  }
}, [zoomRange, playerRef]);
```

---

## Testing Recommendations

1. **Manual Test:**
   - Start a fitness video
   - Seek to position A
   - Right-click thumbnail to zoom
   - Click a sub-thumbnail to seek to position B (within zoom)
   - Press Escape or wait for unzoom
   - Click a thumbnail to seek to position C
   - Verify: Video should be at position C, NOT offset by (B - A)

2. **Add Console Debug:**
   Temporarily add logging to trace actual seek values:
   ```javascript
   console.log('[ZOOM-SEEK-DEBUG]', {
     action: 'seek-requested',
     targetFromUI: resolvedTarget,
     resilienceIntent: playerRef.current.getMediaResilienceController?.()?.getSeekIntentMs?.(),
     videoCurrentTime: videoEl?.currentTime
   });
   ```

3. **Verify Fix Application:**
   Add a console.log when the clear functions are called to ensure they actually execute.

---

## Files Requiring Changes

1. [useMediaResilience.js](../../../frontend/src/modules/Player/hooks/useMediaResilience.js) - Add `clearSeekIntent` to controller
2. [Player.jsx](../../../frontend/src/modules/Player/Player.jsx) - Expose `clearPendingAutoSeek` on imperative handle  
3. [FitnessPlayerFooterSeekThumbnails.jsx](../../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx) - Fix the useEffect to call correct methods on correct objects

---

## Summary

| Aspect | Original "Fix" | Reality |
|--------|---------------|---------|
| `clearPendingAutoSeek` called | ❌ Never called (wrong object) | Method exists but unreachable |
| `recordSeekIntentMs(null)` called | ❌ Never called (wrong object) | Even if called, `null` early-returns |
| Bug fixed | ❌ No | Bug is fully intact |
| User impact | 🔴 Critical | Seek goes to wrong time after zoom |

**Bottom Line:** The fix was well-intentioned but targeted the wrong API layer. The `typeof` guards prevented errors but also prevented any actual fix from occurring.

---

## Fix Applied (2026-01-09)

The correct fix has now been implemented:

### Changes Made:

1. **[useMediaResilience.js](../../../frontend/src/modules/Player/hooks/useMediaResilience.js)** - Added `clearSeekIntent()` method to controller:
```javascript
clearSeekIntent: (reason = 'external-clear') => {
  lastKnownSeekIntentMsRef.current = null;
  updateSessionTargetTimeSeconds(null);
  logResilienceEvent('seek-intent-cleared', { reason });
}
```

2. **[Player.jsx](../../../frontend/src/modules/Player/Player.jsx)** - Exposed new methods on imperative handle:
```javascript
clearPendingAutoSeek: () => {
  controllerRef.current?.transport?.clearPendingAutoSeek?.();
},
clearSeekIntent: (reason) => {
  resilienceControllerRef.current?.clearSeekIntent?.(reason);
}
```

3. **[FitnessPlayerFooterSeekThumbnails.jsx](../../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx)** - Updated zoom effect to call correct methods:
```javascript
useEffect(() => {
  if (!playerRef?.current) return;
  
  if (typeof playerRef.current.clearPendingAutoSeek === 'function') {
    playerRef.current.clearPendingAutoSeek();
  }
  
  if (!zoomRange && typeof playerRef.current.clearSeekIntent === 'function') {
    playerRef.current.clearSeekIntent('zoom-range-reset');
  }
}, [zoomRange, playerRef]);
```

### Verification

Manual testing required to confirm:
1. Start a fitness video
2. Seek to position A
3. Right-click thumbnail to zoom
4. Click a sub-thumbnail to seek within zoom
5. Press Escape or wait for unzoom
6. Click a thumbnail to seek to position C
7. ✅ Video should be at position C without offset
