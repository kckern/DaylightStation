import React, { useEffect, useRef } from 'react';

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function RecordingBar({
  weekLabel,
  isRecording,
  duration,
  micLevelRef,
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
  // Task 10: VU meter is driven by rAF + DOM mutation (not React render).
  // micLevelRef.current is updated ~20×/sec by useAudioRecorder; reading
  // it through state would re-render the whole WeeklyReview tree at that
  // rate. Instead we read the ref inside a rAF loop and toggle `.filled`
  // classes on 20 stable child divs.
  const vuMeterRef = useRef(null);

  useEffect(() => {
    if (!isRecording || !micLevelRef) return;
    let raf;
    const tick = () => {
      const meter = vuMeterRef.current;
      if (meter) {
        const level = micLevelRef.current;
        const filled = Math.round(level * 20);
        const bars = meter.children;
        for (let i = 0; i < bars.length; i++) {
          const shouldFill = i < filled;
          const isFilled = bars[i].classList.contains('filled');
          if (shouldFill && !isFilled) bars[i].classList.add('filled');
          else if (!shouldFill && isFilled) bars[i].classList.remove('filled');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRecording, micLevelRef]);

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
            <div className="vu-meter" ref={vuMeterRef} aria-label="Microphone level">
              {Array.from({ length: 20 }, (_, i) => <div key={i} className="vu-bar" />)}
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
