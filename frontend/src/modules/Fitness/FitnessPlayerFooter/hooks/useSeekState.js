/**
 * useSeekState - Manages seek-related state for the fitness player footer
 * 
 * Separates concerns:
 * - actualTime: The real video playhead position (from parent)
 * - intentTime: Where we've requested to seek (waiting for video to catch up)
 * - previewTime: Where user is hovering/dragging (visual only, no seek yet)
 * - displayTime: Computed value used ONLY for visuals
 * 
 * CRITICAL: displayTime should NEVER be used as a seek target.
 * Always use the explicit segment times from thumbnail props.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import playbackLog from '../../../Player/lib/playbackLogger.js';

const DEBUG_SEEK = false;
const SEEK_LOG_EVENT = 'fitness-seek-state';

const logSeekEvent = (phase, payload = {}) => {
  if (!DEBUG_SEEK) return;
  playbackLog(SEEK_LOG_EVENT, { phase, ...payload });
};

/**
 * Tolerance values for determining when a seek is "complete"
 */
const TOLERANCES = {
  BASE: 0.15,         // Seconds - initial tolerance while waiting
  CLEAR: 0.5,         // Seconds - tolerance for clearing pending state
  RELAXED: 0.75,      // Seconds - tolerance after grace period
  GRACE_MS: 650,      // How long after 'seeked' event to use relaxed tolerance
  MAX_HOLD_MS: 2500,  // Max time to hold pending state before force-clearing
  STICKY_MS: 700,     // How long to "remember" last seek for UI smoothness
  SETTLE_DELAY_MS: 100 // Delay before transitioning PLAYING to IDLE
};

/**
 * Seek lifecycle states
 * - idle: No seek in progress
 * - seeking: Seek requested, waiting for playhead to reach target
 * - buffering: Playhead at target, waiting for playback to resume
 * - playing: Playback resumed at target position
 */
export const SEEK_LIFECYCLE = {
  IDLE: 'idle',
  SEEKING: 'seeking',
  BUFFERING: 'buffering',
  PLAYING: 'playing'
};

export default function useSeekState({
  currentTime,
  playerRef,
  mediaElementKey,
  onSeekCommit,
  isStalled = false
}) {
  // Core state
  const [intentTime, setIntentTime] = useState(null);
  const [previewTime, setPreviewTime] = useState(null);

  // Seek lifecycle state
  const [lifecycle, setLifecycle] = useState(SEEK_LIFECYCLE.IDLE);
  
  // Tracking refs
  const awaitingSettleRef = useRef(false);
  const pendingMetaRef = useRef({ target: null, startedAt: 0, settledAt: 0 });
  const lastSeekRef = useRef({ time: null, expireAt: 0 });
  const rafRef = useRef(null);

  const nowTs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  /**
   * displayTime - VISUAL ONLY
   * Used for: highlighting active thumbnail, showing progress
   * NOT used for: seek targets
   */
  const displayTime = useMemo(() => {
    if (previewTime != null) return previewTime;
    if (intentTime != null) return intentTime;
    return currentTime;
  }, [previewTime, intentTime, currentTime]);

  /**
   * Sync seek intent to the resilience system for recovery after stalls
   */
  const syncToResilience = useCallback((seconds) => {
    if (!Number.isFinite(seconds)) return false;
    const api = playerRef?.current;
    const controller = api?.getMediaResilienceController?.();
    if (!controller) return false;
    
    if (typeof controller.recordSeekIntentSeconds === 'function') {
      controller.recordSeekIntentSeconds(seconds);
      return true;
    }
    if (typeof controller.recordSeekIntentMs === 'function') {
      controller.recordSeekIntentMs(Math.max(0, seconds * 1000));
      return true;
    }
    return false;
  }, [playerRef]);

  /**
   * Clear all pending seek state
   * Note: Uses ref to avoid dependency cycle with intentTime
   */
  const intentTimeRef = useRef(intentTime);
  intentTimeRef.current = intentTime;
  
  const clearIntent = useCallback((reason = 'manual') => {
    logSeekEvent('intent-cleared', { reason, previousIntent: intentTimeRef.current });
    pendingMetaRef.current = { target: null, startedAt: 0, settledAt: 0 };
    awaitingSettleRef.current = false;
    setIntentTime(null);
    lastSeekRef.current.expireAt = nowTs() + TOLERANCES.STICKY_MS;
  }, []);

  /**
   * Request a hard reload (for stalled recovery)
   */
  const requestHardReload = useCallback((targetSeconds) => {
    const api = playerRef?.current;
    if (!api) return false;
    
    const controller = api.getMediaResilienceController?.();
    const seekToIntentMs = Number.isFinite(targetSeconds) 
      ? Math.max(0, targetSeconds * 1000) 
      : null;
    
    if (controller?.forceReload) {
      controller.forceReload({ reason: 'fitness-stalled-seek', seekToIntentMs });
      return true;
    }
    if (api?.forceMediaReload) {
      api.forceMediaReload({ reason: 'fitness-stalled-seek', seekToIntentMs });
      return true;
    }
    return false;
  }, [playerRef]);

  /**
   * Commit a seek - this is the ONLY way to request a seek
   * @param {number} targetSeconds - The EXACT time to seek to (not displayTime!)
   */
  const commitSeek = useCallback((targetSeconds) => {
    if (!Number.isFinite(targetSeconds)) {
      logSeekEvent('commit-rejected', { reason: 'invalid-target', targetSeconds });
      return;
    }

    const normalizedTarget = Math.max(0, targetSeconds);

    logSeekEvent('commit', {
      target: normalizedTarget,
      currentTime,
      previousIntent: intentTime,
      isStalled
    });

    // Record intent
    setIntentTime(normalizedTarget);
    // Enter seeking state
    setLifecycle(SEEK_LIFECYCLE.SEEKING);
    awaitingSettleRef.current = true;
    pendingMetaRef.current = {
      target: normalizedTarget,
      startedAt: nowTs(),
      settledAt: 0
    };
    lastSeekRef.current.time = normalizedTarget;

    // Sync to resilience system
    syncToResilience(normalizedTarget);

    // Handle stalled state with hard reload
    if (isStalled) {
      const reloaded = requestHardReload(normalizedTarget);
      logSeekEvent('stalled-reload', { target: normalizedTarget, reloaded });
      if (reloaded) {
        onSeekCommit?.(normalizedTarget);
        return;
      }
    }

    // Normal seek via player
    const api = playerRef?.current;
    if (api?.seek) {
      api.seek(normalizedTarget);
    } else if (api?.getMediaElement) {
      const media = api.getMediaElement();
      if (media) media.currentTime = normalizedTarget;
    }

    onSeekCommit?.(normalizedTarget);
  }, [currentTime, intentTime, isStalled, playerRef, syncToResilience, requestHardReload, onSeekCommit]);

  /**
   * Set preview time (for hover/drag feedback)
   */
  const setPreview = useCallback((time) => {
    setPreviewTime(time);
  }, []);

  /**
   * Throttled preview update (for pointer move events)
   */
  const setPreviewThrottled = useCallback((time) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setPreviewTime(time));
  }, []);

  /**
   * Clear preview (on pointer leave)
   */
  const clearPreview = useCallback(() => {
    setPreviewTime(null);
  }, []);

  /**
   * Monitor currentTime to clear intentTime when seek completes
   */
  useEffect(() => {
    if (intentTime == null) return;

    const meta = pendingMetaRef.current;
    const target = Number.isFinite(meta.target) ? meta.target : intentTime;
    
    if (!Number.isFinite(target)) {
      clearIntent('invalid-target');
      return;
    }

    const now = nowTs();
    const delta = Math.abs(currentTime - target);
    const tolerance = awaitingSettleRef.current ? TOLERANCES.BASE : TOLERANCES.CLEAR;

    // Within tolerance - seek complete
    if (delta <= tolerance) {
      clearIntent('within-tolerance');
      return;
    }

    // Settled + grace period expired + within relaxed tolerance
    if (meta.settledAt && now - meta.settledAt > TOLERANCES.GRACE_MS && delta <= TOLERANCES.RELAXED) {
      clearIntent('grace-window');
      return;
    }

    // Max hold time expired
    if (meta.startedAt && now - meta.startedAt > TOLERANCES.MAX_HOLD_MS) {
      clearIntent('max-hold-expired');
    }
  }, [currentTime, intentTime, clearIntent]);

  /**
   * Transition from SEEKING to BUFFERING when playhead reaches target
   */
  useEffect(() => {
    if (lifecycle !== SEEK_LIFECYCLE.SEEKING) return;
    if (intentTime == null) return;

    const delta = Math.abs(currentTime - intentTime);
    if (delta <= TOLERANCES.CLEAR) {
      logSeekEvent('lifecycle-transition', { from: 'seeking', to: 'buffering', delta });
      setLifecycle(SEEK_LIFECYCLE.BUFFERING);
    }
  }, [lifecycle, currentTime, intentTime]);

  /**
   * Transition from BUFFERING to PLAYING when video actually plays
   */
  useEffect(() => {
    if (lifecycle !== SEEK_LIFECYCLE.BUFFERING) return;

    const el = playerRef?.current?.getMediaElement?.();
    if (!el) return;

    const handlePlaying = () => {
      logSeekEvent('lifecycle-transition', { from: 'buffering', to: 'playing' });
      setLifecycle(SEEK_LIFECYCLE.PLAYING);
    };

    // Check if already playing
    if (!el.paused && el.readyState >= 3) {
      setLifecycle(SEEK_LIFECYCLE.PLAYING);
      return;
    }

    el.addEventListener('playing', handlePlaying);
    return () => el.removeEventListener('playing', handlePlaying);
  }, [lifecycle, playerRef]);

  /**
   * Transition from PLAYING to IDLE after a short delay
   */
  useEffect(() => {
    if (lifecycle !== SEEK_LIFECYCLE.PLAYING) return;

    const timer = setTimeout(() => {
      logSeekEvent('lifecycle-transition', { from: 'playing', to: 'idle' });
      setLifecycle(SEEK_LIFECYCLE.IDLE);
      clearIntent('lifecycle-complete');
    }, 100);

    return () => clearTimeout(timer);
  }, [lifecycle, clearIntent]);

  /**
   * Listen for media element events
   */
  useEffect(() => {
    const el = playerRef?.current?.getMediaElement?.();
    if (!el) return;

    const handleSeeked = () => {
      if (awaitingSettleRef.current) {
        awaitingSettleRef.current = false;
        pendingMetaRef.current.settledAt = nowTs();
        logSeekEvent('media-seeked', { intentTime, currentTime });
      }
    };

    const handlePlaying = () => {
      handleSeeked();
      logSeekEvent('media-playing', { intentTime, currentTime });
    };

    const handleLoadedMetadata = () => {
      // Recovery event - clear stale intent
      if (awaitingSettleRef.current || intentTime != null) {
        clearIntent('media-recovery');
      }
    };

    el.addEventListener('seeked', handleSeeked);
    el.addEventListener('playing', handlePlaying);
    el.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      el.removeEventListener('seeked', handleSeeked);
      el.removeEventListener('playing', handlePlaying);
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [playerRef, intentTime, currentTime, mediaElementKey, clearIntent]);

  /**
   * Cleanup RAF on unmount
   */
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    // State
    displayTime,      // For visuals ONLY
    intentTime,       // Current seek intent (or null)
    previewTime,      // Current hover preview (or null)
    isSeekPending: intentTime != null,
    lifecycle,        // Seek lifecycle state (idle/seeking/buffering/playing)

    // Actions
    commitSeek,       // Request a seek (pass explicit target!)
    setPreview,       // Set preview time
    setPreviewThrottled, // Throttled preview update
    clearPreview,     // Clear preview
    clearIntent,      // Force clear pending state
  };
}
