import React, { useCallback, useMemo } from 'react';
import '../FitnessCam.scss';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import FitnessVideo from './FitnessVideo.jsx';

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

const FitnessVoiceMemo = ({ onToggleMenu }) => {
  const fitnessCtx = useFitnessContext();
  // const session = fitnessCtx?.fitnessSession; // Removed unused session reference
  const voiceMemos = fitnessCtx?.voiceMemos || [];
  const overlayOpen = Boolean(fitnessCtx?.voiceMemoOverlayState?.open);
  const memoCount = voiceMemos.length;
  const memoCountLabel = useMemo(() => {
    if (memoCount > 99) return '99+';
    if (memoCount > 9) return '9+';
    return String(memoCount);
  }, [memoCount]);

  const handleStartRecording = useCallback(() => {
    fitnessCtx?.openVoiceMemoRedo?.(null);
  }, [fitnessCtx]);

  const handleOpenList = useCallback(() => {
    fitnessCtx?.openVoiceMemoList?.();
  }, [fitnessCtx]);

  const error = null;

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
          
          {/* Record Button - opens overlay/recorder */}
          <button
            className="media-record-btn"
            onClick={handleStartRecording}
            disabled={overlayOpen}
            title={UI_LABELS.RECORD_TOOLTIP}
          >
            ●
          </button>
          
          {/* Counter Button - Bottom (when memos exist) */}
          {memoCount > 0 && (
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
