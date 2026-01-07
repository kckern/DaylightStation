import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import useVoiceMemoRecorder from '../../FitnessSidebar/useVoiceMemoRecorder.js';
import { MicLevelIndicator } from '../primitives';
import { formatTime } from '../utils/time';
import './VoiceMemoModal.scss';

// Auto-accept countdown duration in milliseconds
const AUTO_ACCEPT_MS = 3000;

// SVG Icons
const Icons = {
  Close: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Stop: () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" ry="2" />
    </svg>
  ),
  Accept: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Redo: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
    </svg>
  ),
  Delete: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
};

/**
 * VoiceMemoModal - Unified voice memo recording and preview modal
 *
 * Two views:
 * 1. Recording View: Mic level bars, timer, stop button
 * 2. Preview View: Transcript, 3-second auto-accept countdown, accept/redo/delete buttons
 */
const VoiceMemoModal = ({
  context = 'fullscreen',
  open = false,
  onClose,
  onMemoSaved,
  sessionId,
  playerRef,
  pauseMusic,
  resumeMusic,
  preferredMicrophoneId,
  existingMemo
}) => {
  // View state: 'recording' | 'preview'
  const [view, setView] = useState('recording');
  const [micLevel, setMicLevel] = useState(0);
  const [capturedMemo, setCapturedMemo] = useState(null);
  const [autoAcceptProgress, setAutoAcceptProgress] = useState(0);
  const [autoAcceptCancelled, setAutoAcceptCancelled] = useState(false);

  // Refs
  const micLevelRafRef = useRef(null);
  const autoAcceptStartRef = useRef(null);
  const autoAcceptIntervalRef = useRef(null);
  const hasAutoStartedRef = useRef(false);
  const closeButtonRef = useRef(null);
  const stopButtonRef = useRef(null);

  // Handle memo captured from recorder
  const handleMemoCaptured = useCallback((memo) => {
    setCapturedMemo(memo);
    setView('preview');
    // Start auto-accept countdown
    setAutoAcceptProgress(0);
    setAutoAcceptCancelled(false);
    autoAcceptStartRef.current = Date.now();
  }, []);

  // Voice memo recorder hook
  const {
    isRecording,
    recordingDuration,
    uploading,
    error: recorderError,
    startRecording,
    stopRecording
  } = useVoiceMemoRecorder({
    sessionId,
    playerRef,
    preferredMicrophoneId,
    onMemoCaptured: handleMemoCaptured,
    onLevel: useCallback((level) => {
      if (micLevelRafRef.current) {
        cancelAnimationFrame(micLevelRafRef.current);
      }
      micLevelRafRef.current = requestAnimationFrame(() => {
        setMicLevel(Number.isFinite(level) ? level : 0);
      });
    }, [])
  });

  const isProcessing = uploading;

  // Cancel auto-accept on user interaction
  const handleUserInteraction = useCallback(() => {
    if (view === 'preview' && !autoAcceptCancelled) {
      setAutoAcceptCancelled(true);
      setAutoAcceptProgress(0);
      if (autoAcceptIntervalRef.current) {
        clearInterval(autoAcceptIntervalRef.current);
        autoAcceptIntervalRef.current = null;
      }
    }
  }, [view, autoAcceptCancelled]);

  // Accept memo and close
  const handleAccept = useCallback(() => {
    if (capturedMemo && onMemoSaved) {
      onMemoSaved(capturedMemo, existingMemo?.memoId || null);
    }
    onClose?.();
  }, [capturedMemo, existingMemo?.memoId, onMemoSaved, onClose]);

  // Redo recording
  const handleRedo = useCallback(() => {
    setCapturedMemo(null);
    setView('recording');
    setAutoAcceptProgress(0);
    setAutoAcceptCancelled(false);
    if (autoAcceptIntervalRef.current) {
      clearInterval(autoAcceptIntervalRef.current);
      autoAcceptIntervalRef.current = null;
    }
    // Start recording again
    startRecording();
  }, [startRecording]);

  // Delete memo and close
  const handleDelete = useCallback(() => {
    setCapturedMemo(null);
    onClose?.();
  }, [onClose]);

  // Close modal
  const handleClose = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }
    resumeMusic?.();
    onClose?.();
  }, [isRecording, stopRecording, resumeMusic, onClose]);

  // Auto-start recording when modal opens
  useEffect(() => {
    if (open && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      setView('recording');
      setCapturedMemo(null);
      setAutoAcceptProgress(0);
      setAutoAcceptCancelled(false);
      pauseMusic?.();
      // Small delay to ensure modal is mounted
      const timer = setTimeout(() => {
        startRecording();
      }, 100);
      return () => clearTimeout(timer);
    }
    if (!open) {
      hasAutoStartedRef.current = false;
    }
  }, [open, pauseMusic, startRecording]);

  // Auto-accept countdown
  useEffect(() => {
    if (view !== 'preview' || autoAcceptCancelled || !capturedMemo) {
      if (autoAcceptIntervalRef.current) {
        clearInterval(autoAcceptIntervalRef.current);
        autoAcceptIntervalRef.current = null;
      }
      return;
    }

    const startedAt = autoAcceptStartRef.current || Date.now();

    const update = () => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(1, elapsed / AUTO_ACCEPT_MS);
      setAutoAcceptProgress(progress);

      if (progress >= 1) {
        if (autoAcceptIntervalRef.current) {
          clearInterval(autoAcceptIntervalRef.current);
          autoAcceptIntervalRef.current = null;
        }
        handleAccept();
      }
    };

    update();
    autoAcceptIntervalRef.current = setInterval(update, 50);

    return () => {
      if (autoAcceptIntervalRef.current) {
        clearInterval(autoAcceptIntervalRef.current);
        autoAcceptIntervalRef.current = null;
      }
    };
  }, [view, autoAcceptCancelled, capturedMemo, handleAccept]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
      if (view === 'recording' && isRecording && (e.key === ' ' || e.key === 'Spacebar')) {
        e.preventDefault();
        stopRecording();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, view, isRecording, handleClose, stopRecording]);

  // Focus management
  useEffect(() => {
    if (!open) return;

    if (view === 'recording' && isRecording) {
      stopButtonRef.current?.focus?.();
    } else if (view === 'preview') {
      closeButtonRef.current?.focus?.();
    }
  }, [open, view, isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (micLevelRafRef.current) {
        cancelAnimationFrame(micLevelRafRef.current);
      }
      if (autoAcceptIntervalRef.current) {
        clearInterval(autoAcceptIntervalRef.current);
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  const recordingTimeLabel = formatTime(Math.floor(recordingDuration / 1000), { format: 'auto' });
  const transcript = capturedMemo?.transcriptClean || capturedMemo?.transcriptRaw || 'Transcription in progress...';
  const countdownSeconds = Math.ceil((1 - autoAcceptProgress) * AUTO_ACCEPT_MS / 1000);

  return (
    <div
      className={`voice-memo-modal voice-memo-modal--${context}`}
      onMouseMove={view === 'preview' ? handleUserInteraction : undefined}
      onTouchStart={view === 'preview' ? handleUserInteraction : undefined}
      onClick={view === 'preview' ? handleUserInteraction : undefined}
    >
      <div className="voice-memo-modal__backdrop" onClick={handleClose} />

      <div className="voice-memo-modal__panel">
        {/* Close button - always visible */}
        <button
          type="button"
          className="voice-memo-modal__close"
          onClick={handleClose}
          aria-label="Close"
          ref={closeButtonRef}
        >
          <Icons.Close />
        </button>

        {/* Recording View */}
        {view === 'recording' && (
          <div className="voice-memo-modal__recording">
            {/* Mic Level Indicator */}
            <div className="voice-memo-modal__level-container">
              <MicLevelIndicator
                level={(micLevel || 0) * 100}
                bars={7}
                orientation="horizontal"
                size="lg"
                variant="bars"
                activeColor="#ff6b6b"
                className="voice-memo-modal__mic-level"
              />
            </div>

            {/* Timer */}
            <div className="voice-memo-modal__timer">
              {isRecording ? recordingTimeLabel : (isProcessing ? 'Processing...' : '00:00')}
            </div>

            {/* Stop Button */}
            {isRecording && (
              <button
                type="button"
                className="voice-memo-modal__stop-btn"
                onClick={stopRecording}
                aria-label="Stop recording"
                ref={stopButtonRef}
              >
                <Icons.Stop />
              </button>
            )}

            {/* Processing Spinner */}
            {isProcessing && (
              <div className="voice-memo-modal__spinner" aria-label="Processing" />
            )}

            {/* Error Message */}
            {recorderError && (
              <div className="voice-memo-modal__error">
                {recorderError.message || 'Recording error'}
              </div>
            )}
          </div>
        )}

        {/* Preview View */}
        {view === 'preview' && (
          <div className="voice-memo-modal__preview">
            {/* Transcript */}
            <div className="voice-memo-modal__transcript">
              {transcript}
            </div>

            {/* Auto-accept countdown bar */}
            {!autoAcceptCancelled && (
              <div className="voice-memo-modal__countdown-container">
                <div
                  className="voice-memo-modal__countdown-bar"
                  style={{ transform: `scaleX(${autoAcceptProgress})` }}
                />
                <span className="voice-memo-modal__countdown-text">
                  Auto-saving in {countdownSeconds}s
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="voice-memo-modal__actions">
              <button
                type="button"
                className="voice-memo-modal__action-btn voice-memo-modal__action-btn--accept"
                onClick={handleAccept}
                aria-label="Accept"
                title="Accept"
              >
                <Icons.Accept />
              </button>
              <button
                type="button"
                className="voice-memo-modal__action-btn voice-memo-modal__action-btn--redo"
                onClick={handleRedo}
                aria-label="Redo"
                title="Redo"
              >
                <Icons.Redo />
              </button>
              <button
                type="button"
                className="voice-memo-modal__action-btn voice-memo-modal__action-btn--delete"
                onClick={handleDelete}
                aria-label="Delete"
                title="Delete"
              >
                <Icons.Delete />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Screen reader live region */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {view === 'recording' && isRecording && 'Recording in progress'}
        {view === 'recording' && isProcessing && 'Processing voice memo'}
        {view === 'preview' && 'Voice memo preview ready'}
      </div>
    </div>
  );
};

VoiceMemoModal.propTypes = {
  /** Presentation context/style */
  context: PropTypes.oneOf(['fullscreen', 'player', 'show']),
  /** Whether the modal is visible */
  open: PropTypes.bool,
  /** Called to close the modal */
  onClose: PropTypes.func,
  /** Called with saved memo and optional replacingMemoId */
  onMemoSaved: PropTypes.func,
  /** Fitness session ID */
  sessionId: PropTypes.string,
  /** Video player ref for pause/resume */
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  /** Function to pause background music */
  pauseMusic: PropTypes.func,
  /** Function to resume background music */
  resumeMusic: PropTypes.func,
  /** Preferred microphone device ID */
  preferredMicrophoneId: PropTypes.string,
  /** Existing memo if redoing */
  existingMemo: PropTypes.shape({
    memoId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    transcriptClean: PropTypes.string,
    transcriptRaw: PropTypes.string
  })
};

export default VoiceMemoModal;
