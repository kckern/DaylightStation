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
  syncStatus,
  pendingCount,
  lastAckedAt,
  isFocused,
  canSave,
  onSave,
  micConnected,
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
        <span className={`mic-indicator ${micConnected ? 'mic-indicator--live' : 'mic-indicator--lost'}`}>
          {micConnected ? '🎤 LIVE' : '🎤 LOST'}
        </span>
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

        {(syncStatus || pendingCount > 0) && (
          <div className={`sync-badge sync-badge--${syncStatus || 'idle'}`}>
            {syncStatus === 'syncing' && `Syncing… (${pendingCount} pending)`}
            {syncStatus === 'offline' && `Offline — ${pendingCount} saved locally`}
            {syncStatus === 'saved' && lastAckedAt && `Saved · ${Math.round((Date.now() - lastAckedAt) / 1000)}s ago`}
            {syncStatus === 'idle' && pendingCount > 0 && `Queued (${pendingCount})`}
          </div>
        )}

        {error && <span className="recording-error">{error}</span>}

        {uploading && <span className="uploading-status">Transcribing...</span>}

        <button
          className={`recording-bar__save ${isFocused ? 'focused' : ''} ${canSave ? 'can-save' : ''}`}
          onClick={onSave}
          disabled={!canSave}
          aria-label="Save and finish recording"
        >
          <span className="recording-bar__save-icon" aria-hidden="true">■</span>
          <span className="recording-bar__save-label">Save Recording</span>
        </button>

      </div>
    </div>
  );
}
