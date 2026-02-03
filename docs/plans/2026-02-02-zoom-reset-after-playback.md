# Zoom Reset After Playback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Delay zoom reset until video actually starts playing at the seek target position, not just when seek intent clears.

**Architecture:** Replace `isSeekPending` trigger with `lifecycle` state machine from useSeekState. The lifecycle already tracks SEEKING → BUFFERING → PLAYING transitions. Trigger zoom reset on PLAYING state instead of when intentTime clears.

**Tech Stack:** React hooks, existing useSeekState/useZoomState hooks

---

## Background

Currently zoom resets when `isSeekPending` becomes false, which happens when `intentTime` clears. But `intentTime` can clear before playback actually resumes (e.g., when currentTime is within tolerance of target). This causes the zoom to reset while the video is still buffering.

The useSeekState hook already exposes a `lifecycle` state with values: `idle`, `seeking`, `buffering`, `playing`. We just need to use it.

---

### Task 1: Add lifecycle to SeekThumbnails destructure

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx:67-83`

**Step 1: Add lifecycle to destructured values from useSeekState**

Change line 67-83 from:

```javascript
const {
  displayTime,
  intentTime,
  previewTime,
  isSeekPending,
  commitSeek,
  setPreview,
  setPreviewThrottled,
  clearPreview,
  clearIntent
} = useSeekState({
  currentTime,
  playerRef,
  mediaElementKey,
  onSeekCommit: onSeek,
  isStalled
});
```

To:

```javascript
const {
  displayTime,
  intentTime,
  previewTime,
  isSeekPending,
  lifecycle,
  commitSeek,
  setPreview,
  setPreviewThrottled,
  clearPreview,
  clearIntent
} = useSeekState({
  currentTime,
  playerRef,
  mediaElementKey,
  onSeekCommit: onSeek,
  isStalled
});
```

**Step 2: Verify no syntax errors**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx`
Expected: No errors (lifecycle is already exported from useSeekState)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx
git commit -m "refactor(fitness): destructure lifecycle from useSeekState"
```

---

### Task 2: Replace zoom reset trigger logic

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx:121-138`

**Step 1: Replace the zoom reset useEffect**

Replace lines 121-138:

```javascript
// --- AUTO-RESET ZOOM AFTER SEEK COMPLETES ---
// When a seek completes and playback resumes, schedule zoom reset to base level
const prevSeekPendingRef = useRef(isSeekPending);
useEffect(() => {
  const wasSeekPending = prevSeekPendingRef.current;
  prevSeekPendingRef.current = isSeekPending;

  // Detect seek completion: was pending, now not pending, and we're zoomed
  if (wasSeekPending && !isSeekPending && isZoomed) {
    logger.info('seek-completed-scheduling-zoom-reset', { isZoomed, zoomRange });
    scheduleZoomReset(800);
  }

  // Cancel zoom reset when a new seek starts
  if (!wasSeekPending && isSeekPending) {
    cancelZoomReset();
  }
}, [isSeekPending, isZoomed, zoomRange, scheduleZoomReset, cancelZoomReset]);
```

With:

```javascript
// --- AUTO-RESET ZOOM AFTER PLAYBACK RESUMES ---
// Wait for video to actually START PLAYING at seek target before resetting zoom
const prevLifecycleRef = useRef(lifecycle);
useEffect(() => {
  const prevLifecycle = prevLifecycleRef.current;
  prevLifecycleRef.current = lifecycle;

  // Reset zoom when playback resumes after seek (not just when seek intent clears)
  if (prevLifecycle !== 'playing' && lifecycle === 'playing' && isZoomed) {
    logger.info('playback-resumed-scheduling-zoom-reset', { isZoomed, zoomRange, lifecycle });
    scheduleZoomReset(800);
  }

  // Cancel zoom reset when a new seek starts
  if (lifecycle === 'seeking') {
    cancelZoomReset();
  }
}, [lifecycle, isZoomed, zoomRange, scheduleZoomReset, cancelZoomReset]);
```

**Step 2: Verify no syntax errors**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx
git commit -m "fix(fitness): delay zoom reset until playback actually resumes"
```

---

### Task 3: Update bug doc status

**Files:**
- Modify: `docs/_wip/bugs/2026-02-02-fitness-zoom-seek-offset-bug.md`

**Step 1: Update the status and add resolution notes**

Change line 4 from:

```markdown
**Status:** Open - Fix Ineffective
```

To:

```markdown
**Status:** Fixed
```

Add after line 8 (after the `---`):

```markdown
## Resolution (2026-02-02)

**Root cause was misdiagnosed.** The original analysis about missing API methods was incorrect - both `clearPendingAutoSeek` and `clearSeekIntent` exist on `playerRef.current` (added in Player.jsx lines 691-697).

**Actual issue:** Zoom reset was triggered by `isSeekPending` becoming false, which happens when `intentTime` clears. But `intentTime` can clear before playback actually resumes (tolerance-based clearing).

**Fix:** Changed zoom reset trigger from `isSeekPending` to `lifecycle === 'playing'`. The useSeekState hook already tracks the full seek lifecycle (idle → seeking → buffering → playing → idle). Now zoom only resets when video actually starts playing at the target position.

---
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-02-02-fitness-zoom-seek-offset-bug.md
git commit -m "docs: update BUG-06 status to fixed with accurate root cause"
```

---

### Task 4: Manual verification

**No code changes - manual testing**

**Step 1: Start dev server if not running**

```bash
lsof -i :3111 || npm run dev
```

**Step 2: Test the fix**

1. Open Fitness app in browser
2. Start playing a fitness video
3. Double-click a thumbnail to zoom into that segment
4. Click a different thumbnail to seek (while zoomed)
5. **Verify:** Zoom stays at current level while video seeks/buffers
6. **Verify:** Zoom resets to full timeline only after video starts playing
7. Repeat steps 3-6 multiple times to check for cumulative offset

**Step 3: If tests pass, final commit**

```bash
git add -A
git commit -m "test: verify zoom-reset-after-playback fix manually"
```

---

## Cleanup (Optional)

If time permits, consider removing the dead `clearPendingAutoSeek` code from Player.jsx since the underlying transport method doesn't exist. This is cosmetic and doesn't affect the fix.
