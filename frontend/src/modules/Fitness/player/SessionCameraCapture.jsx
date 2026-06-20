import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Webcam as FitnessWebcam } from '@/modules/Fitness/components/FitnessWebcam.jsx';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

/**
 * Always-on, headless webcam capture for the session time-lapse recap.
 *
 * The recap's PRIMARY feed is the camera (the person working out); player frames
 * are only the PiP overlay, and `TimelapseFrameMapper` returns no frames at all
 * without at least one `role:'camera'` capture. Camera capture therefore must run
 * for the WHOLE session regardless of which UI panel/widget is visible — exactly
 * how `usePlayerFrameCapture` already works for the player feed.
 *
 * Previously camera capture lived only inside the `CameraViewApp` widget, which is
 * mounted solely in `FitnessSessionApp`'s sidebar — so show-player workouts (the
 * common case) recorded zero camera frames and produced no recap. This component
 * decouples capture from the UI: it mounts a hidden FitnessWebcam, captures at the
 * configured cadence, and uploads `role:'camera'` frames via the same
 * `save_screenshot` pipeline the player feed uses.
 */
export default function SessionCameraCapture({ sessionId, intervalMs = 1000, enabled = true }) {
  const logger = useMemo(() => getLogger().child({ component: 'camera-frame-capture' }), []);
  const indexRef = useRef(0);
  const inFlightRef = useRef(false);
  const uploadedRef = useRef(0);

  const period = Math.max(1000, Number.isFinite(intervalMs) ? intervalMs : 1000);
  const active = Boolean(enabled && sessionId);

  useEffect(() => {
    if (!active) return undefined;
    indexRef.current = 0;
    uploadedRef.current = 0;
    logger.info('camera_frame.capture_started', { sessionId, intervalMs: period });
    return () => {
      logger.info('camera_frame.capture_stopped', { sessionId, frames: uploadedRef.current });
    };
  }, [active, sessionId, period, logger]);

  const handleStreamReady = useCallback(() => {
    logger.debug('camera_frame.stream_ready', { sessionId });
  }, [logger, sessionId]);

  const handleStreamError = useCallback((err) => {
    // The single most likely "why is there no camera in the recap?" cause —
    // surface it (rate-limited so a persistent permission/device fault doesn't flood).
    logger.sampled('camera_frame.stream_error', { error: err?.message || String(err) },
      { maxPerMinute: 4, aggregate: true });
  }, [logger, sessionId]);

  const handleSnapshot = useCallback(async (meta, blob) => {
    if (!active || !blob) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (inFlightRef.current) return;
    try {
      inFlightRef.current = true;
      const imageBase64 = await blobToDataUrl(blob);
      const timestamp = meta?.takenAt || Date.now();
      await DaylightAPI('api/v1/fitness/save_screenshot', {
        sessionId,
        imageBase64,
        mimeType: 'image/jpeg',
        index: indexRef.current,
        timestamp,
        role: 'camera'
      });
      indexRef.current += 1;
      uploadedRef.current += 1;
      logger.debug('camera_frame.uploaded', {
        index: indexRef.current,
        w: meta?.resolution?.width ?? null,
        h: meta?.resolution?.height ?? null
      });
    } catch (err) {
      logger.sampled('camera_frame.error', { error: err?.message || String(err) },
        { maxPerMinute: 6, aggregate: true });
    } finally {
      inFlightRef.current = false;
    }
  }, [active, sessionId, logger]);

  if (!active) return null;

  // Hidden, but kept on-screen with opacity:0 (NOT display:none) so the browser
  // keeps decoding video frames — videoWidth/Height come from the intrinsic stream
  // resolution, so the 1px box doesn't shrink the captured image.
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: -9999,
        top: 0,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: -1
      }}
    >
      <FitnessWebcam
        enabled
        audioConstraints={false}
        captureIntervalMs={period}
        // Recap frames are captured RAW: the default `mirrorAdaptive` filter bakes
        // `saturate(2) contrast(1.2) brightness(1.2)` + a horizontal mirror into the
        // saved JPEG, which blew out highlights (washed-out look) and flipped the
        // scene. The live CameraViewApp keeps its filter; only this headless recap
        // capture grabs the true, un-mirrored image.
        filterId="none"
        onSnapshot={handleSnapshot}
        onStreamReady={handleStreamReady}
        onError={handleStreamError}
        snapshotContext="session-recap"
        enableHotkeys={false}
      />
    </div>
  );
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(blob);
  });
}
