import React from 'react';
import useDebugVoiceMemo from './hooks/useDebugVoiceMemo.js';

/**
 * Developer-only microphone button. Rendered inside the Fitness sidebar's
 * Quick Actions section, behind FITNESS_DEBUG.
 */
const DebugMicButton = () => {
  const { isRecording, uploading, error, startRecording, stopRecording } = useDebugVoiceMemo();

  const handleClick = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const label = isRecording
    ? '⏺ Stop Debug Memo'
    : uploading
      ? '⏳ Saving…'
      : '🎙️ Debug Memo';

  return (
    <button
      type="button"
      className={`menu-item action-item${isRecording ? ' is-ack-flash' : ''}`}
      onClick={handleClick}
      disabled={uploading && !isRecording}
      title={error ? `Error: ${error.message}` : 'Record a quick developer audio note'}
      data-testid="debug-mic-button"
    >
      <span>{label}</span>
    </button>
  );
};

export default DebugMicButton;
