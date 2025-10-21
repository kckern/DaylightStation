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
  stallConfig = {},
  showQuality = false
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
    lastStrategy: 'none',
    hasEnded: false  // Flag to prevent recovery after media ends
  });
  const [isStalled, setIsStalled] = useState(false);
  // Quality sampling state
  const [quality, setQuality] = useState({ droppedVideoFrames: 0, totalVideoFrames: 0, droppedPct: 0, supported: true });
  const lastQualityRef = useRef({ droppedVideoFrames: 0, totalVideoFrames: 0, droppedPct: 0, supported: true });

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
    mode = 'auto'
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
      
      try {
        const t = mediaEl.currentTime;
        mediaEl.pause();
        mediaEl.currentTime = Math.max(0, t - 0.001);
        mediaEl.play().catch(() => {});
        return true;
      } catch (_) {
        return false;
      }
    }, [getMediaEl]),

    // Reload: Full media element reset
    reload: useCallback(() => {
      const mediaEl = getMediaEl();
      if (!mediaEl) {
        return false;
      }
      
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
    }, [getMediaEl, seekBackOnReload]),

    // Seek back: Jump back a few seconds
    seekback: useCallback((seconds = 5) => {
      const mediaEl = getMediaEl();
      if (!mediaEl) return false;
      
      try {
        mediaEl.currentTime = Math.max(0, mediaEl.currentTime - seconds);
        return true;
      } catch (_) {
        return false;
      }
    }, [getMediaEl])
  };

  // Execute next recovery strategy
  const attemptRecovery = useCallback(() => {
    const s = stallStateRef.current;
    const strategy = recoveryStrategies[s.recoveryAttempt];
    
    if (!strategy) {
      return false;
    }
    
    const method = recoveryMethods[strategy];
    if (!method) {
      s.recoveryAttempt++;
      return attemptRecovery();
    }
    
    s.lastStrategy = strategy;
    const success = method();
    s.recoveryAttempt++;
    
    return success;
  }, [recoveryStrategies, recoveryMethods]);

  const scheduleStallDetection = useCallback(() => {
    if (!enabled) return;
    const s = stallStateRef.current;
    if (s.hasEnded) {
      return;
    }
    if (s.softTimer) {
      return;
    }
    if (s.isStalled) {
      return;
    }
    
    const mediaEl = getMediaEl();
    if (!mediaEl) {
      return;
    }
    if (mediaEl.paused) {
      return;
    }
    
    s.softTimer = setTimeout(() => {
      const mediaEl = getMediaEl();
      const s = stallStateRef.current;
      
      // If media element is gone or paused, stop checking
      if (!mediaEl || mediaEl.paused) {
        clearTimers();
        return;
      }
      
      // Check if media has ended or is very close to end
      if (s.hasEnded || mediaEl.ended || (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
        s.hasEnded = true;
        clearTimers();
        return;
      }
      
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
        
        if (mode === 'auto') {
          const recoveryDelay = Math.max(0, hardMs - softMs);
          s.hardTimer = setTimeout(() => {
            const s = stallStateRef.current;
            const mediaEl = getMediaEl();
            
            // Don't attempt recovery if media has ended
            if (s.hasEnded || !mediaEl || mediaEl.ended || (mediaEl.duration && mediaEl.currentTime >= mediaEl.duration - 0.5)) {
              clearTimers();
              return;
            }
            
            if (!s.isStalled) {
              return;
            }
            
            if (s.recoveryAttempt < recoveryStrategies.length) {
              clearTimers();
              attemptRecovery();
              scheduleStallDetection();
            }
          }, recoveryDelay);
        }
      } else {
        // Not stalled yet, keep checking
        s.softTimer = null;
        scheduleStallDetection();
      }
    }, checkInterval);
  }, [enabled, softMs, hardMs, recoveryStrategies, checkInterval, getMediaEl, clearTimers, attemptRecovery]);

  const markProgress = useCallback(() => {
    const s = stallStateRef.current;
    if (s.hasEnded) {
      return;
    }
    
    const wasStalled = s.isStalled;
    s.lastProgressTs = Date.now();
    
    if (wasStalled) {
      s.isStalled = false;
      s.recoveryAttempt = 0;
      clearTimers();
      setIsStalled(false);
      scheduleStallDetection();
    }
    // Continuous polling in scheduleStallDetection handles rescheduling
  }, [clearTimers, scheduleStallDetection]);

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
          lastStrategy: stallStateRef.current.lastStrategy,
          quality
        });
      }
    };

    const onDurationChange = () => {
      setDuration(mediaEl.duration);
    };

    const onEnded = () => {
      const mediaEl = getMediaEl();
      const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
      
      lastLoggedTimeRef.current = 0;
      
      // Immediately flag as ended to prevent any recovery attempts
      const s = stallStateRef.current;
      s.hasEnded = true;
      
      // Clear stall detection when track ends
      clearTimers();
      
      if (s.isStalled) {
        s.isStalled = false;
        setIsStalled(false);
      }
      
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
      
      // Loop logic:
      // - Only loop the element when queue length is 1 (single item queue)
      // - For queue length > 1, let the queue behavior handle looping
      // - For queue length 0 (no queue), loop if continuous flag is set, OR loop short videos (<20s)
      // Derive queue length from meta.queueLength if available (set by parent queue controller)
      const queueLength = meta.queueLength || 0;
      const shouldLoopElement = queueLength === 1 || 
                                 (queueLength === 0 && meta.continuous) ||
                                 (queueLength === 0 && isVideo && duration < 20);
      
      if (shouldLoopElement) {
        mediaEl.loop = true;
      } else {
        mediaEl.loop = false;
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
      
      // Reset ended flag for new media
      stallStateRef.current.hasEnded = false;
      stallStateRef.current.recoveryAttempt = 0;
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
      const onWaiting = () => { scheduleStallDetection(); };
      const onStalled = () => { scheduleStallDetection(); };
      const onPlaying = () => { scheduleStallDetection(); };
      
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
  }, [onEnd, playbackRate, start, isVideo, meta, type, media_key, onProgress, enabled, softMs, hardMs, recoveryStrategies, mode, isStalled, volume, getMediaEl, markProgress, scheduleStallDetection, clearTimers]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (mediaEl && onMediaRef) onMediaRef(mediaEl);
  }, [meta.media_key, onMediaRef, getMediaEl]);

  // Sample video playback quality metrics (dropped/decoded frames)
  useEffect(() => {
    if (!showQuality || !isVideo) return;
    const el = getMediaEl();
    if (!el) return;

    let timerId;
    const sample = () => {
      try {
        let dropped = 0, total = 0;
        if (typeof el.getVideoPlaybackQuality === 'function') {
          const q = el.getVideoPlaybackQuality();
          dropped = q?.droppedVideoFrames || 0;
          total = q?.totalVideoFrames || 0;
        } else if ('webkitDroppedFrameCount' in el || 'webkitDecodedFrameCount' in el) {
          dropped = Number(el.webkitDroppedFrameCount || 0);
          total = Number(el.webkitDecodedFrameCount || 0);
        } else {
          // Not supported
          if (lastQualityRef.current.supported) {
            lastQualityRef.current = { ...lastQualityRef.current, supported: false };
            setQuality(prev => ({ ...prev, supported: false }));
          }
          return;
        }
        const pct = total > 0 ? (dropped / total) * 100 : 0;
        // Update only when values change to avoid churn
        const prev = lastQualityRef.current;
        if (prev.droppedVideoFrames !== dropped || prev.totalVideoFrames !== total) {
          const next = { droppedVideoFrames: dropped, totalVideoFrames: total, droppedPct: pct, supported: true };
          lastQualityRef.current = next;
          setQuality(next);
        }
      } catch (_) {}
    };
    timerId = setInterval(sample, 1000);
    sample();
    return () => { if (timerId) clearInterval(timerId); };
  }, [showQuality, isVideo, getMediaEl]);

  // Placeholder for dynamic bitrate adaptation based on quality
  const adaptVideoBitrate = useCallback((q) => {
    // Placeholder implementation: hook for future ABR control
    // Example real impl (dash.js): player.updateSettings({ streaming: { abr: { maxBitrate: { video: X }}} })
    if (!q || !showQuality || !isVideo) return false;
    // Intentionally no-op; just return false and log once when severe drops are detected
    if (q.totalVideoFrames > 300 && q.droppedPct > 5) {
      // eslint-disable-next-line no-console
      console.debug('[adaptVideoBitrate] High dropped frames detected', q);
    }
    return false;
  }, [showQuality, isVideo]);

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
    handleProgressClick,
    quality,
    adaptVideoBitrate
  };
}
