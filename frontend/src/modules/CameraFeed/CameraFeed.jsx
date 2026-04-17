// frontend/src/modules/CameraFeed/CameraFeed.jsx
import { useState, useCallback } from 'react';
import CameraRenderer from './CameraRenderer.jsx';
import CameraViewport from './CameraViewport.jsx';
import useDetections from './useDetections.js';

/**
 * Camera card for HomeApp — interactive CameraRenderer + fullscreen viewport.
 * The fullscreen button is rendered externally via renderFullscreenButton().
 */
export default function CameraFeed({ cameraId, onError, renderHeader }) {
  const [viewportOpen, setViewportOpen] = useState(false);
  const detections = useDetections(cameraId);
  const openViewport = useCallback(() => setViewportOpen(true), []);

  return (
    <>
      {renderHeader?.(openViewport)}
      <CameraRenderer
        cameraId={cameraId}
        crop
        interactive
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
