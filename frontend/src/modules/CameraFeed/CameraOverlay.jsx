// frontend/src/modules/CameraFeed/CameraOverlay.jsx
/**
 * CameraOverlay — screen overlay wrapper for CameraFeed.
 *
 * Designed for the screen framework overlay system. Fetches the camera list,
 * renders a fullscreen CameraViewport for the first available camera in live mode.
 * Receives `dismiss` prop from the overlay provider.
 */
import { useState, useEffect, useMemo } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import CameraViewport from './CameraViewport.jsx';

export default function CameraOverlay({ dismiss }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraOverlay' }), []);
  const [camera, setCamera] = useState(null);
  const [detections, setDetections] = useState([]);
  const [error, setError] = useState(null);

  // Fetch first available camera
  useEffect(() => {
    fetch('/api/v1/camera')
      .then(r => r.json())
      .then(data => {
        const cameras = data.cameras || [];
        if (cameras.length === 0) {
          setError('No cameras available');
          logger.warn('cameraOverlay.noCameras');
          return;
        }
        setCamera(cameras[0]);
        logger.info('cameraOverlay.loaded', { cameraId: cameras[0].id });
      })
      .catch(err => {
        setError('Failed to load cameras');
        logger.error('cameraOverlay.fetchError', { error: err.message });
      });
  }, [logger]);

  // Poll detection state
  useEffect(() => {
    if (!camera) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/camera/${camera.id}/state`);
        if (!res.ok) return;
        const data = await res.json();
        if (active) setDetections(data.detections || []);
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [camera]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
        {error}
      </div>
    );
  }

  if (!camera) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555' }}>
        Loading camera...
      </div>
    );
  }

  return (
    <CameraViewport
      cameraId={camera.id}
      mode="live"
      detections={detections}
      onClose={dismiss}
    />
  );
}
