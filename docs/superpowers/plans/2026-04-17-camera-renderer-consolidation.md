# Camera Renderer Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract duplicated camera rendering logic into shared hooks and a `CameraRenderer` component, making the warmup sequence (snapshot fade-in → live crossfade) the universal default.

**Architecture:** Three hooks (`useSnapshotFetch`, `useHlsStream`, `useDetections`) provide the data plumbing. `CameraRenderer` composes them into the standard rendering flow. `CameraFeed` (HomeApp) wraps it with `interactive` chrome. `CameraOverlay` (kiosk) wraps it bare. `CameraViewport` (fullscreen) uses the hooks directly with its own pan/zoom system.

**Tech Stack:** React hooks, hls.js, CSS animations, Playwright tests

**Spec:** `docs/superpowers/specs/2026-04-17-camera-renderer-consolidation-design.md`

---

### Task 1: Extract `useDetections` hook

**Files:**
- Create: `frontend/src/modules/CameraFeed/useDetections.js`

- [ ] **Step 1: Create the hook**

```js
// frontend/src/modules/CameraFeed/useDetections.js
import { useState, useEffect } from 'react';

/**
 * Poll camera detection state (motion, person, vehicle, animal).
 * @param {string} cameraId
 * @param {object} logger - child logger instance
 * @param {number} [intervalMs=2000]
 * @returns {{ type: string, active: boolean }[]}
 */
export default function useDetections(cameraId, logger, intervalMs = 2000) {
  const [detections, setDetections] = useState([]);

  useEffect(() => {
    if (!cameraId) return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/camera/${cameraId}/state`);
        if (!res.ok) {
          logger?.debug?.('detection.poll.httpError', { status: res.status });
          return;
        }
        const data = await res.json();
        if (active) setDetections(data.detections || []);
      } catch (err) {
        logger?.debug?.('detection.poll.error', { error: err.message });
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => { active = false; clearInterval(timer); };
  }, [cameraId, logger, intervalMs]);

  return detections;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/CameraFeed/useDetections.js
git commit -m "refactor(camera): extract useDetections hook"
```

---

### Task 2: Extract `useSnapshotFetch` hook

**Files:**
- Create: `frontend/src/modules/CameraFeed/useSnapshotFetch.js`

- [ ] **Step 1: Create the hook**

```js
// frontend/src/modules/CameraFeed/useSnapshotFetch.js
import { useState, useEffect, useCallback } from 'react';

/**
 * Fetch a single camera snapshot. Returns a blob URL and natural dimensions.
 * The blob URL is revoked on unmount or when cameraId changes.
 *
 * @param {string} cameraId
 * @param {object} logger - child logger instance
 * @returns {{ src: string|null, loading: boolean, error: boolean, naturalSize: {w:number, h:number}, onImgLoad: function }}
 */
export default function useSnapshotFetch(cameraId, logger) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!cameraId) return;
    let active = true;
    setLoading(true);
    setError(false);

    const t0 = performance.now();
    fetch(`/api/v1/camera/${cameraId}/snap?t=${Date.now()}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (!active) return;
        const url = URL.createObjectURL(blob);
        setSrc(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
        setLoading(false);
        const durationMs = Math.round(performance.now() - t0);
        logger?.info?.('snapshot.fetched', { durationMs, sizeBytes: blob.size });
      })
      .catch(err => {
        if (!active) return;
        setError(true);
        setLoading(false);
        logger?.warn?.('snapshot.error', { error: err.message });
      });

    return () => {
      active = false;
      setSrc(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [cameraId, logger]);

  const onImgLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      setNaturalSize({ w: naturalWidth, h: naturalHeight });
    }
  }, []);

  return { src, loading, error, naturalSize, onImgLoad };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/CameraFeed/useSnapshotFetch.js
git commit -m "refactor(camera): extract useSnapshotFetch hook"
```

---

### Task 3: Extract `useHlsStream` hook

**Files:**
- Create: `frontend/src/modules/CameraFeed/useHlsStream.js`

- [ ] **Step 1: Create the hook**

```js
// frontend/src/modules/CameraFeed/useHlsStream.js
import { useState, useEffect } from 'react';
import Hls from 'hls.js';

/**
 * Attach an HLS live stream to a video element.
 *
 * @param {string} cameraId
 * @param {React.RefObject<HTMLVideoElement>} videoRef
 * @param {object} logger - child logger instance
 * @returns {{ ready: boolean, videoSize: {w:number, h:number} }}
 */
export default function useHlsStream(cameraId, videoRef, logger) {
  const [ready, setReady] = useState(false);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraId) return;
    setReady(false);

    const playlistUrl = `/api/v1/camera/${cameraId}/live/stream.m3u8`;
    logger?.info?.('hls.start', { url: playlistUrl });

    const onPlaying = () => {
      setReady(true);
      logger?.info?.('hls.playing');
    };

    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoSize({ w: video.videoWidth, h: video.videoHeight });
      }
    };

    // Native HLS (Safari)
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playlistUrl;
        video.play().catch(() => {});
        video.addEventListener('playing', onPlaying, { once: true });
        video.addEventListener('loadedmetadata', onMeta, { once: true });
        return () => {
          video.removeEventListener('playing', onPlaying);
          video.removeEventListener('loadedmetadata', onMeta);
          video.src = '';
          fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
        };
      }
      logger?.error?.('hls.unsupported');
      return;
    }

    // hls.js
    const hls = new Hls({
      enableWorker: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 3,
    });

    hls.loadSource(playlistUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (event, data) => {
      logger?.warn?.('hls.error', { type: data.type, details: data.details, fatal: data.fatal });
    });

    video.addEventListener('playing', onPlaying, { once: true });
    video.addEventListener('loadedmetadata', onMeta, { once: true });

    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('loadedmetadata', onMeta);
      hls.destroy();
      fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
      logger?.info?.('hls.stop');
    };
  }, [cameraId, videoRef, logger]);

  return { ready, videoSize };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/CameraFeed/useHlsStream.js
git commit -m "refactor(camera): extract useHlsStream hook"
```

---

### Task 4: Create `CameraRenderer` component and styles

**Files:**
- Create: `frontend/src/modules/CameraFeed/CameraRenderer.jsx`
- Create: `frontend/src/modules/CameraFeed/CameraRenderer.scss`

- [ ] **Step 1: Create CameraRenderer.scss**

```scss
// frontend/src/modules/CameraFeed/CameraRenderer.scss
.camera-renderer {
  position: relative;
  width: 100%;
  background: #111;
  border-radius: 8px;
  overflow: hidden;

  &--crop {
    aspect-ratio: 16 / 9;

    img, video {
      object-fit: cover;
    }
  }

  &--contain {
    img, video {
      object-fit: contain;
    }
  }

  img, video {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }

  // --- Warmup: snapshot preview ---
  &__preview {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    filter: blur(8px) grayscale(100%);
    pointer-events: none;

    &.visible {
      opacity: 1;
      animation: camera-warmup 3s ease-out forwards;
    }
  }

  // --- Live video crossfade ---
  &__live {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.8s ease-in;
    pointer-events: none;

    &.ready {
      opacity: 1;
    }
  }

  // --- Loading / error states ---
  &__skeleton {
    position: absolute;
    inset: 0;
    background: #151515;
    animation: camera-skeleton-pulse 2s ease-in-out infinite;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__skeleton-text {
    color: #555;
    font-size: 0.85rem;
    letter-spacing: 0.02em;
  }

  &__error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 0.9rem;
  }

  // --- Detection badges ---
  &__badges {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 4px;
    z-index: 1;
  }

  &__badge {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
    transition: opacity 0.3s;

    &--person { background: rgba(59, 130, 246, 0.4); color: #93bbfd; }
    &--vehicle { background: rgba(245, 158, 11, 0.4); color: #fbbf24; }
    &--animal { background: rgba(34, 197, 94, 0.4); color: #86efac; }
  }

  // --- Interactive chrome (only when interactive) ---
  &__fullscreen {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2;
    padding: 0;
    transition: background 0.15s, color 0.15s;

    &:hover {
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
    }
  }

  &__nav {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 80px;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    z-index: 2;
    user-select: none;

    &:active { cursor: grabbing; }

    img {
      width: 100%;
      height: auto;
      object-fit: contain;
      display: block;
      pointer-events: none;
    }
  }

  &__nav-viewport {
    position: absolute;
    border: 1.5px solid rgba(255, 255, 255, 0.7);
    background: rgba(255, 255, 255, 0.08);
    pointer-events: none;
  }

  // --- Interactive: drag cursor ---
  &--interactive {
    &.camera-renderer--crop {
      cursor: grab;

      &:active { cursor: grabbing; }
    }
  }
}

@keyframes camera-warmup {
  0%   { filter: blur(8px) grayscale(100%); }
  40%  { filter: blur(4px) grayscale(60%); }
  70%  { filter: blur(2px) grayscale(30%); }
  100% { filter: blur(0px) grayscale(0%); }
}

@keyframes camera-skeleton-pulse {
  0%, 100% { background: #151515; }
  50% { background: #222; }
}
```

- [ ] **Step 2: Create CameraRenderer.jsx**

```jsx
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
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/CameraFeed/CameraRenderer.jsx frontend/src/modules/CameraFeed/CameraRenderer.scss
git commit -m "feat(camera): add CameraRenderer shared core component"
```

---

### Task 5: Rewrite `CameraFeed.jsx` to use `CameraRenderer`

**Files:**
- Modify: `frontend/src/modules/CameraFeed/CameraFeed.jsx` (full rewrite)
- Modify: `frontend/src/modules/CameraFeed/CameraFeed.scss` (strip to card-only styles)

- [ ] **Step 1: Rewrite CameraFeed.jsx**

Replace entire file contents with:

```jsx
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
```

- [ ] **Step 2: Strip CameraFeed.scss to card-only concerns**

Replace entire file contents with:

```scss
// frontend/src/modules/CameraFeed/CameraFeed.scss
// Card-level styles only — rendering styles are in CameraRenderer.scss
// This file is kept for any future card-specific overrides.
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/CameraFeed/CameraFeed.jsx frontend/src/modules/CameraFeed/CameraFeed.scss
git commit -m "refactor(camera): rewrite CameraFeed to use CameraRenderer"
```

---

### Task 6: Simplify `HomeApp.jsx` — remove Live toggle

**Files:**
- Modify: `frontend/src/Apps/HomeApp.jsx`
- Modify: `frontend/src/Apps/HomeApp.scss`

- [ ] **Step 1: Rewrite HomeApp.jsx**

Replace entire file contents with:

```jsx
import { useMemo, useState, useEffect } from 'react';
import './HomeApp.scss';
import { getChildLogger } from '../lib/logging/singleton.js';
import CameraFeed from '../modules/CameraFeed/CameraFeed.jsx';

function HomeApp() {
  const logger = useMemo(() => getChildLogger({ app: 'home' }), []);
  const [cameras, setCameras] = useState([]);

  useEffect(() => {
    fetch('/api/v1/camera')
      .then(r => r.json())
      .then(data => {
        setCameras(data.cameras || []);
        logger.info('home.cameras.loaded', { count: data.cameras?.length });
      })
      .catch(err => logger.error('home.cameras.fetchError', { error: err.message }));
  }, [logger]);

  return (
    <div className="App home-app">
      <div className="home-container">
        <h1>Home</h1>
        <div className="home-cameras">
          {cameras.map(cam => (
            <div key={cam.id} className="home-cameras__card">
              <div className="home-cameras__header">
                <span className="home-cameras__label">{cam.id}</span>
              </div>
              <CameraFeed cameraId={cam.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomeApp;
```

- [ ] **Step 2: Remove toggle button styles from HomeApp.scss**

Replace entire file contents with:

```scss
.home-app {
  .home-container {
    padding: 1rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .home-cameras {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 1rem;

    &__card {
      background: #1a1a1a;
      border-radius: 10px;
      overflow: hidden;
    }

    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
    }

    &__label {
      font-size: 0.85rem;
      color: #aaa;
      text-transform: capitalize;
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/HomeApp.jsx frontend/src/Apps/HomeApp.scss
git commit -m "refactor(home): remove Live toggle, cameras always warmup to live"
```

---

### Task 7: Simplify `CameraOverlay.jsx` to use `CameraRenderer`

**Files:**
- Modify: `frontend/src/modules/CameraFeed/CameraOverlay.jsx`

- [ ] **Step 1: Rewrite CameraOverlay.jsx**

Replace entire file contents with:

```jsx
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/CameraFeed/CameraOverlay.jsx
git commit -m "refactor(camera): simplify CameraOverlay to use CameraRenderer"
```

---

### Task 8: Refactor `CameraViewport.jsx` to use extracted hooks

**Files:**
- Modify: `frontend/src/modules/CameraFeed/CameraViewport.jsx`

- [ ] **Step 1: Replace inline snapshot fetch and HLS setup with hooks**

At the top of the file, replace the imports:

```jsx
// frontend/src/modules/CameraFeed/CameraViewport.jsx
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import usePanZoom from './usePanZoom.js';
import useSnapshotFetch from './useSnapshotFetch.js';
import useHlsStream from './useHlsStream.js';
import CameraControls from './CameraControls.jsx';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './CameraViewport.scss';
```

Remove the `Hls` import (no longer needed directly).

Replace the body of the component — remove the inline snapshot fetch effect (lines 30-53 in original), replace with `useSnapshotFetch`. Remove the inline HLS effect (lines 56-105), replace with `useHlsStream`. The pan/zoom, minimap, hints, and controls all stay.

The key changes inside the component:

```jsx
export default function CameraViewport({ cameraId, mode, snapshotSrc: externalSnapshotSrc, detections = [], onClose }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraViewport', cameraId }), [cameraId]);
  const containerRef = useRef(null);

  // --- Snapshot preview (live warmup) ---
  const { src: fetchedSrc, naturalSize, onImgLoad } = useSnapshotFetch(
    mode === 'live' ? cameraId : null, // only fetch for live mode warmup
    logger,
  );
  const previewSrc = mode === 'live' ? fetchedSrc : null;
  const snapshotSrc = mode === 'snapshot' ? (externalSnapshotSrc || fetchedSrc) : null;

  const [previewPhase, setPreviewPhase] = useState('loading'); // loading | preview | live

  // --- HLS live stream ---
  const liveVideoRef = useRef(null);
  const { ready: liveReady, videoSize } = useHlsStream(
    mode === 'live' ? cameraId : null,
    liveVideoRef,
    logger,
  );

  useEffect(() => {
    if (liveReady) setPreviewPhase('live');
  }, [liveReady]);

  // Content dimensions: prefer video if live+ready, else snapshot natural size
  const [contentDims, setContentDims] = useState({ w: 7680, h: 2160 });
  useEffect(() => {
    if (liveReady && videoSize.w) setContentDims(videoSize);
    else if (naturalSize.w) setContentDims(naturalSize);
  }, [liveReady, videoSize, naturalSize]);

  const isLoading = mode === 'live' ? !liveReady && !previewSrc : !snapshotSrc;

  // ... rest of component unchanged (usePanZoom, hints, minimap, controls, render)
```

The render section replaces the inline `<img>` for preview and `<video>` for live — they stay structurally the same but no longer need inline fetch/HLS logic.

**Full implementation note for the agent:** The render JSX, minimap, hints, keyboard handler, and CameraControls sections are unchanged from the current file. Only the data plumbing (top ~110 lines) changes. Keep `onMediaLoad` for the preview img to update `contentDims` and trigger `previewPhase` transition.

- [ ] **Step 2: Verify no import of `hls.js` remains in CameraViewport.jsx**

Run: `grep -n "import Hls" frontend/src/modules/CameraFeed/CameraViewport.jsx`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/CameraFeed/CameraViewport.jsx
git commit -m "refactor(camera): CameraViewport uses extracted hooks"
```

---

### Task 9: Update Playwright tests

**Files:**
- Modify: `tests/live/flow/home/home-cameras.runtime.test.mjs`

- [ ] **Step 1: Update test selectors for new class names**

The CSS classes changed from `camera-feed` to `camera-renderer`. Update the test:

```js
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const APP_URL = 'http://localhost:3111';
const EXPECTED_CAMERAS = ['driveway-camera', 'doorbell'];

test.describe('Home Cameras', () => {

  test('API returns both cameras', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/camera`);
    expect(res.ok()).toBe(true);

    const data = await res.json();
    const ids = (data.cameras || []).map(c => c.id);

    for (const expected of EXPECTED_CAMERAS) {
      expect(ids, `expected camera "${expected}" in API response`).toContain(expected);
    }
  });

  test('Home page renders a card for each camera', async ({ page }) => {
    await page.goto(`${APP_URL}/home`, { waitUntil: 'domcontentloaded' });

    for (const id of EXPECTED_CAMERAS) {
      const label = page.locator('.home-cameras__label', { hasText: id });
      await expect(label, `expected label for "${id}"`).toBeVisible({ timeout: 10000 });
    }

    const cards = page.locator('.home-cameras__card');
    await expect(cards).toHaveCount(EXPECTED_CAMERAS.length);
  });

  test('each camera card shows a snapshot or an error state', async ({ page }) => {
    await page.goto(`${APP_URL}/home`, { waitUntil: 'domcontentloaded' });

    for (const id of EXPECTED_CAMERAS) {
      const card = page.locator('.home-cameras__card', {
        has: page.locator('.home-cameras__label', { hasText: id }),
      });
      await expect(card, `card for "${id}" should exist`).toBeVisible({ timeout: 10000 });

      const img = card.locator(`.camera-renderer img[alt="${id} snapshot"]`);
      const error = card.locator('.camera-renderer__error');
      await expect(
        img.or(error),
        `camera feed for "${id}" should show snapshot or error`,
      ).toBeVisible({ timeout: 60000 });
    }
  });

  test('Live button is removed from card headers', async ({ page }) => {
    await page.goto(`${APP_URL}/home`, { waitUntil: 'domcontentloaded' });

    // Wait for at least one card to render
    await expect(page.locator('.home-cameras__card').first()).toBeVisible({ timeout: 10000 });

    // No toggle buttons should exist
    const toggles = page.locator('.home-cameras__toggle');
    await expect(toggles).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx playwright test tests/live/flow/home/home-cameras.runtime.test.mjs --reporter=line
```

Expected: all 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/home/home-cameras.runtime.test.mjs
git commit -m "test(camera): update selectors for CameraRenderer consolidation"
```

---

### Task 10: Build, deploy, and verify

- [ ] **Step 1: Build Docker image**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

Expected: build succeeds (no Sass errors, no import errors)

- [ ] **Step 2: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 3: Run Playwright tests against deployed container**

```bash
npx playwright test tests/live/flow/home/home-cameras.runtime.test.mjs --reporter=line
```

Expected: all tests pass

- [ ] **Step 4: Take screenshot to verify visual result**

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:3111/home', { waitUntil: 'domcontentloaded' });
  await page.locator('.camera-renderer img[alt]').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/camera-consolidation-final.png' });
  await browser.close();
  console.log('done');
})();
"
```

Verify: both cameras show warmup → live, fullscreen button visible, mini-nav on doorbell, no "Live" toggle button.

- [ ] **Step 5: Commit any final fixes**
