import { useEffect, useRef, useState, useCallback } from 'react';
import { useFeedbackRecorder } from './useFeedbackRecorder.js';
import { submitFeedback } from './feedbackApi.js';
import './FeedbackPanel.scss';

function mmss(ms) {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * FeedbackPanel — app-wide voice feedback capture. Drop into any app's settings
 * with an `app` slug and optional `context`. The user hits Record, speaks (bug,
 * layout quirk, idea), stops, reviews, and saves. On save it ships the audio plus
 * a snapshot of recent logs to /api/v1/feedback, which transcribes it in the
 * background and files it in the per-app inbox.
 *
 * @param {string} app        - app slug (e.g. 'piano')
 * @param {object} [context]  - app-specific context to attach (merged with route)
 * @param {string} [prompt]   - heading copy
 */
export default function FeedbackPanel({ app, context = {}, prompt = "Found a bug or a rough edge? Record a quick note." }) {
  const { isRecording, durationMs, levelRef, error, start, stop } = useFeedbackRecorder();
  const [phase, setPhase] = useState('idle'); // idle | review | saving | saved | error
  const [take, setTake] = useState(null); // { blob, durationMs }
  const [previewUrl, setPreviewUrl] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const meterRef = useRef(null);
  const meterRafRef = useRef(null);

  // Drive the VU meter straight from the level ref (no re-renders).
  useEffect(() => {
    if (!isRecording) { if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current); return undefined; }
    const tick = () => {
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${Math.max(0.02, levelRef.current).toFixed(3)})`;
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);
    return () => { if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current); };
  }, [isRecording, levelRef]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const onToggle = useCallback(async () => {
    if (isRecording) {
      const result = await stop();
      if (result?.blob?.size) {
        setTake(result);
        setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(result.blob); });
        setPhase('review');
      } else {
        setPhase('idle');
      }
    } else {
      setSaveError(null);
      await start();
    }
  }, [isRecording, start, stop]);

  const onSave = useCallback(async () => {
    if (!take?.blob) return;
    setPhase('saving');
    setSaveError(null);
    try {
      await submitFeedback({ app, blob: take.blob, durationMs: take.durationMs, context });
      setPhase('saved');
    } catch (err) {
      setSaveError(err.message || 'Save failed');
      setPhase('error');
    }
  }, [take, app, context]);

  const reset = useCallback(() => {
    setTake(null);
    setPhase('idle');
    setSaveError(null);
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, []);

  return (
    <div className="feedback-panel">
      <p className="feedback-panel__prompt">{prompt}</p>

      {(phase === 'idle' || isRecording) && (
        <>
          <button
            type="button"
            className={`feedback-panel__record${isRecording ? ' is-recording' : ''}`}
            onClick={onToggle}
          >
            <span className="feedback-panel__dot" />
            <span className="feedback-panel__record-label">
              {isRecording ? `Stop · ${mmss(durationMs)}` : 'Record'}
            </span>
          </button>
          {isRecording && (
            <div className="feedback-panel__meter" aria-hidden="true">
              <span ref={meterRef} className="feedback-panel__meter-fill" />
            </div>
          )}
          {error && <p className="feedback-panel__error">{error}</p>}
        </>
      )}

      {phase === 'review' && (
        <div className="feedback-panel__review">
          <span className="feedback-panel__took">Recorded {mmss(take?.durationMs)}</span>
          {previewUrl && <audio className="feedback-panel__preview" src={previewUrl} controls />}
          <div className="feedback-panel__actions">
            <button type="button" className="feedback-panel__save" onClick={onSave}>Save feedback</button>
            <button type="button" className="feedback-panel__discard" onClick={reset}>Re-record</button>
          </div>
        </div>
      )}

      {phase === 'saving' && <p className="feedback-panel__status">Saving…</p>}

      {phase === 'saved' && (
        <div className="feedback-panel__done">
          <p className="feedback-panel__status">Thanks — saved ✓ It’ll be transcribed and added to the inbox.</p>
          <button type="button" className="feedback-panel__again" onClick={reset}>Record another</button>
        </div>
      )}

      {phase === 'error' && (
        <div className="feedback-panel__done">
          <p className="feedback-panel__error">Couldn’t save: {saveError}</p>
          <button type="button" className="feedback-panel__save" onClick={onSave}>Retry</button>
          <button type="button" className="feedback-panel__discard" onClick={reset}>Discard</button>
        </div>
      )}
    </div>
  );
}
