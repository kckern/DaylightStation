# Bug Report: Video Does Not Resume After Voice Memo Overlay Closes

## Summary

When a user opens the Voice Memo overlay during video playback, the video correctly pauses. However, when the overlay is closed (via X button, ESC, or auto-accept), **the video does NOT resume playback** - it remains paused indefinitely.

## Test Evidence

```
✓ Video playing: 3.52s → 5.56s, advancing=true
✓ Voice memo overlay opens
✓ Video paused state after overlay open: true
✓ Overlay closed
❌ Resume attempt 1: 5.64s → 5.64s, advancing=false, paused=true
❌ Resume attempt 2: 5.64s → 5.64s, advancing=false, paused=true
... (10 attempts, video never resumes)
```

## Root Cause

**`videoPlayerPaused` and `setVideoPlayerPaused` are defined in FitnessContext but NEVER EXPORTED in the context value object.**

### Code Analysis

#### 1. State is defined (line 89 of FitnessContext.jsx):
```jsx
const [videoPlayerPaused, setVideoPlayerPaused] = useState(false);
```

#### 2. FitnessContext internally uses it correctly:

**closeVoiceMemoOverlay** (line 645):
```jsx
setVideoPlayerPaused(false);  // Attempts to trigger resume
```

**openVoiceMemoCapture** (line 719):
```jsx
setVideoPlayerPaused(true);   // Works - pauses video
```

#### 3. FitnessPlayer tries to consume it (line 153-154):
```jsx
const {
  videoPlayerPaused,      // ← Gets undefined!
  setVideoPlayerPaused,   // ← Gets undefined!
  ...
} = useFitness() || {};
```

#### 4. Resume effect in FitnessPlayer depends on `videoPlayerPaused` (lines 401-420):
```jsx
useEffect(() => {
  if (!mediaElement) return;
  
  if (videoPlayerPaused) {          // Never true - videoPlayerPaused is undefined
    wasPlayingBeforeVoiceMemoRef.current = !mediaElement.paused;
    if (!mediaElement.paused) {
      mediaElement.pause();
    }
  } else if (wasPlayingBeforeVoiceMemoRef.current) {  // Never runs - condition fails
    wasPlayingBeforeVoiceMemoRef.current = false;
    if (mediaElement.paused) {
      mediaElement.play().catch(() => {});
    }
  }
}, [videoPlayerPaused, mediaElement]);
```

#### 5. Context value object (lines 1704-1870) - **MISSING the exports**:
```jsx
const value = {
  // ... many exports ...
  voiceMemoOverlayState,     // ← This IS exported
  // videoPlayerPaused,      // ← MISSING!
  // setVideoPlayerPaused,   // ← MISSING!
  // ...
};
```

## Why Pause Works But Resume Doesn't

**Pause path (works):**
1. `openVoiceMemoCapture` calls `setVideoPlayerPaused(true)` - internal state changes
2. `closeVoiceMemoOverlay` is called with state change callback that pauses

But wait - if `videoPlayerPaused` is undefined in FitnessPlayer, how does pause work?

Looking more closely at FitnessPlayer's pause logic (lines 404-410):
```jsx
if (videoPlayerPaused) {  // undefined is falsy - this branch NEVER runs!
```

**The pause that works is from a different mechanism!** The overlay itself must be pausing the video through another path (likely through the music player or a direct DOM manipulation).

Actually, reviewing again - the FitnessMusicPlayer has similar logic with `videoPlayerPaused` dependency, and also won't work since it's undefined.

**The actual pause mechanism** appears to be happening through `pauseMusicPlayer` and `resumeMusicPlayer` context functions, which are properly exported. But the VIDEO pause/resume relies on `videoPlayerPaused` which is not exported.

## Fix

Add `videoPlayerPaused` and `setVideoPlayerPaused` to the context value object in [FitnessContext.jsx#L1704](frontend/src/context/FitnessContext.jsx#L1704):

```jsx
const value = {
  // ... existing exports ...
  
  // Voice memo video pause control (BUG-08 fix)
  videoPlayerPaused,
  setVideoPlayerPaused,
  
  // ... rest of exports ...
};
```

### Location

Add after `voiceMemoOverlayState` export (around line 1739):

```diff
     voiceMemoOverlayState,
+    
+    // Voice memo video pause/resume control
+    videoPlayerPaused,
+    setVideoPlayerPaused,
     
     registerVideoPlayer,
```

## Impact

- **Affected**: Any FitnessPlayer video playback after voice memo interaction
- **Severity**: High - user must manually unpause video or refresh
- **Regression risk**: Low - this is adding missing exports, not changing behavior

## Test Command

```bash
npx playwright test tests/runtime/voice-memo/voice-memo-pause-resume.runtime.test.mjs --headed
```
