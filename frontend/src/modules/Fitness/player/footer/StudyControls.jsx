import React from 'react';
import PropTypes from 'prop-types';
import './StudyControls.scss';

/**
 * Study-mode transport: paused jogging, anchored loop windows, and a visible mirror
 * toggle.
 *
 * NEW loop options appear only while paused, so a window is always anchored to a position
 * the viewer deliberately chose and can see on screen. The ARMED chip is different: it
 * stays rendered while the loop runs, because arming starts playback and a running loop
 * that showed no control would be both invisible and impossible to get out of except by
 * scrubbing. It is tappable to release at any time.
 *
 * Icons are inline SVG or plain text — the kiosk WebView renders tofu for many unicode
 * glyphs.
 */
export default function StudyControls({
  isPaused,
  jogSteps,
  loopDurations,
  loop,
  onJog,
  onArmLoop,
  onReleaseLoop,
  videoMirrored,
  onToggleMirror,
}) {
  const directionLabel = (direction) => (direction === 'back' ? 'Loop back' : 'Loop fwd');

  // One chip renderer for both surfaces, so the armed chip a viewer taps while the loop
  // runs is literally the same control (same aria-label, same release behaviour) as the
  // one they armed while paused.
  const loopChip = (direction, secs) => {
    const armed = loop?.direction === direction && loop?.seconds === secs;
    return (
      <button
        key={`${direction}-${secs}`}
        type="button"
        className={`study-controls__chip${armed ? ' is-active' : ''}`}
        aria-label={`Loop ${direction} ${secs} seconds`}
        aria-pressed={armed}
        onClick={() => (armed ? onReleaseLoop() : onArmLoop(direction, secs))}
      >
        {secs}
      </button>
    );
  };

  const loopRow = (direction) => (
    <div className="study-controls__row" key={direction}>
      <span className="study-controls__label">{directionLabel(direction)}</span>
      {loopDurations.map((secs) => loopChip(direction, secs))}
    </div>
  );

  return (
    <div className="study-controls">
      <div className="study-controls__row">
        {[...jogSteps].reverse().map((secs) => (
          <button
            key={`back-${secs}`}
            type="button"
            className="study-controls__jog"
            aria-label={`Back ${secs} seconds`}
            onClick={() => onJog(-secs)}
          >
            {`- ${secs}s`}
          </button>
        ))}
        {jogSteps.map((secs) => (
          <button
            key={`fwd-${secs}`}
            type="button"
            className="study-controls__jog"
            aria-label={`Forward ${secs} seconds`}
            onClick={() => onJog(secs)}
          >
            {`+ ${secs}s`}
          </button>
        ))}
        <button
          type="button"
          className={`study-controls__mirror${videoMirrored ? ' is-active' : ''}`}
          aria-label="Mirror video"
          aria-pressed={videoMirrored}
          onClick={onToggleMirror}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 3v18" />
            <path d="M8 7 4 12l4 5z" />
            <path d="M16 7l4 5-4 5z" />
          </svg>
          <span>Mirror</span>
        </button>
      </div>

      {isPaused ? (
        <>
          {loopRow('back')}
          {loopRow('forward')}
        </>
      ) : loop ? (
        // Playing with a loop armed: no NEW options (the anchor position is moving), but
        // the armed duration stays visible and tappable so the viewer can see the loop is
        // running and release it without scrubbing out of the window.
        <div className="study-controls__row">
          <span className="study-controls__label">{directionLabel(loop.direction)}</span>
          {loopChip(loop.direction, loop.seconds)}
        </div>
      ) : null}
    </div>
  );
}

StudyControls.propTypes = {
  isPaused: PropTypes.bool,
  jogSteps: PropTypes.arrayOf(PropTypes.number).isRequired,
  loopDurations: PropTypes.arrayOf(PropTypes.number).isRequired,
  loop: PropTypes.shape({ direction: PropTypes.string, seconds: PropTypes.number }),
  onJog: PropTypes.func.isRequired,
  onArmLoop: PropTypes.func.isRequired,
  onReleaseLoop: PropTypes.func.isRequired,
  videoMirrored: PropTypes.bool,
  onToggleMirror: PropTypes.func.isRequired,
};
