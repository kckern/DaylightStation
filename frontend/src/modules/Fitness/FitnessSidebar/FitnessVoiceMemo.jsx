import React, { useCallback, useMemo } from 'react';
import '../FitnessCam.scss';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import FitnessVideo from './FitnessVideo.jsx';
import useVoiceMemoRecorder from './useVoiceMemoRecorder.js';

// UI Label Constants
const UI_LABELS = {
  RECORD_BUTTON: '● Record Voice Memo',
  STOP_BUTTON_PREFIX: '■ Stop Recording Memo',
  SAVING_STATUS: 'Saving...',
  UPLOADING_STATUS: 'Uploading & Transcribing…',
  EMPTY_LIST: 'No memos yet.',
  ERROR_PREFIX: '⚠️',
  RECORD_TOOLTIP: 'Start recording',
  STOP_TOOLTIP: 'Stop and transcribe',
  SHOW_MEMOS_TOOLTIP: 'Review voice memos'
};

const FitnessVoiceMemo = ({ minimal = false, menuOpen = false, onToggleMenu, playerRef, preferredMicrophoneId = '' }) => {
  const fitnessCtx = useFitnessContext();
  const session = fitnessCtx?.fitnessSession;
  const voiceMemos = fitnessCtx?.voiceMemos || [];
  const memoCount = voiceMemos.length;
  const memoCountLabel = useMemo(() => {
    if (memoCount > 99) return '99+';
    if (memoCount > 9) return '9+';
    return String(memoCount);
  }, [memoCount]);

  const handleMemoCaptured = useCallback((memo) => {
    if (!memo) return;
    const stored = fitnessCtx?.addVoiceMemoToSession?.(memo) || memo;
    const target = stored || memo;
    if (target && fitnessCtx?.openVoiceMemoReview) {
      fitnessCtx.openVoiceMemoReview(target, { autoAccept: true });
    }
  }, [fitnessCtx]);

  const {
    isRecording,
    recordingDuration,
    uploading,
    error: recorderError,
    setError: setRecorderError,
    startRecording,
    stopRecording
  } = useVoiceMemoRecorder({
    sessionId: session?.sessionId,
    playerRef,
    preferredMicrophoneId,
    onMemoCaptured: handleMemoCaptured
  });

  const handleStartRecording = useCallback(() => {
    setRecorderError(null);
    startRecording();
  }, [setRecorderError, startRecording]);

  const handleOpenList = useCallback(() => {
    fitnessCtx?.openVoiceMemoList?.();
  }, [fitnessCtx]);

  // Format milliseconds to MM:SS
  const formatDuration = useCallback((ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const stopAriaLabel = useMemo(() => {
    if (!isRecording) return UI_LABELS.STOP_TOOLTIP;
    return `${UI_LABELS.STOP_BUTTON_PREFIX} ${formatDuration(recordingDuration)}`;
  }, [isRecording, recordingDuration, formatDuration]);

  const error = recorderError;

  return (
    <>
      {/* Combined Video + Controls Container */}
      <div className="media-controls-container">
        {/* Video Section */}
        <div className="media-video-section">
          <FitnessVideo minimal />
        </div>
        
        {/* Button Panel Section */}
        <div className="media-button-panel">
          {/* Config Button - Top */}
          <button
            className="media-config-btn"
            onClick={onToggleMenu}
            title="Open menu"
          >
            ⋮
          </button>
          
          {/* Record/Stop Button - Middle or Bottom */}
          {!isRecording && !uploading && (
            <button
              className="media-record-btn"
              onClick={handleStartRecording}
              disabled={uploading}
              title={UI_LABELS.RECORD_TOOLTIP}
            >
              ●
            </button>
          )}
          {isRecording && (
            <button
              className="media-stop-btn"
              onClick={stopRecording}
              title={stopAriaLabel}
            >
              ■
            </button>
          )}
          {uploading && (
            <button
              className="media-saving-btn"
              disabled
              title="Saving memo"
            >
              ⏳
            </button>
          )}
          
          {/* Counter Button - Bottom (when memos exist) */}
          {memoCount > 0 && !isRecording && !uploading && (
            <button
              className="media-counter-btn"
              onClick={handleOpenList}
              title={UI_LABELS.SHOW_MEMOS_TOOLTIP}
            >
              {memoCountLabel}
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && <div className="voice-memo-error">{UI_LABELS.ERROR_PREFIX} {error}</div>}
    </>
  );
};

export default FitnessVoiceMemo;
