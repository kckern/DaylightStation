# Media Element Access Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate four different media element access patterns into a single canonical interface via `useCommonMediaController`.

**Architecture:** Add `getMediaEl()` and `getContainerEl()` methods to `useCommonMediaController`, update `resilienceBridge` to support accessor registration, simplify `useMediaTransportAdapter` to delegate through the bridge, and remove all legacy access patterns.

**Tech Stack:** React hooks, custom elements (dash-video with shadow DOM)

---

## Task 1: Add getContainerEl to useCommonMediaController

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:278-282`

**Step 1: Add getContainerEl alongside existing getMediaEl**

The hook already has `getMediaEl` at line 278. Add `getContainerEl` and update the return.

```javascript
// Replace lines 278-282 with:
const getContainerEl = useCallback(() => {
  return containerRef.current;
}, []);

const getMediaEl = useCallback(() => {
  const container = containerRef.current;
  if (!container) return null;
  // If container has shadow DOM (dash-video), get the inner video/audio
  if (container.shadowRoot) {
    return container.shadowRoot.querySelector('video, audio');
  }
  // Otherwise container IS the media element
  return container;
}, []);
```

**Step 2: Update the return statement**

Find the return statement at line 1301 and add `getContainerEl`:

```javascript
return {
  containerRef,
  seconds,
  percent: getProgressPercent(seconds, duration),
  duration,
  isPaused: !seconds ? false : getMediaEl()?.paused || false,
  isDash,
  shader,
  isStalled,
  isSeeking,
  handleProgressClick,
  quality,
  droppedFramePct,
  currentMaxKbps,
  stallState,
  recovery: recoveryApi,
  elementKey,
  getMediaEl,      // ADD
  getContainerEl   // ADD
};
```

**Step 3: Verify no syntax errors**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run build 2>&1 | head -30`

Expected: Build completes without errors in useCommonMediaController.js

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCommonMediaController.js
git commit -m "feat(player): add getContainerEl accessor to useCommonMediaController"
```

---

## Task 2: Update resilienceBridge interface in SinglePlayer

**Files:**
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx:247-254`

**Step 1: Extend resilienceBridge with registerAccessors**

Replace the `resilienceBridge` useMemo at lines 247-254:

```javascript
// Create ref to hold registered accessors
const mediaAccessorsRef = useRef({ getMediaEl: () => null, getContainerEl: () => null });

const resilienceBridge = useMemo(() => ({
  onPlaybackMetrics,
  onRegisterMediaAccess,
  seekToIntentSeconds,
  onSeekRequestConsumed,
  remountDiagnostics,
  onStartupSignal,
  // New: accessor registration for children
  registerAccessors: ({ getMediaEl, getContainerEl }) => {
    mediaAccessorsRef.current = {
      getMediaEl: getMediaEl || (() => null),
      getContainerEl: getContainerEl || (() => null)
    };
  },
  // New: accessors that delegate to registered functions
  getMediaEl: () => mediaAccessorsRef.current.getMediaEl(),
  getContainerEl: () => mediaAccessorsRef.current.getContainerEl()
}), [onPlaybackMetrics, onRegisterMediaAccess, seekToIntentSeconds, onSeekRequestConsumed, remountDiagnostics, onStartupSignal]);
```

**Step 2: Add useRef import if missing**

Check line 1 - if `useRef` is not in the import, add it:

```javascript
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
```

**Step 3: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run build 2>&1 | head -30`

Expected: Build completes without errors

**Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/SinglePlayer.jsx
git commit -m "feat(player): extend resilienceBridge with accessor registration"
```

---

## Task 3: Register accessors in VideoPlayer

**Files:**
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx:43-97` (destructure new accessors)
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx:106-120` (update registration)
- Modify: `frontend/src/modules/Player/components/VideoPlayer.jsx:242-245` (remove inline query)

**Step 1: Destructure getMediaEl and getContainerEl from hook**

Update the destructuring at lines 43-57 to include the new accessors:

```javascript
const {
  isDash,
  containerRef,
  seconds,
  isPaused,
  duration,
  isStalled,
  isSeeking,
  handleProgressClick,
  quality,
  droppedFramePct,
  currentMaxKbps,
  stallState,
  elementKey,
  getMediaEl,       // ADD
  getContainerEl    // ADD
} = useCommonMediaController({
```

**Step 2: Replace registration effect with accessor registration**

Replace lines 106-120 with:

```javascript
// Register accessors with resilience bridge
useEffect(() => {
  if (resilienceBridge?.registerAccessors) {
    resilienceBridge.registerAccessors({ getMediaEl, getContainerEl });
  }
  // Also register with legacy onRegisterMediaAccess for backward compatibility
  if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
    resilienceBridge.onRegisterMediaAccess({
      getMediaEl,
      hardReset: null,
      fetchVideoInfo: fetchVideoInfo || null
    });
  }
  return () => {
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      resilienceBridge.onRegisterMediaAccess({});
    }
  };
}, [resilienceBridge, getMediaEl, getContainerEl, fetchVideoInfo]);
```

**Step 3: Replace inline shadow DOM query in LoadingOverlay**

Find lines 242-245 and replace the inline getMediaEl:

```javascript
// Before (lines 242-245):
getMediaEl={() => {
  const el = (containerRef.current?.shadowRoot?.querySelector('video')) || containerRef.current;
  return el || null;
}}

// After:
getMediaEl={getMediaEl}
```

**Step 4: Also update line 172 FPS logging**

Find line 172 and replace:

```javascript
// Before:
const mediaEl = (containerRef.current?.shadowRoot?.querySelector('video')) || containerRef.current;

// After:
const mediaEl = getMediaEl();
```

**Step 5: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run build 2>&1 | head -30`

Expected: Build completes without errors

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/components/VideoPlayer.jsx
git commit -m "feat(player): use canonical getMediaEl in VideoPlayer"
```

---

## Task 4: Simplify useMediaTransportAdapter

**Files:**
- Modify: `frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js:165-181`

**Step 1: Update getMediaEl to prefer resilienceBridge**

The adapter currently has a fallback chain. Simplify it to check resilienceBridge first (which will be available once we update Player.jsx to pass it).

For now, add resilienceBridge as a possible source. Replace the getMediaEl callback (lines 168-181):

```javascript
export function useMediaTransportAdapter({ controllerRef, mediaAccess, resilienceBridge }) {
  const warnedMissingMediaRef = useRef(false);

  const getMediaEl = useCallback(() => {
    // Prefer resilience bridge (canonical path)
    if (typeof resilienceBridge?.getMediaEl === 'function') {
      const el = resilienceBridge.getMediaEl();
      if (el) return el;
    }
    // Fallback to legacy mediaAccess
    const accessEl = typeof mediaAccess?.getMediaEl === 'function' ? mediaAccess.getMediaEl() : null;
    if (accessEl) return accessEl;
    // Final fallback to controllerRef transport
    const transportEl = controllerRef?.current?.transport?.getMediaEl;
    if (typeof transportEl === 'function') {
      try {
        return transportEl();
      } catch (error) {
        playbackLog('transport-getMediaEl-error', { message: error?.message || 'transport-error' }, { level: 'warn' });
        return null;
      }
    }
    return null;
  }, [controllerRef, mediaAccess, resilienceBridge]);
```

**Step 2: Add getContainerEl method**

After getMediaEl, add:

```javascript
const getContainerEl = useCallback(() => {
  if (typeof resilienceBridge?.getContainerEl === 'function') {
    return resilienceBridge.getContainerEl();
  }
  return null;
}, [resilienceBridge]);
```

**Step 3: Update return to include getContainerEl**

Update the return statement (around line 217):

```javascript
return {
  getMediaEl,
  getContainerEl,  // ADD
  play,
  pause,
  seek,
  nudge,
  readDiagnostics
};
```

**Step 4: Update the useEffect warning**

Update lines 183-190 to include resilienceBridge check:

```javascript
useEffect(() => {
  if (warnedMissingMediaRef.current) return;
  const hasMediaEl =
    typeof resilienceBridge?.getMediaEl === 'function' ||
    typeof mediaAccess?.getMediaEl === 'function' ||
    typeof controllerRef?.current?.transport?.getMediaEl === 'function';
  if (!hasMediaEl) {
    warnedMissingMediaRef.current = true;
    playbackLog('transport-capability-missing', { capability: 'getMediaEl' }, { level: 'warn' });
  }
}, [controllerRef, mediaAccess, resilienceBridge]);
```

**Step 5: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run build 2>&1 | head -30`

Expected: Build completes without errors

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js
git commit -m "feat(player): add resilienceBridge support to transport adapter"
```

---

## Task 5: Pass resilienceBridge to transport adapter in Player.jsx

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx:457`

**Step 1: Create a bridge reference in Player.jsx**

Find where `transportAdapter` is created (line 457). We need to pass the bridge. First, we need to create a ref that SinglePlayer can populate.

Add after line 399 (after `const controllerRef = useRef(null);`):

```javascript
const resilienceBridgeRef = useRef({ getMediaEl: () => null, getContainerEl: () => null });
```

**Step 2: Update transportAdapter to receive bridge**

Update line 457:

```javascript
// Before:
const transportAdapter = useMediaTransportAdapter({ controllerRef, mediaAccess });

// After:
const transportAdapter = useMediaTransportAdapter({
  controllerRef,
  mediaAccess,
  resilienceBridge: resilienceBridgeRef.current
});
```

**Step 3: Pass bridge registration to SinglePlayer**

In the `playerProps` object (around line 684), we need to add a callback for SinglePlayer to register its bridge. Add:

```javascript
onResilienceBridgeReady: useCallback((bridge) => {
  resilienceBridgeRef.current = bridge;
}, []),
```

Wait - actually looking at the code more carefully, the current flow is:

1. SinglePlayer creates `resilienceBridge` and passes it to VideoPlayer
2. VideoPlayer registers accessors with the bridge
3. Player.jsx uses `mediaAccess` (set via `handleRegisterMediaAccess`)

The simplest fix is to update `handleRegisterMediaAccess` to also store getMediaEl/getContainerEl so they're available to the transport adapter.

Let's revise: the current `mediaAccess` state already receives `getMediaEl` from VideoPlayer's registration. We just need the transport adapter to prefer this path.

Actually, looking at the current flow again:
- `handleRegisterMediaAccess` (line 283) sets `mediaAccess` state
- `useMediaTransportAdapter` (line 457) uses `mediaAccess.getMediaEl`
- This already works!

The issue is that `resilienceBridge.getMediaEl` in SinglePlayer is what we added, but it needs to flow to Player.jsx's transport adapter.

Simpler approach: since the transport adapter already uses `mediaAccess.getMediaEl()` (line 169), and VideoPlayer already registers with `resilienceBridge.onRegisterMediaAccess` which calls Player.jsx's `handleRegisterMediaAccess`, the chain is already working.

The transport adapter's `resilienceBridge` param is optional - it's an additional path. Let's verify the existing path works and simplify.

**Revised Step 1: Verify existing flow works**

The current code path is:
1. VideoPlayer calls `resilienceBridge.onRegisterMediaAccess({ getMediaEl, ... })`
2. SinglePlayer's bridge has `onRegisterMediaAccess` which is actually Player.jsx's `handleRegisterMediaAccess`
3. That sets `mediaAccess` state in Player.jsx
4. Transport adapter uses `mediaAccess.getMediaEl()`

This should already work with our changes. Let's just verify the build.

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run build 2>&1 | head -30`

**Step 2: Commit if no changes needed**

If build passes, no changes needed to Player.jsx for this task.

---

## Task 6: Update AudioPlayer to register accessors

**Files:**
- Modify: `frontend/src/modules/Player/components/AudioPlayer.jsx:37-72`

**Step 1: Verify AudioPlayer already gets getMediaEl from hook**

Looking at line 43, AudioPlayer already destructures `getMediaEl` from useCommonMediaController.

**Step 2: Add getContainerEl to destructuring**

Update line 37-47:

```javascript
const {
  seconds,
  duration,
  containerRef,
  handleProgressClick,
  mediaInstanceKey,
  getMediaEl,
  getContainerEl,  // ADD
  isPaused,
  isSeeking,
  hardReset
} = useCommonMediaController({
```

**Step 3: Add accessor registration effect**

After line 72 (after the useCommonMediaController call), add:

```javascript
// Register accessors with resilience bridge
useEffect(() => {
  if (resilienceBridge?.registerAccessors) {
    resilienceBridge.registerAccessors({ getMediaEl, getContainerEl });
  }
  if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
    resilienceBridge.onRegisterMediaAccess({
      getMediaEl,
      hardReset,
      fetchVideoInfo: fetchVideoInfo || null
    });
  }
  return () => {
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      resilienceBridge.onRegisterMediaAccess({});
    }
  };
}, [resilienceBridge, getMediaEl, getContainerEl, hardReset, fetchVideoInfo]);
```

**Step 4: Add useEffect import if missing**

Check line 1 - add `useEffect` if not present:

```javascript
import React, { useMemo, useCallback, useRef, useEffect } from 'react';
```

**Step 5: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run build 2>&1 | head -30`

Expected: Build completes without errors

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/components/AudioPlayer.jsx
git commit -m "feat(player): register accessors in AudioPlayer"
```

---

## Task 7: Run verification test

**Step 1: Start dev server if not running**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run dev &`

Wait for server to be ready.

**Step 2: Run the video loop overlay test**

The runtime test verifies overlay doesn't flash during video loops. This exercises the media element access path.

Run: `npx playwright test tests/runtime/player/video-loop-overlay.runtime.test.mjs`

Expected: Test passes

**Step 3: If test fails, investigate**

Check the test output for which assertion failed and debug accordingly.

---

## Task 8: Final cleanup and commit

**Step 1: Run full build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/media-element-access && npm run build`

Expected: Clean build with no errors

**Step 2: Review all changes**

Run: `git diff --stat main`

Verify only the expected files were modified:
- `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- `frontend/src/modules/Player/components/SinglePlayer.jsx`
- `frontend/src/modules/Player/components/VideoPlayer.jsx`
- `frontend/src/modules/Player/components/AudioPlayer.jsx`
- `frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js`

**Step 3: Create summary commit if needed**

If there are uncommitted changes:

```bash
git add -A
git commit -m "chore(player): complete media element access consolidation"
```

---

## Summary

After completing all tasks, the codebase will have:

1. **Single canonical accessor** - `getMediaEl()` and `getContainerEl()` from `useCommonMediaController`
2. **Clean registration flow** - Child components register accessors via `resilienceBridge.registerAccessors()`
3. **Shadow DOM handled consistently** - All access goes through the canonical accessor
4. **No inline shadow DOM queries** - Removed from VideoPlayer's LoadingOverlay and FPS logging
5. **Simplified transport adapter** - Single source of truth through the bridge
