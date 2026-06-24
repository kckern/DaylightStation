import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useFeedbackRecorder } from '@/modules/Feedback/useFeedbackRecorder.js';
import { submitFeedback } from '@/modules/Feedback/feedbackApi.js';
import { AppButton, MicLevelIndicator } from '@/modules/Fitness/shared/primitives';
import getLogger from '@/lib/logging/Logger.js';
import './FitnessFeedback.scss';

function mmss(ms) {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const MicGlyph = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
    />
  </svg>
);

/**
 * FitnessFeedback — fitness-styled voice-feedback overlay. Reuses the shared,
 * app-agnostic recorder + submit pipeline (getUserMedia → MediaRecorder one-shot,
 * POST /api/v1/feedback) but presents a touchscreen-friendly UI built from the
 * Fitness shared primitives.
 *
 * Flow: idle (tap to record) → recording (VU + count-up) → review (re-record /
 * save) → saved. Submits with app:'fitness' and a best-effort home context.
 *
 * @param {function} onClose  - dismiss the overlay
 * @param {string}  [view]    - current fitness view (e.g. 'menu'), for context
 * @param {string}  [userId]  - primary/current user id, for context (best-effort)
 */
export default function FitnessFeedback({ onClose, view = null, userId = null }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-feedback', app: 'fitness' }), []);
  const { isRecording, durationMs, levelRef, error, start, stop } = useFeedbackRecorder();
  const [phase, setPhase] = useState('idle'); // idle | review | saving | saved | error
  const [take, setTake] = useState(null); // { blob, durationMs }
  const [previewUrl, setPreviewUrl] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [meterLevel, setMeterLevel] = useState(0); // 0..100 for MicLevelIndicator
  const meterRafRef = useRef(null);

  useEffect(() => {
    logger.info('feedback-overlay-open', { view, hasUser: !!userId });
    return () => logger.info('feedback-overlay-close');
  }, [logger, view, userId]);

  // Drive the VU meter from the recorder's level ref via rAF (no per-frame
  // re-render of the whole tree — only setMeterLevel on a coarse 0..100 scale).
  useEffect(() => {
    if (!isRecording) {
      if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
      setMeterLevel(0);
      return undefined;
    }
    const tick = () => {
      const lvl = Math.round(Math.max(0, Math.min(1, levelRef.current || 0)) * 100);
      setMeterLevel(lvl);
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);
    return () => { if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current); };
  }, [isRecording, levelRef]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const onToggleRecord = useCallback(async () => {
    if (isRecording) {
      const result = await stop();
      if (result?.blob?.size) {
        setTake(result);
        setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(result.blob); });
        setPhase('review');
        logger.info('feedback-take-captured', { durationMs: result.durationMs, bytes: result.blob.size });
      } else {
        setPhase('idle');
        logger.warn('feedback-take-empty');
      }
    } else {
      setSaveError(null);
      logger.info('feedback-record-start');
      await start();
    }
  }, [isRecording, start, stop, logger]);

  const onSave = useCallback(async () => {
    if (!take?.blob) return;
    setPhase('saving');
    setSaveError(null);
    const context = { surface: 'home' };
    if (view) context.view = view;
    if (userId) context.userId = userId;
    try {
      await submitFeedback({ app: 'fitness', blob: take.blob, durationMs: take.durationMs, context });
      setPhase('saved');
      logger.info('feedback-saved', { durationMs: take.durationMs });
    } catch (err) {
      setSaveError(err.message || 'Save failed');
      setPhase('error');
      logger.error('feedback-save-failed', { error: err.message });
    }
  }, [take, view, userId, logger]);

  const reset = useCallback(() => {
    setTake(null);
    setPhase('idle');
    setSaveError(null);
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, []);

  const handleClose = useCallback(() => { onClose?.(); }, [onClose]);

  return (
    <div className="fitness-feedback" data-testid="fitness-feedback" role="dialog" aria-modal="true" aria-label="Voice feedback">
      <div
        className="fitness-feedback__backdrop"
        onPointerDown={handleClose}
        aria-hidden="true"
      />
      <div className="fitness-feedback__panel">
        <div className="fitness-feedback__header">
          <span className="fitness-feedback__title">Voice feedback</span>
          <button
            type="button"
            className="fitness-feedback__close"
            data-testid="fitness-feedback-close"
            aria-label="Close feedback"
            onPointerDown={(e) => { e.preventDefault(); handleClose(); }}
          >
            ✕
          </button>
        </div>

        {(phase === 'idle' || isRecording) && (
          <div className="fitness-feedback__body">
            <p className="fitness-feedback__prompt">
              Found a bug or rough edge? Tap the mic and tell us about it.
            </p>
            <button
              type="button"
              className={`fitness-feedback__record${isRecording ? ' is-recording' : ''}`}
              data-testid="fitness-feedback-record"
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              onPointerDown={(e) => { e.preventDefault(); onToggleRecord(); }}
            >
              <span className="fitness-feedback__record-glyph">
                {isRecording ? <span className="fitness-feedback__stop-square" /> : <MicGlyph />}
              </span>
            </button>
            <div className="fitness-feedback__meter-row">
              <MicLevelIndicator
                level={meterLevel}
                bars={9}
                variant="waveform"
                size="lg"
                activeColor="var(--app-action-primary, #4fc3f7)"
              />
            </div>
            <div className="fitness-feedback__timer">
              {isRecording ? mmss(durationMs) : 'Tap to record'}
            </div>
            {error && <p className="fitness-feedback__error">{error}</p>}
          </div>
        )}

        {phase === 'review' && (
          <div className="fitness-feedback__body">
            <p className="fitness-feedback__took">Recorded {mmss(take?.durationMs)}</p>
            {previewUrl && (
              <audio className="fitness-feedback__preview" src={previewUrl} controls />
            )}
            <div className="fitness-feedback__actions">
              <AppButton
                variant="success"
                size="lg"
                data-testid="fitness-feedback-save"
                onPointerDown={(e) => { e.preventDefault(); onSave(); }}
              >
                Save feedback
              </AppButton>
              <AppButton
                variant="ghost"
                size="lg"
                data-testid="fitness-feedback-rerecord"
                onPointerDown={(e) => { e.preventDefault(); reset(); }}
              >
                Re-record
              </AppButton>
            </div>
          </div>
        )}

        {phase === 'saving' && (
          <div className="fitness-feedback__body">
            <p className="fitness-feedback__status">Saving…</p>
          </div>
        )}

        {phase === 'saved' && (
          <div className="fitness-feedback__body" data-testid="fitness-feedback-saved">
            <p className="fitness-feedback__status">Saved — thanks!</p>
            <p className="fitness-feedback__substatus">It’ll be transcribed and added to the inbox.</p>
            <div className="fitness-feedback__actions">
              <AppButton variant="ghost" size="lg" onPointerDown={(e) => { e.preventDefault(); reset(); }}>
                Record another
              </AppButton>
              <AppButton variant="primary" size="lg" onPointerDown={(e) => { e.preventDefault(); handleClose(); }}>
                Done
              </AppButton>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="fitness-feedback__body">
            <p className="fitness-feedback__error">Couldn’t save: {saveError}</p>
            <div className="fitness-feedback__actions">
              <AppButton variant="primary" size="lg" onPointerDown={(e) => { e.preventDefault(); onSave(); }}>
                Retry
              </AppButton>
              <AppButton variant="ghost" size="lg" onPointerDown={(e) => { e.preventDefault(); reset(); }}>
                Discard
              </AppButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

FitnessFeedback.propTypes = {
  onClose: PropTypes.func.isRequired,
  view: PropTypes.string,
  userId: PropTypes.string,
};
