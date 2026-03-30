import React, { useMemo } from 'react';

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function RecordingBar({
  weekLabel,
  isRecording,
  duration,
  micLevel,
  silenceWarning,
  uploading,
  existingRecording,
  error,
  onStart,
  onStop,
}) {
  const vuBars = useMemo(() => {
    const count = 20;
    const filled = Math.round(micLevel * count);
    return Array.from({ length: count }, (_, i) => i < filled);
  }, [micLevel]);

  const barClass = `recording-bar${silenceWarning ? ' silence-warning' : ''}`;

  return (
    <div className={barClass}>
      <div className="recording-bar-left">
        <span className="week-label">{weekLabel}</span>
        {!isRecording && existingRecording?.exists && (
          <span className="existing-badge">{formatTime(existingRecording.duration)} recorded</span>
        )}
      </div>

      <div className="recording-bar-right">
        {isRecording && (
          <>
            <span className="recording-dot">●</span>
            <span className="recording-timer">{formatTime(duration)}</span>
            <div className="vu-meter">
              {vuBars.map((filled, i) => (
                <div key={i} className={`vu-bar${filled ? ' filled' : ''}`} />
              ))}
            </div>
          </>
        )}

        {error && <span className="recording-error">{error}</span>}

        {uploading ? (
          <span className="uploading-status">Transcribing...</span>
        ) : isRecording ? (
          <button className="recording-stop-btn" onClick={onStop}>
            ■ Stop
          </button>
        ) : (
          <button className="recording-start-btn" onClick={onStart}>
            ● Record
          </button>
        )}
      </div>
    </div>
  );
}
