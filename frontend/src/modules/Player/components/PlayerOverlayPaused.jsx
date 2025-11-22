import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import pause from '../../../assets/icons/pause.svg';

/**
 * Pause overlay shown when pause overlay preference is active and media is paused but healthy.
 */
export function PlayerOverlayPaused({
  shouldRender,
  isVisible,
  pauseOverlayActive = false,
  seconds = 0,
  stalled = false,
  waitingToPlay = false,
  togglePauseOverlay,
  playerPositionDisplay
}) {
  const isInitialPlayback = seconds === 0 && !stalled;
  const shouldShowPauseOverlay = shouldRender
    && isVisible
    && pauseOverlayActive
    && !waitingToPlay
    && !stalled
    && !isInitialPlayback;

  const blockFullscreenToggle = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
  }, []);

  if (!shouldShowPauseOverlay) {
    return null;
  }

  return (
    <div
      className="loading-overlay paused"
      data-no-fullscreen="true"
      style={{
        opacity: 1,
        transition: 'opacity 0.3s ease-in-out'
      }}
      onDoubleClick={togglePauseOverlay}
      onPointerDownCapture={blockFullscreenToggle}
      onMouseDownCapture={blockFullscreenToggle}
    >
      <div className="loading-overlay__inner">
        <div className="loading-timing">
          <div className="loading-spinner" data-no-fullscreen="true">
            <img
              src={pause}
              alt="Paused"
              draggable={false}
              data-no-fullscreen="true"
            />
            <div className="loading-metrics">
              <div className="loading-position">
                {playerPositionDisplay !== '0:00' ? playerPositionDisplay : ''}
              </div>
              <div className="loading-timer">Paused</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

PlayerOverlayPaused.propTypes = {
  shouldRender: PropTypes.bool,
  isVisible: PropTypes.bool,
  pauseOverlayActive: PropTypes.bool,
  seconds: PropTypes.number,
  stalled: PropTypes.bool,
  waitingToPlay: PropTypes.bool,
  togglePauseOverlay: PropTypes.func,
  playerPositionDisplay: PropTypes.string
};

export default PlayerOverlayPaused;
