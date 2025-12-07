import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { Webcam as FitnessWebcam } from './components/FitnessWebcam.jsx';
import './FitnessCamStage.scss';

const DEFAULT_CAPTURE_INTERVAL_MS = 5000;

const FitnessCamStage = ({ onOpenSettings }) => {
  const {
    fitnessSession,
    fitnessSessionInstance,
    registerSessionScreenshot,
    configureSessionScreenshotPlan
  } = useFitnessContext();

  const webcamRef = useRef(null);
  const [streamReady, setStreamReady] = useState(false);
  const sessionId = fitnessSession?.sessionId || fitnessSessionInstance?.sessionId || null;
  const timelineInterval = fitnessSessionInstance?.timeline?.timebase?.intervalMs;
  const summaryInterval = fitnessSession?.timebase?.intervalMs;
  const [snapshotStatus, setSnapshotStatus] = useState({ uploading: false, error: null, lastFilename: null, lastUploadedAt: null });
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

  const [captureEnabled, setCaptureEnabled] = useState(true);

  useEffect(() => {
    const handler = () => setCaptureEnabled(!document.hidden);
    handler();
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const computeCaptureIndex = useCallback(() => {
    const tickCount = fitnessSessionInstance?.timeline?.timebase?.tickCount;
    if (Number.isFinite(tickCount) && tickCount > captureIndexRef.current) {
      captureIndexRef.current = tickCount;
    }
    return captureIndexRef.current;
  }, [fitnessSessionInstance]);

  const blobToBase64 = useCallback((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('snapshot-convert-failed'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('snapshot-convert-failed'));
    reader.readAsDataURL(blob);
  }), []);

  useEffect(() => {
    captureIndexRef.current = 0;
  }, [sessionId]);

  const handleStreamReady = useCallback(() => {
    setStreamReady(true);
  }, []);

  const handleSnapshot = useCallback(async (meta, blob) => {
    if (!sessionId) return;
    if (document.hidden || !captureEnabled || !streamReady) return;
    if (uploadInFlightRef.current) return;

    const baseTimestamp = meta?.takenAt || Date.now();
    const captureIndex = computeCaptureIndex();
    uploadInFlightRef.current = true;
    setSnapshotStatus((prev) => ({ ...prev, uploading: true, error: null }));

    try {
      const imageBase64 = await blobToBase64(blob);
      const payload = {
        sessionId,
        imageBase64,
        mimeType: 'image/jpeg',
        index: Number.isFinite(captureIndex) ? captureIndex : undefined,
        timestamp: baseTimestamp
      };

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
    }
  }, [sessionId, captureEnabled, streamReady, computeCaptureIndex, blobToBase64, fitnessSessionInstance]);

  const snapshotMessage = useMemo(() => {
    if (snapshotStatus.error) return snapshotStatus.error;
    if (snapshotStatus.uploading) return 'Capturing snapshot…';
    if (snapshotStatus.lastUploadedAt) {
      const timestamp = new Date(snapshotStatus.lastUploadedAt);
      return `Snapshot ${timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    return 'Snapshot standby';
  }, [snapshotStatus]);

  const volumePercentage = 100;

  return (
    <div className="fitness-cam-stage">
      <div className="video-container">
        <FitnessWebcam
          ref={webcamRef}
          enabled
          audioConstraints={false}
          captureIntervalMs={captureEnabled && streamReady ? captureIntervalMs : 0}
          onSnapshot={handleSnapshot}
          onStreamReady={handleStreamReady}
          videoClassName="webcam-video"
          renderOverlay={({ status, error, permissionError }) => (
            <>
              {(status === 'starting' || status === 'reconnecting') && (
                <div className="video-status">
                  <div className="status-icon">⏳</div>
                  <div className="status-text">Requesting camera access...</div>
                </div>
              )}
              {(error || permissionError) && (
                <div className="video-status error">
                  <div className="status-icon">⚠️</div>
                  <div className="status-text">{error?.message || permissionError?.message || 'Camera error'}</div>
                </div>
              )}
            </>
          )}
          className="webcam-video"
        />
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
