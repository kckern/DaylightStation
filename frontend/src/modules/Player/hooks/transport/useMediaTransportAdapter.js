import { useCallback, useEffect, useMemo, useRef } from 'react';
import { playbackLog } from '../../lib/playbackLogger.js';

const serializeTimeRanges = (ranges) => {
  if (!ranges || typeof ranges.length !== 'number') return [];
  const entries = [];
  for (let i = 0; i < ranges.length; i += 1) {
    try {
      const start = ranges.start(i);
      const end = ranges.end(i);
      entries.push({
        start: Number.isFinite(start) ? Number(start.toFixed(3)) : start,
        end: Number.isFinite(end) ? Number(end.toFixed(3)) : end
      });
    } catch (_) {
      // ignore
    }
  }
  return entries;
};

const readPlaybackQuality = (mediaEl) => {
  if (!mediaEl) return { droppedFrames: null, totalFrames: null };
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
  return { droppedFrames: dropped, totalFrames: decoded };
};

const fallbackDiagnosticsFromMediaEl = (mediaEl) => {
  if (!mediaEl) return null;
  const buffered = serializeTimeRanges(mediaEl.buffered);
  const currentTime = Number.isFinite(mediaEl.currentTime) ? Number(mediaEl.currentTime.toFixed(3)) : null;
  const readyState = typeof mediaEl.readyState === 'number' ? mediaEl.readyState : null;
  const networkState = typeof mediaEl.networkState === 'number' ? mediaEl.networkState : null;
  const playbackRate = Number.isFinite(mediaEl.playbackRate) ? Number(mediaEl.playbackRate.toFixed(3)) : null;
  const paused = typeof mediaEl.paused === 'boolean' ? mediaEl.paused : null;
  const quality = readPlaybackQuality(mediaEl);

  let bufferAheadSeconds = null;
  let bufferBehindSeconds = null;
  let nextBufferStartSeconds = null;
  if (currentTime != null && buffered.length) {
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
  }

  const bufferGapSeconds = Number.isFinite(nextBufferStartSeconds)
    ? Number((nextBufferStartSeconds - currentTime).toFixed(3))
    : null;

  return {
    currentTime,
    readyState,
    networkState,
    playbackRate,
    paused,
    buffered,
    bufferAheadSeconds,
    bufferBehindSeconds,
    nextBufferStartSeconds,
    bufferGapSeconds,
    quality
  };
};

const toNumber = (value) => {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalize diagnostics from VideoPlayer's buildTroubleDiagnostics
 * Handles both flat structure (from VideoPlayer) and nested structure (legacy)
 */
const normalizeDiagnostics = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  
  // Support both flat (VideoPlayer) and nested (legacy) buffer data
  const bufferAhead = toNumber(raw.bufferAheadSeconds ?? raw.buffer?.bufferAheadSeconds);
  const bufferGap = toNumber(raw.bufferGapSeconds ?? raw.buffer?.bufferGapSeconds);
  const nextBufferStart = toNumber(raw.nextBufferStartSeconds ?? raw.buffer?.nextBufferStartSeconds);
  const bufferBehind = toNumber(raw.bufferBehindSeconds ?? raw.buffer?.bufferBehindSeconds);
  
  // Support both flat quality object (VideoPlayer) and nested decoder (legacy)
  const quality = raw.quality || {};
  const decoder = raw.decoder || {};
  const droppedFrames = toNumber(quality.droppedFrames ?? decoder.droppedFrames);
  const totalFrames = toNumber(quality.totalFrames ?? decoder.totalFrames);
  
  // Preserve Shaka player stats if available
  const shaka = raw.shaka || null;
  
  return {
    buffer: {
      bufferAheadSeconds: bufferAhead,
      bufferBehindSeconds: bufferBehind,
      bufferGapSeconds: bufferGap,
      nextBufferStartSeconds: nextBufferStart,
      buffered: Array.isArray(raw.buffered) ? raw.buffered : null
    },
    decoder: {
      droppedFrames,
      totalFrames
    },
    readyState: raw.readyState ?? raw.ready_state ?? null,
    networkState: raw.networkState ?? raw.network_state ?? null,
    playbackRate: toNumber(raw.playbackRate),
    paused: typeof raw.paused === 'boolean' ? raw.paused : null,
    currentTime: toNumber(raw.currentTime),
    // Include full Shaka player stats for detailed diagnostics
    shaka: shaka ? {
      width: toNumber(shaka.width),
      height: toNumber(shaka.height),
      streamBandwidth: toNumber(shaka.streamBandwidth),
      estimatedBandwidth: toNumber(shaka.estimatedBandwidth),
      decodedFrames: toNumber(shaka.decodedFrames),
      droppedFrames: toNumber(shaka.droppedFrames),
      bufferLength: toNumber(shaka.bufferLength),
      stateHistoryLength: toNumber(shaka.stateHistoryLength)
    } : null
  };
};

const guard = (label, fn) => (...args) => {
  try {
    return fn(...args);
  } catch (error) {
    playbackLog('transport-guard-error', { action: label, message: error?.message || 'transport-error' }, { level: 'warn' });
    return null;
  }
};

export function useMediaTransportAdapter({ controllerRef, mediaAccess, resilienceBridge }) {
  const warnedMissingMediaRef = useRef(false);

  const getMediaEl = useCallback(() => {
    // Prefer resilience bridge (canonical path)
    if (typeof resilienceBridge?.getMediaEl === 'function') {
      const el = resilienceBridge.getMediaEl();
      if (el) return el;
    }
    // Fallback to legacy mediaAccess
    const accessEl = typeof mediaAccess?.getMediaEl === 'function' ? mediaAccess.getMediaEl() : null;
    if (accessEl) return accessEl;
    // Final fallback to controllerRef transport
    const transportEl = controllerRef?.current?.transport?.getMediaEl;
    if (typeof transportEl === 'function') {
      try {
        return transportEl();
      } catch (error) {
        playbackLog('transport-getMediaEl-error', { message: error?.message || 'transport-error' }, { level: 'warn' });
        return null;
      }
    }
    return null;
  }, [controllerRef, mediaAccess, resilienceBridge]);

  const getContainerEl = useCallback(() => {
    if (typeof resilienceBridge?.getContainerEl === 'function') {
      return resilienceBridge.getContainerEl();
    }
    return null;
  }, [resilienceBridge]);

  useEffect(() => {
    if (warnedMissingMediaRef.current) return;
    const hasMediaEl =
      typeof resilienceBridge?.getMediaEl === 'function' ||
      typeof mediaAccess?.getMediaEl === 'function' ||
      typeof controllerRef?.current?.transport?.getMediaEl === 'function';
    if (!hasMediaEl) {
      warnedMissingMediaRef.current = true;
      playbackLog('transport-capability-missing', { capability: 'getMediaEl' }, { level: 'warn' });
    }
  }, [controllerRef, mediaAccess, resilienceBridge]);

  const play = useMemo(() => guard('play', () => controllerRef?.current?.transport?.play?.()), [controllerRef]);
  const pause = useMemo(() => guard('pause', () => controllerRef?.current?.transport?.pause?.()), [controllerRef]);
  const seek = useMemo(() => guard('seek', (seconds) => controllerRef?.current?.transport?.seek?.(seconds)), [controllerRef]);
  const nudge = useMemo(() => guard('nudge', (...args) => mediaAccess?.nudgePlayback?.(...args)), [mediaAccess]);

  const readDiagnostics = useCallback(() => {
    try {
      const raw = typeof mediaAccess?.getTroubleDiagnostics === 'function'
        ? mediaAccess.getTroubleDiagnostics()
        : null;
      if (raw) {
        return normalizeDiagnostics(raw);
      }

      // Fallback: derive minimal diagnostics directly from the media element
      const mediaEl = getMediaEl();
      if (!mediaEl) return null;
      const fallback = fallbackDiagnosticsFromMediaEl(mediaEl);
      return normalizeDiagnostics(fallback);
    } catch (error) {
      playbackLog('transport-diagnostics-error', { message: error?.message || 'diagnostics-error' }, { level: 'warn' });
      return null;
    }
  }, [getMediaEl, mediaAccess]);

  return {
    getMediaEl,
    getContainerEl,
    play,
    pause,
    seek,
    nudge,
    readDiagnostics
  };
}

export default useMediaTransportAdapter;
