import { useCallback, useEffect, useRef } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';

const DEFAULT_POLL_INTERVAL_MS = 100;

const coerceSeconds = (value, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

const coerceBoolean = (value, fallback = false) => (
  typeof value === 'boolean' ? value : fallback
);

const normalizePauseIntent = (value, fallback = null) => {
  if (value === null) return null;
  if (value === 'user' || value === 'system') return value;
  return fallback ?? null;
};

const clampNumber = (value, precision = 3) => (
  Number.isFinite(value) ? Number(value.toFixed(precision)) : null
);

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
        start: clampNumber(start),
        end: clampNumber(end)
      });
    } catch (_) {
      break;
    }
  }
  return entries;
};

const computeBufferMetrics = (mediaEl) => {
  if (!mediaEl || !mediaEl.buffered) {
    return null;
  }
  const currentTime = clampNumber(mediaEl.currentTime, 3);
  if (currentTime == null) {
    return null;
  }
  const buffered = serializeTimeRanges(mediaEl.buffered);
  if (!buffered.length) {
    return { currentTime, buffered };
  }
  let bufferAheadSeconds = null;
  let bufferBehindSeconds = null;
  let nextBufferStartSeconds = null;
  for (let index = 0; index < buffered.length; index += 1) {
    const { start, end } = buffered[index];
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    if (currentTime >= start && currentTime <= end) {
      bufferAheadSeconds = clampNumber(end - currentTime, 3);
      bufferBehindSeconds = clampNumber(currentTime - start, 3);
    } else if (currentTime < start && nextBufferStartSeconds == null) {
      nextBufferStartSeconds = start;
      break;
    }
  }
  const bufferGapSeconds = Number.isFinite(nextBufferStartSeconds)
    ? clampNumber(nextBufferStartSeconds - currentTime, 3)
    : null;
  return {
    currentTime,
    bufferAheadSeconds,
    bufferBehindSeconds,
    nextBufferStartSeconds,
    bufferGapSeconds,
    buffered
  };
};

const readDecoderMetrics = (mediaEl) => {
  if (!mediaEl) {
    return null;
  }
  if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
    try {
      const quality = mediaEl.getVideoPlaybackQuality();
      if (quality && Number.isFinite(quality.totalVideoFrames)) {
        return {
          totalFrames: Number(quality.totalVideoFrames) || 0,
          droppedFrames: Number(quality.droppedVideoFrames) || 0
        };
      }
    } catch (_) {
      // ignore quality read errors
    }
  }
  const decoded = mediaEl.webkitDecodedFrameCount ?? mediaEl.mozDecodedFrames ?? mediaEl.decodedFrameCount;
  if (Number.isFinite(decoded)) {
    const dropped = mediaEl.webkitDroppedFrameCount ?? mediaEl.mozDroppedFrames ?? mediaEl.droppedFrameCount;
    return {
      totalFrames: Number(decoded) || 0,
      droppedFrames: Number(dropped) || 0
    };
  }
  return null;
};

const buildDiagnosticsSnapshot = (mediaEl) => {
  if (!mediaEl) {
    return null;
  }
  const buffer = computeBufferMetrics(mediaEl);
  const decoder = readDecoderMetrics(mediaEl);
  const readyState = typeof mediaEl.readyState === 'number' ? mediaEl.readyState : null;
  const networkState = typeof mediaEl.networkState === 'number' ? mediaEl.networkState : null;
  return {
    buffer,
    decoder,
    readyState,
    networkState,
    collectedAt: Date.now()
  };
};

const hashDiagnostics = (diagnostics) => {
  if (!diagnostics) {
    return 'diagnostics:none';
  }
  const buffer = diagnostics.buffer || {};
  const decoder = diagnostics.decoder || {};
  return [
    clampNumber(buffer?.bufferAheadSeconds) ?? -1,
    clampNumber(buffer?.bufferGapSeconds) ?? -1,
    clampNumber(buffer?.nextBufferStartSeconds) ?? -1,
    Number(decoder?.droppedFrames ?? -1),
    Number(decoder?.totalFrames ?? -1),
    Number(diagnostics.readyState ?? -1),
    Number(diagnostics.networkState ?? -1)
  ].join('|');
};

/**
 * useMediaReporter centralizes how bespoke media renderers (e.g. ContentScroller)
 * report playback state up to the Player resilience bridge. Components hand it a
 * ref to their primary HTMLMediaElement plus the callbacks they already receive
 * (`onPlaybackMetrics`, `onRegisterMediaAccess`, seek intent props, etc.).
 */
export function useMediaReporter({
  mediaRef,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  seekToIntentSeconds = null,
  onSeekRequestConsumed,
  remountDiagnostics,
  mediaIdentityKey = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onStartupSignal = null,
  mediaAccessExtras = null
}) {
  const seekingRef = useRef(false);
  const isHardResettingRef = useRef(false);
  const pendingSeekSecondsRef = useRef(null);
  const lastMetricsRef = useRef({
    seconds: 0,
    isPaused: true,
    isSeeking: false,
    pauseIntent: null,
    diagnostics: null,
    diagnosticsHash: 'diagnostics:none',
    diagnosticsVersion: 0
  });
  const lastDiagnosticsHashRef = useRef('diagnostics:none');
  const startupAttachmentRef = useRef(false);

  const emitStartupSignal = useCallback((type, detail = {}) => {
    if (typeof onStartupSignal !== 'function') {
      return;
    }
    try {
      onStartupSignal({
        type,
        timestamp: Date.now(),
        ...detail
      });
    } catch (error) {
      playbackLog('reporter.startup-signal-error', {
        type,
        error: error?.message || String(error)
      }, { level: 'warn' });
    }
  }, [onStartupSignal]);

  const readPlaybackMetrics = useCallback(() => {
    const mediaEl = mediaRef?.current;
    if (!mediaEl) {
      return {
        seconds: 0,
        isPaused: true,
        isSeeking: seekingRef.current,
        pauseIntent: lastMetricsRef.current.pauseIntent ?? null,
        diagnostics: null
      };
    }
    return {
      seconds: Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0,
      isPaused: Boolean(mediaEl.paused),
      isSeeking: seekingRef.current,
      pauseIntent: lastMetricsRef.current.pauseIntent ?? null,
      diagnostics: buildDiagnosticsSnapshot(mediaEl)
    };
  }, [mediaRef]);

  const reportPlaybackMetrics = useCallback((override = null) => {
    if (typeof onPlaybackMetrics !== 'function') {
      return lastMetricsRef.current;
    }
    const base = readPlaybackMetrics();
    const hasPauseIntentOverride = Boolean(override && Object.prototype.hasOwnProperty.call(override, 'pauseIntent'));
    const resolvedBaseIntent = normalizePauseIntent(base.pauseIntent, lastMetricsRef.current.pauseIntent);
    const diagnosticsOverrideProvided = Boolean(override && Object.prototype.hasOwnProperty.call(override, 'diagnostics'));
    let diagnostics = diagnosticsOverrideProvided ? override.diagnostics : base.diagnostics;
    let diagnosticsHash = hashDiagnostics(diagnostics);
    if (!diagnosticsOverrideProvided) {
      if (diagnosticsHash === lastDiagnosticsHashRef.current) {
        diagnostics = lastMetricsRef.current.diagnostics;
      } else {
        lastDiagnosticsHashRef.current = diagnosticsHash;
      }
    } else {
      lastDiagnosticsHashRef.current = diagnosticsHash;
    }
    const prev = lastMetricsRef.current;
    const diagnosticsVersion = diagnosticsHash === prev.diagnosticsHash
      ? prev.diagnosticsVersion
      : prev.diagnosticsVersion + 1;
    const merged = {
      seconds: coerceSeconds(override?.seconds, base.seconds),
      isPaused: coerceBoolean(override?.isPaused, base.isPaused),
      isSeeking: coerceBoolean(override?.isSeeking, base.isSeeking),
      pauseIntent: hasPauseIntentOverride
        ? normalizePauseIntent(override.pauseIntent, resolvedBaseIntent)
        : resolvedBaseIntent,
      diagnostics,
      diagnosticsHash,
      diagnosticsVersion
    };
    if (
      prev.seconds === merged.seconds
      && prev.isPaused === merged.isPaused
      && prev.isSeeking === merged.isSeeking
      && prev.pauseIntent === merged.pauseIntent
      && prev.diagnosticsHash === merged.diagnosticsHash
      && prev.diagnosticsVersion === merged.diagnosticsVersion
    ) {
      return prev;
    }
    lastMetricsRef.current = merged;
    onPlaybackMetrics(merged);
    emitStartupSignal('progress-tick', {
      seconds: merged.seconds,
      isPaused: merged.isPaused,
      isSeeking: merged.isSeeking
    });
    return merged;
  }, [onPlaybackMetrics, readPlaybackMetrics, emitStartupSignal]);

  const applyPendingSeek = useCallback(() => {
    const target = pendingSeekSecondsRef.current;
    if (!Number.isFinite(target)) {
      return true;
    }
    const mediaEl = mediaRef?.current;
    if (!mediaEl) {
      return false;
    }
    const normalized = Math.max(0, target);
    try {
      mediaEl.currentTime = normalized;
      pendingSeekSecondsRef.current = null;
      onSeekRequestConsumed?.();
      reportPlaybackMetrics();
      return true;
    } catch (_) {
      return false;
    }
  }, [mediaRef, onSeekRequestConsumed, reportPlaybackMetrics]);

  const logExplicitPlaybackToggle = useCallback((action) => {
    const mediaEl = mediaRef?.current;
    const seconds = mediaEl && Number.isFinite(mediaEl.currentTime)
      ? mediaEl.currentTime
      : null;
    playbackLog('media-reporter', {
      event: action === 'play' ? 'explicit-play' : 'explicit-pause',
      mediaIdentityKey,
      seconds
    }, { level: 'debug' });
  }, [mediaRef, mediaIdentityKey]);

  const hardResetMedia = useCallback(({ seekToSeconds } = {}) => {
    const mediaEl = mediaRef?.current;
    if (!mediaEl) return;
    isHardResettingRef.current = true;
    setTimeout(() => { isHardResettingRef.current = false; }, 1000);
    const normalized = Number.isFinite(seekToSeconds) ? Math.max(0, seekToSeconds) : 0;
    pendingSeekSecondsRef.current = normalized;
    try {
      mediaEl.pause?.();
    } catch (_) {}
    try {
      mediaEl.currentTime = normalized;
    } catch (_) {}
    mediaEl.load?.();
    reportPlaybackMetrics();
  }, [mediaRef, reportPlaybackMetrics]);

  const clearPendingSeek = useCallback(() => {
    if (pendingSeekSecondsRef.current == null) return;
    pendingSeekSecondsRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof onRegisterMediaAccess !== 'function') {
      return undefined;
    }
    const baseAccess = {
      getMediaEl: () => mediaRef?.current || null,
      hardReset: hardResetMedia,
      fetchVideoInfo: null,
      remountDiagnostics
    };
    const payload = mediaAccessExtras
      ? { ...mediaAccessExtras, ...baseAccess }
      : baseAccess;
    onRegisterMediaAccess(payload);
    return () => { onRegisterMediaAccess({}); };
  }, [hardResetMedia, mediaAccessExtras, mediaRef, onRegisterMediaAccess, remountDiagnostics]);

  useEffect(() => {
    if (!Number.isFinite(seekToIntentSeconds)) {
      if (seekToIntentSeconds == null) {
        pendingSeekSecondsRef.current = null;
      }
      return;
    }
    pendingSeekSecondsRef.current = Math.max(0, seekToIntentSeconds);
    applyPendingSeek();
  }, [seekToIntentSeconds, applyPendingSeek]);

  useEffect(() => {
    if (mediaIdentityKey == null) {
      return;
    }
    if (pendingSeekSecondsRef.current != null) {
      applyPendingSeek();
    } else {
      reportPlaybackMetrics();
    }
  }, [mediaIdentityKey, applyPendingSeek, reportPlaybackMetrics]);

  useEffect(() => {
    const mediaEl = mediaRef?.current;
    if (!mediaEl) {
      if (startupAttachmentRef.current) {
        startupAttachmentRef.current = false;
        emitStartupSignal('media-el-detached', { reason: 'media-missing' });
      }
      return undefined;
    }

    if (!startupAttachmentRef.current) {
      startupAttachmentRef.current = true;
      emitStartupSignal('media-el-attached', {
        tagName: typeof mediaEl.tagName === 'string' ? mediaEl.tagName.toLowerCase() : null,
        readyState: mediaEl.readyState,
        networkState: mediaEl.networkState
      });
    }

    const handlePlay = (event) => {
      seekingRef.current = false;
      logExplicitPlaybackToggle('play');
      reportPlaybackMetrics({ isPaused: false, isSeeking: false, pauseIntent: null });
    };
    const classifyPauseIntent = () => {
      // Default: treat as user unless we detect system/automatic causes.
      const ended = Boolean(mediaEl?.ended);
      const duration = Number.isFinite(mediaEl?.duration) ? mediaEl.duration : null;
      const current = Number.isFinite(mediaEl?.currentTime) ? mediaEl.currentTime : null;
      const nearNaturalEnd = Number.isFinite(duration) && Number.isFinite(current)
        ? (duration - current) <= 1.5
        : false;
      // Browser/network driven pauses count as system
      const networkStarved = mediaEl?.networkState === 2 && mediaEl?.readyState < 3;
      if (ended || nearNaturalEnd || networkStarved || isHardResettingRef.current) {
        return 'system';
      }
      return 'user';
    };

    const handlePause = (event) => {
      logExplicitPlaybackToggle('pause');
      const intent = (event?.isTrusted === false) ? 'system' : classifyPauseIntent();
      reportPlaybackMetrics({ isPaused: true, pauseIntent: intent });
    };
    const handleTimeUpdate = () => {
      reportPlaybackMetrics();
    };
    const handleStallSignal = () => {
      reportPlaybackMetrics();
    };
    const handleSeeking = () => {
      seekingRef.current = true;
      reportPlaybackMetrics({ isSeeking: true });
    };
    const handleSeeked = () => {
      seekingRef.current = false;
      reportPlaybackMetrics({ isSeeking: false });
    };
    const handleLoadedMetadata = () => {
      emitStartupSignal('loadedmetadata', {
        currentTime: Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null,
        duration: Number.isFinite(mediaEl.duration) ? mediaEl.duration : null,
        readyState: mediaEl.readyState
      });
    };
    const handlePlaying = () => {
      emitStartupSignal('playing', {
        currentTime: Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null,
        readyState: mediaEl.readyState
      });
    };
    const handleEnded = () => {
      logExplicitPlaybackToggle('pause');
      reportPlaybackMetrics({ isPaused: true, pauseIntent: 'system' });
    };

    mediaEl.addEventListener('play', handlePlay);
    mediaEl.addEventListener('pause', handlePause);
    mediaEl.addEventListener('timeupdate', handleTimeUpdate);
    mediaEl.addEventListener('waiting', handleStallSignal);
    mediaEl.addEventListener('stalled', handleStallSignal);
    mediaEl.addEventListener('seeking', handleSeeking);
    mediaEl.addEventListener('seeked', handleSeeked);
    mediaEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    mediaEl.addEventListener('playing', handlePlaying);
    mediaEl.addEventListener('ended', handleEnded);

    reportPlaybackMetrics();

    return () => {
      mediaEl.removeEventListener('play', handlePlay);
      mediaEl.removeEventListener('pause', handlePause);
      mediaEl.removeEventListener('timeupdate', handleTimeUpdate);
      mediaEl.removeEventListener('waiting', handleStallSignal);
      mediaEl.removeEventListener('stalled', handleStallSignal);
      mediaEl.removeEventListener('seeking', handleSeeking);
      mediaEl.removeEventListener('seeked', handleSeeked);
      mediaEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      mediaEl.removeEventListener('playing', handlePlaying);
      mediaEl.removeEventListener('ended', handleEnded);
      if (startupAttachmentRef.current) {
        startupAttachmentRef.current = false;
        emitStartupSignal('media-el-detached', {
          tagName: typeof mediaEl.tagName === 'string' ? mediaEl.tagName.toLowerCase() : null,
          reason: 'cleanup'
        });
      }
    };
  }, [mediaIdentityKey, mediaRef, reportPlaybackMetrics, emitStartupSignal]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) {
      return undefined;
    }
    const intervalId = setInterval(() => {
      const mediaEl = mediaRef?.current;
      if (!mediaEl || mediaEl.paused || mediaEl.ended) {
        return;
      }
      reportPlaybackMetrics();
    }, pollIntervalMs);
    return () => clearInterval(intervalId);
  }, [mediaRef, pollIntervalMs, reportPlaybackMetrics]);

  return {
    reportPlaybackMetrics,
    applyPendingSeek,
    hardResetMedia,
    clearPendingSeek
  };
}
