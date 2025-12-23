import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import useFitnessApp from '../../useFitnessApp';
import { Webcam as FitnessWebcam } from '../../../components/FitnessWebcam.jsx';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import './CameraViewApp.scss';

const DEFAULT_CAPTURE_INTERVAL_MS = 5000;

const CameraViewApp = ({ mode, onClose, config, onMount }) => {
  const {
    sessionId,
    sessionInstance,
    registerSessionScreenshot,
    configureSessionScreenshotPlan,
    registerLifecycle
  } = useFitnessApp('camera_view');

  const webcamRef = useRef(null);
  const [streamReady, setStreamReady] = useState(false);
  const timelineInterval = sessionInstance?.timeline?.timebase?.intervalMs;
  const summaryInterval = sessionInstance?.summary?.timebase?.intervalMs; // Assuming summary structure
  const [snapshotStatus, setSnapshotStatus] = useState({ uploading: false, error: null, lastFilename: null, lastUploadedAt: null });
  const captureIndexRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const registerScreenshotRef = useRef(registerSessionScreenshot);

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  useEffect(() => {
    registerLifecycle({
        onPause: () => {},
        onResume: () => {},
        onSessionEnd: () => {}
    });
  }, [registerLifecycle]);

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
    const tickCount = sessionInstance?.timeline?.timebase?.tickCount;
    if (Number.isFinite(tickCount) && tickCount > captureIndexRef.current) {
      captureIndexRef.current = tickCount;
    }
    return captureIndexRef.current;
  }, [sessionInstance]);

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
        timestamp: baseTimestamp,
        meta: {
          ...meta,
          captureIntervalMs,
          appId: 'camera_view'
        }
      };

      const resp = await DaylightAPI.post('/api/fitness/session/snapshot', payload);
      if (resp?.filename) {
        setSnapshotStatus({
          uploading: false,
          error: null,
          lastFilename: resp.filename,
          lastUploadedAt: Date.now()
        });
        registerScreenshotRef.current?.({
          filename: resp.filename,
          timestamp: baseTimestamp,
          index: captureIndex
        });
      } else {
        throw new Error('upload-failed-no-filename');
      }
    } catch (err) {
      console.warn('Snapshot upload failed', err);
      setSnapshotStatus((prev) => ({ ...prev, uploading: false, error: err.message }));
    } finally {
      uploadInFlightRef.current = false;
    }
  }, [sessionId, captureEnabled, streamReady, captureIntervalMs, blobToBase64, computeCaptureIndex]);

  const layoutClass = {
    standalone: 'camera-layout-full',
    sidebar: 'camera-layout-sidebar',
    overlay: 'camera-layout-overlay',
    mini: 'camera-layout-mini'
  }[mode] || 'camera-layout-sidebar';

  return (
    <div className={`camera-view-app ${layoutClass}`}>
      <div className="video-container">
        <FitnessWebcam
          ref={webcamRef}
          onStreamReady={handleStreamReady}
          onSnapshot={handleSnapshot}
          snapshotIntervalMs={captureIntervalMs}
          className="webcam-video"
        />
        {snapshotStatus.uploading && (
          <div className="snapshot-status uploading">
            <div className="indicator" />
            <span>Saving...</span>
          </div>
        )}
        {snapshotStatus.error && (
          <div className="snapshot-status error">
            <div className="indicator" />
            <span>Error</span>
          </div>
        )}
      </div>
      
      {/* Controls overlay could be added here if needed, but keeping it simple for now */}
    </div>
  );
};

export default CameraViewApp;
