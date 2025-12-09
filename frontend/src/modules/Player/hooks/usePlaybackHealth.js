import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { getLogWaitKey } from '../lib/waitKeyLabel.js';

const DEFAULT_SIGNALS = Object.freeze({
  waiting: false,
  stalled: false,
  playing: false,
  paused: false,
  ended: false,
  buffering: false,
  readyState: null,
  networkState: null
});

const NO_FRAME_INFO = Object.freeze({
  supported: false,
  advancing: false,
  total: null,
  dropped: null,
  corrupted: null,
  lastSampleAt: null
});

const DEFAULT_PROGRESS_STATE = Object.freeze({
  progressToken: 0,
  lastProgressSource: null,
  lastProgressAt: null,
  lastProgressSeconds: null,
  details: null
});

const coerceMediaType = (value) => {
  if (!value) return 'unknown';
  const normalized = String(value).toLowerCase();
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('audio')) return 'audio';
  return normalized;
};

const coercePlayerFlavor = (value, mediaType) => {
  if (!value && mediaType === 'video') return 'html5-video';
  if (!value && mediaType === 'audio') return 'html5-audio';
  return value || 'generic';
};

const readFrameMetrics = (mediaEl) => {
  if (!mediaEl || typeof mediaEl !== 'object') {
    return { supported: false };
  }

  if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
    try {
      const quality = mediaEl.getVideoPlaybackQuality();
      if (quality && Number.isFinite(quality.totalVideoFrames)) {
        return {
          supported: true,
          total: Number(quality.totalVideoFrames) || 0,
          dropped: Number(quality.droppedVideoFrames) || 0,
          corrupted: Number(quality.corruptedVideoFrames) || 0
        };
      }
    } catch (_) {
      // ignore read errors
    }
  }

  const vendorDecoded = mediaEl.webkitDecodedFrameCount ?? mediaEl.mozDecodedFrames ?? mediaEl.decodedFrameCount;
  if (Number.isFinite(vendorDecoded)) {
    const vendorDropped = mediaEl.webkitDroppedFrameCount ?? mediaEl.mozDroppedFrames ?? mediaEl.droppedFrameCount;
    return {
      supported: true,
      total: Number(vendorDecoded) || 0,
      dropped: Number(vendorDropped) || 0,
      corrupted: null
    };
  }

  return { supported: false };
};

export function usePlaybackHealth({
  seconds,
  getMediaEl,
  waitKey,
  mediaType: mediaTypeHint,
  playerFlavor: playerFlavorHint,
  epsilonSeconds = 0.25
}) {
  const mediaType = coerceMediaType(mediaTypeHint);
  const playerFlavor = coercePlayerFlavor(playerFlavorHint, mediaType);

  const [elementSignals, setElementSignals] = useState(DEFAULT_SIGNALS);
  const [frameInfo, setFrameInfo] = useState(NO_FRAME_INFO);
  const [progressSignal, setProgressSignal] = useState(DEFAULT_PROGRESS_STATE);
  const [bufferRunwayMs, setBufferRunwayMs] = useState(null);

  const deltaThreshold = useMemo(
    () => Math.max(0.01, Math.min(0.05, epsilonSeconds / 2)),
    [epsilonSeconds]
  );

  const lastSecondsRef = useRef(Number.isFinite(seconds) ? seconds : null);
  const logWaitKey = useMemo(() => getLogWaitKey(waitKey), [waitKey]);
  const logContextRef = useRef({
    waitKey: logWaitKey,
    mediaType,
    playerFlavor
  });

  useEffect(() => {
    logContextRef.current = {
      waitKey: logWaitKey,
      mediaType,
      playerFlavor
    };
  }, [logWaitKey, mediaType, playerFlavor]);

  useEffect(() => {
    setElementSignals(DEFAULT_SIGNALS);
    setFrameInfo(NO_FRAME_INFO);
    setProgressSignal(DEFAULT_PROGRESS_STATE);
    setBufferRunwayMs(null);
    lastSecondsRef.current = Number.isFinite(seconds) ? seconds : null;
  }, [waitKey]);

  const logHealthEvent = useCallback((event, details = {}, options = {}) => {
    const ctx = logContextRef.current;
    const currentSeconds = Number.isFinite(lastSecondsRef.current) ? lastSecondsRef.current : null;
    const { level: detailLevel, tags: detailTags, ...restDetails } = details || {};
    const resolvedOptions = typeof options === 'object' && options !== null ? options : {};
    const resolvedLevel = resolvedOptions.level || detailLevel || 'debug';

    playbackLog('playback-health', {
      event,
      ...ctx,
      seconds: currentSeconds,
      ...restDetails
    }, {
      ...resolvedOptions,
      level: resolvedLevel,
      tags: detailTags || resolvedOptions.tags,
      context: {
        ...ctx,
        ...(resolvedOptions.context || {})
      }
    });
  }, []);

  const recordProgress = useCallback((source, payload = {}) => {
    setProgressSignal((prev) => ({
      progressToken: prev.progressToken + 1,
      lastProgressSource: source,
      lastProgressAt: Date.now(),
      lastProgressSeconds: Number.isFinite(payload.seconds)
        ? payload.seconds
        : (Number.isFinite(seconds) ? seconds : prev.lastProgressSeconds),
      details: payload.details || null
    }));
  }, [seconds]);

  const updateElementSignals = useCallback((patch) => {
    setElementSignals((prev) => ({
      ...prev,
      ...patch
    }));
  }, []);

  useEffect(() => {
    if (!Number.isFinite(seconds)) {
      return;
    }
    if (!Number.isFinite(lastSecondsRef.current)) {
      lastSecondsRef.current = seconds;
      return;
    }
    if (Math.abs(seconds - lastSecondsRef.current) >= deltaThreshold) {
      lastSecondsRef.current = seconds;
      recordProgress('clock', { seconds });
    }
  }, [seconds, deltaThreshold, recordProgress]);

  useEffect(() => {
    const mediaEl = typeof getMediaEl === 'function' ? getMediaEl() : null;
    if (!mediaEl) {
      setElementSignals(DEFAULT_SIGNALS);
      setBufferRunwayMs(null);
      return () => {};
    }

    let destroyed = false;
    const safeUpdate = (patch) => {
      if (!destroyed) {
        updateElementSignals(patch);
      }
    };

    const sampleCurrentTime = () => {
      if (!mediaEl || !Number.isFinite(mediaEl.currentTime)) {
        return null;
      }
      return Number(mediaEl.currentTime);
    };

    const safeSetBufferRunway = (value) => {
      if (!destroyed) {
        setBufferRunwayMs(value);
      }
    };

    const readReadyNetworkState = () => ({
      readyState: typeof mediaEl?.readyState === 'number' ? mediaEl.readyState : null,
      networkState: typeof mediaEl?.networkState === 'number' ? mediaEl.networkState : null
    });

    const readBufferRunwayMs = () => {
      if (!mediaEl || !mediaEl.buffered) return null;
      const current = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null;
      if (!Number.isFinite(current)) return null;
      try {
        const ranges = mediaEl.buffered;
        const count = Number(ranges?.length) || 0;
        if (count === 0) return 0;
        for (let i = 0; i < count; i += 1) {
          const start = ranges.start(i);
          const end = ranges.end(i);
          if (Number.isFinite(start) && Number.isFinite(end) && current >= start && current <= end) {
            return Math.max(0, (end - current) * 1000);
          }
        }
        const lastEnd = Number.isFinite(ranges.end(count - 1)) ? ranges.end(count - 1) : null;
        if (Number.isFinite(lastEnd) && lastEnd > current) {
          return Math.max(0, (lastEnd - current) * 1000);
        }
      } catch (_) {
        return null;
      }
      return 0;
    };

    const updateBufferRunway = () => {
      safeSetBufferRunway(readBufferRunwayMs());
      safeUpdate(readReadyNetworkState());
    };

    const handleWaiting = () => safeUpdate({ waiting: true, buffering: true });
    const handlePlaying = () => {
      const sampledSeconds = sampleCurrentTime();
      safeUpdate({ playing: true, waiting: false, stalled: false, buffering: false, paused: false });
      recordProgress('event', { details: 'playing', seconds: sampledSeconds });
      logHealthEvent('media-playing', { currentTime: sampledSeconds }, { level: 'debug' });
      updateBufferRunway();
    };
    const handleStalled = () => safeUpdate({ stalled: true, waiting: false });
    const handlePause = () => safeUpdate({ paused: true, playing: false });
    const handleEnded = () => safeUpdate({ ended: true, playing: false, waiting: false });

    const handleStalledWithLog = () => {
      handleStalled();
      logHealthEvent('media-stalled', { currentTime: sampleCurrentTime() }, { level: 'warn' });
    };

    const bufferEvents = ['timeupdate', 'progress', 'waiting', 'playing'];

    mediaEl.addEventListener('waiting', handleWaiting);
    mediaEl.addEventListener('playing', handlePlaying);
    mediaEl.addEventListener('pause', handlePause);
    mediaEl.addEventListener('stalled', handleStalledWithLog);
    mediaEl.addEventListener('ended', handleEnded);
    bufferEvents.forEach((eventName) => mediaEl.addEventListener(eventName, updateBufferRunway));

    const haveFutureData = typeof HTMLMediaElement !== 'undefined'
      ? HTMLMediaElement.HAVE_FUTURE_DATA
      : 3;
    const initialWaiting = typeof mediaEl.readyState === 'number'
      ? mediaEl.readyState < haveFutureData
      : false;

    safeUpdate({
      paused: mediaEl.paused,
      playing: !mediaEl.paused && !mediaEl.ended,
      waiting: initialWaiting,
      stalled: false,
      ...readReadyNetworkState()
    });
    updateBufferRunway();

    return () => {
      destroyed = true;
      mediaEl.removeEventListener('waiting', handleWaiting);
      mediaEl.removeEventListener('playing', handlePlaying);
      mediaEl.removeEventListener('pause', handlePause);
      mediaEl.removeEventListener('stalled', handleStalledWithLog);
      mediaEl.removeEventListener('ended', handleEnded);
      bufferEvents.forEach((eventName) => mediaEl.removeEventListener(eventName, updateBufferRunway));
    };
  }, [getMediaEl, waitKey, recordProgress, updateElementSignals, logHealthEvent]);

  useEffect(() => {
    if (mediaType !== 'video') {
      setFrameInfo(NO_FRAME_INFO);
      return () => {};
    }

    const mediaEl = typeof getMediaEl === 'function' ? getMediaEl() : null;
    if (!mediaEl) {
      setFrameInfo(NO_FRAME_INFO);
      return () => {};
    }

    let lastTotal = null;
    let intervalId = null;
    const sampleInterval = playerFlavor === 'shaka' ? 350 : 500;

    const pollFrames = () => {
      const metrics = readFrameMetrics(mediaEl);
      if (!metrics.supported) {
        setFrameInfo(NO_FRAME_INFO);
        return;
      }
      const progressed = Number.isFinite(lastTotal) && Number(metrics.total) > lastTotal;
      setFrameInfo({
        supported: true,
        advancing: progressed,
        total: metrics.total,
        dropped: metrics.dropped,
        corrupted: metrics.corrupted,
        lastSampleAt: Date.now()
      });
      if (progressed) {
        recordProgress('frame', { details: metrics });
      }
      if (Number.isFinite(metrics.total)) {
        lastTotal = metrics.total;
      }
    };

    pollFrames();
    intervalId = setInterval(pollFrames, sampleInterval);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [getMediaEl, mediaType, playerFlavor, waitKey, recordProgress]);

  return useMemo(() => ({
    progressToken: progressSignal.progressToken,
    lastProgressSource: progressSignal.lastProgressSource,
    lastProgressAt: progressSignal.lastProgressAt,
    lastProgressSeconds: progressSignal.lastProgressSeconds,
    progressDetails: progressSignal.details,
    elementSignals,
    frameInfo,
    bufferRunwayMs,
    isWaiting: Boolean(elementSignals.waiting || elementSignals.buffering),
    isStalledEvent: Boolean(elementSignals.stalled),
    isFrameAdvancing: frameInfo.supported ? frameInfo.advancing : null
  }), [elementSignals, frameInfo, progressSignal, bufferRunwayMs]);
}
