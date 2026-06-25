import { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { MicMeter } from './MicMeter.jsx';
import './VoiceCaptureOverlay.scss';

function mmss(ms) {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Presentational voice-capture overlay. Renders one phase view from props and
 * emits callbacks; it owns no recorder or network logic. Rendered via a portal
 * to document.body so it works from any host.
 *
 * phase: 'idle' | 'recording' | 'processing' | 'review'
 */
export function VoiceCaptureOverlay({
  open, title = 'Voice note', prompt = '',
  phase = 'idle', durationMs = 0, levelRef,
  transcript = '', transcriptStatus = null, error = null,
  onRecordToggle, onKeep, onRedo, onClose,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  const isRecording = phase === 'recording';

  const content = (
    <div
      className="voice-capture-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="voice-capture-overlay__panel" role="dialog" aria-label={title}>
        <div className="voice-capture-overlay__header">
          <div className="voice-capture-overlay__title">{title}</div>
          <button type="button" className="voice-capture-overlay__close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        {(phase === 'idle' || isRecording) && (
          <div className="voice-capture-overlay__content voice-capture-overlay__content--centered">
            {prompt && <p className="voice-capture-overlay__prompt">{prompt}</p>}
            <button
              type="button"
              className={`voice-capture-overlay__record${isRecording ? ' is-recording' : ''}`}
              onClick={onRecordToggle}
            >
              <span className="voice-capture-overlay__dot" />
              <span className="voice-capture-overlay__record-label">
                {isRecording ? `Stop · ${mmss(durationMs)}` : 'Record'}
              </span>
            </button>
            {isRecording && <MicMeter levelRef={levelRef} active />}
            {error && <p className="voice-capture-overlay__error">{error}</p>}
          </div>
        )}

        {phase === 'processing' && (
          <div className="voice-capture-overlay__content voice-capture-overlay__content--centered">
            <div className="voice-capture-overlay__processing">Transcribing…</div>
          </div>
        )}

        {phase === 'review' && (
          <div className="voice-capture-overlay__content voice-capture-overlay__content--review">
            <div className="voice-capture-overlay__transcript">
              {transcript || (transcriptStatus === 'failed'
                ? 'Transcription failed — your note was still saved.'
                : error
                  ? '' // an error is shown below; don't also claim it saved
                  : 'Saved — your note will appear in the inbox shortly.')}
            </div>
            {error && <p className="voice-capture-overlay__error">{error}</p>}
            <div className="voice-capture-overlay__actions">
              <button type="button" className="voice-capture-overlay__keep" onClick={onKeep}>Keep</button>
              <button type="button" className="voice-capture-overlay__redo" onClick={onRedo}>Redo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return portalTarget ? ReactDOM.createPortal(content, portalTarget) : content;
}

export default VoiceCaptureOverlay;
