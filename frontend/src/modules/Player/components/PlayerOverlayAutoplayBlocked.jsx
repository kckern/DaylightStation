import React, { useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import { playbackLog } from '../lib/playbackLogger.js';

/**
 * Overlay shown when the browser blocks autoplay (NotAllowedError).
 * A click/tap/keypress provides a real user gesture, satisfying Firefox's autoplay policy.
 * The actual play() call happens in onAutoplayResolved (VideoPlayer), which has
 * direct access to the shadow DOM inner <video>.
 */
export function PlayerOverlayAutoplayBlocked({
  autoplayBlocked = false,
  onAutoplayResolved,
  suppressForBlackout = false
}) {
  const triggerPlay = useCallback((source) => {
    playbackLog('autoplay-blocked-tap', { ts: Date.now(), source });
    if (typeof onAutoplayResolved === 'function') {
      onAutoplayResolved();
    }
  }, [onAutoplayResolved]);

  const handleClick = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    triggerPlay('click');
  }, [triggerPlay]);

  // Keyboard: Space, Enter, or MediaPlayPause
  useEffect(() => {
    if (!autoplayBlocked) return;
    const handleKeyDown = (event) => {
      if (event.key === ' ' || event.key === 'Enter' || event.key === 'MediaPlayPause') {
        event.preventDefault();
        event.stopPropagation();
        triggerPlay('keyboard');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [autoplayBlocked, triggerPlay]);

  if (!autoplayBlocked || suppressForBlackout) return null;

  return (
    <div
      className="loading-overlay loading"
      data-no-fullscreen="true"
      style={{ opacity: 1, cursor: 'pointer', zIndex: 100 }}
      onClick={handleClick}
      onTouchStart={handleClick}
    >
      <div className="loading-overlay__inner">
        <div className="loading-timing">
          <div className="loading-spinner" data-no-fullscreen="true">
            <svg
              viewBox="0 0 64 64"
              width="100%"
              height="100%"
            >
              <polygon points="20,12 52,32 20,52" fill="rgba(255,255,255,0.6)" />
            </svg>
            <div className="loading-metrics">
              <div className="loading-position" style={{ color: '#FFFFFF99' }}>
                Tap to Play
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

PlayerOverlayAutoplayBlocked.propTypes = {
  autoplayBlocked: PropTypes.bool,
  onAutoplayResolved: PropTypes.func,
  suppressForBlackout: PropTypes.bool
};

export default PlayerOverlayAutoplayBlocked;
