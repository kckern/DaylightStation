import React from 'react';
import PropTypes from 'prop-types';
import './StudyControls.scss';

/**
 * Study-mode transport: paused jogging, anchored loop windows, and a visible mirror
 * toggle.
 *
 * Loop options appear only while paused, so the window is always anchored to a position
 * the viewer deliberately chose and can see on screen. Icons are inline SVG or plain
 * text — the kiosk WebView renders tofu for many unicode glyphs.
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
  const loopRow = (direction, label) => (
    <div className="study-controls__row" key={direction}>
      <span className="study-controls__label">{label}</span>
      {loopDurations.map((secs) => {
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
      })}
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

      {isPaused && (
        <>
          {loopRow('back', 'Loop back')}
          {loopRow('forward', 'Loop fwd')}
        </>
      )}
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
