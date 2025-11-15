import { useRef, useEffect, useState, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent } from '../lib/helpers.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';

/**
 * Common media controller hook for both audio and video players.
 * Handles playback state, progress tracking, and essential media events.
 * All stall detection, recovery, and manual bitrate controls have been
 * removed so we can rely on the underlying player implementation.
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
  shader,
  volume,
  cycleThroughClasses,
  playbackKeys,
  queuePosition,
  ignoreKeys,
  onProgress,
  onMediaRef,
  onController,
  keyboardOverrides,
  controllerExtras
}) {
  const DEBUG_MEDIA = false;

  // Persist global state across remounts so resume/start logic stays sticky per media item.
  if (!useCommonMediaController.__appliedStartByKey) useCommonMediaController.__appliedStartByKey = Object.create(null);
  if (!useCommonMediaController.__lastPosByKey) useCommonMediaController.__lastPosByKey = Object.create(null);
  if (!useCommonMediaController.__lastSeekByKey) useCommonMediaController.__lastSeekByKey = Object.create(null);

  const media_key = meta.media_key || meta.key || meta.guid || meta.id || meta.plex || meta.media_url;
  const containerRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const lastLoggedTimeRef = useRef(0);
  const lastPlaybackPosRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const lastSeekIntentRef = useRef(null);

  const getMediaEl = useCallback(() => {
    const host = containerRef.current;
    if (!host) return null;

    const selector = isAudio ? 'audio,video' : 'video,audio';
    const shadowRoot = host.shadowRoot;
    if (shadowRoot && typeof shadowRoot.querySelector === 'function') {
      const shadowMedia = shadowRoot.querySelector(selector);
      if (shadowMedia) return shadowMedia;
    }

    const tagName = typeof host.tagName === 'string' ? host.tagName.toUpperCase() : '';
    if (tagName === 'VIDEO' || tagName === 'AUDIO') {
      return host;
    }

    if (typeof host.querySelector === 'function') {
      const nestedMedia = host.querySelector(selector);
      if (nestedMedia) return nestedMedia;
    }

    return null;
  }, [isAudio]);

  const isDash = meta.media_type === 'dash_video';

  useEffect(() => {
    try {
      if (media_key) {
        if (!useCommonMediaController.__prevKeyLog) useCommonMediaController.__prevKeyLog = media_key;
        if (useCommonMediaController.__prevKeyLog !== media_key) {
          if (DEBUG_MEDIA) console.log('[MediaKey] change detected', { from: useCommonMediaController.__prevKeyLog, to: media_key });
          useCommonMediaController.__prevKeyLog = media_key;
        }
      }
    } catch (_) {
      // no-op logging guard
    }
    lastSeekIntentRef.current = null;
    lastPlaybackPosRef.current = 0;
    isInitialLoadRef.current = true;
  }, [media_key]);

  const handleProgressClick = useCallback((event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    mediaEl.currentTime = (clickX / rect.width) * duration;
  }, [duration, getMediaEl]);

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

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return;

    const logProgress = async () => {
      const now = Date.now();
      const diff = now - lastLoggedTimeRef.current;
      const pct = getProgressPercent(mediaEl.currentTime || 0, mediaEl.duration || 0);
      if (diff > 10000 && parseFloat(pct) > 0) {
        lastLoggedTimeRef.current = now;
        const secs = mediaEl.currentTime || 0;
        if (secs > 10) {
          const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
          await DaylightAPI('media/log', { title, type, media_key, seconds: secs, percent: pct });
        }
      }
    };

    const onTimeUpdate = () => {
      const current = mediaEl.currentTime || 0;
      setSeconds(current);
      lastPlaybackPosRef.current = current;
      try { useCommonMediaController.__lastPosByKey[media_key] = current; } catch (_) {}
      logProgress();

      if (onProgress) {
        onProgress({
          currentTime: current,
          duration: mediaEl.duration || 0,
          paused: mediaEl.paused,
          media: meta,
          percent: getProgressPercent(mediaEl.currentTime, mediaEl.duration)
        });
      }
    };

    const onDurationChange = () => {
      setDuration(mediaEl.duration || 0);
    };

    const onEnded = () => {
      lastLoggedTimeRef.current = 0;
      logProgress();
      onEnd();
    };

    const onLoadedMetadata = () => {
      const durationValue = mediaEl.duration || 0;
      let desiredStart = 0;
      const hasAppliedForKey = !!useCommonMediaController.__appliedStartByKey[media_key];
      const processedVolumeRaw = Number(volume ?? 100);
      const processedVolume = Number.isFinite(processedVolumeRaw) ? processedVolumeRaw : 100;
      const normalizedVolume = processedVolume > 1 ? processedVolume / 100 : processedVolume;
      const adjustedVolume = Math.min(1, Math.max(0, normalizedVolume));
      const isVideoEl = mediaEl.tagName && mediaEl.tagName.toLowerCase() === 'video';

      if (isInitialLoadRef.current && !hasAppliedForKey) {
        const shouldApplyStart = (durationValue > 12 * 60) || isVideoEl;
        desiredStart = shouldApplyStart ? start : 0;

        if (durationValue > 0 && desiredStart > 0) {
          const progressPercent = (desiredStart / durationValue) * 100;
          const secondsRemaining = durationValue - desiredStart;
          if (progressPercent > 95 || secondsRemaining < 30) {
            desiredStart = 0;
          }
        }

        isInitialLoadRef.current = false;
        try { useCommonMediaController.__appliedStartByKey[media_key] = true; } catch (_) {}
      } else {
        const candidates = [
          lastSeekIntentRef.current,
          useCommonMediaController.__lastSeekByKey[media_key],
          lastPlaybackPosRef.current,
          useCommonMediaController.__lastPosByKey[media_key]
        ];
        const sticky = candidates.find((value) => value != null && Number.isFinite(value)) || 0;
        const nearStart = sticky <= 1;
        const nearEnd = durationValue > 0 ? sticky >= durationValue - 1 : false;
        if (!nearStart && !nearEnd && sticky > 5) {
          desiredStart = Math.max(0, sticky - 1);
        }
      }

      mediaEl.dataset.key = media_key;

      if (Number.isFinite(desiredStart) && desiredStart > 0) {
        try {
          mediaEl.currentTime = desiredStart;
        } catch (_) {
          if (DEBUG_MEDIA) console.warn('[Media] failed to set start time', desiredStart);
        }
      }

      mediaEl.autoplay = true;
      mediaEl.volume = adjustedVolume;

      const queueLength = meta.queueLength || 0;
      const shouldLoop = queueLength === 1
        || (queueLength === 0 && meta.continuous)
        || (queueLength === 0 && isVideoEl && durationValue < 20);
      mediaEl.loop = shouldLoop;

      if (isVideoEl || isDash) {
        mediaEl.controls = false;
        const applyRate = () => { mediaEl.playbackRate = playbackRate; };
        mediaEl.addEventListener('play', applyRate);
        mediaEl.addEventListener('seeked', applyRate);
      } else {
        mediaEl.playbackRate = playbackRate;
      }

      if (DEBUG_MEDIA) {
        console.log('[Media] loadedmetadata', {
          media_key,
          desiredStart,
          duration: durationValue,
          volume: adjustedVolume,
          loop: mediaEl.loop
        });
      }
    };

    const handleSeeking = () => {
      const mediaElInstance = getMediaEl();
      if (mediaElInstance && Number.isFinite(mediaElInstance.currentTime)) {
        lastSeekIntentRef.current = mediaElInstance.currentTime;
        try { useCommonMediaController.__lastSeekByKey[media_key] = mediaElInstance.currentTime; } catch (_) {}
      }
      setIsSeeking(true);
    };

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

    return () => {
      mediaEl.removeEventListener('timeupdate', onTimeUpdate);
      mediaEl.removeEventListener('durationchange', onDurationChange);
      mediaEl.removeEventListener('ended', onEnded);
      mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      mediaEl.removeEventListener('seeking', handleSeeking);
      mediaEl.removeEventListener('seeked', clearSeeking);
      mediaEl.removeEventListener('playing', clearSeeking);
    };
  }, [getMediaEl, media_key, meta, onEnd, onProgress, playbackRate, start, type, volume, isDash]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (mediaEl && onMediaRef) {
      onMediaRef(mediaEl);
    }
  }, [getMediaEl, onMediaRef, media_key]);

  const [controllerExtrasState, setControllerExtrasState] = useState(null);

  const mergedControllerExtras = controllerExtras ?? controllerExtrasState;

  useEffect(() => {
    if (typeof onController !== 'function') return;
    const play = () => { const el = getMediaEl(); if (el) { try { el.play?.(); } catch (_) {} } };
    const pause = () => { const el = getMediaEl(); if (el) { try { el.pause?.(); } catch (_) {} } };
    const seek = (time) => {
      if (!Number.isFinite(time)) return;
      const el = getMediaEl();
      if (!el) return;
      try { el.currentTime = Math.max(0, time); } catch (_) {}
    };

    const transport = {
      getMediaEl,
      play,
      pause,
      seek,
      isDash
    };

    const controllerPayload = {
      ...transport,
      transport,
      ...(mergedControllerExtras || {})
    };

    onController(controllerPayload);
  }, [getMediaEl, isDash, onController, mergedControllerExtras]);

  return {
    containerRef,
    seconds,
    percent: getProgressPercent(seconds, duration),
    duration,
    isPaused: getMediaEl()?.paused || false,
    isDash,
    shader,
    isSeeking,
    handleProgressClick,
    setControllerExtras: setControllerExtrasState
  };
}
