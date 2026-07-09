import Icon from '../../icons/Icon.jsx';

/**
 * Shown over the dimmed video while paused. Loop-first: big −30/−15/▶/+15/+30
 * targets for re-hearing a passage. Tapping the backdrop (or ▶) resumes; the
 * skip buttons stop propagation so they don't also resume.
 */
export default function PausedLoopOverlay({ onSkip, onResume, forwardDisabled = false }) {
  const skip = (delta) => (e) => { e.stopPropagation(); onSkip(delta); };
  const resume = (e) => { e.stopPropagation(); onResume(); };
  return (
    <div className="piano-loop-overlay" onClick={resume}>
      <div className="piano-loop-overlay__cluster" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(-30)} aria-label="Back 30 seconds"><Icon name="skip-back-30" /></button>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(-15)} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
        <button type="button" className="piano-loop-overlay__btn piano-loop-overlay__btn--resume" onClick={resume} aria-label="Resume"><Icon name="play" /></button>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(15)} disabled={forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
        <button type="button" className="piano-loop-overlay__btn" onClick={skip(30)} disabled={forwardDisabled} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /></button>
      </div>
    </div>
  );
}
