# Voice Memo Unified UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify voice memo recording UI with consistent mic level feedback, FAB trigger, and 8-minute threshold.

**Architecture:** Create VoiceMemoModal as single unified component replacing VoiceMemoOverlay and FitnessVoiceMemoStandalone. Fix mic level data flow, add FAB to fullscreen, mic button to FitnessShow, pause music during recording.

**Tech Stack:** React, Web Audio API (AudioContext/AnalyserNode), MediaRecorder API

---

## Task 1: Fix MicLevelIndicator Data Flow

The MicLevelIndicator component exists and is properly wired, but CSS visibility issues prevent it from displaying.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.scss`

**Step 1: Add visibility test**

Add temporary test styles to verify component renders:

```scss
// In VoiceMemoOverlay.scss, find .voice-memo-overlay__mic-level
.voice-memo-overlay__mic-level {
  // Ensure visibility
  display: flex !important;
  visibility: visible !important;
  opacity: 1 !important;
  min-height: 40px;
  margin: 1rem 0;
}
```

**Step 2: Test recording**

Run: Start a fitness session, open voice memo redo, verify mic level bars animate
Expected: Bars should animate during recording

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.scss
git commit -m "fix(voice-memo): ensure MicLevelIndicator visibility"
```

---

## Task 2: Create VoiceMemoModal Component

**Files:**
- Create: `frontend/src/modules/Fitness/shared/VoiceMemoModal/VoiceMemoModal.jsx`
- Create: `frontend/src/modules/Fitness/shared/VoiceMemoModal/VoiceMemoModal.scss`
- Create: `frontend/src/modules/Fitness/shared/VoiceMemoModal/index.js`

**Step 1: Create directory and index**

```bash
mkdir -p frontend/src/modules/Fitness/shared/VoiceMemoModal
```

**Step 2: Create VoiceMemoModal.jsx**

```jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import useVoiceMemoRecorder from '../../FitnessSidebar/useVoiceMemoRecorder.js';
import { MicLevelIndicator } from '../primitives';
import { formatTime } from '../utils/time';
import './VoiceMemoModal.scss';

const AUTO_ACCEPT_MS = 3000;

const Icons = {
  Close: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Stop: () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ),
  Accept: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Redo: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
    </svg>
  ),
  Delete: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
};

/**
 * VoiceMemoModal - Unified voice memo recording UI
 *
 * @param {string} context - 'fullscreen' | 'player' | 'show'
 * @param {boolean} open - Whether modal is open
 * @param {function} onClose - Called when modal should close
 * @param {function} onMemoSaved - Called with memo when saved
 * @param {string} sessionId - Current fitness session ID
 * @param {object} playerRef - Ref to video player for pause/resume
 * @param {function} pauseMusic - Function to pause music player
 * @param {function} resumeMusic - Function to resume music player
 * @param {string} preferredMicrophoneId - Preferred mic device ID
 * @param {object} existingMemo - If redoing, the memo being replaced
 */
const VoiceMemoModal = ({
  context = 'player',
  open,
  onClose,
  onMemoSaved,
  sessionId,
  playerRef,
  pauseMusic,
  resumeMusic,
  preferredMicrophoneId,
  existingMemo = null,
}) => {
  const [view, setView] = useState('recording'); // 'recording' | 'preview'
  const [micLevel, setMicLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [autoAcceptProgress, setAutoAcceptProgress] = useState(0);
  const [autoAcceptCancelled, setAutoAcceptCancelled] = useState(false);
  const autoAcceptStartRef = useRef(null);
  const savedMemoRef = useRef(null);
  const wasVideoPlayingRef = useRef(false);
  const wasMusicPlayingRef = useRef(false);

  const handleMemoCaptured = useCallback((memo) => {
    savedMemoRef.current = memo;
    setTranscript(memo?.transcriptClean || memo?.transcriptRaw || 'Transcription in progress...');
    setView('preview');
    setAutoAcceptCancelled(false);
    autoAcceptStartRef.current = Date.now();
  }, []);

  const {
    isRecording,
    recordingDuration,
    uploading,
    error,
    startRecording,
    stopRecording,
  } = useVoiceMemoRecorder({
    sessionId,
    playerRef,
    preferredMicrophoneId,
    onMemoCaptured: handleMemoCaptured,
    onLevel: useCallback((level) => {
      setMicLevel(Number.isFinite(level) ? level : 0);
    }, []),
  });

  // Pause video and music when recording starts
  useEffect(() => {
    if (open && isRecording) {
      // Pause music
      if (typeof pauseMusic === 'function') {
        wasMusicPlayingRef.current = true;
        pauseMusic();
      }
    }
  }, [open, isRecording, pauseMusic]);

  // Resume music when modal closes
  useEffect(() => {
    if (!open && wasMusicPlayingRef.current) {
      if (typeof resumeMusic === 'function') {
        resumeMusic();
      }
      wasMusicPlayingRef.current = false;
    }
  }, [open, resumeMusic]);

  // Auto-start recording when modal opens
  useEffect(() => {
    if (open && view === 'recording' && !isRecording && !uploading) {
      startRecording();
    }
  }, [open, view, isRecording, uploading, startRecording]);

  // Auto-accept countdown
  useEffect(() => {
    if (view !== 'preview' || autoAcceptCancelled) {
      setAutoAcceptProgress(0);
      return;
    }
    const startTime = autoAcceptStartRef.current || Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / AUTO_ACCEPT_MS);
      setAutoAcceptProgress(progress);
      if (progress >= 1) {
        clearInterval(interval);
        handleAccept();
      }
    }, 50);
    return () => clearInterval(interval);
  }, [view, autoAcceptCancelled]);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setView('recording');
      setMicLevel(0);
      setTranscript('');
      setAutoAcceptProgress(0);
      setAutoAcceptCancelled(false);
      savedMemoRef.current = null;
    }
  }, [open]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
      if (e.key === ' ' && isRecording) {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isRecording, stopRecording]);

  const handleClose = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }
    onClose?.();
  }, [isRecording, stopRecording, onClose]);

  const handleAccept = useCallback(() => {
    if (savedMemoRef.current) {
      onMemoSaved?.(savedMemoRef.current, existingMemo?.memoId);
    }
    onClose?.();
  }, [onMemoSaved, onClose, existingMemo]);

  const handleRedo = useCallback(() => {
    setView('recording');
    setAutoAcceptCancelled(false);
    savedMemoRef.current = null;
    startRecording();
  }, [startRecording]);

  const handleDelete = useCallback(() => {
    savedMemoRef.current = null;
    onClose?.();
  }, [onClose]);

  const handleUserInteraction = useCallback(() => {
    if (!autoAcceptCancelled && view === 'preview') {
      setAutoAcceptCancelled(true);
      setAutoAcceptProgress(0);
    }
  }, [autoAcceptCancelled, view]);

  if (!open) return null;

  const durationLabel = formatTime(Math.floor(recordingDuration / 1000), { format: 'auto' });

  return (
    <div
      className={`voice-memo-modal voice-memo-modal--${context}`}
      onMouseMove={handleUserInteraction}
      onTouchStart={handleUserInteraction}
    >
      <div className="voice-memo-modal__backdrop" onClick={handleClose} />
      <div className="voice-memo-modal__panel">
        {/* Always visible close button */}
        <button
          type="button"
          className="voice-memo-modal__close"
          onClick={handleClose}
          aria-label="Close"
        >
          <Icons.Close />
        </button>

        {view === 'recording' && (
          <div className="voice-memo-modal__recording">
            {/* Mic level indicator */}
            <MicLevelIndicator
              level={(micLevel || 0) * 100}
              bars={7}
              orientation="horizontal"
              size="lg"
              variant="waveform"
              activeColor="#ff6b6b"
              className="voice-memo-modal__mic-level"
            />

            {/* Timer */}
            <div className="voice-memo-modal__timer">
              {isRecording ? durationLabel : (uploading ? 'Processing...' : '0:00')}
            </div>

            {/* Stop button */}
            {isRecording && (
              <button
                type="button"
                className="voice-memo-modal__stop-btn"
                onClick={stopRecording}
                aria-label="Stop recording"
              >
                <Icons.Stop />
              </button>
            )}

            {uploading && (
              <div className="voice-memo-modal__spinner" />
            )}

            {error && (
              <div className="voice-memo-modal__error">{error.message}</div>
            )}
          </div>
        )}

        {view === 'preview' && (
          <div className="voice-memo-modal__preview">
            {/* Transcript */}
            <div className="voice-memo-modal__transcript">
              {transcript}
            </div>

            {/* Auto-accept countdown bar */}
            {!autoAcceptCancelled && (
              <div className="voice-memo-modal__countdown">
                <div
                  className="voice-memo-modal__countdown-bar"
                  style={{ transform: `scaleX(${autoAcceptProgress})` }}
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="voice-memo-modal__actions">
              <button
                type="button"
                className="voice-memo-modal__action voice-memo-modal__action--accept"
                onClick={handleAccept}
                aria-label="Accept"
              >
                <Icons.Accept />
              </button>
              <button
                type="button"
                className="voice-memo-modal__action voice-memo-modal__action--redo"
                onClick={handleRedo}
                aria-label="Redo"
              >
                <Icons.Redo />
              </button>
              <button
                type="button"
                className="voice-memo-modal__action voice-memo-modal__action--delete"
                onClick={handleDelete}
                aria-label="Delete"
              >
                <Icons.Delete />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

VoiceMemoModal.propTypes = {
  context: PropTypes.oneOf(['fullscreen', 'player', 'show']),
  open: PropTypes.bool,
  onClose: PropTypes.func,
  onMemoSaved: PropTypes.func,
  sessionId: PropTypes.string,
  playerRef: PropTypes.object,
  pauseMusic: PropTypes.func,
  resumeMusic: PropTypes.func,
  preferredMicrophoneId: PropTypes.string,
  existingMemo: PropTypes.object,
};

export default VoiceMemoModal;
```

**Step 3: Create VoiceMemoModal.scss**

```scss
.voice-memo-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;

  &__backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
  }

  &__panel {
    position: relative;
    background: var(--fitness-panel-bg, #1a1a1a);
    border-radius: 12px;
    padding: 2rem;
    min-width: 300px;
    max-width: 400px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  &__close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: transparent;
    border: none;
    color: var(--fitness-text-muted, #888);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 50%;
    transition: background 0.2s, color 0.2s;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--fitness-text, #fff);
    }
  }

  &__recording {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding-top: 1rem;
  }

  &__mic-level {
    width: 100%;
    min-height: 60px;
  }

  &__timer {
    font-size: 2rem;
    font-weight: 600;
    color: var(--fitness-text, #fff);
    font-variant-numeric: tabular-nums;
  }

  &__stop-btn {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #dc3545;
    border: none;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, background 0.2s;

    &:hover {
      background: #c82333;
      transform: scale(1.05);
    }

    &:active {
      transform: scale(0.95);
    }
  }

  &__spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--fitness-accent, #4dabf7);
    border-radius: 50%;
    animation: voice-memo-spin 0.8s linear infinite;
  }

  &__error {
    color: #dc3545;
    font-size: 0.875rem;
    text-align: center;
  }

  &__preview {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding-top: 1rem;
  }

  &__transcript {
    font-size: 1.125rem;
    color: var(--fitness-text, #fff);
    line-height: 1.5;
    text-align: center;
    min-height: 3em;
  }

  &__countdown {
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  &__countdown-bar {
    height: 100%;
    background: var(--fitness-accent, #4dabf7);
    transform-origin: left;
    transition: transform 0.05s linear;
  }

  &__actions {
    display: flex;
    justify-content: center;
    gap: 1rem;
  }

  &__action {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, background 0.2s;

    &:hover {
      transform: scale(1.1);
    }

    &--accept {
      background: #28a745;
      color: white;
    }

    &--redo {
      background: #6c757d;
      color: white;
    }

    &--delete {
      background: #dc3545;
      color: white;
    }
  }

  // Context-specific styles
  &--fullscreen {
    .voice-memo-modal__panel {
      background: rgba(26, 26, 26, 0.95);
    }
  }

  &--player {
    .voice-memo-modal__backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
  }

  &--show {
    .voice-memo-modal__panel {
      max-width: 350px;
    }
  }
}

@keyframes voice-memo-spin {
  to {
    transform: rotate(360deg);
  }
}
```

**Step 4: Create index.js**

```javascript
export { default as VoiceMemoModal } from './VoiceMemoModal';
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/shared/VoiceMemoModal/
git commit -m "feat(voice-memo): add VoiceMemoModal unified component"
```

---

## Task 3: Add Music Player Pause/Resume API

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Read FitnessMusicPlayer to understand current API**

```bash
# Check current implementation
grep -n "pause\|play" frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx | head -20
```

**Step 2: Add pause/resume methods to FitnessMusicPlayer**

In FitnessMusicPlayer.jsx, expose imperative methods via useImperativeHandle:

```jsx
// Add at top of component
const FitnessMusicPlayer = React.forwardRef(({ ... }, ref) => {
  // ... existing code ...

  // Expose pause/resume to parent
  React.useImperativeHandle(ref, () => ({
    pause: () => {
      // Store was-playing state
      audioRef.current?.pause();
    },
    resume: () => {
      audioRef.current?.play();
    },
    isPlaying: () => !audioRef.current?.paused,
  }), []);

  // ... rest of component
});
```

**Step 3: Add musicPlayerRef to FitnessContext**

In FitnessContext.jsx:

```jsx
// Add ref
const musicPlayerRef = useRef(null);

// Add to context value
const value = {
  // ... existing ...
  musicPlayerRef,
  pauseMusicPlayer: () => musicPlayerRef.current?.pause?.(),
  resumeMusicPlayer: () => musicPlayerRef.current?.resume?.(),
};
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx frontend/src/context/FitnessContext.jsx
git commit -m "feat(music): expose pause/resume API for voice memo coordination"
```

---

## Task 4: Add FAB Trigger in Fullscreen Mode

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.scss`

**Step 1: Add FAB component and state**

In FitnessPlayer.jsx, add the mic FAB when in fullscreen:

```jsx
// Add import
import { VoiceMemoModal } from './shared/VoiceMemoModal';

// Add state
const [voiceMemoModalOpen, setVoiceMemoModalOpen] = useState(false);

// Add FAB JSX (inside fullscreen container, near other controls)
{isFullscreen && fitnessSessionInstance?.isActive && (
  <button
    type="button"
    className="fitness-player__voice-memo-fab"
    onClick={() => setVoiceMemoModalOpen(true)}
    aria-label="Record voice memo"
  >
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  </button>
)}

{/* VoiceMemoModal */}
<VoiceMemoModal
  context="fullscreen"
  open={voiceMemoModalOpen}
  onClose={() => setVoiceMemoModalOpen(false)}
  onMemoSaved={(memo, replacingMemoId) => {
    if (replacingMemoId) {
      replaceVoiceMemoInSession(replacingMemoId, memo);
    } else {
      addVoiceMemoToSession(memo);
    }
  }}
  sessionId={fitnessSessionInstance?.sessionId}
  playerRef={playerRef}
  pauseMusic={pauseMusicPlayer}
  resumeMusic={resumeMusicPlayer}
  preferredMicrophoneId={preferredMicrophoneId}
/>
```

**Step 2: Add FAB styles**

In FitnessPlayer.scss:

```scss
.fitness-player__voice-memo-fab {
  position: absolute;
  bottom: 6rem;
  right: 2rem;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(8px);
  transition: background 0.2s, transform 0.2s;
  z-index: 100;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx frontend/src/modules/Fitness/FitnessPlayer.scss
git commit -m "feat(voice-memo): add FAB trigger in fullscreen mode"
```

---

## Task 5: Add Mic Button to FitnessShow

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessShow.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessShow.scss`

**Step 1: Add mic button near show title when session active**

In FitnessShow.jsx:

```jsx
// Add import
import { VoiceMemoModal } from './shared/VoiceMemoModal';

// Add state
const [voiceMemoOpen, setVoiceMemoOpen] = useState(false);

// Get session instance from context
const {
  fitnessSessionInstance,
  addVoiceMemoToSession,
  pauseMusicPlayer,
  resumeMusicPlayer,
  preferredMicrophoneId,
} = fitnessContext;

// Add mic button next to show title (inside show-title-row div)
<div className="show-title-row">
  <h1 className="show-title">{info.title}</h1>
  {isGovernedShow && (
    <span className="governed-lock-icon" title="Governed content">🔒</span>
  )}
  {fitnessSessionInstance?.isActive && (
    <button
      type="button"
      className="show-voice-memo-btn"
      onClick={() => setVoiceMemoOpen(true)}
      aria-label="Record voice memo"
      title="Record voice memo"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  )}
</div>

{/* Add modal at end of component */}
<VoiceMemoModal
  context="show"
  open={voiceMemoOpen}
  onClose={() => setVoiceMemoOpen(false)}
  onMemoSaved={(memo) => addVoiceMemoToSession?.(memo)}
  sessionId={fitnessSessionInstance?.sessionId}
  pauseMusic={pauseMusicPlayer}
  resumeMusic={resumeMusicPlayer}
  preferredMicrophoneId={preferredMicrophoneId}
/>
```

**Step 2: Add mic button styles**

In FitnessShow.scss:

```scss
.show-voice-memo-btn {
  margin-left: 0.75rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  color: var(--fitness-text-muted, #888);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
    color: var(--fitness-text, #fff);
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessShow.jsx frontend/src/modules/Fitness/FitnessShow.scss
git commit -m "feat(voice-memo): add mic button to FitnessShow when session active"
```

---

## Task 6: Change Threshold from 15 Minutes to 8 Minutes

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx`

**Step 1: Find and update threshold**

In FitnessPlayer.jsx line ~788, change default from 900 to 480:

```javascript
// Before:
const threshold = plexConfig?.voice_memo_prompt_threshold_seconds ?? 900;

// After:
const threshold = plexConfig?.voice_memo_prompt_threshold_seconds ?? 480;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "feat(voice-memo): reduce prompt threshold from 15 to 8 minutes"
```

---

## Task 7: Integrate VoiceMemoModal into Existing Voice Memo Flow

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessVoiceMemo.jsx`

**Step 1: Update FitnessPlayerOverlay to use new modal for redo mode**

The existing VoiceMemoOverlay can stay for list/review modes, but redo should use the new modal. Or we can gradually migrate.

For now, keep VoiceMemoOverlay for backwards compatibility but add VoiceMemoModal for new trigger points (FAB, FitnessShow).

**Step 2: Update FitnessVoiceMemo sidebar button to use new modal**

In FitnessVoiceMemo.jsx, option to use VoiceMemoModal instead of openVoiceMemoRedo:

```jsx
// The existing button can stay using openVoiceMemoRedo(null) for now
// Future: migrate to VoiceMemoModal
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx frontend/src/modules/Fitness/FitnessSidebar/FitnessVoiceMemo.jsx
git commit -m "refactor(voice-memo): integrate VoiceMemoModal with existing flow"
```

---

## Task 8: Test and Verify

**Step 1: Manual testing checklist**

1. Start a fitness session with video
2. Test FAB in fullscreen:
   - [ ] FAB appears in bottom-right when fullscreen
   - [ ] Tapping FAB opens VoiceMemoModal
   - [ ] Video pauses during recording
   - [ ] Music pauses during recording
   - [ ] Mic level bars animate
   - [ ] Timer counts up
   - [ ] Stop button stops recording
   - [ ] Preview shows transcript
   - [ ] 3-second countdown appears
   - [ ] Accept/Redo/Delete buttons work
   - [ ] X close button always visible
   - [ ] ESC key closes modal

3. Test FitnessShow mic button:
   - [ ] Button only appears when session is active
   - [ ] Button opens VoiceMemoModal
   - [ ] Recording works correctly

4. Test 8-minute threshold:
   - [ ] Play 8+ minute video without recording
   - [ ] Post-video prompt appears

**Step 2: Commit documentation**

```bash
git add docs/_wip/plans/2026-01-06-voice-memo-unified-ui-implementation.md
git commit -m "docs: add voice memo implementation plan"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Fix MicLevelIndicator visibility | VoiceMemoOverlay.scss |
| 2 | Create VoiceMemoModal component | VoiceMemoModal.jsx, .scss, index.js |
| 3 | Add music player pause/resume API | FitnessMusicPlayer.jsx, FitnessContext.jsx |
| 4 | Add FAB trigger in fullscreen | FitnessPlayer.jsx, .scss |
| 5 | Add mic button to FitnessShow | FitnessShow.jsx, .scss |
| 6 | Change threshold to 8 minutes | FitnessPlayer.jsx |
| 7 | Integrate with existing flow | FitnessPlayerOverlay.jsx, FitnessVoiceMemo.jsx |
| 8 | Test and verify | Manual testing |

**Deprecated after migration complete:**
- `FitnessVoiceMemoStandalone.jsx`
- `VoiceMemoOverlay.jsx` (can remain for list/review modes initially)
