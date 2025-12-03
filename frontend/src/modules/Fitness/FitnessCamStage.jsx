import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useMediaDevices } from '../Input/hooks/useMediaDevices';
import { useWebcamStream } from '../Input/hooks/useWebcamStream';
import { useVolumeMeter } from '../Input/hooks/useVolumeMeter';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import './FitnessCamStage.scss';

const DEFAULT_CAPTURE_INTERVAL_MS = 5000;

const FitnessCamStage = ({ onOpenSettings }) => {
  const {
    fitnessSession,
    fitnessSessionInstance,
    registerSessionScreenshot,
    configureSessionScreenshotPlan
  } = useFitnessContext();

  const {
    videoDevices,
    audioDevices,
    selectedVideoDevice,
    selectedAudioDevice,
    cycleVideoDevice,
    cycleAudioDevice
  } = useMediaDevices();

  const { videoRef, stream, error: videoError } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const { volume } = useVolumeMeter(selectedAudioDevice);
  const sessionId = fitnessSession?.sessionId || fitnessSessionInstance?.sessionId || null;
  const timelineInterval = fitnessSessionInstance?.timeline?.timebase?.intervalMs;
  const summaryInterval = fitnessSession?.timebase?.intervalMs;
  const [snapshotStatus, setSnapshotStatus] = useState({ uploading: false, error: null, lastFilename: null, lastUploadedAt: null });
  const canvasRef = useRef(null);
  const captureIndexRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const registerScreenshotRef = useRef(registerSessionScreenshot);

  useEffect(() => {
    registerScreenshotRef.current = registerSessionScreenshot;
  }, [registerSessionScreenshot]);

  const captureIntervalMs = useMemo(() => {
    const candidate = Number.isFinite(timelineInterval) ? timelineInterval : summaryInterval;
    const resolved = Number.isFinite(candidate) && candidate > 0 ? candidate : DEFAULT_CAPTURE_INTERVAL_MS;
    return Math.max(1000, resolved);
  }, [timelineInterval, summaryInterval]);

  useEffect(() => {
    if (!sessionId || typeof configureSessionScreenshotPlan !== 'function') return;
    configureSessionScreenshotPlan({
      intervalMs: captureIntervalMs,
      filenamePattern: `${sessionId}_snapshot`
    });
  }, [sessionId, captureIntervalMs, configureSessionScreenshotPlan]);

  const captureFrame = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.readyState < 2) return null;
    const rawWidth = videoEl.videoWidth || 1280;
    const rawHeight = videoEl.videoHeight || 720;
    const targetWidth = rawWidth > 960 ? 960 : rawWidth;
    const scale = rawWidth ? targetWidth / rawWidth : 1;
    const targetHeight = Math.max(1, Math.round(rawHeight * scale));
    const canvas = canvasRef.current || document.createElement('canvas');
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);
    canvasRef.current = canvas;
    return canvas.toDataURL('image/jpeg', 0.85);
  }, [videoRef]);

  useEffect(() => {
    captureIndexRef.current = 0;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !stream) return;
    let cancelled = false;
    let timerId = null;

    const computeCaptureIndex = () => {
      const tickCount = fitnessSessionInstance?.timeline?.timebase?.tickCount;
      if (Number.isFinite(tickCount) && tickCount > captureIndexRef.current) {
        captureIndexRef.current = tickCount;
      }
      return captureIndexRef.current;
    };

    const scheduleNext = (delay = captureIntervalMs) => {
      if (cancelled) return;
      const clampedDelay = Math.max(750, delay);
      timerId = window.setTimeout(runCapture, clampedDelay);
    };

    const runCapture = async () => {
      timerId = null;
      if (cancelled) return;
      if (document.hidden) {
        scheduleNext(Math.max(2000, captureIntervalMs));
        return;
      }
      const targetVideo = videoRef.current;
      if (!targetVideo || targetVideo.readyState < 2) {
        scheduleNext(1000);
        return;
      }
      if (uploadInFlightRef.current) {
        scheduleNext(500);
        return;
      }

      const imageBase64 = captureFrame();
      if (!imageBase64) {
        scheduleNext(1000);
        return;
      }

      const baseTimestamp = Date.now();
      const captureIndex = computeCaptureIndex();
      const payload = {
        sessionId,
        imageBase64,
        mimeType: 'image/jpeg',
        index: Number.isFinite(captureIndex) ? captureIndex : undefined,
        timestamp: baseTimestamp
      };

      uploadInFlightRef.current = true;
      setSnapshotStatus((prev) => ({ ...prev, uploading: true, error: null }));

      try {
        const response = await DaylightAPI('api/fitness/save_screenshot', payload, 'POST');
        const resolvedIndex = Number.isFinite(response?.index)
          ? response.index
          : Number.isFinite(payload.index)
            ? payload.index
            : captureIndexRef.current;
        captureIndexRef.current = resolvedIndex + 1;

        const captureSummary = {
          index: resolvedIndex,
          timestamp: response?.timestamp || payload.timestamp,
          filename: response?.filename || null,
          path: response?.path || null,
          url: response?.path ? DaylightMediaPath(response.path) : null,
          size: response?.size ?? null
        };

        if (typeof registerScreenshotRef.current === 'function') {
          registerScreenshotRef.current(captureSummary);
        }
        if (captureSummary.path && typeof fitnessSessionInstance?.recordSnapshot === 'function') {
          fitnessSessionInstance.recordSnapshot(captureSummary.path);
        } else if (captureSummary.filename && typeof fitnessSessionInstance?.recordSnapshot === 'function') {
          fitnessSessionInstance.recordSnapshot(captureSummary.filename);
        }

        setSnapshotStatus({
          uploading: false,
          error: null,
          lastFilename: captureSummary.filename,
          lastUploadedAt: captureSummary.timestamp
        });
      } catch (error) {
        setSnapshotStatus((prev) => ({
          ...prev,
          uploading: false,
          error: error?.message || 'Snapshot upload failed'
        }));
      } finally {
        uploadInFlightRef.current = false;
        scheduleNext(captureIntervalMs);
      }
    };

    scheduleNext(1500);

    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [sessionId, stream, captureIntervalMs, captureFrame, videoRef, fitnessSessionInstance]);

  const snapshotMessage = useMemo(() => {
    if (snapshotStatus.error) return snapshotStatus.error;
    if (snapshotStatus.uploading) return 'Capturing snapshot…';
    if (snapshotStatus.lastUploadedAt) {
      const timestamp = new Date(snapshotStatus.lastUploadedAt);
      return `Snapshot ${timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    return 'Snapshot standby';
  }, [snapshotStatus]);

  const volumePercentage = Math.min(volume * 1000, 100);

  // Keyboard shortcuts for device switching
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle if not typing in an input
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

      if (event.key === 'c' || event.key === 'C') {
        cycleVideoDevice('next');
      } else if (event.key === 'm' || event.key === 'M') {
        cycleAudioDevice('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cycleVideoDevice, cycleAudioDevice]);

  return (
    <div className="fitness-cam-stage">
      <div className="video-container">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="webcam-video"
        />
        {videoError && (
          <div className="video-error">
            Camera Error: {videoError.message}
          </div>
        )}
        <div className={`snapshot-status${snapshotStatus.error ? ' error' : ''}${snapshotStatus.uploading ? ' uploading' : ''}`}>
          <span
            className="indicator"
            style={{ opacity: snapshotStatus.error ? 1 : Math.max(0.35, volumePercentage / 100) }}
          />
          <span>{snapshotMessage}</span>
        </div>
      </div>
      <button 
        className="fitness-cam-settings-btn"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings?.();
        }}
      >
        ...
      </button>
    </div>
  );
};

export default FitnessCamStage;
