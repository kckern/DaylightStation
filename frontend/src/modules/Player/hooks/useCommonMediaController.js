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
  showQuality = false,
  onRequestBitrateChange,
  keyboardOverrides
}) {
  const media_key = meta.media_key || meta.key || meta.guid || meta.id || meta.plex || meta.media_url;
  const containerRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const lastLoggedTimeRef = useRef(0);
  const lastUpdatedTimeRef = useRef(0);
  
  // Track if this is the initial load (for start time application)
  const isInitialLoadRef = useRef(true);
  
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

  // Rolling dropped-frame average (fraction 0-1) over recent samples
  const [droppedFramePct, setDroppedFramePct] = useState(0);
  const pctSamplesRef = useRef([]); // store last N per-second pct samples (fractions)
  const lastFramesRef = useRef({ dropped: 0, total: 0 });
  const stableBelowMsRef = useRef(0);
  const lastAdaptTsRef = useRef(0);
  const pendingAdaptRef = useRef(false);
  // Initialize with meta.maxVideoBitrate if available, to avoid initial "unlimited" flash
  const [currentMaxKbps, setCurrentMaxKbps] = useState(() => {
    const initial = Number.isFinite(meta?.maxVideoBitrate) ? Number(meta.maxVideoBitrate) : null;
    console.log('[Bitrate] State initialization:', {
      'meta.maxVideoBitrate': meta?.maxVideoBitrate,
      'initial value': initial,
      'meta': meta
    });
    return initial;
  });

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
    // Adaptation config defaults
    droppedFrameAllowance = 0.5, // fraction 0-1
    rampUpStableSecs = 60,
    rampUpLowPct = 0.01, // <=1%
    initialCapKbps = 2000,
    minCapKbps = 125,
    sampleIntervalMs = 1000,
    avgWindowSecs = 10,
    minAdaptIntervalMs = 8000,
    // Optional ceiling & reset-to-unlimited controls (disabled by default)
    maxCapKbps = null,
    resetToUnlimitedAtKbps = null,
    resetStableSecs = 60,
    // Optional manual reset key (disabled by default)
    manualResetKey = null
  } = stallConfig || {};

  const getMediaEl = useCallback(() => {
    const mediaEl = containerRef.current?.shadowRoot?.querySelector('video') || containerRef.current;
    if (!mediaEl) return null;
    return mediaEl;
  }, []);

  const isDash = meta.media_type === 'dash_video';
  // Seed current cap if provided on meta
  useEffect(() => {
    if (Number.isFinite(meta?.maxVideoBitrate)) {
      const capValue = Number(meta.maxVideoBitrate);
      console.log('[Bitrate] Initializing cap from meta.maxVideoBitrate:', {
        maxVideoBitrate: meta.maxVideoBitrate,
        capKbps: capValue,
        mediaKey: meta?.media_key
      });
      setCurrentMaxKbps(capValue);
    } else {
      console.log('[Bitrate] No maxVideoBitrate set, cap is unlimited', {
        maxVideoBitrate: meta?.maxVideoBitrate,
        mediaKey: meta?.media_key
      });
      setCurrentMaxKbps(null);
    }
  }, [meta?.maxVideoBitrate, meta?.media_key]);

  // Reset sampling state on media change to prevent carryover
  useEffect(() => {
    pctSamplesRef.current = [];
    lastFramesRef.current = { dropped: 0, total: 0 };
    stableBelowMsRef.current = 0;
    // Reset initial load flag when media changes
    isInitialLoadRef.current = true;
    // Do not reset currentMaxKbps here; it seeds from meta.maxVideoBitrate effect above
  }, [media_key]);

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
    setCurrentTime: setSeconds,
    keyboardOverrides
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
          quality,
          droppedFramePct
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
      
      // Only apply start time on initial load, not on recovery reloads
      let startTime = 0;
      if (isInitialLoadRef.current) {
        startTime = (duration > (12 * 60) || isVideo) ? start : 0;
        
        if (duration > 0 && startTime > 0) {
          const progressPercent = (startTime / duration) * 100;
          const secondsRemaining = duration - startTime;
          if (progressPercent > 95 || secondsRemaining < 30) {
            startTime = 0;
          }
        }
        
        // Mark that we've completed the initial load
        isInitialLoadRef.current = false;
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
          // Compute per-interval delta-based fraction and rolling average
          const dDropped = Math.max(0, dropped - (lastFramesRef.current.dropped || 0));
          const dTotal = Math.max(0, total - (lastFramesRef.current.total || 0));
          lastFramesRef.current = { dropped, total };
          const frac = dTotal > 0 ? (dDropped / dTotal) : 0; // 0-1
          // Maintain last N samples
          const N = Math.max(1, Math.floor(avgWindowSecs));
          pctSamplesRef.current = [...pctSamplesRef.current.slice(-N + 1), frac];
          const avg = pctSamplesRef.current.length
            ? (pctSamplesRef.current.reduce((a, b) => a + b, 0) / pctSamplesRef.current.length)
            : 0;
          setDroppedFramePct(avg);
          // Track stability window for ramp-up
          if (avg <= rampUpLowPct) {
            stableBelowMsRef.current = Math.min(rampUpStableSecs * 1000, stableBelowMsRef.current + sampleIntervalMs);
          } else {
            stableBelowMsRef.current = 0;
          }
        }
      } catch (_) {}
    };
    timerId = setInterval(sample, sampleIntervalMs);
    sample();
    return () => { if (timerId) clearInterval(timerId); };
  }, [showQuality, isVideo, getMediaEl, avgWindowSecs, rampUpLowPct, rampUpStableSecs, sampleIntervalMs]);

  // Bitrate adaptation engine (dash-only)
  useEffect(() => {
    if (!isDash || !quality?.supported || !showQuality) return;
    const now = Date.now();
    if (pendingAdaptRef.current) return;
    // Don’t adapt when seeking/paused/stalled heavily – rely on outer controls
    const mediaEl = getMediaEl();
    if (!mediaEl || mediaEl.paused) return;

    // Downscale when over allowance
    if (droppedFramePct > droppedFrameAllowance && (now - lastAdaptTsRef.current) >= minAdaptIntervalMs) {
      const curr = currentMaxKbps;
      let next = (curr == null) ? initialCapKbps : Math.max(minCapKbps, Math.floor(curr / 2));
      if (maxCapKbps != null) next = Math.min(next, maxCapKbps);
      if (next !== curr && typeof onRequestBitrateChange === 'function') {
        pendingAdaptRef.current = true;
        lastAdaptTsRef.current = now;
        setCurrentMaxKbps(next);
        console.log('[Bitrate] Cap updated (downscale):', {
          from: curr === null ? 'unlimited' : `${curr} kbps`,
          to: `${next} kbps`,
          reason: 'over_allowance',
          droppedFramePct: `${(droppedFramePct * 100).toFixed(2)}%`,
          allowance: `${(droppedFrameAllowance * 100).toFixed(2)}%`,
          mediaKey: media_key
        });
        try {
          // eslint-disable-next-line no-console
          console.info('[ABR] downscale', { plexId: media_key, from: curr, to: next, droppedFramePct });
          onRequestBitrateChange(next, { media_key, reason: 'over_allowance', droppedFramePct });
        } finally {
          // The caller is responsible for clearing any UI; we only unlock the guard after a grace period
          setTimeout(() => { pendingAdaptRef.current = false; }, 50);
        }
      }
      return;
    }

    // Ramp-up when stable at low drops
    if (currentMaxKbps != null && droppedFramePct <= rampUpLowPct && stableBelowMsRef.current >= rampUpStableSecs * 1000 && (now - lastAdaptTsRef.current) >= minAdaptIntervalMs) {
      const curr = currentMaxKbps;
      let next = Math.max(minCapKbps, curr * 2); // double each step per spec
      if (maxCapKbps != null) next = Math.min(next, maxCapKbps);
      if (typeof onRequestBitrateChange === 'function') {
        pendingAdaptRef.current = true;
        lastAdaptTsRef.current = now;
        setCurrentMaxKbps(next);
        stableBelowMsRef.current = 0; // reset window after ramp
        console.log('[Bitrate] Cap updated (ramp-up):', {
          from: `${curr} kbps`,
          to: `${next} kbps`,
          reason: 'stable_performance',
          droppedFramePct: `${(droppedFramePct * 100).toFixed(2)}%`,
          stableSeconds: rampUpStableSecs,
          mediaKey: media_key
        });
        try {
          // eslint-disable-next-line no-console
          console.info('[ABR] ramp-up', { plexId: media_key, from: curr, to: next, droppedFramePct });
          onRequestBitrateChange(next, { media_key, reason: 'ramp_up', droppedFramePct });
        } finally {
          setTimeout(() => { pendingAdaptRef.current = false; }, 50);
        }
      }
    }
    // Reset to unlimited when stable at high cap threshold
    if (resetToUnlimitedAtKbps != null && currentMaxKbps != null && currentMaxKbps >= resetToUnlimitedAtKbps && droppedFramePct <= rampUpLowPct && stableBelowMsRef.current >= resetStableSecs * 1000 && (now - lastAdaptTsRef.current) >= minAdaptIntervalMs) {
      const curr = currentMaxKbps;
      if (typeof onRequestBitrateChange === 'function') {
        pendingAdaptRef.current = true;
        lastAdaptTsRef.current = now;
        setCurrentMaxKbps(null);
        stableBelowMsRef.current = 0;
        try {
          // eslint-disable-next-line no-console
          console.info('[ABR] reset-to-unlimited', { plexId: media_key, from: curr, to: null, droppedFramePct });
          onRequestBitrateChange(null, { media_key, reason: 'reset_unlimited', droppedFramePct });
        } finally {
          setTimeout(() => { pendingAdaptRef.current = false; }, 50);
        }
      }
    }
  }, [isDash, quality?.supported, showQuality, droppedFramePct, droppedFrameAllowance, minAdaptIntervalMs, onRequestBitrateChange, initialCapKbps, minCapKbps, rampUpLowPct, rampUpStableSecs, getMediaEl, media_key, maxCapKbps, resetToUnlimitedAtKbps, resetStableSecs, currentMaxKbps]);

  // Manual reset keyboard handler (optional)
  useEffect(() => {
    if (!manualResetKey || !isDash) return;
    const handler = (e) => {
      if (e.key === manualResetKey && typeof onRequestBitrateChange === 'function') {
        const curr = currentMaxKbps;
        setCurrentMaxKbps(null);
        // eslint-disable-next-line no-console
        console.info('[ABR] manual reset to unlimited', { plexId: media_key, from: curr });
        onRequestBitrateChange(null, { media_key, reason: 'manual_reset', droppedFramePct });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [manualResetKey, isDash, onRequestBitrateChange, media_key, droppedFramePct, currentMaxKbps]);

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
    droppedFramePct,
    currentMaxKbps
  };
}
