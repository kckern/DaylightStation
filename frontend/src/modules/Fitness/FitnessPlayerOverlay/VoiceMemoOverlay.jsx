import React, { useMemo, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import useVoiceMemoRecorder from '../FitnessSidebar/useVoiceMemoRecorder.js';
import './VoiceMemoOverlay.scss';

const VOICE_MEMO_AUTO_ACCEPT_MS = 4000;

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatMemoTimestamp = (memo) => {
  if (!memo) return '';
  if (memo.sessionElapsedSeconds != null) {
    return `T+${formatTime(Math.max(0, Math.round(memo.sessionElapsedSeconds)))}`;
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
  onReplaceMemo,
  sessionId,
  playerRef,
  preferredMicrophoneId
}) => {
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

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleAccept = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleReviewSelect = useCallback((memoRef) => {
    if (!memoRef) return;
    onOpenReview?.(memoRef, { autoAccept: false });
  }, [onOpenReview]);

  const handleRedo = useCallback((memoId) => {
    if (!memoId) return;
    onOpenRedo?.(memoId);
  }, [onOpenRedo]);

  const handleDelete = useCallback(() => {
    const memoId = overlayState?.memoId;
    if (!memoId) return;
    onRemoveMemo?.(memoId);
    const remaining = voiceMemos.filter((memo) => memo && String(memo.memoId) !== String(memoId)).length;
    if (remaining <= 0) {
      onClose?.();
    } else if (overlayState.mode !== 'list') {
      onOpenList?.();
    }
  }, [overlayState?.memoId, overlayState?.mode, voiceMemos, onRemoveMemo, onClose, onOpenList]);

  const handleDeleteFromList = useCallback((memoId) => {
    if (!memoId) return;
    onRemoveMemo?.(memoId);
    const remaining = voiceMemos.filter((memo) => memo && String(memo.memoId) !== String(memoId)).length;
    if (remaining <= 0) {
      onClose?.();
    }
  }, [onRemoveMemo, voiceMemos, onClose]);

  const handleRedoCaptured = useCallback((memo) => {
    if (!memo) {
      onClose?.();
      return;
    }
    const targetId = overlayState?.memoId;
    const stored = targetId ? (onReplaceMemo?.(targetId, memo) || memo) : memo;
    const nextTarget = stored || memo;
    if (nextTarget) {
      onOpenReview?.(nextTarget, { autoAccept: false });
    } else {
      onClose?.();
    }
  }, [overlayState?.memoId, onReplaceMemo, onOpenReview, onClose]);

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
    onMemoCaptured: handleRedoCaptured
  });

  const handleStartRedoRecording = useCallback(() => {
    setRecorderError(null);
    startRecording();
  }, [setRecorderError, startRecording]);

  useEffect(() => {
    if (!overlayState?.open || overlayState.mode !== 'review' || !overlayState.autoAccept) {
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
        handleAccept();
      }
    };
    update();
    const interval = setInterval(update, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [overlayState?.open, overlayState?.mode, overlayState?.autoAccept, overlayState?.startedAt, handleAccept]);

  useEffect(() => {
    if (!overlayState?.open) {
      setAutoAcceptProgress(0);
    }
  }, [overlayState?.open]);

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

  useEffect(() => {
    if (!overlayState?.open) return;
    if ((overlayState.mode === 'review' || overlayState.mode === 'redo') && !currentMemo) {
      if (voiceMemos.length > 0) {
        onOpenList?.();
      } else {
        onClose?.();
      }
    }
  }, [overlayState?.open, overlayState?.mode, currentMemo, voiceMemos, onOpenList, onClose]);

  const transcript = currentMemo?.transcriptClean || currentMemo?.transcriptRaw || 'Transcription in progress…';
  const memoTimestamp = formatMemoTimestamp(currentMemo);
  const memoVideoTimestamp = currentMemo?.videoTimeSeconds != null
    ? formatTime(Math.max(0, Math.round(currentMemo.videoTimeSeconds)))
    : '';
  const recordingTimeLabel = formatTime(Math.max(0, Math.floor(recordingDuration / 1000)));

  if (!overlayState?.open) {
    return null;
  }

  const mode = overlayState.mode || 'list';
  const showList = mode === 'list';
  const showReview = mode === 'review';
  const showRedo = mode === 'redo';

  return (
    <div className={`voice-memo-overlay voice-memo-overlay--${mode}`}>
      <div className="voice-memo-overlay__panel">
        <div className="voice-memo-overlay__header">
          <div className="voice-memo-overlay__title">
            {showList ? 'Voice Memos' : showRedo ? 'Redo Voice Memo' : 'Voice Memo Review'}
          </div>
          <button type="button" className="voice-memo-overlay__close" onClick={handleClose} aria-label="Close voice memo overlay">×</button>
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
                        <button type="button" onClick={() => handleReviewSelect(memo)}>Review</button>
                        <button type="button" onClick={() => handleRedo(memoId)}>Redo</button>
                        <button type="button" onClick={() => handleDeleteFromList(memoId)}>Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {showReview && currentMemo ? (
          <div className="voice-memo-overlay__content">
            <div className="voice-memo-overlay__meta">
              {memoTimestamp && <span className="voice-memo-overlay__tag">{memoTimestamp}</span>}
              {memoVideoTimestamp && <span className="voice-memo-overlay__tag">Video {memoVideoTimestamp}</span>}
            </div>
            <div className="voice-memo-overlay__transcript voice-memo-overlay__transcript--large">{transcript}</div>
            {overlayState.autoAccept ? (
              <div className="voice-memo-overlay__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(autoAcceptProgress * 100)}>
                <div className="voice-memo-overlay__progress-fill" style={{ transform: `scaleX(${autoAcceptProgress})` }} />
                <span className="voice-memo-overlay__progress-label">Auto saving…</span>
              </div>
            ) : null}
            <div className="voice-memo-overlay__actions">
              <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--primary" onClick={handleAccept}>Keep</button>
              <button type="button" className="voice-memo-overlay__btn" onClick={() => handleRedo(currentMemo.memoId)}>Redo</button>
              <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        ) : null}

        {showRedo && currentMemo ? (
          <div className="voice-memo-overlay__content">
            <div className="voice-memo-overlay__meta">
              {memoTimestamp && <span className="voice-memo-overlay__tag">{memoTimestamp}</span>}
              {memoVideoTimestamp && <span className="voice-memo-overlay__tag">Video {memoVideoTimestamp}</span>}
            </div>
            <div className="voice-memo-overlay__transcript voice-memo-overlay__transcript--faded">{transcript}</div>
            <div className="voice-memo-overlay__hint">Record a new memo to replace this one.</div>
            {recorderError ? <div className="voice-memo-overlay__error">{recorderError}</div> : null}
            <div className="voice-memo-overlay__redo-controls">
              {!isRecording && !uploading ? (
                <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--primary" onClick={handleStartRedoRecording}>Record Again</button>
              ) : null}
              {isRecording ? (
                <button type="button" className="voice-memo-overlay__btn" onClick={stopRecording}>Stop ({recordingTimeLabel})</button>
              ) : null}
              {(isRecording || uploading) ? (
                <span className="voice-memo-overlay__status">{isRecording ? `Recording… ${recordingTimeLabel}` : 'Uploading…'}</span>
              ) : null}
            </div>
            <div className="voice-memo-overlay__actions">
              <button
                type="button"
                className="voice-memo-overlay__btn"
                onClick={() => handleReviewSelect(currentMemo)}
                disabled={isRecording || uploading}
              >
                Back to review
              </button>
            </div>
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
  onReplaceMemo: null,
  sessionId: null,
  playerRef: null,
  preferredMicrophoneId: ''
};

export default VoiceMemoOverlay;
