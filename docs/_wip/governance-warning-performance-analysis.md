# Performance Degradation Analysis: Governance Warning Overlay State

**Date**: January 5, 2026  
**Component**: `GovernanceStateOverlay.jsx` (Warning State)  
**Symptoms**: FPS drops in Player.jsx, WebcamView, and general UI sluggishness when `governance-warning-progress` overlay is active

---

## Executive Summary

When the governance warning overlay (`category: 'governance-warning-progress'`) is displayed, significant performance degradation occurs across the application. This analysis identifies **7 primary causes** and provides recommendations for each.

---

## 1. CSS `backdrop-filter: blur()` on Multiple Elements

### Problem
The SCSS file applies `backdrop-filter: blur()` to multiple stacked elements:

```scss
// GovernanceStateOverlay.scss
.governance-overlay__panel { backdrop-filter: blur(12px); }  // Line 19
.governance-progress-overlay__chip { backdrop-filter: blur(6px); }  // Line 429
.fitness-player-overlay__panel { backdrop-filter: blur(12px); }  // Line 509
```

**Impact**: `backdrop-filter` is GPU-intensive, especially with blur. When multiple elements stack with blur effects, the GPU must:
1. Render the background content
2. Apply Gaussian blur (multi-pass)
3. Composite each blurred layer

With video playback underneath, this creates a per-frame compositing cost that compounds.

### Recommendation
- Use solid/semi-transparent backgrounds instead of blur when overlay is active
- Add CSS `will-change: backdrop-filter` only if blur is essential
- Consider disabling blur during active video playback via conditional class

---

## 2. Frequent Re-renders from Prop Changes

### Problem
The warning overlay receives props that change frequently:

```jsx
// GovernanceStateOverlay.jsx - Line 17
const GovernanceWarningOverlay = ({ countdown, countdownTotal, offenders }) => {
  const remaining = Number.isFinite(countdown) ? Math.max(countdown, 0) : 0;
  const total = Number.isFinite(countdownTotal) ? Math.max(countdownTotal, 1) : 1;
  const progress = Math.max(0, Math.min(1, remaining / total));
```

The `countdown` prop updates frequently (likely every 100-500ms based on grace period implementation). Each update triggers:
- Full component re-render
- Inline style recalculation (`width: ${Math.round(progress * 100)}%`)
- DOM repaints

### Evidence from FitnessPlayerOverlay.jsx (Lines 197-230)
```jsx
const countdown = Number.isFinite(governanceState.countdownSecondsRemaining)
  ? governanceState.countdownSecondsRemaining
  : null;
```
This value comes from `governanceState` which is likely updated via WebSocket at high frequency.

### Recommendation
- Throttle countdown updates to 250ms minimum
- Use `React.memo()` with custom comparison for `GovernanceWarningOverlay`
- Move progress bar animation to CSS transitions instead of inline style changes

---

## 3. Complex `useMemo` Dependencies in Parent Components

### Problem
The `warningOffenders` computation in `FitnessPlayerOverlay.jsx` (Lines 491-545) runs expensive operations:

```jsx
const warningOffenders = useMemo(() => {
  // ...
  highlightList.forEach((rawName, idx) => {
    const normalized = normalizeName(rawName || String(idx));
    const participant = participantMap.get(normalized);
    const vitals = resolveParticipantVitals(canonicalName, participant);
    const progressEntry = getProgressEntry(vitals?.name || participant?.name);
    // ... more lookups per offender
  });
  return offenders;
}, [overlay, participantMap, zoneMetadata, userZoneProgress, resolveParticipantVitals]);
```

**Issues**:
1. `resolveParticipantVitals` is a callback that may change reference
2. `userZoneProgress` is a Map that updates frequently
3. `participantMap` rebuilds when participant list changes
4. Nested lookups inside forEach are O(n) per offender

### Recommendation
- Stabilize callback references with `useCallback` and proper deps
- Debounce `userZoneProgress` updates 
- Pre-compute offender data outside the render path

---

## 4. Audio Player Instance Per Overlay State

### Problem
```jsx
// GovernanceStateOverlay.jsx - Lines 340-351
const hiddenAudio = audioConfig ? (
  <div className="governance-overlay__audio" aria-hidden="true">
    <Player
      key={audioConfig.playerKey}
      playerType="governance-audio"
      ignoreKeys
      play={audioConfig.playPayload}
    />
  </div>
) : null;
```

A full `<Player>` component is instantiated for audio playback. Per `Player.jsx`:
- It includes media resilience hooks
- Playback session management
- Multiple `useEffect` and `useMemo` hooks
- Composite overlay handling

**Impact**: Every time the overlay status changes (`grey` → `yellow` → `red`), a new Player instance may mount/unmount.

### Recommendation
- Use a dedicated lightweight audio component instead of full Player
- Pre-mount audio elements and control via refs
- Consider `<audio>` element directly with `useRef`

---

## 5. CSS Transitions on Frequently Updated Properties

### Problem
```scss
// GovernanceStateOverlay.scss - Lines 219-222
.governance-lock__progress-fill {
  transition: width 0.3s ease-in-out;
  // ...
}

// Lines 227-231  
.governance-lock__progress-indicator {
  transition: left 0.3s ease-in-out, opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
}

// Lines 405-406
.governance-progress-overlay__fill {
  transition: width 0.25s ease;
  will-change: width;
}
```

When `countdown` updates rapidly, CSS transitions are triggered but may not complete before the next update, causing:
- Stacked animation frames
- Layout thrashing
- GPU memory pressure from incomplete transitions

### Recommendation
- Use `transform: scaleX()` instead of `width` for progress bars (GPU-accelerated)
- Increase transition duration or remove transitions for rapid updates
- Add `contain: layout` to progress containers

---

## 6. Excessive DOM Nodes in Offender Chips

### Problem
Each offender chip renders significant DOM:
```jsx
// GovernanceStateOverlay.jsx - Lines 22-61
{offenders.map((offender) => {
  return (
    <div className="governance-progress-overlay__chip" key={offender.key} style={borderStyle}>
      <div className="governance-progress-overlay__chip-main">
        <div className="governance-progress-overlay__chip-avatar" style={borderStyle}>
          <img src={offender.avatarSrc} alt="" onError={...} />
        </div>
        <div className="governance-progress-overlay__chip-text">
          <span className="governance-progress-overlay__chip-name">...</span>
          <span className="governance-progress-overlay__chip-meta">...</span>
        </div>
      </div>
      {percentValue != null ? (
        <div className="governance-progress-overlay__chip-progress">
          <div className="governance-progress-overlay__chip-progress-fill" style={{width, background}} />
        </div>
      ) : null}
    </div>
  );
})}
```

**Per offender**: ~8 DOM nodes + inline styles + event handler.

With 4+ offenders updating progress bars at 4-10Hz, this means:
- 32+ DOM nodes being styled per update
- Potential layout recalculation cascade

### Recommendation
- Virtualize offender list if count > 6
- Use CSS custom properties for dynamic values instead of inline styles
- Batch DOM updates with `requestAnimationFrame`

---

## 7. Competing Animation Loops

### Problem
Multiple systems run concurrent animation/polling loops:

| Component | Loop Type | Interval |
|-----------|-----------|----------|
| `FitnessPlayer.jsx:177` | `setInterval` (media element probe) | 500ms |
| `PlayerOverlayLoading.jsx:206` | `setInterval` (logging) | 1000ms |
| `useOverlayPresentation.js:142-150` | `requestAnimationFrame` | ~16ms |
| `usePlaybackHealth.js:345` | `setInterval` (frame polling) | Variable |
| `PoseDetectorService.js:249` | `requestAnimationFrame` | ~16ms |
| Webcam snapshots | `setInterval` | Configurable |

When governance overlay is active, these don't pause, creating:
- CPU contention
- Memory pressure from accumulated state
- GC pauses from temporary allocations

### Recommendation
- Implement a global "reduced activity" mode when overlay is blocking
- Pause non-essential loops when video is paused/locked
- Coordinate RAF loops through a single scheduler

---

## 8. Missing `React.memo` on Sub-components

### Problem
Neither `GovernanceWarningOverlay` nor `GovernancePanelOverlay` use `React.memo()`, causing full re-renders when parent state changes even if their props are unchanged.

### Recommendation
```jsx
const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ 
  countdown, countdownTotal, offenders 
}) {
  // ...
}, (prevProps, nextProps) => {
  // Custom comparison - skip re-render if countdown delta < 0.5s
  if (Math.abs((prevProps.countdown || 0) - (nextProps.countdown || 0)) < 0.5) {
    return prevProps.offenders === nextProps.offenders;
  }
  return false;
});
```

---

## ✅ COMPLETED: Backdrop Filter Optimization

**Status**: Implemented on 2026-01-05

Reduced from 3 `backdrop-filter` instances to 1:
- ✅ Kept: `.governance-overlay__panel` (main panel blur)
- ✅ Removed: `.governance-progress-overlay__chip` → increased opacity to 0.95
- ✅ Removed: `.fitness-player-overlay__panel` → increased opacity to 0.92

---

## Implementation Plan: Remaining Optimizations

### Phase 1: Low-Effort / High-Impact (Do First)

#### 1.1 Progress Bar GPU Optimization
**File**: `GovernanceStateOverlay.scss`  
**Effort**: 15 min | **Impact**: High

```scss
// BEFORE (causes layout recalc):
.governance-progress-overlay__fill {
  width: 0;
  transition: width 0.25s ease;
}

// AFTER (GPU-accelerated):
.governance-progress-overlay__fill {
  width: 100%;
  transform-origin: left;
  transform: scaleX(0);
  transition: transform 0.25s ease;
  will-change: transform;
}
```

**Also update JSX** in `GovernanceStateOverlay.jsx`:
```jsx
// Line 66 - Change from:
style={{ width: `${Math.round(progress * 100)}%` }}

// To:
style={{ transform: `scaleX(${progress})` }}
```

Same pattern for:
- `.governance-lock__progress-fill` (Line ~219)
- `.governance-progress-overlay__chip-progress-fill` (Line ~480)

---

#### 1.2 Add React.memo to Sub-components
**File**: `GovernanceStateOverlay.jsx`  
**Effort**: 20 min | **Impact**: Medium

```jsx
// Wrap GovernanceWarningOverlay (after line 71)
const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ 
  countdown, 
  countdownTotal, 
  offenders 
}) {
  // existing implementation
}, (prevProps, nextProps) => {
  // Skip re-render if countdown change is < 0.3s and offenders unchanged
  const countdownDelta = Math.abs((prevProps.countdown || 0) - (nextProps.countdown || 0));
  if (countdownDelta < 0.3 && prevProps.offenders === nextProps.offenders) {
    return true; // props are equal, skip re-render
  }
  return false;
});

// Wrap GovernancePanelOverlay similarly (after line 271)
const GovernancePanelOverlay = React.memo(function GovernancePanelOverlay({ 
  overlay, 
  lockRows 
}) {
  // existing implementation
});
```

---

#### 1.3 Add CSS Containment
**File**: `GovernanceStateOverlay.scss`  
**Effort**: 5 min | **Impact**: Medium

```scss
// Add to .governance-progress-overlay (around line 362)
.governance-progress-overlay {
  // ... existing styles
  contain: layout style;
}

// Add to .governance-overlay (line 1)
.governance-overlay {
  // ... existing styles
  contain: layout style;
}
```

---

### Phase 2: Medium-Effort / High-Impact

#### 2.1 Lightweight Audio Player
**File**: New file `GovernanceAudioPlayer.jsx`  
**Effort**: 45 min | **Impact**: Medium

Create a minimal audio component instead of full Player:

```jsx
// frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceAudioPlayer.jsx
import React, { useEffect, useRef } from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';

const AUDIO_TRACKS = {
  init: 'audio/sfx/bgmusic/fitness/start',
  locked: 'audio/sfx/bgmusic/fitness/locked'
};

const GovernanceAudioPlayer = React.memo(function GovernanceAudioPlayer({ 
  trackKey, 
  volume = 0.85 
}) {
  const audioRef = useRef(null);
  const currentTrackRef = useRef(null);

  useEffect(() => {
    if (!trackKey || !AUDIO_TRACKS[trackKey]) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      return;
    }

    const track = AUDIO_TRACKS[trackKey];
    if (currentTrackRef.current === track) return;
    
    currentTrackRef.current = track;
    const audio = audioRef.current;
    if (!audio) return;

    audio.src = DaylightMediaPath(`/media/${track}.mp3`);
    audio.volume = volume;
    audio.loop = true;
    audio.play().catch(() => {});

    return () => {
      audio.pause();
    };
  }, [trackKey, volume]);

  return <audio ref={audioRef} style={{ display: 'none' }} />;
});

export default GovernanceAudioPlayer;
```

Then update `GovernanceStateOverlay.jsx`:
```jsx
// Replace Player import with:
import GovernanceAudioPlayer from './GovernanceAudioPlayer.jsx';

// Replace hiddenAudio block with:
const audioTrackKey = useMemo(() => {
  if (!overlayShow || overlayCategory !== 'governance') return null;
  if (overlayStatus === 'grey') return 'init';
  if (overlayStatus === 'red') return 'locked';
  return null;
}, [overlayShow, overlayCategory, overlayStatus]);

// In render:
{audioTrackKey && <GovernanceAudioPlayer trackKey={audioTrackKey} />}
```

---

#### 2.2 Stabilize Callback References in FitnessPlayerOverlay
**File**: `FitnessPlayerOverlay.jsx`  
**Effort**: 30 min | **Impact**: High

```jsx
// Line ~370 - Wrap resolveParticipantVitals with stable deps
const resolveParticipantVitals = useCallback((candidateName, participant) => {
  // ... existing implementation
}, [getUserVitals]); // getUserVitals should be stable from context

// Line ~383 - Memoize getProgressEntry
const getProgressEntry = useCallback((name) => {
  if (!name) return null;
  if (progressLookup) return progressLookup.get(name) || null;
  if (userZoneProgress && typeof userZoneProgress === 'object') {
    return userZoneProgress[name] || null;
  }
  return null;
}, [progressLookup, userZoneProgress]);

// Consider extracting warningOffenders to a custom hook with internal throttling
```

---

### Phase 3: Higher-Effort / Future Optimization

#### 3.1 Throttle Governance State Updates
**File**: `FitnessContext.jsx` or governance state source  
**Effort**: 1-2 hours | **Impact**: High

```jsx
// Create a throttled governance state hook
import { useMemo, useRef, useEffect, useState } from 'react';

const useThrottledGovernanceState = (rawState, throttleMs = 200) => {
  const [throttledState, setThrottledState] = useState(rawState);
  const lastUpdateRef = useRef(0);
  const pendingRef = useRef(null);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;

    if (timeSinceLastUpdate >= throttleMs) {
      setThrottledState(rawState);
      lastUpdateRef.current = now;
    } else {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => {
        setThrottledState(rawState);
        lastUpdateRef.current = Date.now();
      }, throttleMs - timeSinceLastUpdate);
    }

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [rawState, throttleMs]);

  return throttledState;
};
```

---

#### 3.2 Coordinate Animation Loops (Global Scheduler)
**Effort**: 4+ hours | **Impact**: High (long-term)

This is an architectural change - consider for future sprint:
- Create `AnimationScheduler` service
- Components register their RAF/interval callbacks
- Scheduler pauses non-essential when overlay is blocking
- Single RAF loop dispatches to registered callbacks

---

## Execution Checklist

| # | Task | File(s) | Est. | Status |
|---|------|---------|------|--------|
| ✅ | Remove extra backdrop-filter | GovernanceStateOverlay.scss | 5m | Done |
| ✅ | Progress bar → transform:scaleX | GovernanceStateOverlay.scss, .jsx | 15m | Done |
| ✅ | Add React.memo to overlays | GovernanceStateOverlay.jsx | 20m | Done |
| ✅ | Add CSS containment | GovernanceStateOverlay.scss | 5m | Done |
| ✅ | Create lightweight audio player | GovernanceAudioPlayer.jsx | 45m | Done |
| ✅ | Stabilize callback refs | FitnessPlayerOverlay.jsx | 30m | Done |
| ✅ | Throttle governance updates | GovernanceEngine.js | 1-2h | Done |
| ✅ | Create test plan & tests | tests/runtime/governance/ | 30m | Done |
| ⬜ | Run tests & validate | Dev tools | 30m | |

---

## Diagnostic Tools

```javascript
// Add to dev console when overlay is active
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 16) {
      console.warn('Long task:', entry.duration.toFixed(2) + 'ms', entry);
    }
  }
});
observer.observe({ entryTypes: ['longtask'] });

// React DevTools: Enable "Highlight updates when components render"
// Chrome DevTools: Performance tab → Record during overlay transition
```

---

## Summary Priority Matrix

| Issue | Severity | Effort | Impact | Status |
|-------|----------|--------|--------|--------|
| CSS backdrop-filter | High | Low | High | ✅ Done |
| Progress bar width vs transform | High | Low | Medium | ⬜ Phase 1 |
| React.memo missing | Medium | Low | Medium | ⬜ Phase 1 |
| CSS containment | Low | Low | Medium | ⬜ Phase 1 |
| Audio Player overhead | Medium | Medium | Medium | ⬜ Phase 2 |
| Callback reference churn | Medium | Medium | High | ⬜ Phase 2 |
| Throttle state updates | Medium | High | High | ⬜ Phase 3 |
| Animation loop coordination | High | High | High | ⬜ Future |
