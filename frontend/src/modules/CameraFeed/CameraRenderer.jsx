// frontend/src/modules/CameraFeed/CameraRenderer.jsx
import { useRef, useState, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import useSnapshotFetch from './useSnapshotFetch.js';
import useHlsStream from './useHlsStream.js';
import useDetections from './useDetections.js';
import './CameraRenderer.scss';

/**
 * Universal camera rendering component.
 *
 * Flow: snapshot fade-in (warmup) → HLS live crossfade → detection badges.
 *
 * @param {Object} props
 * @param {string} props.cameraId
 * @param {boolean} [props.crop=true] - 16:9 cover crop vs uncropped contain
 * @param {boolean} [props.interactive=false] - click-to-center, drag-to-pan, mini-nav, fullscreen
 * @param {function} [props.onFullscreen] - fullscreen button callback (interactive only)
 * @param {function} [props.onError] - error callback
 */
export default function CameraRenderer({ cameraId, crop = true, interactive = false, onFullscreen, onError }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraRenderer', cameraId }), [cameraId]);
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  // --- Data hooks ---
  const { src, loading, error, naturalSize, onImgLoad } = useSnapshotFetch(cameraId, logger);
  const { ready: liveReady, videoSize } = useHlsStream(cameraId, videoRef, logger);
  const detections = useDetections(cameraId, logger);

  // --- Warmup phase ---
  const [previewVisible, setPreviewVisible] = useState(false);

  const handlePreviewLoad = useCallback((e) => {
    onImgLoad(e);
    setPreviewVisible(true);
    logger.info('warmup.previewRendered');
  }, [onImgLoad, logger]);

  // --- Pan state (interactive mode) ---
  const [objectPosition, setObjectPosition] = useState('50% 50%');
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e) => {
    if (!interactive || !crop) return;
    if (e.button !== 0) return;
    dragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [interactive, crop]);

  const handlePointerMove = useCallback((e) => {
    if (!dragging.current) return;
    const container = containerRef.current;
    if (!container) return;

    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };

    // Determine effective content size (use video if live, snapshot otherwise)
    const size = liveReady ? videoSize : naturalSize;
    if (!size.w || !size.h) return;

    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    setObjectPosition(prev => {
      const [px, py] = prev.split(' ').map(v => parseFloat(v));
      // Convert pixel delta to percentage of the overflow range
      const containerRatio = 16 / 9;
      const imageRatio = size.w / size.h;
      let newPx = px, newPy = py;

      if (imageRatio > containerRatio) {
        // Width overflows — horizontal pan
        const overflowW = (size.h * containerRatio) > 0 ? size.w - size.h * containerRatio : 0;
        if (overflowW > 0) {
          const pxPerPercent = (overflowW * containerH / size.h) / 100;
          newPx = Math.max(0, Math.min(100, px - dx / pxPerPercent));
        }
      } else {
        // Height overflows — vertical pan
        const overflowH = (size.w / containerRatio) > 0 ? size.h - size.w / containerRatio : 0;
        if (overflowH > 0) {
          const pxPerPercent = (overflowH * containerW / size.w) / 100;
          newPy = Math.max(0, Math.min(100, py - dy / pxPerPercent));
        }
      }
      return `${newPx.toFixed(1)}% ${newPy.toFixed(1)}%`;
    });
  }, [liveReady, videoSize, naturalSize]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const handleClick = useCallback((e) => {
    if (!interactive || !crop) return;
    // If the user dragged, don't treat as a click-to-center
    // (pointerup already fired, dragging is false, but we can check movement)
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setObjectPosition(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }, [interactive, crop]);

  // --- Suppress click-to-center after drag ---
  const pointerStart = useRef({ x: 0, y: 0 });
  const handlePointerDownWithTracking = useCallback((e) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    handlePointerDown(e);
  }, [handlePointerDown]);

  const handleClickGuarded = useCallback((e) => {
    const dist = Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y);
    if (dist > 5) return; // was a drag, not a click
    handleClick(e);
  }, [handleClick]);

  // --- Render ---
  const activeDetections = detections.filter(d => d.active);
  const showPreview = src && !liveReady;
  const posStyle = crop ? { objectPosition } : undefined;

  const className = [
    'camera-renderer',
    crop ? 'camera-renderer--crop' : 'camera-renderer--contain',
    interactive ? 'camera-renderer--interactive' : '',
    loading ? 'camera-renderer--loading' : '',
  ].filter(Boolean).join(' ');

  const pointerHandlers = interactive && crop ? {
    onPointerDown: handlePointerDownWithTracking,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    onClick: handleClickGuarded,
  } : {};

  return (
    <div className={className} ref={containerRef} {...pointerHandlers}>
      {/* Loading skeleton */}
      {loading && !src && (
        <div className="camera-renderer__skeleton">
          <span className="camera-renderer__skeleton-text">Loading camera...</span>
        </div>
      )}

      {/* Error state */}
      {error && !src && !loading && (
        <div className="camera-renderer__error">Camera unavailable</div>
      )}

      {/* Snapshot preview with warmup animation */}
      {showPreview && (
        <img
          className={`camera-renderer__preview ${previewVisible ? 'visible' : ''}`}
          src={src}
          alt={`${cameraId} snapshot`}
          onLoad={handlePreviewLoad}
          draggable={false}
          style={posStyle}
        />
      )}

      {/* HLS live video — crossfades over the preview */}
      <video
        ref={videoRef}
        className={`camera-renderer__live ${liveReady ? 'ready' : ''}`}
        muted
        autoPlay
        playsInline
        style={posStyle}
      />

      {/* Detection badges */}
      {activeDetections.length > 0 && (
        <div className="camera-renderer__badges">
          {activeDetections.map(d => (
            <span key={d.type} className={`camera-renderer__badge camera-renderer__badge--${d.type}`}>{d.type}</span>
          ))}
        </div>
      )}

      {/* Interactive chrome */}
      {interactive && (src || liveReady) && onFullscreen && (
        <button className="camera-renderer__fullscreen" onClick={onFullscreen} title="Fullscreen">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1h5V0H0v6h1V1zm14 0h-5V0h6v6h-1V1zM1 15h5v1H0v-6h1v5zm14 0h-5v1h6v-6h-1v5z"/>
          </svg>
        </button>
      )}

      {interactive && src && naturalSize.w > 0 && (
        <MiniNav
          src={src}
          naturalWidth={naturalSize.w}
          naturalHeight={naturalSize.h}
          objectPosition={objectPosition}
          onPan={setObjectPosition}
        />
      )}
    </div>
  );
}

// --- MiniNav (moved from CameraFeed.jsx) ---

function MiniNav({ src, naturalWidth, naturalHeight, objectPosition, onPan }) {
  const navRef = useRef(null);

  const getViewportStyle = useCallback(() => {
    if (!naturalWidth || !naturalHeight) return { display: 'none' };

    const containerRatio = 16 / 9;
    const imageRatio = naturalWidth / naturalHeight;

    let visibleW, visibleH;
    if (imageRatio > containerRatio) {
      visibleW = containerRatio / imageRatio;
      visibleH = 1;
    } else {
      visibleW = 1;
      visibleH = imageRatio / containerRatio;
    }

    const [pxStr, pyStr] = (objectPosition || '50% 50%').split(' ');
    const px = parseFloat(pxStr) / 100;
    const py = parseFloat(pyStr) / 100;

    const maxOffsetX = 1 - visibleW;
    const maxOffsetY = 1 - visibleH;
    const left = px * maxOffsetX;
    const top = py * maxOffsetY;

    return {
      left: `${left * 100}%`,
      top: `${top * 100}%`,
      width: `${visibleW * 100}%`,
      height: `${visibleH * 100}%`,
    };
  }, [naturalWidth, naturalHeight, objectPosition]);

  const handleNav = useCallback((e) => {
    const nav = navRef.current;
    if (!nav) return;
    const rect = nav.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onPan(`${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`);
  }, [onPan]);

  const dragRef = useRef(false);

  const onPointerDown = useCallback((e) => {
    e.stopPropagation();
    dragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    handleNav(e);
  }, [handleNav]);

  const onPointerMove = useCallback((e) => {
    if (dragRef.current) { e.stopPropagation(); handleNav(e); }
  }, [handleNav]);

  const onPointerUp = useCallback((e) => {
    e.stopPropagation();
    dragRef.current = false;
  }, []);

  const containerRatio = 16 / 9;
  const imageRatio = naturalWidth / naturalHeight;
  const needsNav = imageRatio > containerRatio * 1.05 || imageRatio < containerRatio * 0.95;
  if (!needsNav) return null;

  return (
    <div
      className="camera-renderer__nav"
      ref={navRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img src={src} alt="" draggable={false} />
      <div className="camera-renderer__nav-viewport" style={getViewportStyle()} />
    </div>
  );
}
