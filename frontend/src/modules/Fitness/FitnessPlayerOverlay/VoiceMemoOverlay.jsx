import React, { useMemo, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import PropTypes from 'prop-types';
import useVoiceMemoRecorder from '../FitnessSidebar/useVoiceMemoRecorder.js';
import { MicLevelIndicator, CountdownRing } from '../shared';
import { formatTime } from '../shared/utils/time';
import './VoiceMemoOverlay.scss';
import { playbackLog } from '../../Player/lib/playbackLogger.js';
import { getDaylightLogger } from '../../../lib/logging/singleton.js';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';

// Auto-accept countdown for review mode
const VOICE_MEMO_AUTO_ACCEPT_MS = 8000;

const Icons = {
  Review: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  ),
  Redo: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
    </svg>
  ),
  Delete: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  ),
  Keep: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  ),
  Close: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  ),
  Record: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="22"></line>
      <line x1="8" y1="22" x2="16" y2="22"></line>
    </svg>
  ),
  Stop: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect>
    </svg>
  ),
  Processing: () => (
    <svg className="voice-memo-overlay__processing-spinner" width="48" height="48" viewBox="0 0 48 48" fill="none">
      {/* Animated sound wave bars */}
      <rect className="voice-memo-overlay__wave-bar voice-memo-overlay__wave-bar--1" x="8" y="16" width="4" height="16" rx="2" fill="currentColor" />
      <rect className="voice-memo-overlay__wave-bar voice-memo-overlay__wave-bar--2" x="16" y="12" width="4" height="24" rx="2" fill="currentColor" />
      <rect className="voice-memo-overlay__wave-bar voice-memo-overlay__wave-bar--3" x="24" y="8" width="4" height="32" rx="2" fill="currentColor" />
      <rect className="voice-memo-overlay__wave-bar voice-memo-overlay__wave-bar--4" x="32" y="12" width="4" height="24" rx="2" fill="currentColor" />
      <rect className="voice-memo-overlay__wave-bar voice-memo-overlay__wave-bar--5" x="40" y="16" width="4" height="16" rx="2" fill="currentColor" />
    </svg>
  )
};

// Legacy formatTime wrapper for backward compatibility
const formatTimeLocal = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00';
  return formatTime(seconds, { format: 'auto' });
};

const formatMemoTimestamp = (memo) => {
  if (!memo) return '';
  if (memo.sessionElapsedSeconds != null) {
    return formatTimeLocal(Math.max(0, Math.round(memo.sessionElapsedSeconds)));
  }
  if (memo.createdAt) {
    try {
      const dt = new Date(memo.createdAt);
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }
  return '';
};

const VoiceMemoOverlay = ({
  overlayState,
  voiceMemos,
  onClose,
  onOpenReview,
  onOpenList,
  onOpenRedo,
  onRemoveMemo,
  onAddMemo,
  onReplaceMemo,
  sessionId,
  playerRef,
  preferredMicrophoneId
}) => {
  const fitnessCtx = useFitnessContext();
  const pauseMusicPlayer = fitnessCtx?.pauseMusicPlayer;
  const resumeMusicPlayer = fitnessCtx?.resumeMusicPlayer;

  const logVoiceMemo = useCallback((event, payload = {}, options = {}) => {
    playbackLog('voice-memo', {
      event,
      ...payload
    }, {
      level: options.level || 'info',
      context: {
        source: 'VoiceMemoOverlay',
        sessionId: sessionId || null,
        ...(options.context || {})
      },
      tags: options.tags || undefined
    });
  }, [sessionId]);

  const sortedMemos = useMemo(() => {
    return voiceMemos.slice().sort((a, b) => {
      const aValue = a?.createdAt ?? (a?.sessionElapsedSeconds != null ? a.sessionElapsedSeconds * 1000 : 0);
      const bValue = b?.createdAt ?? (b?.sessionElapsedSeconds != null ? b.sessionElapsedSeconds * 1000 : 0);
      return Number(bValue) - Number(aValue);
    });
  }, [voiceMemos]);

  const currentMemo = useMemo(() => {
    if (!overlayState?.memoId) return null;
    const targetId = String(overlayState.memoId);
    return voiceMemos.find((memo) => memo && String(memo.memoId) === targetId) || null;
  }, [overlayState?.memoId, voiceMemos]);

  const [autoAcceptProgress, setAutoAcceptProgress] = useState(0);
  // Fix 6 (bugbash 4C.5): Track if user cancelled auto-accept via interaction
  const [autoAcceptCancelled, setAutoAcceptCancelled] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micLevelRafRef = React.useRef(null);
  const closeButtonRef = React.useRef(null);
  const recordButtonRef = React.useRef(null);
  const autoStartRef = React.useRef(false);
  const overlayRef = React.useRef(null);
  const panelRef = React.useRef(null);

  const handleClose = useCallback(() => {
    logVoiceMemo('overlay-close-request', { mode: overlayState?.mode, memoId: overlayState?.memoId });
    // If closing during review mode, discard the pending memo
    if (overlayState?.mode === 'review' && overlayState?.memoId) {
      logVoiceMemo('overlay-close-discard', { memoId: overlayState.memoId });
      onRemoveMemo?.(overlayState.memoId);
    }
    onClose?.();
  }, [logVoiceMemo, onClose, onRemoveMemo, overlayState?.mode, overlayState?.memoId]);

  const handleAccept = useCallback(() => {
    logVoiceMemo('overlay-accept', { memoId: overlayState?.memoId || null });
    onClose?.();
  }, [logVoiceMemo, onClose, overlayState?.memoId]);

  // Fix 6 (bugbash 4C.5): Cancel auto-accept countdown on any user interaction
  const handleUserInteraction = useCallback(() => {
    if (overlayState?.autoAccept && !autoAcceptCancelled) {
      setAutoAcceptCancelled(true);
      setAutoAcceptProgress(0);
      if (process.env.NODE_ENV === 'development') {
        console.log('[VoiceMemo] Auto-accept cancelled by user interaction');
      }
    }
  }, [overlayState?.autoAccept, autoAcceptCancelled]);

  const handleReviewSelect = useCallback((memoRef) => {
    if (!memoRef) return;
    logVoiceMemo('overlay-select-review', { memoId: memoRef.memoId || null });
    onOpenReview?.(memoRef, { autoAccept: false });
  }, [logVoiceMemo, onOpenReview]);

  const handleRedo = useCallback((memoId) => {
    if (!memoId) return;
    logVoiceMemo('overlay-redo-request', { memoId });
    onOpenRedo?.(memoId);
  }, [logVoiceMemo, onOpenRedo]);

  const handleDelete = useCallback(() => {
    const memoId = overlayState?.memoId;
    if (!memoId) return;
    logVoiceMemo('overlay-delete-request', { memoId });
    onRemoveMemo?.(memoId);
    const remaining = voiceMemos.filter((memo) => memo && String(memo.memoId) !== String(memoId)).length;
    if (remaining <= 0) {
      onClose?.();
    } else if (overlayState.mode !== 'list') {
      onOpenList?.();
    }
  }, [logVoiceMemo, overlayState?.memoId, overlayState?.mode, voiceMemos, onRemoveMemo, onClose, onOpenList]);

  const handleDeleteFromList = useCallback((memoId) => {
    if (!memoId) return;
    logVoiceMemo('overlay-delete-from-list', { memoId });
    onRemoveMemo?.(memoId);
    const remaining = voiceMemos.filter((memo) => memo && String(memo.memoId) !== String(memoId)).length;
    if (remaining <= 0) {
      onClose?.();
    }
  }, [logVoiceMemo, onRemoveMemo, voiceMemos, onClose]);

  const handleRedoCaptured = useCallback((memo) => {
    if (!memo) {
      logVoiceMemo('overlay-redo-cancel');
      onClose?.();
      return;
    }

    // Check if transcript indicates no meaningful content - auto-redo
    const transcript = (memo.transcriptClean || memo.transcriptRaw || '').trim().toLowerCase();
    if (transcript === 'no memo' || transcript === 'no memo.') {
      logVoiceMemo('overlay-redo-auto-retry', { reason: 'no-memo-transcript', memoId: memo.memoId || null });
      // Reset state so recording auto-starts again
      autoStartRef.current = false;
      setRecorderState('idle');
      // Stay in redo mode - recording will auto-start via useLayoutEffect
      return;
    }

    const targetId = overlayState?.memoId;
    logVoiceMemo('overlay-redo-captured', { memoId: targetId || memo.memoId || null });
    const stored = targetId ? (onReplaceMemo?.(targetId, memo) || memo) : (onAddMemo?.(memo) || memo);
    const nextTarget = stored || memo;
    if (nextTarget) {
      // 4C: Pass fromRecording: true to enable auto-accept for post-recording review
      onOpenReview?.(nextTarget, { autoAccept: true, fromRecording: true });
    } else {
      onClose?.();
    }
  }, [logVoiceMemo, overlayState?.memoId, onReplaceMemo, onAddMemo, onOpenReview, onClose]);

  const [recorderState, setRecorderState] = useState('idle'); // idle|recording|processing|ready|error
  const {
    isRecording,
    recordingDuration,
    uploading,
    error: recorderError,
    setError: setRecorderError,
    startRecording,
    stopRecording
  } = useVoiceMemoRecorder({
    sessionId,
    playerRef,
    preferredMicrophoneId,
    onMemoCaptured: handleRedoCaptured,
    onStateChange: setRecorderState,
    onLevel: useCallback((level) => {
      if (micLevelRafRef.current) {
        cancelAnimationFrame(micLevelRafRef.current);
      }
      micLevelRafRef.current = requestAnimationFrame(() => {
        setMicLevel(Number.isFinite(level) ? level : 0);
      });
    }, []),
    onPauseMusic: pauseMusicPlayer,
    onResumeMusic: resumeMusicPlayer
  });

  const isProcessing = uploading || recorderState === 'processing';
  const recorderErrorMessage = typeof recorderError === 'string' ? recorderError : recorderError?.message;
  const recorderErrorRetryable = recorderError?.retryable !== false;
  const isRecorderErrored = recorderState === 'error' || Boolean(recorderError);

  const handleStartRedoRecording = useCallback(() => {
    setRecorderError(null);
    setRecorderState('recording');
    logVoiceMemo('overlay-redo-start-recording', { memoId: overlayState?.memoId || null });
    startRecording();
  }, [logVoiceMemo, overlayState?.memoId, setRecorderError, setRecorderState, startRecording]);

  useEffect(() => {
    // Fix 6 (bugbash 4C.5): Don't run countdown if cancelled by user
    if (!overlayState?.open || overlayState.mode !== 'review' || !overlayState.autoAccept || autoAcceptCancelled) {
      setAutoAcceptProgress(0);
      return undefined;
    }
    const startedAt = overlayState.startedAt || Date.now();
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const progress = Math.max(0, Math.min(1, elapsed / VOICE_MEMO_AUTO_ACCEPT_MS));
      setAutoAcceptProgress(progress);
      if (progress >= 1 && !cancelled) {
        cancelled = true;
        logVoiceMemo('overlay-auto-accept', { memoId: overlayState?.memoId || null });
        handleAccept();
      }
    };
    update();
    const interval = setInterval(update, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [overlayState?.open, overlayState?.mode, overlayState?.autoAccept, overlayState?.startedAt, handleAccept, autoAcceptCancelled, logVoiceMemo]);

  useEffect(() => {
    if (!overlayState?.open) {
      setAutoAcceptProgress(0);
      setMicLevel(0);
      setAutoAcceptCancelled(false); // Fix 6: Reset cancelled flag when overlay closes
    }
  }, [overlayState?.open]);

  // DEBUG: Log xywh of overlay and panel
  useEffect(() => {
    if (!overlayState?.open) return;
    const logger = getDaylightLogger();
    const logDimensions = () => {
      const overlay = overlayRef.current;
      const panel = panelRef.current;
      if (overlay) {
        const rect = overlay.getBoundingClientRect();
        logger.info('voice-memo-overlay-dimensions', {
          element: 'overlay',
          mode: overlayState?.mode,
          x: rect.x.toFixed(1),
          y: rect.y.toFixed(1),
          width: rect.width.toFixed(1),
          height: rect.height.toFixed(1)
        });
      }
      if (panel) {
        const rect = panel.getBoundingClientRect();
        logger.info('voice-memo-panel-dimensions', {
          element: 'panel',
          mode: overlayState?.mode,
          x: rect.x.toFixed(1),
          y: rect.y.toFixed(1),
          width: rect.width.toFixed(1),
          height: rect.height.toFixed(1)
        });
      }
    };
    // Log after render settles
    const timeout = setTimeout(logDimensions, 100);
    return () => clearTimeout(timeout);
  }, [overlayState?.open, overlayState?.mode]);

  useEffect(() => {
    if (overlayState?.mode !== 'redo' && isRecording) {
      stopRecording();
    }
  }, [overlayState?.mode, isRecording, stopRecording]);

  useEffect(() => {
    if (overlayState?.mode !== 'redo') {
      setRecorderError(null);
    }
  }, [overlayState?.mode, setRecorderError]);

  // Auto-start recording for fresh redo captures (no memo id yet)
  useLayoutEffect(() => {
    if (!overlayState?.open || overlayState.mode !== 'redo') {
      autoStartRef.current = false;
      return;
    }
    // Auto-start recording in redo mode (whether new capture or redoing existing memo)
    if (!isRecording && !isProcessing && !isRecorderErrored && !autoStartRef.current) {
      autoStartRef.current = true;
      handleStartRedoRecording();
    }
  }, [overlayState?.open, overlayState?.mode, isRecording, isProcessing, isRecorderErrored, handleStartRedoRecording]);

  useEffect(() => {
    if (!overlayState?.open) return;
    // Keep the overlay mounted; list should only open explicitly.
  }, [overlayState?.open]);

  useEffect(() => {
    if (overlayState?.mode === 'redo' && isProcessing) {
      // keep overlay pinned; ensure recorder state reflects processing
      setRecorderState('processing');
    }
    if (overlayState?.mode !== 'redo' && recorderState !== 'idle' && recorderState !== 'ready') {
      setRecorderState('idle');
    }
  }, [overlayState?.mode, isProcessing, recorderState]);

  useEffect(() => () => {
    if (micLevelRafRef.current) {
      cancelAnimationFrame(micLevelRafRef.current);
    }
  }, []);

  // Focus management on mode change
  useEffect(() => {
    if (!overlayState?.open) return;
    if (overlayState.mode === 'redo') {
      // Focus record button when not recording, close button when recording (since stop button removed)
      const target = isRecording ? closeButtonRef.current : recordButtonRef.current;
      target?.focus?.();
    } else if (overlayState.mode === 'review' || overlayState.mode === 'list') {
      closeButtonRef.current?.focus?.();
    }
  }, [overlayState?.open, overlayState?.mode, isRecording]);

  // Handle backdrop click (click outside panel to close)
  const handleBackdropClick = useCallback((e) => {
    // Stop propagation to prevent triggering fullscreen toggle on player underneath
    e.stopPropagation();
    // Only close if clicking directly on backdrop, not on panel or its children
    if (e.target === overlayRef.current) {
      handleClose();
    }
  }, [handleClose]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!overlayState?.open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
      if (overlayState.mode === 'redo' && isRecording && (e.key === ' ' || e.key === 'Spacebar')) {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlayState?.open, overlayState?.mode, isRecording, handleClose, stopRecording]);

  if (!overlayState?.open) {
    return null;
  }

  const mode = overlayState.mode || 'list';
  const showList = mode === 'list';
  const showReview = mode === 'review';
  const showRedo = mode === 'redo';
  const titleText = showList
    ? 'Voice Memos'
    : showRedo
      ? (overlayState.memoId ? 'Record Voice Memo' : 'Voice Memo')
      : 'Voice Memo Review';

  const transcript = currentMemo?.transcriptClean || currentMemo?.transcriptRaw || 'Transcription in progress…';
  const memoTimestamp = currentMemo ? formatMemoTimestamp(currentMemo) : '';
  const memoVideoTimestamp = currentMemo?.videoTimeSeconds != null
    ? formatTimeLocal(Math.max(0, Math.round(currentMemo.videoTimeSeconds)))
    : '';
  const recordingTimeLabel = formatTimeLocal(Math.max(0, Math.floor(recordingDuration / 1000)));
  const displayTranscript = showRedo
    ? (isRecording || (!isProcessing && !isRecording) ? 'Recording…' : 'Processing voice memo…')
    : (showReview && !currentMemo ? 'Finalizing memo…' : transcript);
  const hasMemoId = Boolean(currentMemo?.memoId || overlayState?.memoId);
  const memoTitle = currentMemo?.title || currentMemo?.name || currentMemo?.label || '';
  const micLabel = preferredMicrophoneId ? `Mic: ${preferredMicrophoneId}` : '';

  return (
    <div
      ref={overlayRef}
      className={`voice-memo-overlay voice-memo-overlay--${mode}`}
      onClick={handleBackdropClick}
      onMouseMove={handleUserInteraction}
      onTouchStart={handleUserInteraction}
      onKeyDown={handleUserInteraction}
    >
      <div ref={panelRef} className="voice-memo-overlay__panel">
        <div className="voice-memo-overlay__header">
          <div className="voice-memo-overlay__title">{titleText}</div>
          <button type="button" className="voice-memo-overlay__close" onClick={handleClose} aria-label="Close voice memo overlay" ref={closeButtonRef}>
            <Icons.Close />
          </button>
        </div>

        {showList ? (
          <div className="voice-memo-overlay__content">
            {sortedMemos.length === 0 ? (
              <div className="voice-memo-overlay__empty">No memos yet.</div>
            ) : (
              <ul className="voice-memo-overlay__list">
                {sortedMemos.map((memo) => {
                  const memoId = memo?.memoId;
                  if (!memoId) return null;
                  const timeLabel = formatMemoTimestamp(memo);
                  const memoTranscript = memo.transcriptClean || memo.transcriptRaw || 'Transcription in progress…';
                  return (
                    <li className="voice-memo-overlay__list-item" key={memoId}>
                      <div className="voice-memo-overlay__list-body">
                        <div className="voice-memo-overlay__meta">{timeLabel || 'Recorded memo'}</div>
                        <div className="voice-memo-overlay__transcript">{memoTranscript}</div>
                      </div>
                      <div className="voice-memo-overlay__list-actions">
                        <button type="button" className="voice-memo-overlay__icon-btn voice-memo-overlay__icon-btn--redo" onClick={() => handleRedo(memoId)} title="Redo">
                          <Icons.Redo />
                        </button>
                        <button type="button" className="voice-memo-overlay__icon-btn voice-memo-overlay__icon-btn--delete" onClick={() => handleDeleteFromList(memoId)} title="Delete">
                          <Icons.Delete />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {showReview ? (
          <div className="voice-memo-overlay__content voice-memo-overlay__content--review">
            <div className="voice-memo-overlay__transcript voice-memo-overlay__transcript--large">{displayTranscript}</div>
            <div className="voice-memo-overlay__actions">
              <button 
                type="button" 
                className={`voice-memo-overlay__icon-btn voice-memo-overlay__icon-btn--keep ${overlayState.autoAccept ? 'voice-memo-overlay__icon-btn--auto-accept' : ''}`}
                onClick={handleAccept} 
                title={overlayState.autoAccept ? `Auto-saving in ${Math.ceil((1 - autoAcceptProgress) * VOICE_MEMO_AUTO_ACCEPT_MS / 1000)}s` : 'Keep'}
              >
                <Icons.Keep />
                {overlayState.autoAccept && (
                  <div 
                    className="voice-memo-overlay__auto-accept-bar" 
                    style={{ transform: `scaleX(${autoAcceptProgress})` }}
                  />
                )}
              </button>
              <button
                type="button"
                className="voice-memo-overlay__icon-btn voice-memo-overlay__icon-btn--redo"
                onClick={() => handleRedo(currentMemo?.memoId || overlayState?.memoId)}
                title="Redo"
                disabled={!hasMemoId}
              >
                <Icons.Redo />
              </button>
              <button
                type="button"
                className="voice-memo-overlay__icon-btn voice-memo-overlay__icon-btn--delete"
                onClick={handleDelete}
                title="Delete"
                disabled={!hasMemoId}
              >
                <Icons.Delete />
              </button>
            </div>
          </div>
        ) : null}

        {showRedo ? (
          <div className="voice-memo-overlay__content voice-memo-overlay__content--centered">
            {isProcessing ? (
              <div className="voice-memo-overlay__processing">
                <Icons.Processing />
                <span className="voice-memo-overlay__processing-text">Transcribing…</span>
              </div>
            ) : (
              <>
                <span className="voice-memo-overlay__prompt">
                  {overlayState?.fromFitnessVideoEnd ? 'How did it go?' : 'How is it going?'}
                </span>

                <MicLevelIndicator
                  level={(micLevel || 0) * 100}
                  bars={7}
                  orientation="horizontal"
                  size="lg"
                  variant="waveform"
                  activeColor="#ff6b6b"
                  className="voice-memo-overlay__mic-level"
                />

                {recorderErrorMessage ? <div className="voice-memo-overlay__error">{recorderErrorMessage}</div> : null}

                <div className="voice-memo-overlay__redo-controls">
                  {!isRecording && !isRecorderErrored ? (
                    <button
                      type="button"
                      className="voice-memo-overlay__record-btn"
                      onClick={handleStartRedoRecording}
                      aria-label="Start recording"
                      ref={recordButtonRef}
                    >
                      <Icons.Record />
                    </button>
                  ) : null}

                  {isRecording ? (
                    <>
                      <div className="voice-memo-overlay__recording-status">
                        <div className="voice-memo-overlay__hint voice-memo-overlay__hint--recording">Recording…</div>
                        <div className="voice-memo-overlay__recording-time">{recordingTimeLabel}</div>
                      </div>
                      <button
                        type="button"
                        className="voice-memo-overlay__record-btn voice-memo-overlay__record-btn--active"
                        onClick={stopRecording}
                        aria-label="Stop recording"
                      >
                        <Icons.Stop />
                      </button>
                    </>
                  ) : null}

                  {isRecorderErrored ? (
                    <div className="voice-memo-overlay__retry-row">
                      {recorderErrorRetryable ? (
                        <button type="button" className="voice-memo-overlay__btn" onClick={handleStartRedoRecording}>Retry</button>
                      ) : null}
                      <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--ghost" onClick={handleClose}>Discard</button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

VoiceMemoOverlay.propTypes = {
  overlayState: PropTypes.shape({
    open: PropTypes.bool,
    mode: PropTypes.string,
    memoId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    autoAccept: PropTypes.bool,
    startedAt: PropTypes.number
  }),
  voiceMemos: PropTypes.arrayOf(PropTypes.shape({
    memoId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    transcriptClean: PropTypes.string,
    transcriptRaw: PropTypes.string,
    createdAt: PropTypes.number,
    sessionElapsedSeconds: PropTypes.number,
    videoTimeSeconds: PropTypes.number
  })),
  onClose: PropTypes.func,
  onOpenReview: PropTypes.func,
  onOpenList: PropTypes.func,
  onOpenRedo: PropTypes.func,
  onRemoveMemo: PropTypes.func,
  onAddMemo: PropTypes.func,
  onReplaceMemo: PropTypes.func,
  sessionId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  preferredMicrophoneId: PropTypes.string
};

VoiceMemoOverlay.defaultProps = {
  overlayState: null,
  voiceMemos: [],
  onClose: null,
  onOpenReview: null,
  onOpenList: null,
  onOpenRedo: null,
  onRemoveMemo: null,
  onAddMemo: null,
  onReplaceMemo: null,
  sessionId: null,
  playerRef: null,
  preferredMicrophoneId: ''
};

export default VoiceMemoOverlay;
