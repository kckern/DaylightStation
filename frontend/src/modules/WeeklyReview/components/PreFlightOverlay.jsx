import React from 'react';

/**
 * Non-blocking audio status notice for WeeklyReview.
 *
 * IMPORTANT: this NEVER blocks the UI. The review is always usable regardless of
 * microphone state — it only informs the user. If audio isn't working it tells
 * them to record their review separately, but never traps them in a modal/overlay.
 *
 * Props:
 *   - status: 'acquiring' | 'ok'   — derived from firstAudibleFrameSeen
 *   - unavailable: boolean         — mic failed or no audio within the grace period
 */
export default function PreFlightOverlay({ status, unavailable = false }) {
  if (unavailable) {
    return (
      <div
        className="weekly-review-audio-notice weekly-review-audio-notice--error"
        role="status"
        aria-live="polite"
      >
        <span className="audio-notice-icon">🎤❌</span>
        <span className="audio-notice-text">
          Audio isn’t recording on this device — please record your review separately.
        </span>
      </div>
    );
  }

  if (status === 'acquiring') {
    return (
      <div
        className="weekly-review-audio-notice weekly-review-audio-notice--acquiring"
        role="status"
        aria-live="polite"
      >
        <span className="audio-notice-icon">🎤</span>
        <span className="audio-notice-text">Listening for your microphone…</span>
      </div>
    );
  }

  return null;
}
