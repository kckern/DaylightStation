import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_POLL_INTERVAL_MS = 100;

const coerceSeconds = (value, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

const coerceBoolean = (value, fallback = false) => (
  typeof value === 'boolean' ? value : fallback
);

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
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}) {
  const seekingRef = useRef(false);
  const pendingSeekSecondsRef = useRef(null);
  const lastMetricsRef = useRef({ seconds: 0, isPaused: true, isSeeking: false });

  const readPlaybackMetrics = useCallback(() => {
    const mediaEl = mediaRef?.current;
    if (!mediaEl) {
      return {
        seconds: 0,
        isPaused: true,
        isSeeking: seekingRef.current
      };
    }
    return {
      seconds: Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0,
      isPaused: Boolean(mediaEl.paused),
      isSeeking: seekingRef.current
    };
  }, [mediaRef]);

  const reportPlaybackMetrics = useCallback((override = null) => {
    if (typeof onPlaybackMetrics !== 'function') {
      return lastMetricsRef.current;
    }
    const base = readPlaybackMetrics();
    const merged = {
      seconds: coerceSeconds(override?.seconds, base.seconds),
      isPaused: coerceBoolean(override?.isPaused, base.isPaused),
      isSeeking: coerceBoolean(override?.isSeeking, base.isSeeking)
    };
    const prev = lastMetricsRef.current;
    if (
      prev.seconds === merged.seconds
      && prev.isPaused === merged.isPaused
      && prev.isSeeking === merged.isSeeking
    ) {
      return prev;
    }
    lastMetricsRef.current = merged;
    onPlaybackMetrics(merged);
    return merged;
  }, [onPlaybackMetrics, readPlaybackMetrics]);

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

  const hardResetMedia = useCallback(({ seekToSeconds } = {}) => {
    const mediaEl = mediaRef?.current;
    if (!mediaEl) return;
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
    onRegisterMediaAccess({
      getMediaEl: () => mediaRef?.current || null,
      hardReset: hardResetMedia,
      fetchVideoInfo: null,
      remountDiagnostics
    });
    return () => { onRegisterMediaAccess({}); };
  }, [hardResetMedia, mediaRef, onRegisterMediaAccess, remountDiagnostics]);

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
      return undefined;
    }

    const handlePlay = () => {
      seekingRef.current = false;
      reportPlaybackMetrics({ isPaused: false, isSeeking: false });
    };
    const handlePause = () => {
      reportPlaybackMetrics({ isPaused: true });
    };
    const handleTimeUpdate = () => {
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

    mediaEl.addEventListener('play', handlePlay);
    mediaEl.addEventListener('pause', handlePause);
    mediaEl.addEventListener('timeupdate', handleTimeUpdate);
    mediaEl.addEventListener('seeking', handleSeeking);
    mediaEl.addEventListener('seeked', handleSeeked);

    reportPlaybackMetrics();

    return () => {
      mediaEl.removeEventListener('play', handlePlay);
      mediaEl.removeEventListener('pause', handlePause);
      mediaEl.removeEventListener('timeupdate', handleTimeUpdate);
      mediaEl.removeEventListener('seeking', handleSeeking);
      mediaEl.removeEventListener('seeked', handleSeeked);
    };
  }, [mediaIdentityKey, mediaRef, reportPlaybackMetrics]);

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
