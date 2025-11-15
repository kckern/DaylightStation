import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';
import { formatSeekTime } from '../lib/helpers.js';
import { DebugInfo } from './DebugInfo.jsx';

// Global state for pause overlay visibility preference
let pauseOverlayVisible = true;
const debugTimeout = 5000; // ms

/**
 * Loading overlay component for displaying loading/paused state with debug info
 */
export function LoadingOverlay({ 
  isPaused, 
  fetchVideoInfo, 
  onTogglePauseOverlay, 
  initialStart = 0, 
  seconds = 0, 
  stalled, 
  debugContext, 
  getMediaEl,
  plexId,
  message,
  show = true,
  waitForPlaybackStart = false,
  waitForPlaybackKey,
  gracePeriodMs = 500,
  reloadOnStallMs
}) {
  const [visible, setVisible] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayVisible);
  const [showDebug, setShowDebug] = useState(false);
  const [waitingForPlayback, setWaitingForPlayback] = useState(false);
  const [graceElapsed, setGraceElapsed] = useState(!waitForPlaybackStart);
  const listenerCleanupRef = useRef(() => {});
  const attachIntervalRef = useRef(null);
  const reloadTimeoutRef = useRef(null);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    setShowPauseOverlay(pauseOverlayVisible);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isPaused && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const newVisibility = !showPauseOverlay;
        setShowPauseOverlay(newVisibility);
        pauseOverlayVisible = newVisibility; // Remember setting globally
      }
    };

    if (isPaused) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (isPaused) {
        window.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [isPaused, showPauseOverlay]);

  useEffect(() => {
    if (!isPaused) {
      const interval = setInterval(() => {
        setLoadingTime((prev) => prev + 1);
      }, 1000);

      if (loadingTime >= 10) {
        fetchVideoInfo?.();
        setLoadingTime(0); // Reset loading time after fetching
      }

      return () => clearInterval(interval);
    } else {
      setLoadingTime(0); // Reset loading time if paused
    }
  }, [isPaused, loadingTime, fetchVideoInfo]);

  // After 3s on initial load (seconds===0), reveal debug info
  useEffect(() => {
    if (isPaused) { setShowDebug(false); return; }
    let to;
    if (visible && seconds === 0) {
      to = setTimeout(() => setShowDebug(true), debugTimeout || 3000);
    } else {
      setShowDebug(false);
    }
    return () => { if (to) clearTimeout(to); };
  }, [visible, seconds, isPaused]);

  useEffect(() => {
    if (!waitForPlaybackStart) {
      setWaitingForPlayback(false);
      setGraceElapsed(true);
      return () => {};
    }

    setWaitingForPlayback(true);
    setGraceElapsed(false);

    const graceTimer = setTimeout(() => setGraceElapsed(true), gracePeriodMs);

    const attachListeners = () => {
      const element = typeof getMediaEl === 'function' ? getMediaEl() : null;
      if (!element) return false;

      const markStarted = () => setWaitingForPlayback(false);
      const markFailed = () => setGraceElapsed(true);

      element.addEventListener('canplay', markStarted);
      element.addEventListener('play', markStarted);
      element.addEventListener('playing', markStarted);
      element.addEventListener('error', markFailed);

      listenerCleanupRef.current = () => {
        element.removeEventListener('canplay', markStarted);
        element.removeEventListener('play', markStarted);
        element.removeEventListener('playing', markStarted);
        element.removeEventListener('error', markFailed);
      };

      return true;
    };

    const attached = attachListeners();
    if (!attached) {
      attachIntervalRef.current = setInterval(() => {
        if (attachListeners()) {
          clearInterval(attachIntervalRef.current);
          attachIntervalRef.current = null;
        }
      }, 100);
    }

    return () => {
      clearTimeout(graceTimer);
      listenerCleanupRef.current?.();
      if (attachIntervalRef.current) {
        clearInterval(attachIntervalRef.current);
        attachIntervalRef.current = null;
      }
    };
  }, [waitForPlaybackStart, waitForPlaybackKey, getMediaEl, gracePeriodMs]);

  const waitingToPlay = waitForPlaybackStart && waitingForPlayback && graceElapsed;

  useEffect(() => {
    if (!reloadOnStallMs) {
      return () => {};
    }

    if (waitingToPlay && seconds === 0 && !isPaused) {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
      reloadTimeoutRef.current = setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, reloadOnStallMs);
    } else if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
    }

    return () => {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, [waitingToPlay, seconds, isPaused, reloadOnStallMs]);

  const isInitialPlayback = seconds === 0 && !stalled; // Media is still starting up, not user-paused
  const explicitShow = show ?? true;
  const shouldRender = waitingToPlay || explicitShow || (isPaused && showPauseOverlay);

  if (!shouldRender) {
    return null;
  }

  const shouldShowPauseIcon = isPaused && !isInitialPlayback;
  const imgSrc = shouldShowPauseIcon ? pause : spinner;
  const showSeekInfo = initialStart > 0 && seconds === 0 && !stalled;

  return (
    <div
      className={`loading-overlay ${(shouldShowPauseIcon && !waitingToPlay) ? 'paused' : 'loading'}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
      }}
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
    </div>
  );
}

LoadingOverlay.propTypes = {
  isPaused: PropTypes.bool,
  fetchVideoInfo: PropTypes.func,
  onTogglePauseOverlay: PropTypes.func,
  initialStart: PropTypes.number,
  seconds: PropTypes.number,
  stalled: PropTypes.bool,
  debugContext: PropTypes.object,
  getMediaEl: PropTypes.func,
  plexId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  message: PropTypes.string,
  show: PropTypes.bool,
  waitForPlaybackStart: PropTypes.bool,
  waitForPlaybackKey: PropTypes.any,
  gracePeriodMs: PropTypes.number,
  reloadOnStallMs: PropTypes.number
};
