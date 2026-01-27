# Stall Detection Consolidation Design

**Date:** 2026-01-18
**Status:** Approved for implementation

## Goal

Consolidate three independent stall detection systems into one authoritative source, eliminating duplicate timers and conflicting detection logic.

## Current State (Problems)

1. **Three stall detection systems:**
   - `useCommonMediaController` - Timer-based (1.2s soft, 8s hard), executes recovery strategies
   - `useMediaResilience` - Progress token comparison, manages overlay visibility
   - `usePlaybackHealth` - DOM events + frame tracking, provides raw signals

2. **Duplicate timers:** Both useCommonMediaController and useMediaResilience run independent interval timers checking for stalls

3. **Potential timing conflicts:** Two systems detecting "stalled" independently can disagree

## Design

### Single Source of Truth

**useCommonMediaController** becomes the sole stall detector:
- Already has battle-tested thresholds (1.2s soft, 8s hard)
- Already executes recovery strategies
- Already provides `isStalled` to consumers

### What Gets Removed from useMediaResilience

```javascript
// DELETE: Progress token stall detection (~40 lines)
const progressToken = useRef(0);
const lastTimeRef = useRef(0);
const stallCountRef = useRef(0);
const [internalStalled, setInternalStalled] = useState(false);

const checkProgress = useCallback(() => {
  // ... stall detection logic
}, []);

useEffect(() => {
  const interval = setInterval(checkProgress, 500);
  return () => clearInterval(interval);
}, [checkProgress]);

// DELETE: Merge logic
const effectiveStalled = internalStalled || externalStalled;
```

### Data Flow After Consolidation

```
useCommonMediaController              useMediaResilience              PlayerOverlayLoading
──────────────────────               ─────────────────               ────────────────────

Timer-based stall detection           Overlay visibility logic        Pure presentation
  │                                     │                              │
  ├─ isStalled ────────────────────────►├─ shouldShowOverlay ─────────►├─ renders overlay
  │   (1.2s soft / 8s hard)             │   (single boolean)           │
  │                                     │                              │
  ├─ isSeeking ────────────────────────►├─ (factors into decision)     │
  │                                     │                              │
  ├─ seconds ──────────────────────────►├─ (startup detection)         │
  │                                     │                              │
  └─ isPaused ─────────────────────────►└─ pauseOverlayActive ────────►└─ showPauseIcon
```

### File Changes

| File | Action |
|------|--------|
| `useMediaResilience.js` | Remove internal stall detection (~50 lines deleted) |
| `Player.jsx` | Verify `isStalled` wiring to useMediaResilience |

### No Changes Needed

- `useCommonMediaController.js` - Already authoritative
- `usePlaybackHealth.js` - Provides raw signals, not stall decisions
- `PlayerOverlayLoading.jsx` - Already receives shouldShowOverlay from parent

### Net Result

- Single stall detection path (was 3)
- ~50 lines removed
- One fewer interval timer during playback
- useMediaResilience focuses on visibility decisions only

## Testing

**Automated:** Existing runtime tests cover video playback

**Manual verification:**
1. Buffering stall - overlay appears after ~1.2s
2. Seek stall - overlay during unbuffered seek
3. Startup - overlay until playback begins
4. Recovery - overlay hides when stall clears
