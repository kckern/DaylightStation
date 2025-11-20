import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_SIGNALS = Object.freeze({
  waiting: false,
  stalled: false,
  playing: false,
  paused: false,
  ended: false,
  buffering: false
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

  const deltaThreshold = useMemo(
    () => Math.max(0.01, Math.min(0.05, epsilonSeconds / 2)),
    [epsilonSeconds]
  );

  const lastSecondsRef = useRef(Number.isFinite(seconds) ? seconds : null);

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
      return () => {};
    }

    let destroyed = false;
    const safeUpdate = (patch) => {
      if (!destroyed) {
        updateElementSignals(patch);
      }
    };

    const handleWaiting = () => safeUpdate({ waiting: true, buffering: true });
    const handlePlaying = () => {
      safeUpdate({ playing: true, waiting: false, stalled: false, buffering: false, paused: false });
      recordProgress('event', { details: 'playing' });
    };
    const handleStalled = () => safeUpdate({ stalled: true, waiting: false });
    const handlePause = () => safeUpdate({ paused: true, playing: false });
    const handleEnded = () => safeUpdate({ ended: true, playing: false, waiting: false });

    mediaEl.addEventListener('waiting', handleWaiting);
    mediaEl.addEventListener('playing', handlePlaying);
    mediaEl.addEventListener('pause', handlePause);
    mediaEl.addEventListener('stalled', handleStalled);
    mediaEl.addEventListener('ended', handleEnded);

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
      stalled: false
    });

    return () => {
      destroyed = true;
      mediaEl.removeEventListener('waiting', handleWaiting);
      mediaEl.removeEventListener('playing', handlePlaying);
      mediaEl.removeEventListener('pause', handlePause);
      mediaEl.removeEventListener('stalled', handleStalled);
      mediaEl.removeEventListener('ended', handleEnded);
    };
  }, [getMediaEl, waitKey, recordProgress, updateElementSignals]);

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
    elementSignals,
    frameInfo,
    isWaiting: Boolean(elementSignals.waiting || elementSignals.buffering),
    isStalledEvent: Boolean(elementSignals.stalled),
    isFrameAdvancing: frameInfo.supported ? frameInfo.advancing : null
  }), [elementSignals, frameInfo, progressSignal]);
}
