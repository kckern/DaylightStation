import React, { useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import pause from '../../../assets/icons/pause.svg';
import { playbackLog } from '../lib/playbackLogger.js';

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
  playerPositionDisplay,
  suppressForBlackout = false
}) {
  // In blackout mode, keep screen completely dark (TV appears off)
  if (suppressForBlackout) {
    return null;
  }
  const isInitialPlayback = seconds === 0 && !stalled;
  const shouldShowPauseOverlay = shouldRender
    && isVisible
    && pauseOverlayActive
    && !waitingToPlay
    && !stalled
    && !isInitialPlayback;

  const overlayContextRef = useRef({ source: 'PlayerOverlayPaused' });
  const visibilityRef = useRef(shouldShowPauseOverlay);

  useEffect(() => {
    if (visibilityRef.current === shouldShowPauseOverlay) {
      return;
    }
    visibilityRef.current = shouldShowPauseOverlay;
    playbackLog('overlay.paused-visibility', {
      visible: shouldShowPauseOverlay,
      seconds,
      stalled,
      waitingToPlay,
      positionDisplay: playerPositionDisplay || null
    }, {
      level: shouldShowPauseOverlay ? 'info' : 'debug',
      context: overlayContextRef.current
    });
  }, [playerPositionDisplay, seconds, shouldShowPauseOverlay, stalled, waitingToPlay]);

  const blockFullscreenToggle = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.nativeEvent?.stopImmediatePropagation?.();
  }, []);

  const handlePauseToggle = useCallback((event) => {
    blockFullscreenToggle(event);
    playbackLog('overlay.pause-toggle', {
      trigger: event?.type || 'doubleclick',
      seconds,
      stalled,
      positionDisplay: playerPositionDisplay || null
    }, {
      level: 'info',
      context: overlayContextRef.current
    });
    togglePauseOverlay?.();
  }, [blockFullscreenToggle, playerPositionDisplay, seconds, stalled, togglePauseOverlay]);

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
      onDoubleClick={handlePauseToggle}
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
  playerPositionDisplay: PropTypes.string,
  suppressForBlackout: PropTypes.bool
};

export default PlayerOverlayPaused;
