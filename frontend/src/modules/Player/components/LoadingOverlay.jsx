import React from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';
import { formatSeekTime } from '../lib/helpers.js';
import { DebugInfo } from './DebugInfo.jsx';

/**
 * Pure presentation component for media loading / pause overlay.
 * All timing and state decisions are handled upstream by useMediaResilience.
 */
export function LoadingOverlay({
  shouldRender,
  isVisible,
  isPaused,
  seconds = 0,
  stalled = false,
  waitingToPlay = false,
  showPauseOverlay = false,
  showDebug = false,
  initialStart = 0,
  message,
  debugContext,
  getMediaEl,
  plexId,
  togglePauseOverlay,
  explicitShow = false
}) {
  if (!shouldRender) {
    return null;
  }

  const isInitialPlayback = seconds === 0 && !stalled;
  const shouldShowPauseIcon = isPaused && !isInitialPlayback && !waitingToPlay;
  const imgSrc = shouldShowPauseIcon ? pause : spinner;
  const showSeekInfo = initialStart > 0 && seconds === 0 && !stalled && explicitShow;
  const overlayStateClass = (shouldShowPauseIcon && !waitingToPlay) ? 'paused' : 'loading';

  return (
    <div
      className={`loading-overlay ${overlayStateClass}`}
      style={{
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out'
      }}
      onDoubleClick={togglePauseOverlay}
    >
      <img src={imgSrc} alt="" />
      {message && (
        <div className="loading-message" style={{ marginTop: 8 }}>
          {message}
        </div>
      )}
      {(showSeekInfo || showDebug) && (
        <div className="loading-info">
          {showSeekInfo && <div>Loading at {formatSeekTime(initialStart)}</div>}
          <DebugInfo
            show={showDebug}
            debugContext={debugContext}
            getMediaEl={getMediaEl}
            stalled={stalled}
            plexId={plexId}
          />
        </div>
      )}
      {shouldShowPauseIcon && !waitingToPlay && !showPauseOverlay && (
        <div className="loading-hint">
          Double-click to show pause overlay
        </div>
      )}
    </div>
  );
}

LoadingOverlay.propTypes = {
  shouldRender: PropTypes.bool,
  isVisible: PropTypes.bool,
  isPaused: PropTypes.bool,
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
  explicitShow: PropTypes.bool
};
