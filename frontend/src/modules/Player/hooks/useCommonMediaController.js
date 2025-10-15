import { useRef, useEffect, useState, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent } from '../lib/helpers.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';

/**
 * Common media controller hook for both audio and video players
 * Handles playback state, progress tracking, stall detection, and media events
 */
export function useCommonMediaController({
  start = 0,
  playbackRate = 1,
  onEnd = () => {},
  onClear = () => {},
  isAudio = false,
  isVideo = false,
  meta,
  type,
  onShaderLevelChange = () => {},
  shader,
  volume,
  cycleThroughClasses,
  playbackKeys,
  queuePosition,
  ignoreKeys,
  onProgress,
  onMediaRef,
  stallConfig = {}
}) {
  const media_key = meta.media_key || meta.key || meta.guid || meta.id || meta.plex || meta.media_url;
  const containerRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const lastLoggedTimeRef = useRef(0);
  const lastUpdatedTimeRef = useRef(0);
  
  // Stall detection refs
  const stallStateRef = useRef({
    lastProgressTs: 0,
    softTimer: null,
    hardTimer: null,
    recoveryAttempt: 0,
    isStalled: false,
    lastStrategy: 'none'
  });
  const [isStalled, setIsStalled] = useState(false);

  // Config with sane defaults
  // recoveryStrategies: Array of strategies to attempt in order
  //   - 'nudge': Tiny time adjustment (fastest, least disruptive)
  //   - 'reload': Full media element reload (more aggressive)
  //   - 'seekback': Jump back several seconds
  // Example: ['nudge', 'nudge', 'reload'] tries nudge twice, then reload
  const {
    enabled = true,
    softMs = 1200,
    hardMs = 8000,
    recoveryStrategies = ['nudge', 'reload'],
    seekBackOnReload = 2,
    mode = 'auto',
    debug = false
  } = stallConfig || {};

  const getMediaEl = useCallback(() => {
    const mediaEl = containerRef.current?.shadowRoot?.querySelector('video') || containerRef.current;
    if (!mediaEl) return null;
    return mediaEl;
  }, []);

  const isDash = meta.media_type === 'dash_video';

  const handleProgressClick = useCallback((event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    mediaEl.currentTime = (clickX / rect.width) * duration;
  }, [duration, getMediaEl]);

  // Use centralized keyboard handler
  useMediaKeyboardHandler({
    getMediaEl,
    onEnd,
    onClear,
    cycleThroughClasses,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    meta,
    type,
    media_key,
    setCurrentTime: setSeconds
  });

  // Helper: debug log
  const dlog = useCallback((...args) => { 
    if (debug) console.log('[PlayerStall]', ...args); 
  }, [debug]);

  // Memoize check interval
  const checkInterval = Math.min(500, softMs / 3);

  // Clear timers utility
  const clearTimers = useCallback(() => {
    const s = stallStateRef.current;
    if (s.softTimer) { clearTimeout(s.softTimer); s.softTimer = null; }
    if (s.hardTimer) { clearTimeout(s.hardTimer); s.hardTimer = null; }
  }, []);

  // Recovery strategies
  const recoveryMethods = {
    // Nudge: Tiny time adjustment to trigger buffer reload
    nudge: useCallback(() => {
      const mediaEl = getMediaEl();
      if (!mediaEl) return false;
      
      dlog('Recovery: nudge currentTime');
      try {
        const t = mediaEl.currentTime;
        mediaEl.pause();
        mediaEl.currentTime = Math.max(0, t - 0.001);
        mediaEl.play().catch(() => {});
        return true;
      } catch (_) {
        return false;
      }
    }, [getMediaEl, dlog]),

    // Reload: Full media element reset
    reload: useCallback(() => {
      const mediaEl = getMediaEl();
      if (!mediaEl) {
        dlog('Recovery: reload failed, no media element');
        return false;
      }
      
      dlog('Recovery: reloading media element');
      const priorTime = mediaEl.currentTime || 0;
      const src = mediaEl.getAttribute('src');
      
      try {
        mediaEl.pause();
        mediaEl.removeAttribute('src');
        mediaEl.load();
        
        setTimeout(() => {
          try {
            if (src) mediaEl.setAttribute('src', src);
            mediaEl.load();
            mediaEl.addEventListener('loadedmetadata', function handleOnce() {
              mediaEl.removeEventListener('loadedmetadata', handleOnce);
              const target = Math.max(0, priorTime - seekBackOnReload);
              if (Number.isFinite(target)) {
                try { mediaEl.currentTime = target; } catch (_) {}
              }
              mediaEl.play().catch(() => {});
            }, { once: true });
          } catch (_) {}
        }, 50);
        return true;
      } catch (_) {
        return false;
      }
    }, [getMediaEl, dlog, seekBackOnReload]),

    // Seek back: Jump back a few seconds
    seekback: useCallback((seconds = 5) => {
      const mediaEl = getMediaEl();
      if (!mediaEl) return false;
      
      dlog(`Recovery: seeking back ${seconds}s`);
      try {
        mediaEl.currentTime = Math.max(0, mediaEl.currentTime - seconds);
        return true;
      } catch (_) {
        return false;
      }
    }, [getMediaEl, dlog])
  };

  // Execute next recovery strategy
  const attemptRecovery = useCallback(() => {
    const s = stallStateRef.current;
    const strategy = recoveryStrategies[s.recoveryAttempt];
    
    if (!strategy) {
      dlog('No more recovery strategies available');
      return false;
    }
    
    const method = recoveryMethods[strategy];
    if (!method) {
      dlog(`Unknown recovery strategy: ${strategy}`);
      s.recoveryAttempt++;
      return attemptRecovery();
    }
    
    s.lastStrategy = strategy;
    const success = method();
    s.recoveryAttempt++;
    
    return success;
  }, [dlog, recoveryStrategies, recoveryMethods]);

  const scheduleStallDetection = useCallback(() => {
    if (!enabled) return;
    const s = stallStateRef.current;
    if (s.softTimer || s.isStalled) return;
    
    const mediaEl = getMediaEl();
    if (!mediaEl || mediaEl.paused) return;
    
    s.softTimer = setTimeout(() => {
      const mediaEl = getMediaEl();
      
      // If media element is gone or paused, stop checking
      if (!mediaEl || mediaEl.paused) {
        clearTimers();
        return;
      }
      
      const s = stallStateRef.current;
      
      if (s.lastProgressTs === 0) {
        // No progress yet, reschedule
        s.softTimer = null;
        scheduleStallDetection();
        return;
      }
      
      const diff = Date.now() - s.lastProgressTs;
      if (diff >= softMs) {
        s.isStalled = true;
        setIsStalled(true);
        dlog('Soft stall confirmed after', diff, 'ms');
        
        if (mode === 'auto') {
          s.hardTimer = setTimeout(() => {
            const s = stallStateRef.current;
            if (!s.isStalled) return;
            
            if (s.recoveryAttempt < recoveryStrategies.length) {
              clearTimers();
              attemptRecovery();
              scheduleStallDetection();
            } else {
              dlog('All recovery strategies exhausted');
            }
          }, Math.max(0, hardMs - softMs));
        }
      } else {
        // Not stalled yet, keep checking
        s.softTimer = null;
        scheduleStallDetection();
      }
    }, checkInterval);
  }, [enabled, softMs, hardMs, recoveryStrategies, checkInterval, getMediaEl, dlog, clearTimers, attemptRecovery]);

  const markProgress = useCallback(() => {
    const s = stallStateRef.current;
    s.lastProgressTs = Date.now();
    if (s.isStalled) {
      dlog('Recovery: progress resumed');
      s.isStalled = false;
      s.recoveryAttempt = 0; // Reset recovery attempts
      clearTimers();
      setIsStalled(false);
      scheduleStallDetection();
    }
    // Continuous polling in scheduleStallDetection handles rescheduling
  }, [dlog, clearTimers, scheduleStallDetection]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return;

    const logProgress = async () => {
      const now = Date.now();
      lastUpdatedTimeRef.current = now;
      const diff = now - lastLoggedTimeRef.current;
      const pct = getProgressPercent(mediaEl.currentTime || 0, mediaEl.duration || 0);
      if (diff > 10000 && parseFloat(pct) > 0) {
        lastLoggedTimeRef.current = now;
        const secs = mediaEl.currentTime || 0;
        if (secs > 10) {
          const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
          await DaylightAPI(`media/log`, { title, type, media_key, seconds: secs, percent: pct });
        }
      }
    };

    const onTimeUpdate = () => {
      setSeconds(mediaEl.currentTime);
      logProgress();
      markProgress();
      if (onProgress) {
        onProgress({
          currentTime: mediaEl.currentTime || 0,
          duration: mediaEl.duration || 0,
          paused: mediaEl.paused,
          media: meta,
          percent: getProgressPercent(mediaEl.currentTime, mediaEl.duration),
          stalled: isStalled,
          recoveryAttempt: stallStateRef.current.recoveryAttempt,
          lastStrategy: stallStateRef.current.lastStrategy
        });
      }
    };

    const onDurationChange = () => {
      setDuration(mediaEl.duration);
    };

    const onEnded = () => {
      const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
      lastLoggedTimeRef.current = 0;
      logProgress();
      onEnd();
    };

    const onLoadedMetadata = () => {
      const duration = mediaEl.duration || 0;
      
      let processedVolume = parseFloat(volume || 100);
      if (processedVolume > 1) {
        processedVolume = processedVolume / 100;
      }
      
      const adjustedVolume = Math.min(1, Math.max(0, processedVolume));
      const isVideo = ['video', 'dash_video'].includes(mediaEl.tagName.toLowerCase());
      let startTime = (duration > (12 * 60) || isVideo) ? start : 0;
      
      if (duration > 0 && startTime > 0) {
        const progressPercent = (startTime / duration) * 100;
        const secondsRemaining = duration - startTime;
        if (progressPercent > 95 || secondsRemaining < 30) {
          startTime = 0;
        }
      }
      
      mediaEl.dataset.key = media_key;
      if (Number.isFinite(startTime)) mediaEl.currentTime = startTime;
      mediaEl.autoplay = true;
      mediaEl.volume = adjustedVolume;
      
      if ((isVideo && duration < 20) || meta.continuous) {
        mediaEl.loop = true;
      }
      
      if (isVideo) {
        mediaEl.controls = false;
        mediaEl.addEventListener('play', () => {
          mediaEl.playbackRate = playbackRate;
        }, { once: false });
        mediaEl.addEventListener('seeked', () => {
          mediaEl.playbackRate = playbackRate;
        }, { once: false });
      } else {
        mediaEl.playbackRate = playbackRate;
      }
      
      stallStateRef.current.lastProgressTs = Date.now();
      scheduleStallDetection();
    };

    const handleSeeking = () => setIsSeeking(true);
    const clearSeeking = () => {
      requestAnimationFrame(() => setIsSeeking(false));
    };

    mediaEl.addEventListener('timeupdate', onTimeUpdate);
    mediaEl.addEventListener('durationchange', onDurationChange);
    mediaEl.addEventListener('ended', onEnded);
    mediaEl.addEventListener('loadedmetadata', onLoadedMetadata);
    mediaEl.addEventListener('seeking', handleSeeking);
    mediaEl.addEventListener('seeked', clearSeeking);
    mediaEl.addEventListener('playing', clearSeeking);

    if (enabled) {
      const onWaiting = () => { dlog('waiting event'); scheduleStallDetection(); };
      const onStalled = () => { dlog('stalled event'); scheduleStallDetection(); };
      const onPlaying = () => { dlog('playing event'); scheduleStallDetection(); };
      
      mediaEl.addEventListener('waiting', onWaiting);
      mediaEl.addEventListener('stalled', onStalled);
      mediaEl.addEventListener('playing', onPlaying);
      
      return () => {
        mediaEl.removeEventListener('timeupdate', onTimeUpdate);
        mediaEl.removeEventListener('durationchange', onDurationChange);
        mediaEl.removeEventListener('ended', onEnded);
        mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
        mediaEl.removeEventListener('waiting', onWaiting);
        mediaEl.removeEventListener('stalled', onStalled);
        mediaEl.removeEventListener('playing', onPlaying);
        mediaEl.removeEventListener('seeking', handleSeeking);
        mediaEl.removeEventListener('seeked', clearSeeking);
      };
    }

    return () => {
      mediaEl.removeEventListener('timeupdate', onTimeUpdate);
      mediaEl.removeEventListener('durationchange', onDurationChange);
      mediaEl.removeEventListener('ended', onEnded);
      mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      mediaEl.removeEventListener('seeking', handleSeeking);
      mediaEl.removeEventListener('seeked', clearSeeking);
    };
  }, [onEnd, playbackRate, start, isVideo, meta, type, media_key, onProgress, enabled, softMs, hardMs, recoveryStrategies, mode, isStalled, volume, getMediaEl, dlog, markProgress, scheduleStallDetection]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (mediaEl && onMediaRef) onMediaRef(mediaEl);
  }, [meta.media_key, onMediaRef, getMediaEl]);

  return {
    containerRef,
    seconds,
    percent: getProgressPercent(seconds, duration),
    duration,
    isPaused: !seconds ? false : getMediaEl()?.paused || false,
    isDash,
    shader,
    isStalled,
    isSeeking,
    handleProgressClick
  };
}
