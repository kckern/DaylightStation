import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import spinner from '../../../assets/icons/spinner.svg';
import pause from '../../../assets/icons/pause.svg';
import { formatSeekTime, mapReadyState, mapNetworkState } from '../lib/helpers.js';

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
  getMediaEl 
}) {
  const [visible, setVisible] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayVisible);
  const [showDebug, setShowDebug] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState(null);

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

  // Build a snapshot of media element state for debugging
  useEffect(() => {
    if (!showDebug) return;
    
    const collect = () => {
      const el = typeof getMediaEl === 'function' ? getMediaEl() : null;
      const err = el?.error ? (el.error.message || el.error.code) : undefined;
      const bufferedEnd = (() => { 
        try { 
          return el?.buffered?.length ? el.buffered.end(el.buffered.length - 1).toFixed(2) : undefined; 
        } catch { 
          return undefined; 
        } 
      })();
      
      setDebugSnapshot({
        when: new Date().toISOString(),
        context: debugContext || {},
        elPresent: !!el,
        readyState: el?.readyState,
        readyStateText: mapReadyState(el?.readyState),
        networkState: el?.networkState,
        networkStateText: mapNetworkState(el?.networkState),
        paused: el?.paused,
        seeking: el?.seeking,
        ended: el?.ended,
        currentTime: el?.currentTime,
        duration: el?.duration,
        bufferedEnd,
        src: el?.getAttribute?.('src'),
        currentSrc: el?.currentSrc,
        error: err,
        stalled
      });
    };
    
    collect();
    const id = setInterval(collect, 1000);
    return () => clearInterval(id);
  }, [showDebug, getMediaEl, debugContext, stalled]);

  const imgSrc = isPaused ? pause : spinner;
  const showSeekInfo = initialStart > 0 && seconds === 0 && !stalled;

  // Always show loading overlay when not paused (loading state)
  // For paused state, respect the user's toggle setting
  if (isPaused && !showPauseOverlay) {
    return null;
  }

  return (
    <div
      className={`loading-overlay ${isPaused ? 'paused' : 'loading'}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
      }}
    >
      <img src={imgSrc} alt="" />
      {(showSeekInfo || showDebug) && (
        <div className="loading-info">
          {showSeekInfo && <div>Loading at {formatSeekTime(initialStart)}</div>}
          {showDebug && (
            <pre style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>
{JSON.stringify(debugSnapshot, null, 2)}
            </pre>
          )}
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
  getMediaEl: PropTypes.func
};
