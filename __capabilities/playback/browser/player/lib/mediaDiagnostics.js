/**
 * Media diagnostic utilities for video/audio element introspection.
 * Extracted from LoadingOverlay.jsx for reuse across Player components.
 */

export const EMPTY_MEDIA_DIAGNOSTICS = Object.freeze({
  hasElement: false,
  currentTime: null,
  readyState: null,
  networkState: null,
  paused: null,
  playbackRate: null,
  buffered: [],
  bufferAheadSeconds: null,
  bufferBehindSeconds: null,
  nextBufferStartSeconds: null,
  bufferGapSeconds: null,
  droppedFrames: null,
  totalFrames: null
});

const serializeRanges = (ranges) => {
  if (!ranges || typeof ranges.length !== 'number') {
    return [];
  }
  const out = [];
  for (let index = 0; index < ranges.length; index += 1) {
    try {
      const start = ranges.start(index);
      const end = ranges.end(index);
      out.push({
        start: Number.isFinite(start) ? Number(start.toFixed(3)) : start,
        end: Number.isFinite(end) ? Number(end.toFixed(3)) : end
      });
    } catch (_) {
      // ignore bad range
    }
  }
  return out;
};

export const computeBufferDiagnostics = (mediaEl) => {
  if (!mediaEl) {
    return {
      buffered: [],
      bufferAheadSeconds: null,
      bufferBehindSeconds: null,
      nextBufferStartSeconds: null,
      bufferGapSeconds: null
    };
  }
  const buffered = serializeRanges(mediaEl.buffered);
  const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null;
  if (!buffered.length || !Number.isFinite(currentTime)) {
    return {
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
    buffered,
    bufferAheadSeconds,
    bufferBehindSeconds,
    nextBufferStartSeconds,
    bufferGapSeconds
  };
};

export const readPlaybackQuality = (mediaEl) => {
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

export const buildMediaDiagnostics = (mediaEl) => {
  if (!mediaEl) {
    return EMPTY_MEDIA_DIAGNOSTICS;
  }
  const buffer = computeBufferDiagnostics(mediaEl);
  const quality = readPlaybackQuality(mediaEl);
  return {
    hasElement: true,
    currentTime: Number.isFinite(mediaEl.currentTime) ? Number(mediaEl.currentTime.toFixed(1)) : null,
    readyState: typeof mediaEl.readyState === 'number' ? mediaEl.readyState : null,
    networkState: typeof mediaEl.networkState === 'number' ? mediaEl.networkState : null,
    paused: typeof mediaEl.paused === 'boolean' ? mediaEl.paused : null,
    playbackRate: Number.isFinite(mediaEl.playbackRate) ? Number(mediaEl.playbackRate.toFixed(3)) : null,
    buffered: buffer.buffered,
    bufferAheadSeconds: buffer.bufferAheadSeconds,
    bufferBehindSeconds: buffer.bufferBehindSeconds,
    nextBufferStartSeconds: buffer.nextBufferStartSeconds,
    bufferGapSeconds: buffer.bufferGapSeconds,
    droppedFrames: quality.droppedFrames,
    totalFrames: quality.totalFrames
  };
};
