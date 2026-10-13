import { noteOnCount } from './studioRecording.js';

/** ms → M:SS. */
function mmss(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Review prompt shown after a Studio recording stops: the take is held pending a
 * decision rather than auto-saved, so a fumbled take isn't silently kept. Shows a
 * summary (length + notes) with Save / Discard. Discarding (or tapping the scrim)
 * drops the take; saving persists it to the Recordings tab.
 */
export default function StudioReviewPrompt({ take, onSave, onDiscard }) {
  if (!take) return null;
  const notes = noteOnCount(take.events);
  return (
    <div className="piano-studio-review" role="dialog" aria-modal="true" aria-label="Review recording">
      <div className="piano-studio-review__scrim" onClick={onDiscard} />
      <div className="piano-studio-review__card">
        <h3 className="piano-studio-review__title">Keep this take?</h3>
        <p className="piano-studio-review__meta">{mmss(take.durationMs)} · {notes} {notes === 1 ? 'note' : 'notes'}</p>
        <div className="piano-studio-review__actions">
          <button type="button" className="piano-studio-review__discard" onClick={onDiscard}>Discard</button>
          <button type="button" className="piano-studio-review__save" onClick={onSave}>Save take</button>
        </div>
      </div>
    </div>
  );
}
