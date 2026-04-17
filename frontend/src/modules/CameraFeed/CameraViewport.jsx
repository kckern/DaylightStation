// frontend/src/modules/CameraFeed/CameraViewport.jsx
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import usePanZoom from './usePanZoom.js';
import CameraControls from './CameraControls.jsx';
import { getChildLogger } from '../../lib/logging/singleton.js';
import useSnapshotFetch from './useSnapshotFetch.js';
import useHlsStream from './useHlsStream.js';
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
export default function CameraViewport({ cameraId, mode, snapshotSrc: externalSnapshotSrc, detections = [], onClose }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraViewport', cameraId }), [cameraId]);
  const containerRef = useRef(null);
  const mediaRef = useRef(null);
  const [contentDims, setContentDims] = useState({ w: 7680, h: 2160 }); // default panoramic
  const [showHints, setShowHints] = useState(true);
  const [showZoom, setShowZoom] = useState(false);
  const hintTimer = useRef(null);
  const zoomTimer = useRef(null);

  // Snapshot fetch hook — active only in live mode (for warmup preview)
  const { src: fetchedSrc, naturalSize, onImgLoad } = useSnapshotFetch(
    mode === 'live' ? cameraId : null,
    logger,
  );
  const previewSrc = mode === 'live' ? fetchedSrc : null;
  const snapshotSrc = mode === 'snapshot' ? (externalSnapshotSrc || fetchedSrc) : null;
  const [previewPhase, setPreviewPhase] = useState('loading'); // loading | preview | live

  // HLS stream hook — active only in live mode
  const liveVideoRef = useRef(null);
  const { ready: liveReady, videoSize } = useHlsStream(
    mode === 'live' ? cameraId : null,
    liveVideoRef,
    logger,
  );

  useEffect(() => {
    if (liveReady) setPreviewPhase('live');
  }, [liveReady]);

  // Update content dimensions from HLS video size or snapshot natural size
  useEffect(() => {
    if (liveReady && videoSize.w) setContentDims(videoSize);
    else if (naturalSize.w) setContentDims(naturalSize);
  }, [liveReady, videoSize, naturalSize]);

  const isLoading = mode === 'live' ? !liveReady && !previewSrc : !snapshotSrc;

  const { x, y, zoom, lastZoomTime, handlers, reset, panTo, getDims, MIN_ZOOM } = usePanZoom({
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

  // Minimap click/drag: convert minimap position to pan coordinates
  const minimapRef = useRef(null);
  const minimapDragRef = useRef(false);

  const minimapPositionToPan = useCallback((clientX, clientY) => {
    const el = minimapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Normalized position (0-1) within the minimap
    const normX = (clientX - rect.left) / rect.width;
    const normY = (clientY - rect.top) / rect.height;
    // Convert to pan: center of minimap = pan(0,0), edges = max pan
    const d = getDims();
    const scaledW = d.contentW * zoom;
    const scaledH = d.contentH * zoom;
    const newX = (0.5 - normX) * scaledW;
    const newY = (0.5 - normY) * scaledH;
    panTo(newX, newY);
  }, [getDims, zoom, panTo]);

  const onMinimapPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    minimapDragRef.current = true;
    minimapPositionToPan(e.clientX, e.clientY);
  }, [minimapPositionToPan]);

  const onMinimapPointerMove = useCallback((e) => {
    if (!minimapDragRef.current) return;
    e.stopPropagation();
    minimapPositionToPan(e.clientX, e.clientY);
  }, [minimapPositionToPan]);

  const onMinimapPointerUp = useCallback((e) => {
    minimapDragRef.current = false;
    e.stopPropagation();
  }, []);

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
        {mode === 'live' && (previewPhase === 'loading') && (
          <div className="camera-viewport__loading">
            <span className="camera-viewport__loading-text">Loading camera...</span>
          </div>
        )}
        <div className="camera-viewport__media" style={transformStyle}>
          {mode === 'live' ? (
            <>
              {/* Low-res preview: blur+grayscale → sharp+color animation */}
              {previewSrc && previewPhase !== 'live' && (
                <img
                  className={`camera-viewport__preview ${previewPhase === 'preview' ? 'visible' : ''}`}
                  src={previewSrc}
                  alt=""
                  draggable={false}
                  onLoad={(e) => {
                    onImgLoad(e);
                    onMediaLoad(e);
                    setPreviewPhase('preview');
                    logger.info?.('viewport.warmup.previewRendered');
                  }}
                  onAnimationEnd={() => logger.info?.('viewport.warmup.animationComplete')}
                />
              )}
              {/* HLS video — fades in over the preview */}
              <video
                ref={liveVideoRef}
                className={`camera-viewport__live-video ${liveReady ? 'ready' : ''}`}
                muted
                autoPlay
                playsInline
                onTransitionEnd={() => {
                  if (liveReady) logger.info?.('viewport.warmup.crossfadeComplete');
                }}
              />
            </>
          ) : (
            snapshotSrc && (
              <img
                ref={mediaRef}
                src={snapshotSrc}
                alt={`${cameraId} viewport`}
                onLoad={onMediaLoad}
                draggable={false}
              />
            )
          )}
        </div>
        {mode === 'snapshot' && !snapshotSrc && (
          <div className="camera-viewport__loading">
            <span className="camera-viewport__loading-text">Loading camera...</span>
          </div>
        )}
      </div>

      {/* Minimap — click/drag to navigate */}
      {zoom > MIN_ZOOM && (
        <div
          className="camera-viewport__minimap"
          ref={minimapRef}
          onPointerDown={onMinimapPointerDown}
          onPointerMove={onMinimapPointerMove}
          onPointerUp={onMinimapPointerUp}
          onPointerCancel={onMinimapPointerUp}
        >
          <div className="camera-viewport__minimap-bg">
            {mode === 'snapshot' && snapshotSrc && <img src={snapshotSrc} alt="" draggable={false} />}
            {mode === 'live' && <div style={{ width: '100%', height: '100%', background: '#222' }} />}
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
