# Overlay Consolidation Design

**Date:** 2026-01-18
**Status:** Approved for implementation

## Goal

Consolidate two independent loading overlay systems into one, eliminating duplicate rendering and conflicting visibility logic.

## Current State (Problems)

1. **Two overlay components:**
   - `LoadingOverlay` (545 lines) - rendered by VideoPlayer
   - `PlayerOverlayLoading` (306 lines) - rendered by Player.jsx

2. **Two visibility decisions:**
   - VideoPlayer: `(seconds === 0 && isPaused) || isStalled || isSeeking || isAdapting`
   - useMediaResilience: 8+ interacting boolean conditions

3. **Conflicting behavior:** Both can show/hide independently, causing visual inconsistency.

## Design

### Component Responsibilities

| Component | After Consolidation |
|-----------|---------------------|
| VideoPlayer | Renders video element, reports state via `onPlaybackMetrics()` |
| useMediaResilience | Single source of truth for `shouldShowOverlay` |
| PlayerOverlayLoading | Pure presentation - renders what parent tells it |

### Data Flow

```
VideoPlayer                    Player.jsx                     PlayerOverlayLoading
───────────                    ──────────                     ────────────────────

useCommonMediaController       useMediaResilience             Pure presentation
  │                              │                              │
  ├─ isStalled ────────────────►├─ shouldShowOverlay ─────────►├─ shouldRender
  ├─ isSeeking ────────────────►├─ isVisible ─────────────────►├─ isVisible
  ├─ seconds ──────────────────►├─ pauseOverlayActive ────────►├─ showPauseIcon
  ├─ isPaused ─────────────────►├─ status ────────────────────►├─ status
  │                              │                              │
  └─ via onPlaybackMetrics() ───┘                              └─ renders overlay
```

### PlayerOverlayLoading Enhancements

1. **Pause icon support:** Show pause icon when user-paused, spinner when loading
2. **Debug-only diagnostics:** Buffer analysis, dropped frames enabled via prop or `window.PLAYER_DEBUG_OVERLAY`

### File Changes

| File | Action |
|------|--------|
| `PlayerOverlayLoading.jsx` | Add pause icon, debug diagnostics (~30 lines) |
| `VideoPlayer.jsx` | Remove LoadingOverlay render (~25 lines deleted) |
| `lib/mediaDiagnostics.js` | NEW - Extract diagnostic utilities (~110 lines) |
| `LoadingOverlay.jsx` | DELETE after extraction |

### Net Result

- Single overlay system (was 2)
- Single visibility decision point
- ~400 lines net reduction
- Debug diagnostics available when needed
- Pause icon preserved

## Testing

- Existing runtime tests verify video playback
- Manual verification: overlay during buffering, pause icon when paused
