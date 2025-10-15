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
    stallCandidateTs: 0,
    softTimer: null,
    hardTimer: null,
    retryCount: 0,
    isStalled: false,
    recoveryPhase: 'none'
  });
  const [isStalled, setIsStalled] = useState(false);

  // Config with sane defaults
  const {
    enabled = true,
    softMs = 1200,
    hardMs = 8000,
    maxRetries = 1,
    mode = 'auto',
    debug = false,
    enablePhase2 = true,
    phase2SeekBackSeconds = 2
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

  // Clear timers utility
  const clearTimers = useCallback(() => {
    const s = stallStateRef.current;
    if (s.softTimer) { clearTimeout(s.softTimer); s.softTimer = null; }
    if (s.hardTimer) { clearTimeout(s.hardTimer); s.hardTimer = null; }
  }, []);

  const scheduleStallDetection = useCallback(() => {
    if (!enabled) return;
    const s = stallStateRef.current;
    if (s.softTimer || s.isStalled) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    if (mediaEl.paused) return;
    
    s.softTimer = setTimeout(() => {
      const now = Date.now();
      if (s.lastProgressTs === 0) return;
      const diff = now - s.lastProgressTs;
      if (diff >= softMs) {
        s.isStalled = true;
        setIsStalled(true);
        dlog('Soft stall confirmed after', diff, 'ms');
        
        if (mode === 'auto') {
          s.hardTimer = setTimeout(() => {
            if (!s.isStalled) return;
            if (s.retryCount < maxRetries) {
              // Phase 1: light recovery
              s.retryCount += 1;
              s.recoveryPhase = 'light';
              dlog('Attempt light recovery, retry #', s.retryCount);
              try {
                const mediaEl = getMediaEl();
                if (mediaEl) {
                  const t = mediaEl.currentTime;
                  mediaEl.pause();
                  mediaEl.currentTime = Math.max(0, t - 0.001);
                  mediaEl.play().catch(() => {});
                }
              } catch (_) {}
              clearTimers();
              s.softTimer = null;
              s.hardTimer = null;
              scheduleStallDetection();
            } else if (enablePhase2) {
              // Phase 2: reload element
              const mediaEl = getMediaEl();
              if (mediaEl) {
                s.recoveryPhase = 'reload';
                dlog('Phase 2: reloading media element');
                const priorTime = mediaEl.currentTime || 0;
                try {
                  const src = mediaEl.getAttribute('src');
                  mediaEl.pause();
                  mediaEl.removeAttribute('src');
                  mediaEl.load();
                  setTimeout(() => {
                    try {
                      if (src) mediaEl.setAttribute('src', src);
                      mediaEl.load();
                      mediaEl.addEventListener('loadedmetadata', function handleOnce() {
                        mediaEl.removeEventListener('loadedmetadata', handleOnce);
                        const target = Math.max(0, priorTime - phase2SeekBackSeconds);
                        if (!isNaN(target)) {
                          try { mediaEl.currentTime = target; } catch (_) {}
                        }
                        mediaEl.play().catch(() => {});
                      });
                    } catch (_) {}
                  }, 50);
                } catch (_) {}
                clearTimers();
                s.softTimer = null;
                s.hardTimer = null;
                scheduleStallDetection();
              } else {
                dlog('Phase 2 requested but media element unavailable');
              }
            } else {
              dlog('Max light retries reached; Phase 2 disabled; leaving stalled state');
            }
          }, Math.max(0, hardMs - softMs));
        }
      }
    }, softMs);
  }, [enabled, softMs, hardMs, maxRetries, mode, enablePhase2, phase2SeekBackSeconds, getMediaEl, dlog, clearTimers]);

  const markProgress = useCallback(() => {
    const s = stallStateRef.current;
    s.lastProgressTs = Date.now();
    if (s.isStalled) {
      dlog('Recovery: progress resumed');
      s.isStalled = false;
      s.stallCandidateTs = 0;
      clearTimers();
      setIsStalled(false);
      scheduleStallDetection();
    }
    if (!s.softTimer && !s.isStalled) {
      scheduleStallDetection();
    }
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
          retryCount: stallStateRef.current.retryCount,
          recoveryPhase: stallStateRef.current.recoveryPhase
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
  }, [onEnd, playbackRate, start, isVideo, meta, type, media_key, onProgress, enabled, softMs, hardMs, maxRetries, mode, isStalled, volume, getMediaEl, dlog, markProgress, scheduleStallDetection]);

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
