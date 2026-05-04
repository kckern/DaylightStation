import React from 'react';

/**
 * Blocks the WeeklyReview UI until the mic is verified.
 * Props:
 *   - status: 'acquiring' | 'failed' | 'ok'
 *   - focusIndex: 0 | 1   (which failed-state button is focused: 0=Retry, 1=Exit)
 *   - onRetry: () => void
 *   - onExit:  () => void
 */
export default function PreFlightOverlay({ status, focusIndex = 0, onRetry, onExit }) {
  if (status === 'ok') return null;

  return (
    <div
      className="weekly-review-preflight-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weekly-review-preflight-label"
      aria-live="polite"
    >
      <div className="preflight-content">
        {status === 'acquiring' && (
          <>
            <div className="preflight-mic-pulse">🎤</div>
            <div className="preflight-title" id="weekly-review-preflight-label">Listening for your microphone…</div>
            <div className="preflight-subtitle">Speak to begin.</div>
          </>
        )}
        {status === 'failed' && (
          <>
            <div className="preflight-mic-error">🎤❌</div>
            <div className="preflight-title" id="weekly-review-preflight-label">Microphone unavailable</div>
            <div className="preflight-subtitle">Please check the device and try again.</div>
            <div className="preflight-actions">
              <button
                className={`preflight-btn preflight-btn--primary${focusIndex === 0 ? ' focused' : ''}`}
                onClick={onRetry}
              >Retry</button>
              <button
                className={`preflight-btn${focusIndex === 1 ? ' focused' : ''}`}
                onClick={onExit}
              >Exit</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
