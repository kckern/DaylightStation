# Volume Persistence Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix volume persistence regression so volume is correctly applied on init, page reload, video stall/restart, and component remount.

**Architecture:** Add media event listeners (`canplay`, `loadedmetadata`) to trigger volume application when media becomes ready, and watch for resilience status transitions from `recovering` to `playing` to re-apply volume after stall recovery.

**Tech Stack:** React hooks, HTML5 media events, existing VolumeProvider/usePersistentVolume infrastructure

---

## Background

The volume persistence system (`usePersistentVolume.js`) relies on `useLayoutEffect` to apply volume when `ids` or `playerRef` changes. However:

1. On initial mount, `playerRef.current` may be null when the effect runs
2. After resilience recovery (stall/restart), neither `ids` nor `playerRef` changes, so volume isn't re-applied
3. The resilience refactor (commit `3fe3184a`, Jan 9) removed complex recovery logic but didn't add volume re-application

**Current volume application points:**
- `usePersistentVolume.js:34-42` - `useLayoutEffect` on ids/playerRef change
- `FitnessPlayer.jsx:544-548` - `useEffect` on mediaElement change
- `FitnessPlayer.jsx:1006-1008` - `useEffect` on currentMediaIdentity change
- `useFitnessVolumeControls.js:24-27` - `useEffect` on videoTrackId change

**Missing trigger:** Volume re-application after resilience recovery completes.

---

## Task 1: Add `useVolumeSync` Hook

Create a dedicated hook that listens for media ready events and resilience recovery to apply volume reliably.

**Files:**
- Create: `frontend/src/modules/Fitness/hooks/useVolumeSync.js`

**Step 1: Create the hook file**

```javascript
import { useEffect, useRef } from 'react';
import { RESILIENCE_STATUS } from '../../Player/hooks/useResilienceState.js';

/**
 * Synchronizes volume state with media element on:
 * 1. Media ready (canplay event)
 * 2. Resilience recovery completion (recovering -> playing)
 * 3. Component remount
 */
export function useVolumeSync({
  mediaElement,
  resilienceStatus,
  applyVolume
}) {
  const prevStatusRef = useRef(resilienceStatus);
  const hasAppliedOnMountRef = useRef(false);

  // Apply volume when media becomes ready (canplay event)
  useEffect(() => {
    if (!mediaElement || typeof applyVolume !== 'function') return;

    const handleCanPlay = () => {
      applyVolume();
    };

    // Apply immediately if media is already ready
    if (mediaElement.readyState >= 3) {
      applyVolume();
      hasAppliedOnMountRef.current = true;
    }

    mediaElement.addEventListener('canplay', handleCanPlay);
    return () => {
      mediaElement.removeEventListener('canplay', handleCanPlay);
    };
  }, [mediaElement, applyVolume]);

  // Apply volume after resilience recovery completes
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = resilienceStatus;

    // Detect transition from recovering -> playing
    if (
      prevStatus === RESILIENCE_STATUS.recovering &&
      resilienceStatus === RESILIENCE_STATUS.playing
    ) {
      applyVolume?.();
    }
  }, [resilienceStatus, applyVolume]);

  // Apply on mount if media is ready but we haven't applied yet
  useEffect(() => {
    if (
      mediaElement &&
      !hasAppliedOnMountRef.current &&
      mediaElement.readyState >= 3
    ) {
      applyVolume?.();
      hasAppliedOnMountRef.current = true;
    }
  }, [mediaElement, applyVolume]);

  // Reset mount flag when media element changes (remount)
  useEffect(() => {
    hasAppliedOnMountRef.current = false;
  }, [mediaElement]);
}
```

**Step 2: Verify the file was created**

Run: `ls -la frontend/src/modules/Fitness/hooks/useVolumeSync.js`
Expected: File exists

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/hooks/useVolumeSync.js
git commit -m "feat(fitness): add useVolumeSync hook for reliable volume application

Listens for canplay events and resilience recovery transitions to ensure
volume is applied when media becomes ready or after stall recovery.

Fixes: Volume persistence regression (bug 02)"
```

---

## Task 2: Integrate `useVolumeSync` in FitnessPlayer

Wire the new hook into FitnessPlayer to handle volume sync.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx`

**Step 1: Add import**

Find line (around line 16):
```javascript
import { FitnessPlayerFrame } from './frames';
```

Add after it:
```javascript
import { useVolumeSync } from './hooks/useVolumeSync.js';
```

**Step 2: Add the hook call**

Find the block (around lines 544-548):
```javascript
  // Apply persisted volume when media element becomes available
  // This fixes the race condition where useLayoutEffect runs before playerRef is set
  useEffect(() => {
    if (mediaElement && videoVolume?.applyToPlayer) {
      videoVolume.applyToPlayer();
    }
  }, [mediaElement, videoVolume]);
```

Replace with:
```javascript
  // Apply persisted volume when media element becomes available or after recovery
  // This fixes race conditions and ensures volume persists after stall/restart
  useVolumeSync({
    mediaElement,
    resilienceStatus: resilienceState?.status,
    applyVolume: videoVolume?.applyToPlayer
  });
```

**Step 3: Remove redundant useEffect**

Find and remove the block (around lines 1006-1008):
```javascript
  useEffect(() => {
    videoVolume.applyToPlayer();
  }, [videoVolume, currentMediaIdentity]);
```

This is now handled by `useVolumeSync`.

**Step 4: Test manually**

1. Start dev server: `npm run dev`
2. Open Fitness app, play a video
3. Set volume to non-default (e.g., 30%)
4. Reload page - volume should persist at 30%
5. If video stalls, observe volume persists after recovery

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "feat(fitness): integrate useVolumeSync for volume persistence

Replaces manual useEffect hooks with useVolumeSync to handle:
- Initial mount with ready media
- Media becoming ready after mount
- Recovery from stall/restart

Part of bug 02 fix"
```

---

## Task 3: Update useFitnessVolumeControls

Simplify the hook since volume sync is now handled by `useVolumeSync`.

**Files:**
- Modify: `frontend/src/modules/Fitness/useFitnessVolumeControls.js`

**Step 1: Remove redundant useEffect**

Current file:
```javascript
import { useEffect, useMemo } from 'react';
import { usePersistentVolume } from './usePersistentVolume.js';

const DEFAULT_VIDEO_IDS = {
  showId: 'fitness',
  seasonId: 'global',
  trackId: 'video'
};

// Shared hook that owns the video volume state once and wires it to the player ref.
export function useFitnessVolumeControls({
  videoPlayerRef,
  videoShowId,
  videoSeasonId,
  videoTrackId
} = {}) {
  const videoVolume = usePersistentVolume({
    showId: videoShowId || DEFAULT_VIDEO_IDS.showId,
    seasonId: videoSeasonId || DEFAULT_VIDEO_IDS.seasonId,
    trackId: videoTrackId || DEFAULT_VIDEO_IDS.trackId,
    playerRef: videoPlayerRef
  });

  useEffect(() => {
    // Re-apply whenever identity changes so late-bound media elements pick up the state.
    videoVolume.applyToPlayer();
  }, [videoVolume, videoTrackId]);

  return useMemo(() => ({
    videoVolume
  }), [videoVolume]);
}
```

Replace with:
```javascript
import { useMemo } from 'react';
import { usePersistentVolume } from './usePersistentVolume.js';

const DEFAULT_VIDEO_IDS = {
  showId: 'fitness',
  seasonId: 'global',
  trackId: 'video'
};

/**
 * Shared hook that owns the video volume state and wires it to the player ref.
 * Volume application is delegated to useVolumeSync in the consuming component.
 */
export function useFitnessVolumeControls({
  videoPlayerRef,
  videoShowId,
  videoSeasonId,
  videoTrackId
} = {}) {
  const videoVolume = usePersistentVolume({
    showId: videoShowId || DEFAULT_VIDEO_IDS.showId,
    seasonId: videoSeasonId || DEFAULT_VIDEO_IDS.seasonId,
    trackId: videoTrackId || DEFAULT_VIDEO_IDS.trackId,
    playerRef: videoPlayerRef
  });

  return useMemo(() => ({
    videoVolume
  }), [videoVolume]);
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/useFitnessVolumeControls.js
git commit -m "refactor(fitness): remove redundant volume apply from useFitnessVolumeControls

Volume application is now centralized in useVolumeSync which handles all
edge cases (mount, remount, recovery) more reliably."
```

---

## Task 4: Update Bug Documentation

Mark the bug as resolved with implementation notes.

**Files:**
- Modify: `docs/_wip/bugs/2026-01-07-fitness-app-bugbash/02-volume-persistence.md`

**Step 1: Update status and add resolution**

Add at the top after the Status line:
```markdown
**Status:** Resolved
**Resolution Date:** 2026-01-14

## Resolution

Created `useVolumeSync` hook that listens for:
1. `canplay` media event - ensures volume applied when media becomes ready
2. Resilience status transition (`recovering` -> `playing`) - re-applies after stall recovery
3. Component remount - resets tracking and re-applies when media ready

**Files Changed:**
- Created: `frontend/src/modules/Fitness/hooks/useVolumeSync.js`
- Modified: `frontend/src/modules/Fitness/FitnessPlayer.jsx`
- Modified: `frontend/src/modules/Fitness/useFitnessVolumeControls.js`

---

```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-01-07-fitness-app-bugbash/02-volume-persistence.md
git commit -m "docs: mark volume persistence bug as resolved

Documents the useVolumeSync solution that handles init, remount, and
recovery edge cases."
```

---

## Task 5: Final Verification

**Step 1: Run dev server and test all scenarios**

```bash
npm run dev
```

Test checklist:
- [ ] Set volume to 30%, reload page → volume stays at 30%
- [ ] Set volume to 50%, switch tracks → volume persists
- [ ] Trigger stall (disconnect network briefly), observe recovery → volume persists
- [ ] Close and reopen FitnessPlayer → volume persists
- [ ] Different shows/seasons maintain separate volume settings

**Step 2: Check for console errors**

Open browser DevTools, filter for "volume" or "resilience" related logs.
Expected: No errors, clean application.

**Step 3: Final commit (if any adjustments needed)**

```bash
git status
# If clean, done. If changes needed, commit them.
```

---

## Summary

This fix introduces a single point of truth (`useVolumeSync`) for volume application that:

1. **Handles race conditions** - Waits for `canplay` event instead of assuming media is ready
2. **Survives stall recovery** - Watches resilience status transitions
3. **Works on remount** - Tracks mount state and re-applies when needed
4. **Centralizes logic** - Removes scattered `useEffect` hooks that each handled partial cases
