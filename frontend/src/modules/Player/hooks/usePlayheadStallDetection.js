/**
 * Playhead Stall Detection Hook
 * 
 * Detects when video playback becomes stuck by monitoring the playhead position.
 * Handles three specific failure modes:
 * 1. Playhead stall - position unchanged for > STALL_THRESHOLD_MS
 * 2. Playhead regression - position goes backwards (impossible in normal playback)
 * 3. Recovery failures - tracks attempts and prevents infinite loops
 * 
 * Issue #1 from bug bash: Video stuck at 5595.24s for 8 seconds with videoFps: 0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLogger } from '../../../lib/logging/Logger.js';

// Stall detection constants
const STALL_THRESHOLD_MS = 3000;    // Time before declaring a stall
const MAX_RECOVERY_ATTEMPTS = 3;    // Maximum recovery attempts before giving up
const CHECK_INTERVAL_MS = 500;      // How often to check for stalls
const POSITION_EPSILON = 0.001;     // Minimum movement to consider progress

/**
 * Get current heap memory usage in MB (if available)
 */
const getHeapMB = () => {
  try {
    if (typeof performance !== 'undefined' && performance.memory) {
      return Math.round(performance.memory.usedJSHeapSize / (1024 * 1024) * 10) / 10;
    }
  } catch (_) {
    // Memory API not available
  }
  return null;
};

/**
 * Get video FPS from quality metrics
 */
const getVideoFps = (mediaEl) => {
  if (!mediaEl) return 0;
  
  try {
    // Try standard API first
    if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
      const quality = mediaEl.getVideoPlaybackQuality();
      if (quality && quality.totalVideoFrames > 0 && mediaEl.currentTime > 0) {
        // Estimate FPS from frames / time
        return Math.round((quality.totalVideoFrames / mediaEl.currentTime) * 10) / 10;
      }
    }
    
    // Fallback to webkit prefixed
    const decoded = mediaEl.webkitDecodedFrameCount ?? mediaEl.mozDecodedFrames;
    if (Number.isFinite(decoded) && decoded > 0 && mediaEl.currentTime > 0) {
      return Math.round((decoded / mediaEl.currentTime) * 10) / 10;
    }
  } catch (_) {
    // Ignore errors
  }
  
  return 0;
};

/**
 * Hook for detecting playhead stalls and regressions
 *
 * @param {Object} options
 * @param {Function} options.getMediaEl - Function to get the media element
 * @param {boolean} options.enabled - Whether detection is enabled
 * @param {Object} options.meta - Media metadata for logging
 * @param {Function} options.onStallDetected - Callback when stall is detected
 * @param {Function} options.onRecoveryAttempt - Callback to attempt recovery
 * @param {Function} options.onRecoveryExhausted - Callback when all recovery attempts exhausted
 * @param {Function} options.onRecovered - Callback when playback recovers from a stall
 */
export function usePlayheadStallDetection({
  getMediaEl,
  enabled = true,
  meta = {},
  onStallDetected,
  onRecoveryAttempt,
  onRecoveryExhausted,
  onRecovered
}) {
  // Track playhead position for stall/regression detection
  const lastPlayheadPositionRef = useRef(null);
  const stallStartTimeRef = useRef(null);
  const recoveryAttemptsRef = useRef(0);
  const lastCheckTimeRef = useRef(Date.now());
  const checkIntervalRef = useRef(null);
  const hasLoggedCurrentStallRef = useRef(false);
  
  // Expose stall state for consumers
  const [stallInfo, setStallInfo] = useState({
    isStalled: false,
    stallDurationMs: 0,
    recoveryAttempts: 0,
    position: null,
    lastRegression: null
  });

  const logger = getLogger();
  const assetId = meta.assetId || meta.key || meta.guid || meta.id || meta.plex || meta.mediaUrl;

  /**
   * Log a playback event
   */
  const logEvent = useCallback((eventName, data = {}) => {
    const mediaEl = typeof getMediaEl === 'function' ? getMediaEl() : null;
    
    logger.info(eventName, {
      title: meta?.title || meta?.name,
      artist: meta?.artist,
      album: meta?.album,
      show: meta?.show,
      season: meta?.season,
      mediaKey: assetId,
      position: mediaEl?.currentTime || null,
      duration: mediaEl?.duration || null,
      videoFps: mediaEl ? getVideoFps(mediaEl) : 0,
      heapMB: getHeapMB(),
      ...data
    });
  }, [logger, meta, assetId, getMediaEl]);

  /**
   * Attempt recovery from a stall
   */
  const attemptRecovery = useCallback(() => {
    const mediaEl = typeof getMediaEl === 'function' ? getMediaEl() : null;
    if (!mediaEl) return false;

    const currentAttempts = recoveryAttemptsRef.current;
    const position = mediaEl.currentTime;
    
    if (currentAttempts >= MAX_RECOVERY_ATTEMPTS) {
      logEvent('playback.recovery_exhausted', {
        recoveryAttempts: currentAttempts,
        stallDurationMs: stallStartTimeRef.current ? Date.now() - stallStartTimeRef.current : 0,
        position
      });
      
      if (typeof onRecoveryExhausted === 'function') {
        onRecoveryExhausted({
          position,
          recoveryAttempts: currentAttempts,
          stallDurationMs: stallStartTimeRef.current ? Date.now() - stallStartTimeRef.current : 0
        });
      }
      return false;
    }

    recoveryAttemptsRef.current = currentAttempts + 1;
    
    // Determine strategy based on attempt number
    let strategy;
    if (recoveryAttemptsRef.current === 1) {
      strategy = 'pause_resume';
    } else if (recoveryAttemptsRef.current === 2) {
      strategy = 'seek_nudge';
    } else {
      strategy = 'decoder_reset';
    }

    logEvent('playback.recovery_attempt', {
      recoveryAttempts: recoveryAttemptsRef.current,
      maxAttempts: MAX_RECOVERY_ATTEMPTS,
      position,
      stallDurationMs: stallStartTimeRef.current ? Date.now() - stallStartTimeRef.current : 0,
      strategy
    });

    try {
      if (strategy === 'pause_resume') {
        // First attempt: simple pause/resume
        mediaEl.pause();
        requestAnimationFrame(() => {
          mediaEl.play().catch(() => {});
        });
      } else if (strategy === 'seek_nudge') {
        // Second attempt: nudge the playhead slightly backward
        const nudgeAmount = 0.1;
        mediaEl.currentTime = Math.max(0, position - nudgeAmount);
        mediaEl.play().catch(() => {});
      } else if (strategy === 'decoder_reset') {
        // Third attempt: full decoder reset via load()
        // Preserve the current position before resetting
        const savedPosition = position;
        const savedSrc = mediaEl.src;

        // Setup cleanup function to ensure listeners are always removed
        let timeoutId = null;

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          mediaEl.removeEventListener('canplay', onCanPlay);
          mediaEl.removeEventListener('error', onError);
        };

        const onCanPlay = () => {
          cleanup();
          mediaEl.currentTime = savedPosition;
          mediaEl.play().catch(() => {});
        };

        const onError = () => {
          cleanup();
          logger.warn('playback.decoder_reset_failed', {
            position: savedPosition,
            error: 'media_error'
          });
        };

        // Timeout to clean up if canplay never fires (e.g., network failure)
        timeoutId = setTimeout(() => {
          cleanup();
          logger.warn('playback.decoder_reset_timeout', {
            position: savedPosition,
            timeoutMs: 5000
          });
        }, 5000);

        mediaEl.addEventListener('canplay', onCanPlay);
        mediaEl.addEventListener('error', onError);

        // Force a full decoder reset
        mediaEl.load();

        // If src was cleared by load(), restore it
        if (!mediaEl.src && savedSrc) {
          mediaEl.src = savedSrc;
        }
      }

      if (typeof onRecoveryAttempt === 'function') {
        onRecoveryAttempt({
          attempt: recoveryAttemptsRef.current,
          maxAttempts: MAX_RECOVERY_ATTEMPTS,
          position,
          strategy
        });
      }

      return true;
    } catch (err) {
      logger.warn('playback.recovery_error', {
        error: err.message,
        recoveryAttempts: recoveryAttemptsRef.current,
        position
      });
      return false;
    }
  }, [getMediaEl, logEvent, logger, onRecoveryAttempt, onRecoveryExhausted]);

  /**
   * Check for playhead stall or regression
   */
  const checkPlayhead = useCallback(() => {
    const mediaEl = typeof getMediaEl === 'function' ? getMediaEl() : null;
    if (!mediaEl) return;

    // Skip if paused, ended, or not ready
    if (mediaEl.paused || mediaEl.ended || mediaEl.readyState < 2) {
      // Reset stall tracking when legitimately paused
      if (mediaEl.paused && !mediaEl.ended) {
        stallStartTimeRef.current = null;
        hasLoggedCurrentStallRef.current = false;
      }
      return;
    }

    const currentTime = mediaEl.currentTime;
    const now = Date.now();
    const lastPosition = lastPlayheadPositionRef.current;
    const lastCheckTime = lastCheckTimeRef.current;

    // Update check time
    lastCheckTimeRef.current = now;

    // First check - initialize position tracking
    if (lastPosition === null) {
      lastPlayheadPositionRef.current = currentTime;
      return;
    }

    // Check for playhead regression (backwards movement)
    if (currentTime < lastPosition - POSITION_EPSILON) {
      logEvent('playback.regression_detected', {
        previousPosition: lastPosition,
        currentPosition: currentTime,
        regressionAmount: lastPosition - currentTime,
        timeSinceLastCheck: now - lastCheckTime
      });

      setStallInfo(prev => ({
        ...prev,
        lastRegression: {
          from: lastPosition,
          to: currentTime,
          at: now
        }
      }));

      // Regression is a strong signal of problems - attempt recovery
      attemptRecovery();
    }

    // Check for playhead stall (no movement)
    const hasProgressed = Math.abs(currentTime - lastPosition) > POSITION_EPSILON;

    if (hasProgressed) {
      // Playhead is moving - reset stall tracking
      if (stallStartTimeRef.current !== null) {
        // We recovered from a stall
        const stallDuration = now - stallStartTimeRef.current;
        if (stallDuration > STALL_THRESHOLD_MS) {
          logEvent('playback.stall_recovered', {
            position: currentTime,
            stallDurationMs: stallDuration,
            recoveryAttempts: recoveryAttemptsRef.current
          });

          if (typeof onRecovered === 'function') {
            onRecovered({
              position: currentTime,
              stallDurationMs: stallDuration,
              recoveryAttempts: recoveryAttemptsRef.current
            });
          }
        }
      }
      
      stallStartTimeRef.current = null;
      hasLoggedCurrentStallRef.current = false;
      recoveryAttemptsRef.current = 0;
      lastPlayheadPositionRef.current = currentTime;
      
      setStallInfo({
        isStalled: false,
        stallDurationMs: 0,
        recoveryAttempts: 0,
        position: currentTime,
        lastRegression: null
      });
      return;
    }

    // No progress detected - track stall duration
    if (stallStartTimeRef.current === null) {
      stallStartTimeRef.current = now;
    }

    const stallDuration = now - stallStartTimeRef.current;

    // Update stall info state
    setStallInfo(prev => ({
      ...prev,
      isStalled: stallDuration >= STALL_THRESHOLD_MS,
      stallDurationMs: stallDuration,
      recoveryAttempts: recoveryAttemptsRef.current,
      position: currentTime
    }));

    // Check if we've hit the stall threshold
    if (stallDuration >= STALL_THRESHOLD_MS) {
      // Log stall detection (only once per stall episode)
      if (!hasLoggedCurrentStallRef.current) {
        hasLoggedCurrentStallRef.current = true;
        
        logEvent('playback.stall_detected', {
          position: currentTime,
          stallDurationMs: stallDuration,
          recoveryAttempts: recoveryAttemptsRef.current,
          videoFps: getVideoFps(mediaEl),
          heapMB: getHeapMB(),
          readyState: mediaEl.readyState,
          networkState: mediaEl.networkState,
          buffered: mediaEl.buffered?.length > 0 
            ? { start: mediaEl.buffered.start(0), end: mediaEl.buffered.end(mediaEl.buffered.length - 1) }
            : null
        });

        if (typeof onStallDetected === 'function') {
          onStallDetected({
            position: currentTime,
            stallDurationMs: stallDuration,
            recoveryAttempts: recoveryAttemptsRef.current,
            videoFps: getVideoFps(mediaEl),
            heapMB: getHeapMB()
          });
        }
      }

      // Attempt recovery if we haven't exhausted attempts
      if (recoveryAttemptsRef.current < MAX_RECOVERY_ATTEMPTS) {
        attemptRecovery();
      }
    }

    // Update last position for next check
    lastPlayheadPositionRef.current = currentTime;
  }, [getMediaEl, logEvent, attemptRecovery, onStallDetected, onRecovered]);

  /**
   * Reset all stall detection state
   */
  const resetStallState = useCallback(() => {
    lastPlayheadPositionRef.current = null;
    stallStartTimeRef.current = null;
    recoveryAttemptsRef.current = 0;
    hasLoggedCurrentStallRef.current = false;
    lastCheckTimeRef.current = Date.now();
    
    setStallInfo({
      isStalled: false,
      stallDurationMs: 0,
      recoveryAttempts: 0,
      position: null,
      lastRegression: null
    });
  }, []);

  // Setup and cleanup check interval
  useEffect(() => {
    if (!enabled) {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      return;
    }

    // Start checking
    checkIntervalRef.current = setInterval(checkPlayhead, CHECK_INTERVAL_MS);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [enabled, checkPlayhead]);

  // Reset state when media changes
  useEffect(() => {
    resetStallState();
  }, [assetId, resetStallState]);

  return {
    stallInfo,
    resetStallState,
    checkPlayhead,
    // Expose constants for testing
    constants: {
      STALL_THRESHOLD_MS,
      MAX_RECOVERY_ATTEMPTS,
      CHECK_INTERVAL_MS
    }
  };
}

export { STALL_THRESHOLD_MS, MAX_RECOVERY_ATTEMPTS };
