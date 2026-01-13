import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getProgressPercent, guid } from '../lib/helpers.js';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
// useMediaResilience now lives at the Player level; this hook no longer imports it directly.
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';
import { useMediaReporter } from './useMediaReporter.js';
import { getDaylightLogger } from '../../../lib/logging/singleton.js';

const logger = getDaylightLogger({ context: { component: 'MediaController' } });
const DEBUG_MEDIA = false;
const roundSeconds = (value, precision = 3) => (Number.isFinite(value)
  ? Number(value.toFixed(precision))
  : null);

export const shouldRestartFromBeginning = (durationSeconds, candidateSeconds) => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { restart: false, reason: 'invalid-duration' };
  }
  if (!Number.isFinite(candidateSeconds) || candidateSeconds < 0) {
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
  watchedDurationProvider = null,
  onMediaRef,
  onController,
  keyboardOverrides,
  controllerExtras,
  mediaAccessExtras = null,
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
    remountDiagnostics: bridgeRemountDiagnostics,
    onStartupSignal: bridgeStartupSignal
  } = resilienceBridge || {};
  const mountDiagnostics = bridgeRemountDiagnostics || null;
  const containerRef = useRef(null);
  const mediaElementRef = useRef(null);
  const onEndRef = useRef(onEnd);
  const onMediaRefRef = useRef(onMediaRef);
  const onProgressRef = useRef(onProgress);
  const playbackRateRef = useRef(playbackRate);
  const volumeRef = useRef(volume);
  const metaRef = useRef(meta);
  const startRef = useRef(start);
  const resolveWatchedDurationRef = useRef(resolveWatchedDuration);

  // Keep refs updated with latest values
  useEffect(() => {
    onEndRef.current = onEnd;
    onMediaRefRef.current = onMediaRef;
    onProgressRef.current = onProgress;
    playbackRateRef.current = playbackRate;
    volumeRef.current = volume;
    metaRef.current = meta;
    startRef.current = start;
    resolveWatchedDurationRef.current = resolveWatchedDuration;
  }, [onEnd, onMediaRef, onProgress, playbackRate, volume, meta, start, resolveWatchedDuration]);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const lastLoggedTimeRef = useRef(0);
  const lastPlaybackPosRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const lastSeekIntentRef = useRef(null);
  const pendingAutoSeekRef = useRef(null);
  const lastWaitStatusRef = useRef(null);
  const lastLoggedMetadataKeyRef = useRef(null);

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
      logger.info('video-seek-apply', { source, targetSeconds, currentTime, from: 'setSeconds' });
      mediaEl.currentTime = targetSeconds;
      pendingAutoSeekRef.current = null;
      if (DEBUG_MEDIA) {
        playbackLog('media.seek-apply', {
          source,
          targetSeconds
        }, { level: 'debug' });
      }
      return true;
    } catch (error) {
      pendingAutoSeekRef.current = targetSeconds;
      if (DEBUG_MEDIA) {
        playbackLog('media.seek-apply-error', {
          source,
          targetSeconds,
          error: error?.message || String(error)
        }, { level: 'warn' });
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
    const { level: detailLevel, context: detailContext, ...restDetails } = details || {};
    playbackLog('controller', {
      event,
      ...restDetails
    }, {
      level: detailLevel || 'info',
      context: {
        threadId,
        mediaKey: media_key || null,
        instanceKey: resolvedInstanceKey,
        waitKey: waitKeyLabel,
        ...detailContext
      }
    });
  }, [formatWaitKeyForLogs, media_key, resolvedInstanceKey, threadId]);

  const hardReset = useCallback(({ seekToSeconds = null } = {}) => {
    if (Number.isFinite(seekToSeconds)) {
      setInternalSeekIntentSeconds(Math.max(0, seekToSeconds));
    }
    setReloadNonce((nonce) => {
      const next = nonce + 1;
      logControllerEvent('hard-reset', { seekToSeconds, level: 'warn' }, `${baseInstanceKey}:mc-${next}`);
      return next;
    });
  }, [baseInstanceKey, logControllerEvent, setReloadNonce]);

  const resolveWatchedDuration = useCallback(() => {
    if (typeof watchedDurationProvider !== 'function') {
      return null;
    }
    try {
      const value = watchedDurationProvider();
      return Number.isFinite(value) ? value : null;
    } catch (_) {
      return null;
    }
  }, [watchedDurationProvider]);

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
    mediaIdentityKey: resolvedInstanceKey,
    onStartupSignal: bridgeStartupSignal,
    mediaAccessExtras
  });

  useEffect(() => {
    try {
      if (media_key) {
        if (!useCommonMediaController.__prevKeyLog) useCommonMediaController.__prevKeyLog = media_key;
        if (useCommonMediaController.__prevKeyLog !== media_key) {
          if (DEBUG_MEDIA) {
            playbackLog('media-key-change', {
              from: useCommonMediaController.__prevKeyLog,
              to: media_key
            }, { level: 'debug' });
          }
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
    const MEDIA_EL_POLL_INTERVAL_MS = 50;
    let detachListeners = null;
    let waitTimer = null;
    let observer = null;
    let cancelled = false;
    let waitAttempts = 0;

    const teardownObserver = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const cleanup = () => {
      if (typeof detachListeners === 'function') {
        detachListeners();
      }
      detachListeners = null;
      teardownObserver();
      lastWaitStatusRef.current = null;
    };

    const logWaitingStatus = (status) => {
      if (lastWaitStatusRef.current === status) return;
      lastWaitStatusRef.current = status;
      // Skip logging for immediate resolution to reduce noise
      if (status === 'resolved' && waitAttempts === 0) return;
      playbackLog('media-el-wait', {
        status,
        attempts: waitAttempts,
        waitKey: formatWaitKeyForLogs(resolvedInstanceKey),
        media_key
      }, { level: 'debug' });
    };

    const attachWhenReady = () => {
      if (cancelled) return;
      const mediaEl = getMediaEl();
      if (!mediaEl) {
        waitAttempts += 1;
        const host = containerRef.current;
        if (!observer && host && typeof MutationObserver !== 'undefined') {
          observer = new MutationObserver(() => {
            const candidate = getMediaEl();
            if (candidate) {
              teardownObserver();
              attachWhenReady();
            }
          });
          observer.observe(host, { childList: true, subtree: true });
          logWaitingStatus('observer-attached');
        }
        logWaitingStatus('pending');
        waitTimer = setTimeout(attachWhenReady, MEDIA_EL_POLL_INTERVAL_MS);
        return;
      }
      if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
      teardownObserver();
      logWaitingStatus('resolved');

      if (Number.isFinite(pendingAutoSeekRef.current)) {
        try {
          logger.info('video-seek-apply', { 
            targetSeconds: pendingAutoSeekRef.current, 
            currentTime: mediaEl.currentTime,
            from: 'pendingAutoSeek-after-waiting' 
          });
          mediaEl.currentTime = pendingAutoSeekRef.current;
        } catch (_) {
          // rely on future metadata event to reapply
        }
        pendingAutoSeekRef.current = null;
      }

      let rateCleanup = null;

      const logProgress = async () => {
        const now = Date.now();
        const diff = now - lastLoggedTimeRef.current;
        const pct = getProgressPercent(mediaEl.currentTime || 0, mediaEl.duration || 0);
        if (diff > 10000 && parseFloat(pct) > 0) {
          lastLoggedTimeRef.current = now;
          const secs = mediaEl.currentTime || 0;
          if (secs > 10) {
            const title = metaRef.current?.title + (metaRef.current?.show ? ` (${metaRef.current.show} - ${metaRef.current.season})` : '');
            const logType = (metaRef.current?.plex || /^\d+$/.test(String(media_key))) ? 'plex' : type;
            const logPayload = { title, type: logType, media_key, seconds: secs, percent: pct };
            const watchedDurationSeconds = resolveWatchedDurationRef.current?.();
            if (watchedDurationSeconds != null) {
              logPayload.watched_duration = Number(watchedDurationSeconds.toFixed(3));
            }
            await DaylightAPI('media/log', logPayload);
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

        if (onProgressRef.current) {
          onProgressRef.current({
            currentTime: current,
            duration: mediaEl.duration || 0,
            paused: mediaEl.paused,
            media: metaRef.current,
            percent: getProgressPercent(mediaEl.currentTime, mediaEl.duration)
          });
        }
      };

      const onDurationChange = () => {
        setDuration(mediaEl.duration || 0);
      };

      const onError = () => {
        const error = mediaEl.error;
        playbackLog('media-error', {
          code: error?.code,
          message: error?.message,
          networkState: mediaEl.networkState,
          readyState: mediaEl.readyState,
          src: mediaEl.currentSrc || mediaEl.src
        }, { level: 'error' });
      };

      const onEnded = () => {
        lastLoggedTimeRef.current = 0;
        logProgress();
        onEndRef.current?.();
      };

      const onLoadedMetadata = () => {
        const durationValue = mediaEl.duration || 0;
        let desiredStart = 0;
        const pendingSeekValue = Number.isFinite(pendingAutoSeekRef.current)
          ? pendingAutoSeekRef.current
          : null;
        const hasAppliedForKey = !!useCommonMediaController.__appliedStartByKey[media_key];
        const processedVolumeRaw = Number(volumeRef.current ?? 100);
        const processedVolume = Number.isFinite(processedVolumeRaw) ? processedVolumeRaw : 100;
        const normalizedVolume = processedVolume > 1 ? processedVolume / 100 : processedVolume;
        const adjustedVolume = Math.min(1, Math.max(0, normalizedVolume));
        const isVideoEl = mediaEl.tagName && mediaEl.tagName.toLowerCase() === 'video';

        // Deduplication check for metadata/autoplay logs
        const logKey = `${resolvedInstanceKey}:${mediaEl.src}:${durationValue}`;
        const alreadyLoggedMetadata = lastLoggedMetadataKeyRef.current === logKey;
        
        if (!alreadyLoggedMetadata) {
          lastLoggedMetadataKeyRef.current = logKey;
        }

        const explicitResume = metaRef.current?.resume;
        const forceStart = explicitResume === false;

        if (!alreadyLoggedMetadata) {
          playbackLog('media-resume-check', {
            media_key,
            explicitResume,
            forceStart,
            start: startRef.current,
            duration: durationValue,
            isInitial: isInitialLoadRef.current,
            hasApplied: hasAppliedForKey
          }, { level: 'info' });
        }

        if ((isInitialLoadRef.current && !hasAppliedForKey) || forceStart) {
          const shouldApplyStart = (durationValue > 12 * 60) || isVideoEl || forceStart;
          desiredStart = shouldApplyStart ? startRef.current : 0;

          const initialDecision = shouldRestartFromBeginning(durationValue, desiredStart);

          playbackLog('media-resume-decision-initial', {
            media_key,
            desiredStart,
            duration: durationValue,
            restart: initialDecision.restart,
            reason: initialDecision.reason,
            forceStart
          }, { level: 'debug' });

          if (initialDecision.restart || forceStart) {
            desiredStart = forceStart ? startRef.current : 0;
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

          playbackLog('media-resume-decision-sticky', {
            media_key,
            candidate: sticky,
            source: foundCandidate?.label || 'none',
            restart: stickyDecision.restart,
            reason: stickyDecision.reason
          }, { level: 'debug' });

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

        if (Number.isFinite(desiredStart) && desiredStart >= 0) {
          try {
            logger.info('video-seek-apply', { 
              targetSeconds: desiredStart, 
              currentTime: mediaEl.currentTime,
              from: 'desiredStart-on-media-change' 
            });
            mediaEl.currentTime = desiredStart;
          } catch (error) {
            playbackLog('media-start-time-failed', { desiredStart, error }, { level: 'warn' });
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
        
        if (!alreadyLoggedMetadata) {
          playbackLog('transport-autoplay-primed', autoplayLogContext, { level: 'debug' });
        }

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
                }, { level: 'info' });
              })
              .catch((error) => {
                playbackLog('transport-autoplay-result', {
                  ...autoplayLogContext,
                  result: 'rejected',
                  paused: Boolean(mediaEl.paused),
                  readyState: mediaEl.readyState,
                  error: error?.message || 'unknown-error'
                }, { level: 'warn' });
              });
          } else {
            playbackLog('transport-autoplay-result', {
              ...autoplayLogContext,
              result: 'no-promise',
              paused: Boolean(mediaEl.paused),
              readyState: mediaEl.readyState
            }, { level: 'info' });
          }
        } catch (error) {
          playbackLog('transport-autoplay-result', {
            ...autoplayLogContext,
            result: 'threw',
            paused: Boolean(mediaEl.paused),
            readyState: mediaEl.readyState,
            error: error?.message || 'play-threw'
          }, { level: 'warn' });
        }

        const queueLength = metaRef.current?.queueLength || 0;
        const shouldLoop = queueLength === 1
          || (queueLength === 0 && metaRef.current?.continuous)
          || (queueLength === 0 && isVideoEl && durationValue < 20);
        mediaEl.loop = shouldLoop;

        if (isVideoEl || isDash) {
          mediaEl.controls = false;
          const applyRate = () => { mediaEl.playbackRate = playbackRateRef.current; };
          mediaEl.addEventListener('play', applyRate);
          mediaEl.addEventListener('seeked', applyRate);
          rateCleanup = () => {
            mediaEl.removeEventListener('play', applyRate);
            mediaEl.removeEventListener('seeked', applyRate);
          };
        } else {
          mediaEl.playbackRate = playbackRateRef.current;
          rateCleanup = null;
        }

        if (!alreadyLoggedMetadata) {
          playbackLog('media-loadedmetadata', {
            media_key,
            desiredStart,
            duration: durationValue,
            volume: adjustedVolume,
            loop: mediaEl.loop
          }, { level: 'debug' });
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

      const onPlayingEvent = () => {
        clearSeeking();
      };

      mediaEl.addEventListener('timeupdate', onTimeUpdate);
      mediaEl.addEventListener('durationchange', onDurationChange);
      mediaEl.addEventListener('error', onError);
      mediaEl.addEventListener('ended', onEnded);
      mediaEl.addEventListener('loadedmetadata', onLoadedMetadata);
      mediaEl.addEventListener('seeking', handleSeeking);
      mediaEl.addEventListener('seeked', clearSeeking);
      mediaEl.addEventListener('playing', onPlayingEvent);

      detachListeners = () => {
        mediaEl.removeEventListener('timeupdate', onTimeUpdate);
        mediaEl.removeEventListener('durationchange', onDurationChange);
        mediaEl.removeEventListener('error', onError);
        mediaEl.removeEventListener('ended', onEnded);
        mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
        mediaEl.removeEventListener('seeking', handleSeeking);
        mediaEl.removeEventListener('seeked', clearSeeking);
        mediaEl.removeEventListener('playing', onPlayingEvent);
        rateCleanup?.();
      };

      if (onMediaRefRef.current) {
        try {
          onMediaRefRef.current(mediaEl);
        } catch (_) {
          // ignore consumer errors; diagnostics handled elsewhere
        }
      }
    };

    attachWhenReady();

    return () => {
      cancelled = true;
      if (waitTimer) {
        clearTimeout(waitTimer);
      }
      cleanup();
    };
  }, [formatWaitKeyForLogs, getMediaEl, isDash, media_key, resolvedInstanceKey, start, type]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (mediaEl && onMediaRefRef.current) {
      onMediaRefRef.current(mediaEl);
    }
  }, [getMediaEl, media_key, resolvedInstanceKey]);

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
    hardReset,
    clearPendingAutoSeek: () => {
      pendingAutoSeekRef.current = null;
    }
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
  }, [mergedControllerExtras, onController, resolvedInstanceKey, transport]);

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
    setControllerExtras: setControllerExtrasState,
    waitKey: formatWaitKeyForLogs(resolvedInstanceKey)
  };
}
