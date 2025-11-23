import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent, guid } from '../lib/helpers.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
import { useMediaResilience, mergeMediaResilienceConfig } from './useMediaResilience.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';

const DEBUG_MEDIA = false;

export const shouldRestartFromBeginning = (durationSeconds, candidateSeconds) => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { restart: false, reason: 'invalid-duration' };
  }
  if (!Number.isFinite(candidateSeconds) || candidateSeconds <= 0) {
    return { restart: false, reason: 'invalid-candidate' };
  }
  const secondsRemaining = durationSeconds - candidateSeconds;
  if (secondsRemaining < 30) {
    return { restart: true, reason: 'less-than-30s' };
  }
  const progressPercent = (candidateSeconds / durationSeconds) * 100;
  if (progressPercent > 95) {
    return { restart: true, reason: 'over-95-percent' };
  }
  return { restart: false, reason: 'resume-ok' };
};

const clearResumeHistoryForKey = (mediaKey) => {
  if (!mediaKey) return;
  try {
    if (useCommonMediaController.__lastPosByKey) {
      delete useCommonMediaController.__lastPosByKey[mediaKey];
    }
    if (useCommonMediaController.__lastSeekByKey) {
      delete useCommonMediaController.__lastSeekByKey[mediaKey];
    }
    if (useCommonMediaController.__appliedStartByKey) {
      delete useCommonMediaController.__appliedStartByKey[mediaKey];
    }
  } catch (_) {
    // swallowing cache reset issues keeps playback uninterrupted
  }
};

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
  meta = {},
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
  controllerExtras,
  seekToIntentSeconds = null,
  instanceKey = null,
  fetchVideoInfo,
  resilience: resilienceOptions = null
}) {
  // Persist global state across remounts so resume/start logic stays sticky per media item.
  if (!useCommonMediaController.__appliedStartByKey) useCommonMediaController.__appliedStartByKey = Object.create(null);
  if (!useCommonMediaController.__lastPosByKey) useCommonMediaController.__lastPosByKey = Object.create(null);
  if (!useCommonMediaController.__lastSeekByKey) useCommonMediaController.__lastSeekByKey = Object.create(null);

  const media_key = meta.media_key || meta.key || meta.guid || meta.id || meta.plex || meta.media_url;
  const threadIdRef = useRef(null);
  if (!threadIdRef.current) {
    threadIdRef.current = guid();
  }
  const threadId = threadIdRef.current;
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
  const baseInstanceKey = useMemo(() => {
    const baseKey = String(instanceKey ?? media_key ?? meta.media_url ?? meta.id ?? 'media');
    return `${baseKey}:${threadId}`;
  }, [instanceKey, media_key, meta.media_url, meta.id, threadId]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [internalSeekIntentSeconds, setInternalSeekIntentSeconds] = useState(null);
  useEffect(() => {
    setReloadNonce(0);
    setInternalSeekIntentSeconds(null);
  }, [baseInstanceKey]);
  const resolvedInstanceKey = `${baseInstanceKey}:mc-${reloadNonce}`;
  const formatWaitKeyForLogs = useCallback((value) => getLogWaitKey(value || resolvedInstanceKey), [resolvedInstanceKey]);

  const logControllerEvent = useCallback((event, details = {}, overrideWaitKey = null) => {
    const waitKeyLabel = formatWaitKeyForLogs(overrideWaitKey || resolvedInstanceKey);
    playbackLog('controller', {
      event,
      threadId,
      waitKey: waitKeyLabel,
      media_key,
      ...details
    });
  }, [formatWaitKeyForLogs, media_key, resolvedInstanceKey, threadId]);

  const hardReset = useCallback(({ seekToSeconds = null } = {}) => {
    if (Number.isFinite(seekToSeconds)) {
      setInternalSeekIntentSeconds(Math.max(0, seekToSeconds));
    }
    setReloadNonce((nonce) => {
      const next = nonce + 1;
      logControllerEvent('hard-reset', { seekToSeconds }, `${baseInstanceKey}:mc-${next}`);
      return next;
    });
  }, [baseInstanceKey, logControllerEvent, setReloadNonce]);

  const handleResilienceReload = useCallback((options = {}) => {
    const seekSeconds = Number.isFinite(options.seekToIntentMs)
      ? options.seekToIntentMs / 1000
      : null;
    hardReset({ seekToSeconds: seekSeconds });
    logControllerEvent('resilience-reload', { seekSeconds });
  }, [hardReset, logControllerEvent]);

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
    logControllerEvent('mount', { media_key });
    lastSeekIntentRef.current = null;
    lastPlaybackPosRef.current = 0;
    isInitialLoadRef.current = true;
  }, [logControllerEvent, media_key]);

  useEffect(() => {
    if (!Number.isFinite(seekToIntentSeconds)) return;
    const normalized = Math.max(0, seekToIntentSeconds);
    lastSeekIntentRef.current = normalized;
    try { useCommonMediaController.__lastSeekByKey[media_key] = normalized; }
    catch (_) { /* ignore cache write failures */ }
  }, [seekToIntentSeconds, media_key]);

  useEffect(() => {
    if (!Number.isFinite(internalSeekIntentSeconds)) return;
    const normalized = Math.max(0, internalSeekIntentSeconds);
    lastSeekIntentRef.current = normalized;
    try { useCommonMediaController.__lastSeekByKey[media_key] = normalized; }
    catch (_) { /* ignore cache write failures */ }
    setInternalSeekIntentSeconds(null);
  }, [internalSeekIntentSeconds, media_key]);

  const handleProgressClick = useCallback((event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    mediaEl.currentTime = (clickX / rect.width) * duration;
  }, [duration, getMediaEl]);

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
      try { useCommonMediaController.__lastPosByKey[media_key] = current; }
      catch (_) { /* ignore cache write failures */ }
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

        const initialDecision = shouldRestartFromBeginning(durationValue, desiredStart);

        if (initialDecision.restart) {
          desiredStart = 0;
          clearResumeHistoryForKey(media_key);
          lastSeekIntentRef.current = null;
          lastPlaybackPosRef.current = 0;
        }

        isInitialLoadRef.current = false;
        try { useCommonMediaController.__appliedStartByKey[media_key] = true; }
        catch (_) { /* ignore cache write failures */ }
      } else {
        const candidateSources = [
          { label: 'lastSeekIntent', value: lastSeekIntentRef.current },
          { label: 'persistedSeek', value: useCommonMediaController.__lastSeekByKey[media_key] },
          { label: 'sessionPlayback', value: lastPlaybackPosRef.current },
          { label: 'persistedPlayback', value: useCommonMediaController.__lastPosByKey[media_key] }
        ];
        const foundCandidate = candidateSources.find((entry) => entry.value != null && Number.isFinite(entry.value));
        const sticky = foundCandidate?.value ?? 0;
        const nearStart = sticky <= 1;
        const nearEnd = durationValue > 0 ? sticky >= durationValue - 1 : false;
        const stickyDecision = shouldRestartFromBeginning(durationValue, sticky);

        if (!nearStart && !nearEnd && !stickyDecision.restart && sticky > 5) {
          desiredStart = Math.max(0, sticky - 1);
        } else if (stickyDecision.restart && sticky > 0) {
          desiredStart = 0;
          clearResumeHistoryForKey(media_key);
          lastSeekIntentRef.current = null;
          lastPlaybackPosRef.current = 0;
        }
      }

      mediaEl.dataset.key = media_key;

      if (Number.isFinite(desiredStart) && desiredStart > 0) {
        try {
          mediaEl.currentTime = desiredStart;
        } catch (error) {
          if (DEBUG_MEDIA) console.warn('[Media] failed to set start time', desiredStart, error);
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
        try { useCommonMediaController.__lastSeekByKey[media_key] = mediaElInstance.currentTime; }
        catch (_) { /* ignore cache write failures */ }
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
  }, [getMediaEl, media_key, meta, onEnd, onProgress, playbackRate, start, type, volume, isDash, resolvedInstanceKey]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (mediaEl && onMediaRef) {
      onMediaRef(mediaEl);
    }
  }, [getMediaEl, onMediaRef, media_key, resolvedInstanceKey]);

  const mediaElementSnapshot = getMediaEl();
  const isPausedValue = mediaElementSnapshot ? Boolean(mediaElementSnapshot.paused) : false;

  const operateOnMediaEl = useCallback((fn) => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return null;
    try {
      return fn(mediaEl);
    } catch (_) {
      return null;
    }
  }, [getMediaEl]);

  const play = useCallback(() => operateOnMediaEl((el) => {
    try { return el.play?.(); } catch (_) { return null; }
  }), [operateOnMediaEl]);

  const pause = useCallback(() => operateOnMediaEl((el) => {
    try { return el.pause?.(); } catch (_) { return null; }
  }), [operateOnMediaEl]);

  const toggle = useCallback(() => operateOnMediaEl((el) => {
    if (el.paused) {
      try { return el.play?.(); } catch (_) { return null; }
    }
    try { return el.pause?.(); } catch (_) { return null; }
  }), [operateOnMediaEl]);

  const seek = useCallback((time) => {
    if (!Number.isFinite(time)) return null;
    return operateOnMediaEl((el) => {
      const next = Math.max(0, time);
      el.currentTime = next;
      return next;
    });
  }, [operateOnMediaEl]);

  const seekRelative = useCallback((deltaSeconds) => {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return null;
    return operateOnMediaEl((el) => {
      const current = Number.isFinite(el.currentTime) ? el.currentTime : 0;
      const durationValue = Number.isFinite(el.duration) ? el.duration : null;
      const unclamped = current + deltaSeconds;
      const next = Math.max(0, durationValue ? Math.min(unclamped, durationValue) : unclamped);
      el.currentTime = next;
      return next;
    });
  }, [operateOnMediaEl]);

  const getCurrentTime = useCallback(() => operateOnMediaEl((el) => Number.isFinite(el.currentTime) ? el.currentTime : 0) ?? 0, [operateOnMediaEl]);

  const getDurationValue = useCallback(() => operateOnMediaEl((el) => Number.isFinite(el.duration) ? el.duration : 0) ?? 0, [operateOnMediaEl]);


  const resilienceSettings = (resilienceOptions && typeof resilienceOptions === 'object') ? resilienceOptions : {};
  const resilienceDisabled = resilienceOptions === false;
  const mergedResilienceConfig = mergeMediaResilienceConfig(resilienceSettings.config, meta?.mediaResilienceConfig);
  const stalledOverride = typeof resilienceSettings.stalled === 'boolean'
    ? resilienceSettings.stalled
    : resilienceSettings.stalledOverride;
  const defaultDebugContext = {
    scope: isVideo ? 'video' : (isAudio ? 'audio' : 'media'),
    mediaType: meta?.media_type,
    title: meta?.title,
    show: meta?.show,
    season: meta?.season,
    episode: meta?.episode,
    url: meta?.media_url,
    media_key,
    isDash,
    shader,
    queuePosition,
    reloadNonce,
    threadId
  };

  const {
    overlayProps: computedOverlayProps,
    controller: resilienceController,
    state: resilienceState
  } = useMediaResilience({
    getMediaEl,
    meta,
    seconds,
    isPaused: isPausedValue,
    isSeeking,
    initialStart: start || 0,
    waitKey: resolvedInstanceKey,
    fetchVideoInfo,
    onStateChange: typeof resilienceSettings.onStateChange === 'function'
      ? (nextState) => resilienceSettings.onStateChange(nextState, meta)
      : undefined,
    onReload: handleResilienceReload,
    configOverrides: mergedResilienceConfig,
    controllerRef: resilienceDisabled ? undefined : resilienceSettings.controllerRef,
    explicitShow: resilienceSettings.explicitShow,
    plexId: meta?.media_key || meta?.key || meta?.plex || null,
    debugContext: resilienceSettings.debugContext ?? defaultDebugContext,
    message: resilienceSettings.message,
    stalled: stalledOverride,
    mediaTypeHint: isVideo ? 'video' : (isAudio ? 'audio' : 'unknown'),
    playerFlavorHint: isVideo ? (isDash ? 'shaka' : 'html5-video') : 'html5-audio',
    threadId
  });

  const overlayProps = resilienceDisabled ? null : computedOverlayProps;

  const getPlaybackState = useCallback(() => ({
    isPaused: isPausedValue,
    isSeeking,
    seconds,
    duration,
    resilienceStatus: resilienceState?.status ?? null,
    resilienceState
  }), [duration, isPausedValue, isSeeking, resilienceState, seconds]);

  const [controllerExtrasState, setControllerExtrasState] = useState(null);

  const mergedControllerExtras = controllerExtras ?? controllerExtrasState;

  const transport = useMemo(() => ({
    getMediaEl,
    play,
    pause,
    toggle,
    seek,
    seekRelative,
    getCurrentTime,
    getDuration: getDurationValue,
    getPlaybackState,
    isDash,
    hardReset
  }), [getMediaEl, getCurrentTime, getDurationValue, getPlaybackState, hardReset, isDash, pause, play, seek, seekRelative, toggle]);

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
    keyboardOverrides,
    controller: transport,
    isPaused: isPausedValue
  });

  useEffect(() => {
    if (typeof onController !== 'function') return;

    const controllerPayload = {
      ...transport,
      getPlaybackState,
      transport,
      ...(mergedControllerExtras || {}),
      ...(resilienceController && !resilienceDisabled ? { resilience: resilienceController } : {})
    };

    onController(controllerPayload);
  }, [getPlaybackState, mergedControllerExtras, onController, resilienceController, resilienceDisabled, resolvedInstanceKey, transport]);

  return {
    containerRef,
    seconds,
    percent: getProgressPercent(seconds, duration),
    duration,
    isPaused: isPausedValue,
    isDash,
    shader,
    handleProgressClick,
    overlayProps,
    resilienceState: resilienceDisabled ? null : resilienceState,
    resilienceController: resilienceDisabled ? null : resilienceController,
    mediaInstanceKey: resolvedInstanceKey,
    hardReset,
    transport,
    getPlaybackState,
    setControllerExtras: setControllerExtrasState
  };
}
