// frontend/src/modules/CameraFeed/CameraViewport.jsx
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import usePanZoom from './usePanZoom.js';
import CameraControls from './CameraControls.jsx';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './CameraViewport.scss';

/**
 * Fullscreen pan/zoom camera viewport overlay.
 *
 * @param {Object} props
 * @param {string} props.cameraId
 * @param {'snapshot'|'live'} props.mode
 * @param {string} [props.snapshotSrc] - current snapshot blob URL (for snapshot mode)
 * @param {{ type: string, active: boolean }[]} props.detections
 * @param {Function} props.onClose
 */
export default function CameraViewport({ cameraId, mode, snapshotSrc, detections = [], onClose }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraViewport', cameraId }), [cameraId]);
  const containerRef = useRef(null);
  const mediaRef = useRef(null);
  const [contentDims, setContentDims] = useState({ w: 7680, h: 2160 }); // default panoramic
  const [showHints, setShowHints] = useState(true);
  const [showZoom, setShowZoom] = useState(false);
  const hintTimer = useRef(null);
  const zoomTimer = useRef(null);

  // For live mode, fetch a snapshot as a still frame for the viewport
  const [liveSrc, setLiveSrc] = useState(null);
  useEffect(() => {
    if (mode !== 'live') return;
    let active = true;
    const url = `/api/v1/camera/${cameraId}/snap?t=${Date.now()}`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (active) setLiveSrc(URL.createObjectURL(blob));
      })
      .catch(err => logger.warn?.('viewport.liveSnapError', { error: err.message }));
    return () => {
      active = false;
      setLiveSrc(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [cameraId, mode, logger]);

  const imageSrc = mode === 'snapshot' ? snapshotSrc : liveSrc;

  const { x, y, zoom, lastZoomTime, handlers, reset, MIN_ZOOM } = usePanZoom({
    containerRef,
    contentWidth: contentDims.w,
    contentHeight: contentDims.h,
  });

  // Get content dimensions from loaded media
  const onMediaLoad = useCallback((e) => {
    const el = e.target;
    const w = el.naturalWidth || el.videoWidth || contentDims.w;
    const h = el.naturalHeight || el.videoHeight || contentDims.h;
    setContentDims({ w, h });
    logger.debug?.('viewport.mediaDims', { w, h });
  }, [contentDims.w, contentDims.h, logger]);

  // Hints: fade after 3s, reappear on mouse move
  useEffect(() => {
    hintTimer.current = setTimeout(() => setShowHints(false), 3000);
    return () => clearTimeout(hintTimer.current);
  }, []);

  const onMouseMove = useCallback(() => {
    setShowHints(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowHints(false), 3000);
  }, []);

  // Zoom indicator: show briefly on zoom change
  useEffect(() => {
    setShowZoom(true);
    clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => setShowZoom(false), 2000);
    return () => clearTimeout(zoomTimer.current);
  }, [zoom]);

  // Esc to close
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Lock body scroll while viewport is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    logger.info?.('viewport.open', { mode });
    return () => {
      document.body.style.overflow = '';
      logger.info?.('viewport.close');
    };
  }, [logger, mode]);

  const activeDetections = detections.filter(d => d.active);

  // Minimap viewport rect
  const minimapViewport = (() => {
    if (zoom <= MIN_ZOOM) return null;
    const containerW = containerRef.current?.clientWidth || 1;
    const containerH = containerRef.current?.clientHeight || 1;
    const scaledW = contentDims.w * zoom;
    const scaledH = contentDims.h * zoom;
    const viewW = containerW / scaledW;
    const viewH = containerH / scaledH;
    const viewX = 0.5 - x / scaledW;
    const viewY = 0.5 - y / scaledH;
    return {
      left: `${(viewX - viewW / 2) * 100}%`,
      top: `${(viewY - viewH / 2) * 100}%`,
      width: `${viewW * 100}%`,
      height: `${viewH * 100}%`,
    };
  })();

  const transformStyle = {
    transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    transformOrigin: 'center center',
    willChange: 'transform',
  };

  return (
    <div className="camera-viewport" onMouseMove={onMouseMove}>
      {/* Top bar */}
      <div className="camera-viewport__top-bar">
        <div className="camera-viewport__title">
          <span className="camera-viewport__status-dot" />
          <span>{cameraId.replace(/-/g, ' ')}</span>
          {mode === 'live' && <span className="camera-viewport__live-badge">LIVE</span>}
        </div>
        {activeDetections.length > 0 && (
          <div className="camera-viewport__detections">
            {activeDetections.map(d => (
              <span key={d.type} className={`camera-viewport__detection-badge camera-viewport__detection-badge--${d.type}`}>
                {d.type}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Close button */}
      <button className="camera-viewport__close" onClick={onClose}>{'\u2715'}</button>

      {/* Zoom indicator */}
      <div className={`camera-viewport__zoom-indicator ${showZoom ? 'visible' : ''}`}>
        {zoom.toFixed(1)}x
      </div>

      {/* Main viewport */}
      <div
        className="camera-viewport__container"
        ref={containerRef}
        {...handlers}
        style={{ cursor: zoom > MIN_ZOOM ? 'grab' : 'default' }}
      >
        <div className="camera-viewport__media" style={transformStyle}>
          {imageSrc && (
            <img
              ref={mediaRef}
              src={imageSrc}
              alt={`${cameraId} viewport`}
              onLoad={onMediaLoad}
              draggable={false}
            />
          )}
        </div>
      </div>

      {/* Minimap */}
      {zoom > MIN_ZOOM && (
        <div className="camera-viewport__minimap">
          <div className="camera-viewport__minimap-bg">
            {imageSrc && <img src={imageSrc} alt="" draggable={false} />}
          </div>
          {minimapViewport && <div className="camera-viewport__minimap-viewport" style={minimapViewport} />}
        </div>
      )}

      {/* Camera controls */}
      <CameraControls cameraId={cameraId} logger={logger} />

      {/* Hints bar */}
      <div className={`camera-viewport__hints ${showHints ? 'visible' : ''}`}>
        Drag to pan · Scroll to zoom · +/- keys · Double-click to reset · Esc to close
      </div>
    </div>
  );
}
