import React from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';

/**
 * Pure presentation component for media loading / pause overlay.
 * All timing and state decisions are handled upstream by useMediaResilience.
 */
export function LoadingOverlay({
  shouldRender,
  isVisible,
  pauseOverlayActive = false,
  seconds = 0,
  stalled = false,
  waitingToPlay = false,
  togglePauseOverlay,
  countUpDisplay,
  countUpSeconds = 0,
  playerPositionDisplay,
  intentPositionDisplay
}) {
  if (!shouldRender) {
    return null;
  }

  const isInitialPlayback = seconds === 0 && !stalled;
  const shouldShowPauseIcon = pauseOverlayActive && !isInitialPlayback && !waitingToPlay && !stalled;
  const imgSrc = shouldShowPauseIcon ? pause : spinner;
  const overlayStateClass = shouldShowPauseIcon ? 'paused' : 'loading';
  const elapsedDisplay = typeof countUpDisplay === 'string' ? countUpDisplay : null;
  const positionDisplay = intentPositionDisplay || playerPositionDisplay || null;
  const showTimer = !shouldShowPauseIcon && isVisible && countUpSeconds >= 0;

  return (
    <div
      className={`loading-overlay ${overlayStateClass}`}
      style={{
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out'
      }}
      onDoubleClick={togglePauseOverlay}
    >
      <div className="loading-timing">
        <div className="loading-spinner">
          <img src={imgSrc} alt="" />
          {!shouldShowPauseIcon && <div className="loading-metrics">
            <div className="loading-position">
              {positionDisplay !== '0:00' ? positionDisplay : ''}
            </div>
            <div className="loading-timer">
              {showTimer ? elapsedDisplay : ''}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}

LoadingOverlay.propTypes = {
  shouldRender: PropTypes.bool,
  isVisible: PropTypes.bool,
  isPaused: PropTypes.bool,
  pauseOverlayActive: PropTypes.bool,
  seconds: PropTypes.number,
  stalled: PropTypes.bool,
  waitingToPlay: PropTypes.bool,
  showPauseOverlay: PropTypes.bool,
  showDebug: PropTypes.bool,
  initialStart: PropTypes.number,
  message: PropTypes.string,
  debugContext: PropTypes.object,
  getMediaEl: PropTypes.func,
  plexId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  togglePauseOverlay: PropTypes.func,
  explicitShow: PropTypes.bool,
  countUpSeconds: PropTypes.number,
  countUpDisplay: PropTypes.string,
  playerPositionDisplay: PropTypes.string,
  intentPositionDisplay: PropTypes.string
};
