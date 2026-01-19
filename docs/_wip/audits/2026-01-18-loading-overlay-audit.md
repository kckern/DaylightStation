# Loading Overlay System Audit

**Date**: 2026-01-18
**Trigger**: Video loop overlay flash bug investigation
**Status**: As-Is documentation for optimization team

---

## Executive Summary

During investigation of a seemingly simple bug (overlay flashing during video loops), we uncovered significant architectural debt in the Player module's overlay system. The system has evolved organically with multiple overlapping mechanisms for the same concerns, inconsistent component integration, and workarounds layered on workarounds.

---

## Problem Statements

### 1. Duplicate Overlay Systems

**Finding**: Two independent loading overlay implementations exist and can render simultaneously.

| Component | Location | Rendered By | Control Mechanism |
|-----------|----------|-------------|-------------------|
| `LoadingOverlay` | `VideoPlayer.jsx:203-229` | VideoPlayer directly | Local state: `seconds === 0 && isPaused`, `isStalled`, `isSeeking`, `isAdapting` |
| `PlayerOverlayLoading` | `Player.jsx` | Parent Player component | `useMediaResilience` hook's `overlayProps` |

**Evidence**: Test output showed overlay with `parentClass: "player default"` (from Player.jsx), not VideoPlayer's overlay.

**Impact**:
- Conflicting visibility logic between parent and child
- Double rendering during edge cases
- Unclear which overlay is authoritative

---

### 2. Broken Component Integration Chain

**Finding**: `VideoPlayer` was not integrated with the parent's resilience system despite receiving the integration props.

```
Player.jsx
  └── passes resilienceBridge to SinglePlayer
        └── passes resilienceBridge to VideoPlayer
              └── IGNORED - VideoPlayer never used it
```

**Contrast with AudioPlayer**:
```javascript
// AudioPlayer.jsx - correctly uses resilienceBridge
} = useCommonMediaController({
  ...
  resilienceBridge,
  ...
});
```

```javascript
// VideoPlayer.jsx - was ignoring resilienceBridge entirely
} = useCommonMediaController({
  ...
  // resilienceBridge NOT passed
  ...
});
```

**Impact**:
- Parent's `useMediaResilience` had no access to video element
- Loop detection impossible without element access
- Diagnostics incomplete for video playback

---

### 3. Triplicate Stall Detection

**Finding**: Three independent systems detect playback stalls, with no clear hierarchy.

| System | Location | Mechanism |
|--------|----------|-----------|
| `useCommonMediaController` | `stallStateRef` | Timer-based with strategy pipeline (nudge, seekback, reload, softReinit) |
| `useMediaResilience` | `STATUS.stalling` | Progress token comparison + timer |
| `usePlaybackHealth` | `isWaiting`, `isStalledEvent` | DOM event listeners (waiting, stalled) |

**Data Flow Confusion**:
```
usePlaybackHealth → feeds → useMediaResilience
useCommonMediaController → has own stall state → exposes isStalled
useMediaResilience → accepts externalStalled → but also has internal detection
```

**Impact**:
- Stall states can disagree
- Recovery actions may conflict
- Debugging requires tracing through 3 systems

---

### 4. Media Element Access Fragmentation

**Finding**: Multiple mechanisms exist to access the underlying `<video>` element, with inconsistent implementations.

| Access Method | Location | Implementation |
|---------------|----------|----------------|
| `containerRef` | useCommonMediaController | Direct ref to element |
| `mediaAccess.getMediaEl()` | Player.jsx state | Registered by child via callback |
| `transportAdapter.getMediaEl()` | useMediaTransportAdapter | Tries mediaAccess, falls back to controllerRef.transport |
| Inline function | VideoPlayer.jsx LoadingOverlay | `containerRef.current?.shadowRoot?.querySelector('video')` |

**Shadow DOM Complexity**: For `<dash-video>` custom elements, the actual `<video>` is inside shadow DOM:
```javascript
// Some places check shadow DOM
el.shadowRoot?.querySelector('video') || el

// Other places don't
containerRef.current
```

**Impact**:
- `getMediaEl()` may return different elements depending on call site
- Shadow DOM access is inconsistent
- Loop property was set on one element but read from another (root cause of original bug)

---

### 5. Overlay Visibility Logic Complexity

**Finding**: `shouldShowOverlay` in `useMediaResilience` depends on 8+ interacting conditions.

```javascript
const shouldShowOverlay =
  !isLoopTransition && (           // Workaround added during this fix
    isStalled ||
    isRecovering ||
    (isStartup && !hasEverPlayedRef.current) ||
    isSeeking ||
    (isBuffering && !isBriefBuffering) ||  // Grace period workaround
    isUserPaused
  );
```

**Dependencies**:
- `isLoopTransition` - checks `mediaEl.loop` + `seconds < 1` + `hasEverPlayedRef`
- `isStalled` - either external or internal stall detection
- `isRecovering` - resilience state machine
- `isStartup` - resilience state machine
- `hasEverPlayedRef` - ref tracking first successful playback
- `isSeeking` - prop from parent
- `isBuffering` - from playbackHealth
- `isBriefBuffering` - grace period state (500ms timer)
- `bufferingPastGrace` - timer state
- `isUserPaused` - derived from isPaused + pauseIntent

**Impact**:
- Difficult to reason about when overlay will show
- Edge cases cause unexpected behavior
- Each new condition adds combinatorial complexity

---

### 6. Workarounds Documented During Fix

The following workarounds were added to fix the loop flash bug:

| Workaround | File | Purpose |
|------------|------|---------|
| `hasEverPlayedRef` | useMediaResilience.js | Track if video has ever played to distinguish initial load from loop |
| `bufferingPastGrace` + 500ms timer | useMediaResilience.js | Suppress overlay for brief buffering after playback started |
| `isBriefBuffering` calculation | useMediaResilience.js | Combine grace period with other conditions |
| `isLoopTransition` IIFE | useMediaResilience.js | Check `mediaEl.loop` synchronously during render |
| CSS transition-delay 300ms | PlayerOverlayLoading.jsx | Delay overlay appearance (still present, may be redundant now) |
| Media element registration | VideoPlayer.jsx | Register element so parent can access `loop` property |

---

### 7. Prop Threading Without Validation

**Finding**: Props are threaded through 3-4 component layers with no runtime validation that they're actually used.

```
Player.jsx (creates resilienceBridge)
  → SinglePlayer.jsx (threads through)
    → VideoPlayer.jsx (was ignoring until fix)
      → useCommonMediaController (also doesn't use it)
```

**No Static Analysis**:
- PropTypes exist but are optional and don't enforce usage
- No TypeScript to catch unused props
- `resilienceBridge` was silently ignored for unknown duration

---

### 8. Dual Overlay Rendering in VideoPlayer

**Finding**: `VideoPlayer.jsx` renders its own `LoadingOverlay` with different conditions than the parent's `PlayerOverlayLoading`.

```javascript
// VideoPlayer.jsx line 203
{((seconds === 0 && isPaused) || isStalled || isSeeking || isAdapting) && (
  <LoadingOverlay ... />
)}
```

```javascript
// Player.jsx via useMediaResilience
// Uses completely different calculation for shouldShowOverlay
```

**Impact**:
- Two overlays can show/hide independently
- Visual inconsistency during transitions
- `LoadingOverlay` vs `PlayerOverlayLoading` have different props and capabilities

---

## Architecture Diagram (As-Is)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Player.jsx                                                          │
│  ├── useMediaResilience ──→ overlayProps ──→ PlayerOverlayLoading   │
│  │     ├── uses transportAdapter.getMediaEl()                       │
│  │     ├── usePlaybackHealth (stall detection #1)                   │
│  │     └── internal stall detection (stall detection #2)            │
│  │                                                                  │
│  └── SinglePlayer.jsx                                               │
│        └── VideoPlayer.jsx                                          │
│              ├── useCommonMediaController                           │
│              │     └── stallStateRef (stall detection #3)           │
│              ├── LoadingOverlay (DUPLICATE OVERLAY)                 │
│              └── <video> / <dash-video> element                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Recommendations for Optimization Team

1. **Consolidate Overlays**: Choose one overlay system (likely `PlayerOverlayLoading` at parent level) and remove the duplicate.

2. **Unify Stall Detection**: Single source of truth for stall state, exposed consistently to all consumers.

3. **Standardize Media Element Access**: One canonical way to get the media element that handles shadow DOM consistently.

4. **Simplify Overlay Visibility**: Reduce boolean conditions; consider state machine approach.

5. **Remove Obsolete Workarounds**: After consolidation, audit which workarounds (grace periods, loop detection) are still needed.

6. **Add TypeScript**: Catch integration issues at compile time rather than runtime debugging.

7. **Document Component Contracts**: Clear interface definitions for what child components must provide to parent.

---

## Files Referenced

| File | Role |
|------|------|
| `frontend/src/modules/Player/Player.jsx` | Parent orchestrator, renders PlayerOverlayLoading |
| `frontend/src/modules/Player/components/VideoPlayer.jsx` | Video renderer, renders duplicate LoadingOverlay |
| `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx` | Parent's loading overlay |
| `frontend/src/modules/Player/components/LoadingOverlay.jsx` | VideoPlayer's loading overlay |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | Overlay visibility logic, stall detection |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | Media control, separate stall detection |
| `frontend/src/modules/Player/hooks/usePlaybackHealth.js` | DOM event-based health monitoring |
| `frontend/src/modules/Player/hooks/transport/useMediaTransportAdapter.js` | Media element access abstraction |
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | Props threading layer |

---

## Test Created

`tests/runtime/player/video-loop-overlay.runtime.test.mjs` - Playwright test that verifies overlay doesn't flash during seamless video loops.
