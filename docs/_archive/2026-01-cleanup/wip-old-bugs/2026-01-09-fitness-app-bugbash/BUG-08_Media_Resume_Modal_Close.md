# BUG-08: Media Resume on Modal Close

**Date Reported:** 2026-01-09  
**Category:** 🎙️ Feature: Voice Memo  
**Priority:** Medium  
**Status:** Open

---

## Summary

When the Voice Memo modal is closed/finished, the previous media (Music or Video) remains paused instead of resuming playback.

## Expected Behavior

If media was playing prior to the Voice Memo trigger, it should auto-resume immediately upon the modal closing.

## Current Behavior

After Voice Memo modal closes, video/music stays paused and user must manually resume playback.

---

## Technical Analysis

### Relevant Components

| File | Purpose |
|------|---------|
| [`VoiceMemoOverlay.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx) | Voice memo recording overlay |
| [`FitnessPlayer.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayer.jsx) | Video player with playback control |
| [`FitnessMusicPlayer.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx) | Music player component |
| [`pauseArbiter.js`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Player/utils/pauseArbiter.js) | Pause reason management |

### Root Cause

The system likely pauses media when voice memo starts (to avoid recording background audio), but doesn't track the "was playing" state to restore afterward.

In `FitnessPlayer.jsx`, there's a pause arbiter system:
```javascript
import { resolvePause, PAUSE_REASON } from '../Player/utils/pauseArbiter.js';
```

This system manages pause reasons but may not have a corresponding "voice_memo" reason that auto-clears on modal close.

### Expected Flow

```
1. User is watching video (playing)
2. User taps Voice Memo button
3. System records: wasPlaying = true
4. System pauses video with reason: PAUSE_REASON.VOICE_MEMO
5. Voice Memo overlay opens
6. User records and finishes
7. Modal closes
8. System clears PAUSE_REASON.VOICE_MEMO
9. Since wasPlaying was true, resume playback
```

---

## Recommended Fix

### Option A: Pause Arbiter Integration (Preferred)

Add voice memo as a tracked pause reason:

```javascript
// In pauseArbiter.js - add new reason
export const PAUSE_REASON = {
  USER: 'user',
  GOVERNANCE: 'governance',
  VOICE_MEMO: 'voice_memo',  // ← Add this
  // ... other reasons
};
```

Update VoiceMemoOverlay to manage pause state:

```javascript
// In VoiceMemoOverlay.jsx
import { addPauseReason, removePauseReason, PAUSE_REASON } from '../../Player/utils/pauseArbiter.js';

useEffect(() => {
  if (overlayState?.open) {
    // Pause media when overlay opens
    addPauseReason(PAUSE_REASON.VOICE_MEMO);
  }
  
  return () => {
    // Remove pause reason when overlay closes
    removePauseReason(PAUSE_REASON.VOICE_MEMO);
  };
}, [overlayState?.open]);
```

### Option B: Explicit Play State Tracking

Track and restore play state explicitly:

```javascript
// In VoiceMemoOverlay.jsx or context
const wasPlayingRef = useRef(false);

const handleOverlayOpen = useCallback(() => {
  // Check if media was playing
  wasPlayingRef.current = playerRef.current?.isPlaying?.() ?? false;
  
  if (wasPlayingRef.current) {
    playerRef.current?.pause?.();
  }
}, [playerRef]);

const handleOverlayClose = useCallback(() => {
  if (wasPlayingRef.current) {
    // Restore playback
    playerRef.current?.play?.();
    wasPlayingRef.current = false;
  }
  onClose?.();
}, [playerRef, onClose]);
```

### Option C: Event-Based Resume

Emit events for media control:

```javascript
// On voice memo start
window.dispatchEvent(new CustomEvent('voice-memo:start', { 
  detail: { source: 'video' } // or 'music'
}));

// On voice memo end
window.dispatchEvent(new CustomEvent('voice-memo:end', { 
  detail: { shouldResume: true }
}));

// In FitnessPlayer.jsx - listen for resume signal
useEffect(() => {
  const handleVoiceMemoEnd = (event) => {
    if (event.detail.shouldResume && pendingResumeRef.current) {
      playerRef.current?.play?.();
    }
  };
  
  window.addEventListener('voice-memo:end', handleVoiceMemoEnd);
  return () => window.removeEventListener('voice-memo:end', handleVoiceMemoEnd);
}, []);
```

---

## Files to Modify

1. **Primary**: [`VoiceMemoOverlay.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx) - Add pause/resume logic on open/close
2. **Optional**: [`pauseArbiter.js`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Player/utils/pauseArbiter.js) - Add VOICE_MEMO pause reason
3. **Consider**: Both video and music player components need to respond to resume signal

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Video playing → Voice Memo → Close | Video resumes |
| Video paused → Voice Memo → Close | Video stays paused |
| Music playing → Voice Memo → Close | Music resumes |
| Both video & music → Voice Memo | Resume both (or primary only?) |
| Voice memo canceled | Resume media |
| Voice memo error | Resume media |

---

## Verification Steps

1. Start video playback in Fitness Player
2. Tap Voice Memo button
3. Verify video pauses (audio shouldn't be in recording)
4. Complete or cancel the voice memo
5. Verify video automatically resumes
6. Repeat test with music player active
7. Test with video initially paused (should stay paused after memo)

---

## Related Audio Concerns

The original pause may exist to prevent audio bleed into voice recording. Verify:
- Recording quality is not affected by resume timing
- Resume happens after recording is fully stopped (no audio capture of resumed media)

Consider a small delay (200-500ms) before resume:
```javascript
const handleOverlayClose = () => {
  setTimeout(() => {
    if (wasPlayingRef.current) {
      playerRef.current?.play?.();
    }
  }, 300); // Allow audio system to fully stop recording
};
```

---

*For testing, assign to: QA Team*  
*For development, assign to: Frontend Team*
