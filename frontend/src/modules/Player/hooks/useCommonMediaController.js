import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent, guid } from '../lib/helpers.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
// useMediaResilience now lives at the Player level; this hook no longer imports it directly.
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { useMediaReporter } from './useMediaReporter.js';

const DEBUG_MEDIA = false;
const roundSeconds = (value, precision = 3) => (Number.isFinite(value)
  ? Number(value.toFixed(precision))
  : null);

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
  resilienceBridge = null
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
  const {
    onPlaybackMetrics: bridgePlaybackMetrics,
    onRegisterMediaAccess: bridgeRegisterAccess,
    onSeekRequestConsumed: bridgeSeekConsumed,
    remountDiagnostics: bridgeRemountDiagnostics
  } = resilienceBridge || {};
  const mountDiagnostics = bridgeRemountDiagnostics || null;
  const containerRef = useRef(null);
  const mediaElementRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const lastLoggedTimeRef = useRef(0);
  const lastPlaybackPosRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const lastSeekIntentRef = useRef(null);
  const pendingAutoSeekRef = useRef(null);

  const assignMediaElementRef = (candidate) => {
    mediaElementRef.current = candidate || null;
    return mediaElementRef.current;
  };

  const getMediaEl = useCallback(() => {
    const host = containerRef.current;
    if (!host) return assignMediaElementRef(null);

    const selector = isAudio ? 'audio,video' : 'video,audio';
    const shadowRoot = host.shadowRoot;
    if (shadowRoot && typeof shadowRoot.querySelector === 'function') {
      const shadowMedia = shadowRoot.querySelector(selector);
      if (shadowMedia) return assignMediaElementRef(shadowMedia);
    }

    const tagName = typeof host.tagName === 'string' ? host.tagName.toUpperCase() : '';
    if (tagName === 'VIDEO' || tagName === 'AUDIO') {
      return assignMediaElementRef(host);
    }

    if (typeof host.querySelector === 'function') {
      const nestedMedia = host.querySelector(selector);
      if (nestedMedia) return assignMediaElementRef(nestedMedia);
    }

    return assignMediaElementRef(null);
  }, [isAudio]);

  const applySeekToMediaEl = useCallback((targetSeconds, source = 'seek-intent') => {
    if (!Number.isFinite(targetSeconds)) return false;
    if (typeof getMediaEl !== 'function') {
      pendingAutoSeekRef.current = targetSeconds;
      return false;
    }

    const mediaEl = getMediaEl();
    if (!mediaEl) {
      pendingAutoSeekRef.current = targetSeconds;
      return false;
    }

    try {
      const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
      if (Math.abs(currentTime - targetSeconds) < 0.05) {
        pendingAutoSeekRef.current = null;
        return true;
      }
      mediaEl.currentTime = targetSeconds;
      pendingAutoSeekRef.current = null;
      if (DEBUG_MEDIA) {
        console.log('[Media] applySeekToMediaEl', { source, targetSeconds });
      }
      return true;
    } catch (error) {
      pendingAutoSeekRef.current = targetSeconds;
      if (DEBUG_MEDIA) {
        console.warn('[Media] failed to apply seek intent', { source, targetSeconds, error });
      }
      return false;
    }
  }, [getMediaEl]);

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

  const handleRegisterMediaAccess = useCallback((payload = {}) => {
    if (!bridgeRegisterAccess) return;
    const hasPayload = payload && Object.keys(payload).length > 0;
    if (!hasPayload) {
      bridgeRegisterAccess({});
      return;
    }
    bridgeRegisterAccess({
      ...payload,
      hardReset,
      fetchVideoInfo
    });
  }, [bridgeRegisterAccess, fetchVideoInfo, hardReset]);

  useMediaReporter({
    mediaRef: mediaElementRef,
    onPlaybackMetrics: bridgePlaybackMetrics,
    onRegisterMediaAccess: handleRegisterMediaAccess,
    seekToIntentSeconds,
    onSeekRequestConsumed: bridgeSeekConsumed,
    remountDiagnostics: mountDiagnostics,
    mediaIdentityKey: resolvedInstanceKey
  });

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
    const mountDetails = {
      media_key,
      mountReason: mountDiagnostics?.reason || 'initial-render',
      mountSource: mountDiagnostics?.source || null,
      mountSeekSeconds: typeof mountDiagnostics?.seekSeconds === 'number' ? mountDiagnostics.seekSeconds : null,
      remountNonce: mountDiagnostics?.remountNonce ?? null,
      mountWaitKey: mountDiagnostics?.waitKey || null,
      mountTrigger: mountDiagnostics?.trigger || null,
      mountConditions: mountDiagnostics?.conditions || null,
      mountTimestamp: mountDiagnostics?.timestamp || null
    };
    logControllerEvent('mount', mountDetails);
    lastSeekIntentRef.current = null;
    lastPlaybackPosRef.current = 0;
    isInitialLoadRef.current = true;
  }, [logControllerEvent, media_key, mountDiagnostics]);

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
    applySeekToMediaEl(normalized, 'internal-seek-intent');
    setInternalSeekIntentSeconds(null);
  }, [internalSeekIntentSeconds, media_key, applySeekToMediaEl]);

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

    if (Number.isFinite(pendingAutoSeekRef.current)) {
      try {
        mediaEl.currentTime = pendingAutoSeekRef.current;
      } catch (_) {
        // rely on future metadata event to reapply
      }
      pendingAutoSeekRef.current = null;
    }

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
      const pendingSeekValue = Number.isFinite(pendingAutoSeekRef.current)
        ? pendingAutoSeekRef.current
        : null;
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

      if (pendingSeekValue != null) {
        desiredStart = pendingSeekValue;
        pendingAutoSeekRef.current = null;
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

      const autoplayLogContext = {
        waitKey: formatWaitKeyForLogs(resolvedInstanceKey),
        media_key,
        type,
        isVideo: isVideoEl,
        desiredStart: roundSeconds(desiredStart),
        pendingSeekSeconds: roundSeconds(pendingSeekValue),
        autoplay: true
      };
      playbackLog('transport-autoplay-primed', autoplayLogContext);

      try {
        const playPromise = mediaEl.play?.();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise
            .then(() => {
              playbackLog('transport-autoplay-result', {
                ...autoplayLogContext,
                result: 'fulfilled',
                paused: Boolean(mediaEl.paused),
                readyState: mediaEl.readyState
              });
            })
            .catch((error) => {
              playbackLog('transport-autoplay-result', {
                ...autoplayLogContext,
                result: 'rejected',
                paused: Boolean(mediaEl.paused),
                readyState: mediaEl.readyState,
                error: error?.message || 'unknown-error'
              });
            });
        } else {
          playbackLog('transport-autoplay-result', {
            ...autoplayLogContext,
            result: 'no-promise',
            paused: Boolean(mediaEl.paused),
            readyState: mediaEl.readyState
          });
        }
      } catch (error) {
        playbackLog('transport-autoplay-result', {
          ...autoplayLogContext,
          result: 'threw',
          paused: Boolean(mediaEl.paused),
          readyState: mediaEl.readyState,
          error: error?.message || 'play-threw'
        });
      }

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



  const getPlaybackState = useCallback(() => ({
    isPaused: isPausedValue,
    isSeeking,
    seconds,
    duration
  }), [duration, isPausedValue, isSeeking, seconds]);

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
      ...(mergedControllerExtras || {})
    };

    onController(controllerPayload);
  }, [getPlaybackState, mergedControllerExtras, onController, resolvedInstanceKey, transport]);

  return {
    containerRef,
    getMediaEl,
    seconds,
    percent: getProgressPercent(seconds, duration),
    duration,
    isPaused: isPausedValue,
    isSeeking,
    isDash,
    shader,
    handleProgressClick,
    mediaInstanceKey: resolvedInstanceKey,
    hardReset,
    transport,
    getPlaybackState,
    setControllerExtras: setControllerExtrasState
  };
}
