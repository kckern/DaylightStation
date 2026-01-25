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
  const overlayRef = useRef(null);

  useEffect(() => {
    if (visibilityRef.current === shouldShowPauseOverlay) {
      return;
    }
    visibilityRef.current = shouldShowPauseOverlay;

    // Get dimension diagnostics
    const overlayEl = overlayRef.current;
    const overlayRect = overlayEl?.getBoundingClientRect?.() ?? null;
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    // Calculate gaps
    const discrepancy = overlayRect ? {
      top: overlayRect.y,
      left: overlayRect.x,
      bottom: viewport.height - (overlayRect.y + overlayRect.height),
      right: viewport.width - (overlayRect.x + overlayRect.width),
      widthDiff: viewport.width - overlayRect.width,
      heightDiff: viewport.height - overlayRect.height
    } : null;

    const hasGap = discrepancy && (
      Math.abs(discrepancy.top) > 0.5 ||
      Math.abs(discrepancy.left) > 0.5 ||
      Math.abs(discrepancy.bottom) > 0.5 ||
      Math.abs(discrepancy.right) > 0.5
    );

    const computedStyles = overlayEl ? window.getComputedStyle(overlayEl) : null;

    playbackLog('overlay.paused-visibility', {
      visible: shouldShowPauseOverlay,
      seconds,
      stalled,
      waitingToPlay,
      positionDisplay: playerPositionDisplay || null,
      dimensions: overlayRect ? {
        x: Math.round(overlayRect.x * 100) / 100,
        y: Math.round(overlayRect.y * 100) / 100,
        width: Math.round(overlayRect.width * 100) / 100,
        height: Math.round(overlayRect.height * 100) / 100
      } : null,
      viewport,
      discrepancy: discrepancy ? {
        top: Math.round(discrepancy.top * 100) / 100,
        left: Math.round(discrepancy.left * 100) / 100,
        bottom: Math.round(discrepancy.bottom * 100) / 100,
        right: Math.round(discrepancy.right * 100) / 100
      } : null,
      hasGap,
      computed: computedStyles ? {
        position: computedStyles.position,
        top: computedStyles.top,
        left: computedStyles.left,
        width: computedStyles.width,
        height: computedStyles.height,
        display: computedStyles.display
      } : null
    }, {
      level: shouldShowPauseOverlay ? (hasGap ? 'warn' : 'info') : 'debug',
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
      ref={overlayRef}
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
