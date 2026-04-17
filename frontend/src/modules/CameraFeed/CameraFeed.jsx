// frontend/src/modules/CameraFeed/CameraFeed.jsx
import { useState, useCallback } from 'react';
import CameraRenderer from './CameraRenderer.jsx';
import CameraViewport from './CameraViewport.jsx';
import useDetections from './useDetections.js';
import './CameraFeed.scss';

/**
 * Camera card for HomeApp — interactive CameraRenderer + fullscreen viewport.
 */
export default function CameraFeed({ cameraId, onError }) {
  const [viewportOpen, setViewportOpen] = useState(false);
  const detections = useDetections(cameraId);
  const openViewport = useCallback(() => setViewportOpen(true), []);

  return (
    <>
      <CameraRenderer
        cameraId={cameraId}
        crop
        interactive
        onFullscreen={openViewport}
        onError={onError}
      />
      {viewportOpen && (
        <CameraViewport
          cameraId={cameraId}
          mode="live"
          detections={detections}
          onClose={() => setViewportOpen(false)}
        />
      )}
    </>
  );
}
