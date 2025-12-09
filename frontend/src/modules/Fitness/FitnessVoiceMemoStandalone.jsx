import React, { useCallback, useMemo } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import useVoiceMemoRecorder from './FitnessSidebar/useVoiceMemoRecorder.js';
import './FitnessSidebar/FitnessVoiceMemoStandalone.scss';
import { playbackLog } from '../Player/lib/playbackLogger.js';

const UI = {
  TITLE: 'Voice Memo',
  RECORD: 'Record',
  STOP: 'Stop',
  VIEW: 'View Memos',
  SAVING: 'Uploading…',
  ERROR_PREFIX: '⚠',
  TIMER_PREFIX: 'REC'
};

const formatDuration = (ms) => {
  if (!ms || ms <= 0) return '0:00';
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
};

const FitnessVoiceMemoStandalone = ({ playerRef = null, preferredMicrophoneId = '' }) => {
  const fitnessCtx = useFitnessContext();
  const voiceMemos = fitnessCtx?.voiceMemos || [];
  const resolvedPreferredMic = preferredMicrophoneId || fitnessCtx?.preferredMicrophoneId || '';
  const memoCount = voiceMemos.length;
  const logVoiceMemo = useCallback((event, payload = {}, options = {}) => {
    playbackLog('voice-memo', {
      event,
      ...payload
    }, {
      level: options.level || 'info',
      context: {
        source: 'VoiceMemoStandalone',
        sessionId: fitnessCtx?.fitnessSession?.sessionId || null
      }
    });
  }, [fitnessCtx?.fitnessSession?.sessionId]);
  const memoCountLabel = useMemo(() => {
    if (memoCount > 99) return '99+';
    if (memoCount > 9) return '9+';
    return String(memoCount);
  }, [memoCount]);

  const handleMemoCaptured = useCallback((memo) => {
    if (!memo) return;
    logVoiceMemo('standalone-memo-captured', { memoId: memo.memoId || null });
    const stored = fitnessCtx?.addVoiceMemoToSession?.(memo) || memo;
    const target = stored || memo;
    if (target && fitnessCtx?.openVoiceMemoReview) {
      fitnessCtx.openVoiceMemoReview(target, { autoAccept: true });
    }
  }, [fitnessCtx, logVoiceMemo]);

  const {
    isRecording,
    recordingDuration,
    uploading,
    error,
    setError,
    startRecording,
    stopRecording
  } = useVoiceMemoRecorder({
    sessionId: fitnessCtx?.fitnessSession?.sessionId,
    playerRef,
    preferredMicrophoneId: resolvedPreferredMic,
    onMemoCaptured: handleMemoCaptured
  });

  const handleRecord = useCallback(() => {
    setError(null);
    logVoiceMemo('standalone-record-toggle', { action: isRecording ? 'stop' : 'start' });
    startRecording();
  }, [isRecording, logVoiceMemo, setError, startRecording]);

  const handleViewMemos = useCallback(() => {
    logVoiceMemo('standalone-open-list', { memoCount });
    fitnessCtx?.openVoiceMemoList?.();
  }, [fitnessCtx, logVoiceMemo, memoCount]);

  const statusText = useMemo(() => {
    if (uploading) return UI.SAVING;
    if (isRecording) return `${UI.TIMER_PREFIX} ${formatDuration(recordingDuration)}`;
    return null;
  }, [isRecording, recordingDuration, uploading]);

  return (
    <div className="voice-memo-standalone">
      <div className="voice-memo-standalone__header">
        <h4>{UI.TITLE}</h4>
        {memoCount > 0 && (
          <button
            type="button"
            className="voice-memo-standalone__view"
            onClick={handleViewMemos}
            title="Open voice memo list"
          >
            {UI.VIEW} <span className="voice-memo-standalone__badge">{memoCountLabel}</span>
          </button>
        )}
      </div>

      <div className="voice-memo-standalone__body">
        <button
          type="button"
          className={`voice-memo-standalone__record ${isRecording ? 'recording' : ''}`}
          onClick={isRecording ? stopRecording : handleRecord}
          disabled={uploading}
        >
          {isRecording ? UI.STOP : UI.RECORD}
        </button>
        {statusText && (
          <div className="voice-memo-standalone__status">{statusText}</div>
        )}
        {error && (
          <div className="voice-memo-standalone__error">
            {UI.ERROR_PREFIX} {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default FitnessVoiceMemoStandalone;
