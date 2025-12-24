import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useCallback } from 'react';
import { useMediaDevices } from './useMediaDevices.js';
import { useWebcamStream } from './useWebcamStream.js';
import { useWebcamSnapshots } from './useWebcamSnapshots.js';
import { DEFAULT_FILTER_ID, getWebcamFilter, resolveFilterId } from './webcamFilters.js';

const noop = () => {};

const defaultSnapshotMeta = {
  takenAt: null,
  deviceId: null,
  resolution: null,
  filterId: 'none',
  context: 'webcam',
};

const FitnessWebcam = forwardRef(function FitnessWebcam(props, ref) {
  const {
    enabled = true,
    videoConstraints,
    audioConstraints,
    filterId = DEFAULT_FILTER_ID,
    filterParams,
    captureIntervalMs = 0,
    onSnapshot = noop,
    onStreamReady = noop,
    onError = noop,
    renderOverlay,
    showControls = false,
    className,
    style,
    videoClassName,
    videoStyle,
    snapshotContext = 'webcam',
    enableHotkeys = true,
  } = props;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [lastSnapshotMeta, setLastSnapshotMeta] = useState(null);
  const [activeFilterId, setActiveFilterId] = useState(resolveFilterId(filterId));

  const {
    devices,
    activeVideoId,
    activeAudioId,
    setActiveVideoId,
    setActiveAudioId,
    nextVideo,
    nextAudio,
    permissionError,
  } = useMediaDevices(enabled);

  const resolvedVideoConstraints = useMemo(() => {
    if (videoConstraints === false) return false;
    const base = typeof videoConstraints === 'object' && videoConstraints !== null
      ? { ...videoConstraints }
      : { facingMode: 'user' };
    if (activeVideoId) {
      base.deviceId = { exact: activeVideoId };
    }
    return base;
  }, [videoConstraints, activeVideoId]);

  const resolvedAudioConstraints = useMemo(() => {
    if (audioConstraints === false) return false;
    const base = typeof audioConstraints === 'object' && audioConstraints !== null
      ? { ...audioConstraints }
      : false;
    if (base && activeAudioId) {
      base.deviceId = { exact: activeAudioId };
    }
    return base;
  }, [audioConstraints, activeAudioId]);

  const { status, stream, error, start, stop } = useWebcamStream({
    enabled,
    videoConstraints: resolvedVideoConstraints,
    audioConstraints: resolvedAudioConstraints,
    onStream: onStreamReady,
    onError,
  });

  useEffect(() => {
    if (videoRef.current && stream instanceof MediaStream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (!error) return;
    onError(error);
  }, [error, onError]);

  const makeSnapshot = useCallback(async () => {
    const videoEl = videoRef.current;
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
      throw new Error('snapshot-unavailable');
    }
    const width = videoEl.videoWidth;
    const height = videoEl.videoHeight;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas-context-unavailable');
    }
    const filter = getWebcamFilter(activeFilterId);
    filter.apply(ctx, videoEl, width, height, filterParams);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('snapshot-blob-failed'));
      }, 'image/jpeg', 0.92);
    });
    const meta = {
      ...defaultSnapshotMeta,
      takenAt: Date.now(),
      deviceId: activeVideoId || null,
      resolution: { width, height },
      filterId: activeFilterId || 'none',
      context: snapshotContext,
    };
    setLastSnapshotMeta(meta);
    return { meta, blob };
  }, [activeFilterId, filterParams, activeVideoId, snapshotContext]);

  useWebcamSnapshots({
    enabled: enabled && Boolean(captureIntervalMs),
    intervalMs: captureIntervalMs,
    videoElement: videoRef.current,
    canvasElement: canvasRef.current,
    makeSnapshot,
    onSnapshot,
    onError,
  });

  useImperativeHandle(ref, () => ({
    start,
    stop,
    switchCamera: nextVideo,
    switchMic: nextAudio,
    setCamera: setActiveVideoId,
    setMic: setActiveAudioId,
    takeSnapshot: makeSnapshot,
    getStream: () => stream,
    applyFilter: (next) => {
      if (!next) return;
      if (typeof next === 'string') {
        setActiveFilterId(next);
        return;
      }
      if (next.id) {
        setActiveFilterId(next.id);
      }
    },
  }), [start, stop, nextVideo, nextAudio, setActiveVideoId, setActiveAudioId, makeSnapshot, stream]);

  const wrapperClass = `fitness-webcam${className ? ` ${className}` : ''}`;

  const activeFilter = getWebcamFilter(activeFilterId);
  const mergedVideoStyle = useMemo(() => {
    const base = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      position: 'absolute',
      top: 0,
      left: 0,
      filter: activeFilter.css || 'none',
      ...(videoStyle || {})
    };
    if (!base.transform && activeFilter.transform) {
      base.transform = activeFilter.transform;
    }
    return base;
  }, [activeFilter, videoStyle]);

  return (
    <div className={wrapperClass} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', ...style }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={audioConstraints === false}
        className={`fitness-webcam-video${videoClassName ? ` ${videoClassName}` : ''}`}
        style={mergedVideoStyle}
      />
      {renderOverlay ? renderOverlay({ status, error, permissionError, devices, activeVideoId, activeAudioId, nextVideo, nextAudio, lastSnapshotMeta }) : null}
      {showControls && (
        <div className="fitness-webcam-controls">
          <button type="button" onClick={nextVideo}>Switch Camera</button>
          <button type="button" onClick={nextAudio}>Switch Mic</button>
        </div>
      )}
    </div>
  );
});

// Optional hotkeys for cycling devices
export function FitnessWebcamWithHotkeys(props, ref) {
  const innerRef = useRef(null);
  const memoProps = useMemo(() => props, [props]);

  useEffect(() => {
    if (!props.enableHotkeys) return undefined;
    const handler = (event) => {
      if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return;
      if (!innerRef.current) return;
      if (event.key === 'c' || event.key === 'C') {
        innerRef.current.switchCamera?.();
      } else if (event.key === 'm' || event.key === 'M') {
        innerRef.current.switchMic?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [props.enableHotkeys]);

  return <FitnessWebcam ref={ref || innerRef} {...memoProps} />;
}

export const Webcam = forwardRef(FitnessWebcamWithHotkeys);

export default FitnessWebcam;
