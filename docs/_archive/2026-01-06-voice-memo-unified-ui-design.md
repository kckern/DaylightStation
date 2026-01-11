# Voice Memo Unified UI Design

**Date:** 2026-01-06
**Status:** Approved
**Related code:** `frontend/src/hooks/fitness/VoiceMemoManager.js`, `frontend/src/modules/Fitness/`

## Overview

Unify the voice memo recording experience across the Fitness app with a consistent, minimal UI optimized for quick gym note-taking (weights, reps, feelings, maxes).

## Use Case

Quick micro-notes during active exercise - not long reflections. Examples:
- "135 pounds, 8 reps, felt strong"
- "Maxed out on last set"
- "Increase weight next time"

## Architecture

### Component Structure

```
VoiceMemoModal (new unified component)
├── RecordingView (minimal: level bars, timer, stop)
├── PreviewView (transcript, accept/redo/delete, 3s countdown)
└── Adapts presentation based on context prop
```

### Context Modes

| Context | Trigger | Appearance |
|---------|---------|------------|
| `fullscreen` | FAB in corner | Centered overlay on video |
| `player` | Sidebar button (existing) | Slide-in panel in sidebar area |
| `show` | Button near poster/title | Modal dialog |

### Media Pause Behavior

When recording starts:
1. Pause video player
2. Pause music player
3. Store "was playing" state for both
4. On recording end: restore previous play state

## UI Flow

### Step 1: Trigger

**Fullscreen mode:**
- FAB appears in bottom-right corner
- Simple mic icon, subtle until tapped
- Single tap → immediately start recording

**Player sidebar:**
- Existing button location (near screenshot button)
- Tap → start recording

**FitnessShow (episode browser):**
- Small mic icon button near show poster OR in header
- Only visible when `fitnessSessionInstance?.isActive` is true
- Tap → open modal and start recording

### Step 2: Recording View

```
┌─────────────────────────────┐
│                         [X] │  ← Skip/close always visible
│                             │
│     ████ ██ ████ ██ ███     │  ← Mic level bars (animated)
│                             │
│          0:03               │  ← Timer (seconds)
│                             │
│         [ ■ ]               │  ← Stop button (large, red)
│                             │
└─────────────────────────────┘
```

**Behavior:**
- Video pauses, music pauses (store previous state)
- Mic level bars animate in real-time
- Timer counts up
- Tap stop OR tap anywhere outside → stop recording
- ESC key → stop recording

### Step 3: Preview View

```
┌─────────────────────────────┐
│                         [X] │  ← Skip/close always visible
│                             │
│  "135 pounds, 8 reps,       │  ← Transcript text
│   felt strong"              │
│                             │
│  ┌───────────────────────┐  │
│  │ ████████░░░░░░░░░░░░░ │  │  ← Auto-accept countdown (3s)
│  └───────────────────────┘  │
│                             │
│   [✓]      [↺]      [🗑]    │  ← Accept / Redo / Delete
│                             │
└─────────────────────────────┘
```

**Behavior:**
- Transcript appears immediately (or "Transcribing..." if async)
- 3-second auto-accept countdown bar fills left-to-right
- Any interaction cancels auto-accept
- **Accept**: Save memo, close modal, restore video/music playback
- **Redo**: Return to Recording View, replace this memo
- **Delete**: Discard memo, close modal, restore playback

### Step 4: Post-Video Prompt

- Trigger after **8+ minute sessions** with no memos recorded
- Same modal UI with prompt: "Add a note about this workout?"
- Skip (X) always available

## Technical Changes

### New Files

| File | Purpose |
|------|---------|
| `VoiceMemoModal.jsx` | Unified component for all voice memo UI |
| `VoiceMemoModal.scss` | Styles for unified component |

### Modified Files

| File | Change |
|------|--------|
| `useVoiceMemoRecorder.js` | Fix `onLevel` callback, ensure Web Audio analyzer connected |
| `FitnessPlayer.jsx` | Pause video/music on record, add FAB for fullscreen mode |
| `FitnessMusicPlayer.jsx` | Expose pause/resume API for voice memo coordination |
| `FitnessShow.jsx` | Add mic button when session active |
| `FitnessContext.jsx` | Coordinate voice memo state, provide `openVoiceMemoModal()` |
| Config/constants | Change threshold from 900s (15min) to 480s (8min) |

### Deprecated Files

| File | Replacement |
|------|-------------|
| `FitnessVoiceMemoStandalone.jsx` | `VoiceMemoModal` |
| `VoiceMemoOverlay.jsx` | `VoiceMemoModal` |

### Kept Unchanged

| File | Reason |
|------|--------|
| `VoiceMemoManager.js` | Core memo storage logic - no changes needed |

## MicLevelIndicator Fix

Current `MicLevelIndicator` component isn't displaying. Investigation needed:

1. Check if `onLevel` callback passed to `useVoiceMemoRecorder`
2. Verify Web Audio analyzer is connected and firing
3. Trace prop drilling from recorder hook → modal → indicator
4. Check CSS visibility rules

## Success Criteria

- [ ] Single unified UI component for all voice memo interactions
- [ ] Mic level bars visibly animate during recording
- [ ] Video AND music pause during recording
- [ ] 3-second auto-accept with cancel on interaction
- [ ] Skip (X) always visible
- [ ] FAB trigger in fullscreen mode
- [ ] Button trigger in FitnessShow when session active
- [ ] Post-video prompt at 8 minutes (down from 15)
- [ ] Old components deprecated and removed
