# FitnessPlayerFooter Deep Dive Analysis

**Date:** January 9, 2026  
**Status:** Analysis Complete - Needs Refactoring

---

## Executive Summary

The FitnessPlayerFooter is a complex seek/zoom/progress UI system for video playback. After careful analysis, **the core issues stem from tangled state management around three distinct time values**, conflicting responsibilities between components, and an overly-complex zoom state machine. This document catalogs every feature the system needs and identifies the architectural problems.

---

## 1. Component Architecture Overview

```
FitnessPlayerFooterView (container)
├── FitnessPlayerFooterControls (left) - play/pause, prev, zoom nav
├── FitnessPlayerFooterSeekThumbnails - THE CORE PROBLEM AREA
│   ├── Progress bar (simple click-to-seek)
│   └── Thumbnail grid (10 segments)
│       └── FitnessPlayerFooterSeekThumbnail × 10
│           ├── SingleThumbnailButton (gesture handler)
│           ├── Thumbnail image layers (crossfade animation)
│           └── ProgressFrame (SVG border progress)
└── FitnessPlayerFooterControls (right) - next, close/back
```

---

## 2. The Three Time Values Problem

### Current State (BROKEN)
The system tracks **three different time values** but conflates them:

| Value | Purpose | Where Stored |
|-------|---------|--------------|
| `currentTime` | Actual video element playhead | Prop from parent |
| `pendingTime` | "We requested seek to X, waiting for media" | `useState` in SeekThumbnails |
| `previewTime` | "User is hovering/dragging, showing intent" | `useState` in SeekThumbnails |

### The Core Bug
```jsx
const displayTime = useMemo(() => {
  if (previewTime != null) return previewTime;  // ✓ Good
  if (pendingTime != null) return pendingTime;  // ⚠️ Problem!
  return currentTime;
}, [previewTime, pendingTime, currentTime]);
```

**Problem:** `pendingTime` is used for:
1. Showing visual feedback (correct)
2. Calculating which thumbnail is "active" (problematic during zoom!)
3. Resetting after zoom transitions (causes offset bugs)

### Required Behavior
| Scenario | displayTime Should Be |
|----------|-----------------------|
| Idle playback | `currentTime` |
| User hovering progress bar | `previewTime` |
| After click, waiting for seek | `pendingTime` → then clear when `currentTime` catches up |
| During zoom transition | **Should NOT change seek position!** |
| After unzoom | Playhead should remain where video actually is |

---

## 3. The Zoom State Machine Problem

### Current Implementation (OVER-COMPLEX)

```
States:
- zoomRange: [start, end] | null
- zoomStackRef: Array of { positions, range }
- lastViewSnapshotRef
- navStateRef
- resetZoomOnPlayingRef
```

### Issues:
1. **Zoom stack is confusing** - Stores positions AND range, unclear when each is used
2. **Zoom triggers auto-seek** - When zooming, the system sometimes seeks to the zoom anchor (BUG!)
3. **Unzoom clears seek intent** - But may not match actual video position
4. **Zoom nav (⏪⏩) is disconnected** - Uses different index resolution than thumbnails

### Required Behavior

| Action | Expected Result |
|--------|-----------------|
| Click thumbnail | Seek to `segmentStart` of that thumbnail |
| Right-click/long-press thumbnail | Zoom INTO that segment (no seek!) |
| Click time label | Zoom to segment containing that time |
| ⏪ / ⏩ in zoom mode | Pan zoom window left/right (no seek!) |
| Back button in zoom mode | Unzoom to full timeline (no seek!) |
| Click while zoomed | Seek within zoomed range |

**Critical Rule:** Zoom/pan operations should NEVER trigger a seek. They are NAVIGATION, not PLAYBACK operations.

---

## 4. Required Features Catalog

### 4.1 Progress Bar (Simple)
- [x] Shows playback progress as percentage
- [x] Click anywhere to seek
- [ ] Drag to scrub (currently broken - only clicks)
- [ ] Show zoom region indicator when zoomed
- [ ] Hover preview time tooltip

### 4.2 Thumbnail Grid
- [x] 10 thumbnails evenly distributed
- [x] Shows time label on each
- [x] "Active" thumbnail highlighted
- [x] Progress border around active thumbnail
- [x] Spark indicator at progress position
- [ ] Thumbnails should crossfade when time updates (partially working)
- [ ] Pan animation on active thumbnail (working but janky)

### 4.3 Seeking (Core)
- [x] Click thumbnail → seek to segment start
- [x] Seek persists intent through stalls (resilience system)
- [ ] **BUG:** Seek after zoom uses wrong target time
- [ ] **BUG:** pendingTime not cleared correctly on fast seeks
- [ ] **BUG:** Multiple rapid clicks cause race conditions

### 4.4 Zooming
- [x] Right-click or long-press to zoom into segment
- [x] Time label click zooms to signal
- [x] Zoom splits segment into 10 sub-thumbnails
- [ ] **BUG:** Zooming can trigger an unwanted seek
- [ ] **BUG:** Zoom stack navigation (⏪⏩) index resolution is inconsistent
- [ ] **BUG:** Unzoom leaves stale seek intent

### 4.5 Controls (Left)
- [x] Play/Pause button
- [x] Lock icon when governed
- [x] Refresh icon when stalled
- [x] Prev button (disabled when no prev)
- [x] Zoom nav buttons (⏪⏩) when zoomed
- [ ] **BUG:** Zoom nav buttons use wrong step logic

### 4.6 Controls (Right)
- [x] Next button
- [x] Close button (normal mode)
- [x] Back button (zoom mode)
- [ ] Back should unzoom completely (currently works)

### 4.7 Stall Recovery
- [x] Detects stalled video
- [x] Shows refresh icon
- [x] Manual reload preserves seek intent
- [ ] **BUG:** Seek intent may be stale after zoom operations

### 4.8 Visual Feedback
- [x] ProgressFrame SVG border
- [x] Spark dot at progress position
- [ ] **BUG:** Spark position miscalculated at segment boundaries
- [ ] **BUG:** Progress border doesn't update smoothly

---

## 5. Specific Bugs Identified

### BUG-01: Zoom Triggers Seek
**Location:** `handleThumbnailSeek` in SeekThumbnails.jsx:669
```jsx
if (zoomRange) {
  resetZoomOnPlayingRef.current = true;  // Sets flag to unzoom on play
}
```
This is called from `SingleThumbnailButton.handlePointerDown` even during zoom operations because the zoom/seek paths aren't cleanly separated.

**Fix:** Zoom operations should use `onZoom` callback only, not `onSeek`.

### BUG-02: pendingTime Persists Through Zoom
**Location:** SeekThumbnails.jsx:424-460
The pending clear logic uses tolerance against `currentTime`, but during zoom the reference frame changes and tolerances become meaningless.

**Fix:** Clear `pendingTime` when entering/exiting zoom mode.

### BUG-03: Stale Seek Intent After Unzoom
**Location:** SeekThumbnails.jsx:140-150
```jsx
useEffect(() => {
  // Clear seek intent when unzooming
  if (!zoomRange && typeof playerRef.current.clearSeekIntent === 'function') {
    playerRef.current.clearSeekIntent('zoom-range-reset');
  }
}, [zoomRange, playerRef]);
```
This clears resilience system's intent but NOT the local `pendingTime` state.

### BUG-04: Zoom Nav Index Mismatch
**Location:** `resolveZoomIndex` and `setZoomRangeFromIndex`
These use `getActiveZoomSnapshot().positions` but the snapshot may be stale after rapid zoom operations.

### BUG-05: displayTime Used for Both Visuals AND Seek Target
**Location:** Throughout SeekThumbnails.jsx
`displayTime` is used to determine which thumbnail is active (visual) AND passed to seek operations (behavior). These should be separate.

### BUG-06: Effect Ordering Race Condition
**Location:** Multiple useEffects depend on `zoomRange`, `pendingTime`, `currentTime`
No guaranteed execution order, causing inconsistent state during transitions.

---

## 6. Recommended Refactoring Strategy

### Phase 1: Separate Concerns
1. **Create `useSeekState` hook** - Manages `currentTime`, `pendingTime`, `previewTime`, `displayTime`
2. **Create `useZoomState` hook** - Manages `zoomRange`, `zoomStack`, navigation
3. **Clear boundary:** Zoom operations NEVER call seek, seek operations NEVER modify zoom

### Phase 2: Single Source of Truth
```jsx
// Proposed state structure
const seekState = {
  actualTime: number,      // From video element
  intentTime: number|null, // User's requested seek target
  previewTime: number|null // Hover/drag preview
};

const zoomState = {
  range: [start, end] | null,
  parentRange: [start, end],
  canNavBack: boolean,
  canNavForward: boolean
};
```

### Phase 3: Event-Driven Architecture
Replace tangled useEffects with explicit event handlers:
- `onSeekRequested(time)` → Sets intentTime, calls player.seek()
- `onSeekComplete()` → Clears intentTime when actualTime catches up
- `onZoomIn(range)` → Pushes to zoom stack, NO seek
- `onZoomOut()` → Pops zoom stack, NO seek
- `onZoomNav(direction)` → Shifts zoom window, NO seek

### Phase 4: Simplify Thumbnail Component
`FitnessPlayerFooterSeekThumbnail` should be a dumb component:
- Receives: `segmentStart`, `segmentEnd`, `isActive`, `progressRatio`, `thumbnailSrc`
- Emits: `onSeek(segmentStart)`, `onZoom([segmentStart, segmentEnd])`
- No internal time calculations

---

## 7. Test Scenarios to Validate Fix

| # | Scenario | Expected | Currently |
|---|----------|----------|-----------|
| 1 | Click thumbnail at 5:00 | Video seeks to 5:00 | ✓ Works |
| 2 | Right-click thumbnail at 5:00 | Zoom to 5:00-6:00 range, NO seek | ⚠️ Sometimes seeks |
| 3 | Click thumbnail while zoomed | Seeks within zoom range | ⚠️ Sometimes wrong target |
| 4 | Press Back while zoomed at 5:30 | Unzoom, stay at 5:30 | ⚠️ May jump |
| 5 | ⏪ button while zoomed | Shift zoom window left, NO seek | ⚠️ Inconsistent |
| 6 | Rapid click-click-click | Final seek wins | ⚠️ Race condition |
| 7 | Seek during stall | Resilience system recovers | ⚠️ May use stale intent |

---

## 8. Files Requiring Changes

| File | Change Type | Priority |
|------|-------------|----------|
| FitnessPlayerFooterSeekThumbnails.jsx | Major refactor | 🔴 Critical |
| SingleThumbnailButton.jsx | Separate zoom/seek paths | 🔴 Critical |
| FitnessPlayerFooterControls.jsx | Minor cleanup | 🟡 Medium |
| FitnessPlayerFooterSeekThumbnail.jsx | Simplify to dumb component | 🟡 Medium |
| FitnessPlayerFooterView.jsx | Clean up prop drilling | 🟢 Low |
| ProgressFrame.jsx | No changes needed | ✅ Done |

---

## 9. Immediate Quick Fixes (Before Full Refactor)

If you need to ship quickly:

### Fix A: Clear pendingTime on zoom change
```jsx
useEffect(() => {
  setPendingTime(null);
  awaitingSettleRef.current = false;
}, [zoomRange]);
```

### Fix B: Separate zoom/seek in SingleThumbnailButton
```jsx
const handlePointerDown = (e) => {
  if (isZoomTrigger(e)) {
    // ONLY zoom, do NOT call onSeek
    onZoom?.(btnRange);
    return;
  }
  // ONLY seek, zoom handler above handles zoom
  onSeek?.(resolveSeekTime(), resolveRangeAnchor());
};
```

### Fix C: Don't use displayTime for seek commits
```jsx
// In handleThumbnailSeek:
// DON'T: commit(resolvedTarget) where resolvedTarget derives from displayTime
// DO: commit(segmentStart) directly from thumbnail props
```

---

## 10. Conclusion

The FitnessPlayerFooter needs a **clean separation between seek operations and zoom navigation**. The current implementation conflates these concerns through shared state (`displayTime`, `pendingTime`) and side effects that trigger both behaviors.

**Recommended approach:** Extract state management into custom hooks, establish clear event boundaries, and make thumbnails stateless/dumb components that only emit events.

**Estimated refactor time:** 4-6 hours for full cleanup, or 1 hour for quick fixes (A, B, C above).
