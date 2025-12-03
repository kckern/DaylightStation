import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ShakaVideoStreamer from 'vimond-replay/video-streamer/shaka-player';
import { useCommonMediaController, shouldRestartFromBeginning } from '../hooks/useCommonMediaController.js';
import { ProgressBar } from './ProgressBar.jsx';
import { playbackLog } from '../lib/playbackLogger.js';

const deriveApproxDurationSeconds = (media = {}) => {
  const numericFields = [
    media?.duration,
    media?.duration_seconds,
    media?.runtime,
    media?.runtimeSeconds,
    media?.media_duration
  ];
  const explicitDuration = numericFields.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
  if (Number.isFinite(explicitDuration)) {
    return explicitDuration;
  }
  const seconds = Number(media?.seconds);
  const percent = Number(media?.percent);
  if (Number.isFinite(seconds) && Number.isFinite(percent) && percent > 0) {
    return seconds / (percent / 100);
  }
  return null;
};

const resolveInitialStartSeconds = (media) => {
  const rawStart = Number(media?.seconds);
  const normalizedStart = Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 0;
  const approxDuration = deriveApproxDurationSeconds(media);
  const decision = shouldRestartFromBeginning(approxDuration, normalizedStart);
  return {
    startSeconds: decision.restart ? 0 : normalizedStart,
    decision,
    approxDuration
  };
};

/**
 * Video player component for playing video content (including DASH video)
 */
const serializePlaybackError = (error) => {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  if (typeof error === 'object') {
    const {
      code,
      severity,
      technology,
      message,
      data,
      category,
      detail,
      stack
    } = error;
    return {
      code: code ?? error?.detail?.code ?? null,
      severity: severity ?? error?.severity ?? null,
      technology: technology ?? error?.technology ?? null,
      category: category ?? null,
      message: message ?? error?.message ?? null,
      data: data ?? error?.data ?? null,
      detail: detail ?? null,
      stack: stack ?? error?.stack ?? null
    };
  }
  return { value: error };
};

const serializeMediaError = (mediaError) => {
  if (!mediaError) return null;
  const { code, message, MEDIA_ERR_NETWORK, MEDIA_ERR_DECODE, MEDIA_ERR_SRC_NOT_SUPPORTED, MEDIA_ERR_ABORTED } = mediaError;
  return {
    code: code ?? null,
    message: message || null,
    MEDIA_ERR_ABORTED,
    MEDIA_ERR_NETWORK,
    MEDIA_ERR_DECODE,
    MEDIA_ERR_SRC_NOT_SUPPORTED
  };
};

const serializeTimeRanges = (ranges) => {
  if (!ranges || typeof ranges.length !== 'number') {
    return [];
  }
  const entries = [];
  for (let index = 0; index < ranges.length; index += 1) {
    try {
      const start = ranges.start(index);
      const end = ranges.end(index);
      entries.push({
        start: Number.isFinite(start) ? Number(start.toFixed(3)) : start,
        end: Number.isFinite(end) ? Number(end.toFixed(3)) : end
      });
    } catch (_) {
      // Ignore invalid ranges
    }
  }
  return entries;
};

const computeBufferSnapshot = (mediaEl) => {
  if (!mediaEl) {
    return {
      currentTime: null,
      buffered: [],
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  const buffered = serializeTimeRanges(mediaEl.buffered);
  const currentTime = Number.isFinite(mediaEl.currentTime) ? Number(mediaEl.currentTime.toFixed(3)) : null;
  if (currentTime == null || !buffered.length) {
    return {
      currentTime,
      buffered,
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  let bufferAheadSeconds = null;
  let bufferBehindSeconds = null;
  let nextBufferStartSeconds = null;
  for (let index = 0; index < buffered.length; index += 1) {
    const range = buffered[index];
    if (currentTime >= range.start && currentTime <= range.end) {
      bufferAheadSeconds = Number((range.end - currentTime).toFixed(3));
      bufferBehindSeconds = Number((currentTime - range.start).toFixed(3));
      if (index + 1 < buffered.length) {
        nextBufferStartSeconds = buffered[index + 1].start;
      }
      break;
    }
    if (currentTime < range.start) {
      nextBufferStartSeconds = range.start;
      break;
    }
  }
  const bufferGapSeconds = Number.isFinite(nextBufferStartSeconds)
    ? Number((nextBufferStartSeconds - currentTime).toFixed(3))
    : null;
  return {
    currentTime,
    buffered,
    bufferAheadSeconds,
    bufferBehindSeconds,
    nextBufferStartSeconds,
    bufferGapSeconds
  };
};

const readVideoPlaybackQuality = (mediaEl) => {
  if (!mediaEl) {
    return {
      droppedFrames: null,
      totalFrames: null
    };
  }
  try {
    if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
      const sample = mediaEl.getVideoPlaybackQuality();
      return {
        droppedFrames: Number.isFinite(sample?.droppedVideoFrames)
          ? sample.droppedVideoFrames
          : (Number.isFinite(sample?.droppedFrames) ? sample.droppedFrames : null),
        totalFrames: Number.isFinite(sample?.totalVideoFrames)
          ? sample.totalVideoFrames
          : (Number.isFinite(sample?.totalFrames) ? sample.totalFrames : null)
      };
    }
  } catch (_) {
    // ignore playback quality errors
  }
  const dropped = Number.isFinite(mediaEl?.webkitDroppedFrameCount)
    ? mediaEl.webkitDroppedFrameCount
    : null;
  const decoded = Number.isFinite(mediaEl?.webkitDecodedFrameCount)
    ? mediaEl.webkitDecodedFrameCount
    : null;
  return {
    droppedFrames: dropped,
    totalFrames: decoded
  };
};

const summarizeShakaStats = (player) => {
  if (!player || typeof player.getStats !== 'function') {
    return null;
  }
  try {
    const stats = player.getStats();
    if (!stats || typeof stats !== 'object') {
      return null;
    }
    return {
      width: stats.width ?? null,
      height: stats.height ?? null,
      streamBandwidth: stats.streamBandwidth ?? null,
      estimatedBandwidth: stats.estimatedBandwidth ?? null,
      decodedFrames: stats.decodedFrames ?? null,
      droppedFrames: stats.droppedFrames ?? null,
      bufferLength: stats.bufferLength ?? null,
      stateHistoryLength: Array.isArray(stats.stateHistory) ? stats.stateHistory.length : null
    };
  } catch (_) {
    return null;
  }
};

const buildTroubleDiagnostics = (mediaEl, player) => {
  if (!mediaEl) {
    return null;
  }
  const buffer = computeBufferSnapshot(mediaEl);
  const quality = readVideoPlaybackQuality(mediaEl);
  const shaka = summarizeShakaStats(player);
  return {
    currentTime: buffer.currentTime,
    bufferAheadSeconds: buffer.bufferAheadSeconds,
    bufferBehindSeconds: buffer.bufferBehindSeconds,
    nextBufferStartSeconds: buffer.nextBufferStartSeconds,
    bufferGapSeconds: buffer.bufferGapSeconds,
    buffered: buffer.buffered,
    playbackRate: Number.isFinite(mediaEl.playbackRate) ? Number(mediaEl.playbackRate.toFixed(3)) : null,
    paused: typeof mediaEl.paused === 'boolean' ? mediaEl.paused : null,
    readyState: typeof mediaEl.readyState === 'number' ? mediaEl.readyState : null,
    networkState: typeof mediaEl.networkState === 'number' ? mediaEl.networkState : null,
    quality,
    shaka
  };
};

const isSmoothPlaybackSample = (mediaEl) => {
  if (!mediaEl) {
    return false;
  }
  const readyState = typeof mediaEl.readyState === 'number' ? mediaEl.readyState : 0;
  const networkState = typeof mediaEl.networkState === 'number' ? mediaEl.networkState : 0;
  return readyState >= 3 && mediaEl.paused === false && networkState !== 2;
};

const SMOOTH_PLAYBACK_HEARTBEAT_INTERVAL_MS = 15000;

export function VideoPlayer({ 
  media, 
  advance, 
  clear, 
  shader, 
  volume, 
  playbackRate,
  setShader, 
  cycleThroughClasses, 
  classes, 
  playbackKeys,
  queuePosition, 
  fetchVideoInfo, 
  ignoreKeys, 
  onProgress, 
  onMediaRef, 
  keyboardOverrides,
  onController,
  resilienceBridge,
  maxVideoBitrate,
  maxResolution,
  watchedDurationProvider
}) {
  // console.log('[VideoPlayer] Received keyboardOverrides:', keyboardOverrides ? Object.keys(keyboardOverrides) : 'undefined');
  const isPlex = ['dash_video'].includes(media.media_type);
  
  const { show, season, title, media_url } = media;

  const { startSeconds: initialStartSeconds } = useMemo(
    () => resolveInitialStartSeconds(media),
    [
      media?.seconds,
      media?.percent,
      media?.duration,
      media?.duration_seconds,
      media?.runtime,
      media?.runtimeSeconds,
      media?.media_duration
    ]
  );

  const resolvedMaxVideoBitrate = maxVideoBitrate ?? media?.maxVideoBitrate ?? null;
  const resolvedMaxResolution = maxResolution ?? media?.maxResolution ?? null;

  const videoKey = useMemo(
    () => `${media_url || ''}:${resolvedMaxVideoBitrate ?? 'unlimited'}:${resolvedMaxResolution ?? 'native'}`,
    [media_url, resolvedMaxVideoBitrate, resolvedMaxResolution]
  );

  const shakaNudgePlaybackRef = useRef(async () => ({ ok: false, outcome: 'not-ready' }));
  const mediaAccessExtras = useMemo(() => ({
    nudgePlayback: (...args) => shakaNudgePlaybackRef.current?.(...args)
  }), []);

  const {
    isDash,
    containerRef,
    seconds,
    duration,
    handleProgressClick,
    mediaInstanceKey,
    getMediaEl,
    isPaused,
    isSeeking,
    hardReset
  } = useCommonMediaController({
    start: initialStartSeconds,
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta: media,
    type: isPlex ? 'plex' : 'media',
    shader,
    volume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    onProgress,
    onMediaRef,
    keyboardOverrides,
    onController,
    instanceKey: videoKey,
    fetchVideoInfo,
    seekToIntentSeconds: resilienceBridge?.seekToIntentSeconds,
    resilienceBridge,
    watchedDurationProvider,
    mediaAccessExtras
  });
  const dashSource = useMemo(() => {
    if (!media_url) return null;
    const startPosition = Number.isFinite(initialStartSeconds) && initialStartSeconds > 0 ? initialStartSeconds : undefined;
    return startPosition != null
      ? { streamUrl: media_url, contentType: 'application/dash+xml', startPosition }
      : { streamUrl: media_url, contentType: 'application/dash+xml' };
  }, [media_url, initialStartSeconds]);

  const getCurrentMediaElement = useCallback(() => {
    const host = containerRef.current;
    if (!host) return null;
    const selector = 'video';
    const shadowRoot = host.shadowRoot;
    if (shadowRoot && typeof shadowRoot.querySelector === 'function') {
      const shadowVideo = shadowRoot.querySelector(selector);
      if (shadowVideo) return shadowVideo;
    }

    const tagName = typeof host.tagName === 'string' ? host.tagName.toUpperCase() : '';
    if (tagName === 'VIDEO') {
      return host;
    }

    if (typeof host.querySelector === 'function') {
      const nestedVideo = host.querySelector(selector);
      if (nestedVideo) return nestedVideo;
    }

    return null;
  }, [containerRef]);

  const shakaPlayerRef = useRef(null);
  const shakaNetworkingCleanupRef = useRef(() => {});
  const shakaRecoveryStateRef = useRef({
    attempts: 0,
    pendingFetch: false,
    skipped: false,
    cooldownUntil: 0
  });
  const findNextBufferedStart = useCallback((mediaEl, currentSeconds) => {
    if (!mediaEl?.buffered) return null;
    try {
      const ranges = mediaEl.buffered;
      const length = Number(ranges.length) || 0;
      let containsCurrent = false;
      for (let index = 0; index < length; index += 1) {
        const start = ranges.start(index);
        const end = ranges.end(index);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          continue;
        }
        if (currentSeconds >= start && currentSeconds <= end) {
          containsCurrent = true;
          break;
        }
        if (currentSeconds < start) {
          return start + 0.01;
        }
      }
      return containsCurrent ? null : null;
    } catch (_) {
      return null;
    }
  }, []);

  const logShakaDiagnostic = useCallback((event, payload = {}, level = 'debug') => {
    const rateLimit = event === 'shaka-video-event'
      ? {
          key: 'playback-heartbeat',
          interval: SMOOTH_PLAYBACK_HEARTBEAT_INTERVAL_MS,
          when: (recordPayload) => (
            recordPayload?.eventName === 'timeupdate'
            && (recordPayload?.smooth === true
              || (
                typeof recordPayload?.readyState === 'number'
                && recordPayload.readyState >= 3
                && recordPayload?.paused === false
                && recordPayload?.buffering !== true
              ))
          )
        }
      : undefined;
    playbackLog(event, {
      ...payload,
      mediaType: media?.media_type || null,
      mediaTitle: media?.title || media?.show || null
    }, {
      level,
      context: {
        mediaKey: media?.media_key || media?.id || null,
        instanceKey: mediaInstanceKey
      },
      ...(rateLimit ? { rateLimit } : {})
    });
  }, [media?.id, media?.media_key, media?.media_type, media?.show, media?.title, mediaInstanceKey]);

  const shakaNudgePlayback = useCallback(async ({ reason = 'decoder-stall' } = {}) => {
    const mediaEl = getCurrentMediaElement();
    if (!mediaEl) {
      logShakaDiagnostic('shaka-nudge-skip', { reason, outcome: 'no-media-element' }, 'warn');
      return { ok: false, outcome: 'no-media-element' };
    }

    const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
    const gapTarget = findNextBufferedStart(mediaEl, currentTime);
    if (Number.isFinite(gapTarget) && gapTarget - currentTime > 0.05) {
      try {
        mediaEl.currentTime = Math.max(0, gapTarget);
        mediaEl.play?.().catch(() => {});
        logShakaDiagnostic('shaka-nudge-gap-skip', { reason, targetSeconds: gapTarget }, 'info');
        return { ok: true, action: 'gap-skip', targetSeconds: gapTarget };
      } catch (error) {
        logShakaDiagnostic('shaka-nudge-gap-error', {
          reason,
          targetSeconds: gapTarget,
          error: serializePlaybackError(error)
        }, 'warn');
      }
    }

    const player = shakaPlayerRef.current;
    if (player && typeof player.retryStreaming === 'function') {
      try {
        await player.retryStreaming();
        logShakaDiagnostic('shaka-nudge-retry-streaming', { reason }, 'info');
        return { ok: true, action: 'retry-streaming' };
      } catch (error) {
        logShakaDiagnostic('shaka-nudge-retry-error', {
          reason,
          error: serializePlaybackError(error)
        }, 'warn');
      }
    }

    const duration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : null;
    const delta = 0.25;
    const targetSeconds = duration != null
      ? Math.min(Math.max(0, currentTime + delta), Math.max(0, duration - 0.05))
      : currentTime + delta;
    if (Number.isFinite(targetSeconds) && targetSeconds > currentTime) {
      try {
        mediaEl.currentTime = targetSeconds;
        mediaEl.play?.().catch(() => {});
        logShakaDiagnostic('shaka-nudge-microseek', { reason, targetSeconds }, 'info');
        return { ok: true, action: 'micro-seek', targetSeconds };
      } catch (error) {
        logShakaDiagnostic('shaka-nudge-microseek-error', {
          reason,
          targetSeconds,
          error: serializePlaybackError(error)
        }, 'warn');
      }
    }

    logShakaDiagnostic('shaka-nudge-exhausted', { reason }, 'warn');
    return { ok: false, outcome: 'exhausted' };
  }, [findNextBufferedStart, getCurrentMediaElement, logShakaDiagnostic]);

  useEffect(() => {
    shakaNudgePlaybackRef.current = shakaNudgePlayback;
  }, [shakaNudgePlayback]);

  useEffect(() => {
    shakaRecoveryStateRef.current = {
      attempts: 0,
      pendingFetch: false,
      skipped: false,
      cooldownUntil: 0
    };
  }, [mediaInstanceKey]);

  const shakaConfiguration = useMemo(() => {
    const streaming = {
      bufferingGoal: 90,
      rebufferingGoal: 30,
      stallEnabled: true,
      stallThreshold: 0.25,
      bufferBehind: 120,
      retryParameters: {
        maxAttempts: 7,
        baseDelay: 250,
        backoffFactor: 2,
        fuzzFactor: 0.5,
        timeout: 0
      }
    };
    const abr = {
      enabled: true,
      switchInterval: 2,
      bandwidthUpgradeTarget: 0.85,
      bandwidthDowngradeTarget: 0.95
    };
    return {
      playsInline: true,
      shakaPlayer: {
        installPolyfills: true,
        customConfiguration: {
          streaming,
          abr
        }
      }
    };
  }, []);

  const handleShakaReady = useCallback(({ thirdPartyPlayer, play, setProperties }) => {
    shakaPlayerRef.current = thirdPartyPlayer || null;
    if (typeof shakaNetworkingCleanupRef.current === 'function') {
      shakaNetworkingCleanupRef.current();
      shakaNetworkingCleanupRef.current = () => {};
    }
    const cleanupFns = [];
    if (thirdPartyPlayer && typeof thirdPartyPlayer.addEventListener === 'function') {
      const shakaEvents = ['error', 'loading', 'streaming', 'buffering'];
      shakaEvents.forEach((eventName) => {
        const handler = (event) => {
          const payload = {
            eventName,
            streamUrl: dashSource?.streamUrl || null
          };
          if (event && typeof event === 'object') {
            if ('buffering' in event) payload.buffering = Boolean(event.buffering);
            if ('detail' in event) payload.detail = serializePlaybackError(event.detail);
          }
          if (eventName === 'buffering' || eventName === 'error') {
            payload.diagnostics = buildTroubleDiagnostics(getCurrentMediaElement(), shakaPlayerRef.current || thirdPartyPlayer || null);
          }
          logShakaDiagnostic('shaka-player-event', payload, eventName === 'error' ? 'warn' : 'debug');
        };
        thirdPartyPlayer.addEventListener(eventName, handler);
        cleanupFns.push(() => thirdPartyPlayer.removeEventListener(eventName, handler));
      });
      logShakaDiagnostic('shaka-event-hooks', {
        attached: true,
        eventNames: shakaEvents
      }, 'debug');
    } else {
      logShakaDiagnostic('shaka-event-hooks', {
        attached: false
      }, 'warn');
    }

    let networkingHooksRegistered = false;
    let networkingEngineReason = null;
    const hasNetworkingGetter = Boolean(thirdPartyPlayer && typeof thirdPartyPlayer.getNetworkingEngine === 'function');
    const networkingEngine = hasNetworkingGetter ? thirdPartyPlayer.getNetworkingEngine() : null;
    if (networkingEngine) {
      const requestFilter = (requestType, request) => {
        logShakaDiagnostic('shaka-network-request', {
          requestType,
          uri: request?.uris?.[0] || null,
          method: request?.method || 'GET',
          headerKeys: request?.headers ? Object.keys(request.headers) : null,
          allowCrossSiteCredentials: Boolean(request?.allowCrossSiteCredentials)
        }, 'debug');
      };
      const responseFilter = (requestType, response) => {
        const status = typeof response?.status === 'number' ? response.status : null;
        logShakaDiagnostic('shaka-network-response', {
          requestType,
          uri: response?.uri || null,
          originalUri: response?.originalUri || null,
          fromCache: Boolean(response?.fromCache),
          status
        }, status && status >= 400 ? 'warn' : 'debug');
      };
      networkingEngine.registerRequestFilter?.(requestFilter);
      networkingEngine.registerResponseFilter?.(responseFilter);
      cleanupFns.push(() => {
        networkingEngine.unregisterRequestFilter?.(requestFilter);
        networkingEngine.unregisterResponseFilter?.(responseFilter);
      });
      networkingHooksRegistered = true;
      logShakaDiagnostic('shaka-network-hooks', {
        registered: true,
        hasRequestFilter: typeof networkingEngine.registerRequestFilter === 'function',
        hasResponseFilter: typeof networkingEngine.registerResponseFilter === 'function'
      }, 'debug');
    } else {
      networkingEngineReason = !thirdPartyPlayer
        ? 'missing-player'
        : !hasNetworkingGetter
        ? 'missing-networking-api'
        : 'engine-null';
    }

    if (!networkingHooksRegistered) {
      logShakaDiagnostic('shaka-network-hooks', {
        registered: false,
        reason: networkingEngineReason
      }, 'warn');
    }

    shakaNetworkingCleanupRef.current = () => {
      cleanupFns.forEach((fn) => {
        try {
          fn();
        } catch (error) {
          console.warn('[VideoPlayer] Failed to cleanup shaka diagnostics', error);
        }
      });
    };

    const appliedConfig = shakaConfiguration?.shakaPlayer?.customConfiguration || null;
    if (thirdPartyPlayer && appliedConfig) {
      try {
        thirdPartyPlayer.configure(appliedConfig);
        logShakaDiagnostic('shaka-config-applied', {
          streaming: appliedConfig.streaming,
          abr: appliedConfig.abr
        }, 'info');
      } catch (error) {
        logShakaDiagnostic('shaka-config-error', {
          error: serializePlaybackError(error)
        }, 'error');
      }
    }

    logShakaDiagnostic('shaka-ready', {
      hasPlayer: Boolean(thirdPartyPlayer),
      hasPlayMethod: typeof play === 'function',
      streamUrl: dashSource?.streamUrl || null,
      startPosition: dashSource?.startPosition ?? null,
      playbackRate: playbackRate || media.playbackRate || 1
    }, 'info');
    if (setProperties) {
      setProperties({ playbackRate: playbackRate || media.playbackRate || 1 });
    }
  }, [dashSource?.startPosition, dashSource?.streamUrl, getCurrentMediaElement, logShakaDiagnostic, media.playbackRate, playbackRate, shakaConfiguration]);

  const handleShakaPlaybackError = useCallback((error) => {
    const serializedError = serializePlaybackError(error);
    logShakaDiagnostic('shaka-playback-error', {
      error: serializedError
    }, 'error');

    if (typeof resilienceBridge?.onStartupSignal === 'function') {
      resilienceBridge.onStartupSignal({
        type: 'shaka-playback-error',
        timestamp: Date.now(),
        detail: serializedError
      });
    }

    const state = shakaRecoveryStateRef.current;
    if (!state || state.skipped) {
      return;
    }

    if (state.pendingFetch) {
      logShakaDiagnostic('shaka-recovery-skip', {
        reason: 'pending-media-refetch'
      }, 'debug');
      return;
    }

    const now = Date.now();
    if (state.cooldownUntil && now < state.cooldownUntil) {
      logShakaDiagnostic('shaka-recovery-skip', {
        reason: 'cooldown',
        retryInMs: state.cooldownUntil - now
      }, 'debug');
      return;
    }

    state.cooldownUntil = now + 2000;
    state.attempts += 1;
    const attempt = state.attempts;
    const seekSeconds = Number.isFinite(seconds) ? Number(seconds.toFixed(3)) : null;

    if (attempt === 1) {
      logShakaDiagnostic('shaka-recovery-action', {
        action: 'hard-reset',
        attempt,
        seekSeconds
      }, 'warn');
      hardReset({ seekToSeconds: seekSeconds });
      return;
    }

    if (attempt === 2 && typeof fetchVideoInfo === 'function') {
      state.pendingFetch = true;
      logShakaDiagnostic('shaka-recovery-action', {
        action: 'refetch-media-info',
        attempt
      }, 'warn');
      Promise.resolve(fetchVideoInfo({ reason: 'shaka-playback-error', attempt }))
        .catch((refetchError) => {
          logShakaDiagnostic('shaka-recovery-action', {
            action: 'refetch-media-info',
            attempt,
            status: 'rejected',
            error: serializePlaybackError(refetchError)
          }, 'error');
        })
        .finally(() => {
          state.pendingFetch = false;
          state.cooldownUntil = Date.now() + 1000;
        });
      return;
    }

    state.skipped = true;
    logShakaDiagnostic('shaka-recovery-action', {
      action: 'skip-entry',
      attempt
    }, 'error');
    advance?.(1);
  }, [advance, fetchVideoInfo, hardReset, logShakaDiagnostic, resilienceBridge, seconds]);

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  
  
  const heading = !!show && !!season && !!title
    ? `${show} - ${season}: ${title}`
    : !!show && !!season
    ? `${show} - ${season}`
    : !!show
    ? show
    : title;


  useEffect(() => {
    const mediaEl = getCurrentMediaElement();
    if (!mediaEl) return;
    mediaEl.style.objectFit = 'contain';
    mediaEl.style.maxWidth = '100%';
    mediaEl.style.maxHeight = '100%';
    mediaEl.style.width = '100%';
    mediaEl.style.height = '100%';
  }, [getCurrentMediaElement, mediaInstanceKey]);

  useEffect(() => {
    if (!isDash) return () => {};
    let disposed = false;
    let detachListeners = () => {};
    const importantEvents = [
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'canplaythrough',
      'waiting',
      'stalled',
      'error',
      'play',
      'playing',
      'pause',
      'seeking',
      'seeked',
      'ended',
      'timeupdate'
    ];

    const attachListeners = (mediaEl) => {
      if (!mediaEl) return;
      let restorePlay = null;
      if (typeof mediaEl.play === 'function') {
        const originalPlay = mediaEl.play;
        mediaEl.play = (...args) => {
          logShakaDiagnostic('dash-video-play-invoked', {
            argsLength: args.length
          }, 'debug');
          try {
            const result = originalPlay.apply(mediaEl, args);
            if (result && typeof result.then === 'function') {
              return result.then(
                (value) => {
                  logShakaDiagnostic('dash-video-play-result', { status: 'fulfilled' }, 'info');
                  return value;
                },
                (error) => {
                  logShakaDiagnostic('dash-video-play-result', {
                    status: 'rejected',
                    error: serializePlaybackError(error)
                  }, 'warn');
                  throw error;
                }
              );
            }
            logShakaDiagnostic('dash-video-play-result', { status: 'sync' }, 'info');
            return result;
          } catch (error) {
            logShakaDiagnostic('dash-video-play-result', {
              status: 'threw',
              error: serializePlaybackError(error)
            }, 'error');
            throw error;
          }
        };
        restorePlay = () => {
          mediaEl.play = originalPlay;
        };
      }
      const handler = (event) => {
        const payload = {
          eventName: event.type,
          readyState: mediaEl.readyState,
          networkState: mediaEl.networkState,
          paused: mediaEl.paused,
          ended: mediaEl.ended,
          currentTime: Number.isFinite(mediaEl.currentTime)
            ? Number(mediaEl.currentTime.toFixed(3))
            : null,
          buffered: serializeTimeRanges(mediaEl.buffered)
        };
        if (event.type === 'error') {
          payload.mediaError = serializeMediaError(mediaEl.error);
        }
        if (event.type === 'timeupdate') {
          payload.smooth = isSmoothPlaybackSample(mediaEl);
        }
        if (event.type === 'waiting' || event.type === 'stalled' || event.type === 'error' || event.type === 'seeking') {
          payload.diagnostics = buildTroubleDiagnostics(mediaEl, shakaPlayerRef.current);
        }
        logShakaDiagnostic('shaka-video-event', payload, event.type === 'error' ? 'error' : 'debug');
      };
      importantEvents.forEach((eventName) => mediaEl.addEventListener(eventName, handler));
      detachListeners = () => {
        importantEvents.forEach((eventName) => mediaEl.removeEventListener(eventName, handler));
        if (restorePlay) {
          restorePlay();
        }
      };
      logShakaDiagnostic('shaka-video-element-attached', {
        readyState: mediaEl.readyState,
        networkState: mediaEl.networkState,
        paused: mediaEl.paused
      }, 'debug');
    };

    const waitForMediaElement = () => {
      if (disposed) return;
      const mediaEl = getCurrentMediaElement();
      if (!mediaEl) {
        requestAnimationFrame(waitForMediaElement);
        return;
      }
      attachListeners(mediaEl);
    };

    waitForMediaElement();

    return () => {
      disposed = true;
      detachListeners();
    };
  }, [getCurrentMediaElement, isDash, logShakaDiagnostic, mediaInstanceKey]);

  useEffect(() => () => {
    if (typeof shakaNetworkingCleanupRef.current === 'function') {
      shakaNetworkingCleanupRef.current();
    }
  }, []);

  return (
    <div className={`video-player ${shader}`}>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {isDash ? (
        <div ref={containerRef} className="video-element-host">
          <ShakaVideoStreamer
            key={mediaInstanceKey}
            className="video-element"
            source={dashSource}
            configuration={shakaConfiguration}
            onReady={handleShakaReady}
            onPlaybackError={handleShakaPlaybackError}
          />
        </div>
      ) : (
        <video
          key={mediaInstanceKey}
          autoPlay
          ref={containerRef}
          className="video-element"
          src={media_url}
        />
      )}
    </div>
  );
}

VideoPlayer.propTypes = {
  media: PropTypes.object.isRequired,
  advance: PropTypes.func.isRequired,
  clear: PropTypes.func.isRequired,
  shader: PropTypes.string,
  volume: PropTypes.number,
  playbackRate: PropTypes.number,
  setShader: PropTypes.func,
  cycleThroughClasses: PropTypes.func,
  classes: PropTypes.arrayOf(PropTypes.string),
  playbackKeys: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.string),
    PropTypes.objectOf(PropTypes.arrayOf(PropTypes.string))
  ]),
  queuePosition: PropTypes.number,
  fetchVideoInfo: PropTypes.func,
  ignoreKeys: PropTypes.bool,
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  keyboardOverrides: PropTypes.object,
  onController: PropTypes.func,
  resilienceBridge: PropTypes.shape({
    onPlaybackMetrics: PropTypes.func,
    onRegisterMediaAccess: PropTypes.func,
    seekToIntentSeconds: PropTypes.number,
    onSeekRequestConsumed: PropTypes.func,
    onStartupSignal: PropTypes.func
  }),
  maxVideoBitrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  maxResolution: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  watchedDurationProvider: PropTypes.func
};
