// frontend/src/modules/CameraFeed/CameraOverlay.jsx
/**
 * CameraOverlay — screen overlay wrapper for CameraRenderer.
 *
 * Designed for the screen framework overlay system (kiosk/signage).
 * Fetches the camera list, renders a non-interactive CameraRenderer
 * for the first available camera.
 */
import { useState, useEffect, useMemo } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import CameraRenderer from './CameraRenderer.jsx';

export default function CameraOverlay({ dismiss, crop = true }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraOverlay' }), []);
  const [camera, setCamera] = useState(null);
  const [error, setError] = useState(null);

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

  return <CameraRenderer cameraId={camera.id} crop={crop} />;
}
