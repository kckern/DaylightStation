// frontend/src/modules/CameraFeed/usePanZoom.js
import { useReducer, useCallback, useRef, useEffect } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PAN_STEP = 50;
const ZOOM_STEP = 0.25;
const MOMENTUM_FRICTION = 0.92;
const MOMENTUM_MIN_VELOCITY = 0.5;

function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

function reducer(state, action) {
  switch (action.type) {
    case 'pan': {
      const { dx, dy, bounds } = action;
      return {
        ...state,
        x: clamp(state.x + dx, bounds.minX, bounds.maxX),
        y: clamp(state.y + dy, bounds.minY, bounds.maxY),
      };
    }
    case 'zoom': {
      const { delta, cx, cy, containerW, containerH, contentW, contentH } = action;
      const newZoom = clamp(state.zoom + delta, MIN_ZOOM, MAX_ZOOM);
      if (newZoom === state.zoom) return state;

      // Zoom toward cursor: adjust translation so the point under the cursor stays fixed
      const scale = newZoom / state.zoom;
      const newX = cx - scale * (cx - state.x);
      const newY = cy - scale * (cy - state.y);

      const bounds = calcBounds(newZoom, containerW, containerH, contentW, contentH);
      return {
        x: clamp(newX, bounds.minX, bounds.maxX),
        y: clamp(newY, bounds.minY, bounds.maxY),
        zoom: newZoom,
      };
    }
    case 'set':
      return { ...state, ...action.values };
    case 'reset':
      return { x: 0, y: 0, zoom: MIN_ZOOM };
    default:
      return state;
  }
}

function calcBounds(zoom, containerW, containerH, contentW, contentH) {
  const scaledW = contentW * zoom;
  const scaledH = contentH * zoom;
  const maxPanX = Math.max(0, (scaledW - containerW) / 2);
  const maxPanY = Math.max(0, (scaledH - containerH) / 2);
  return { minX: -maxPanX, maxX: maxPanX, minY: -maxPanY, maxY: maxPanY };
}

/**
 * Pan/zoom hook for camera viewport.
 *
 * @param {Object} options
 * @param {React.RefObject} options.containerRef - ref to the overflow:hidden container
 * @param {number} options.contentWidth - natural width of the image/video
 * @param {number} options.contentHeight - natural height of the image/video
 * @returns {{ x, y, zoom, handlers, reset, zoomIn, zoomOut, MIN_ZOOM, MAX_ZOOM, lastZoomTime }}
 */
export default function usePanZoom({ containerRef, contentWidth = 1, contentHeight = 1 }) {
  const [state, dispatch] = useReducer(reducer, { x: 0, y: 0, zoom: MIN_ZOOM });
  const dragRef = useRef(null);
  const momentumRef = useRef(null);
  const lastZoomTime = useRef(0);

  const getDims = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { containerW: 1, containerH: 1, contentW: contentWidth, contentH: contentHeight };
    return {
      containerW: el.clientWidth,
      containerH: el.clientHeight,
      contentW: contentWidth,
      contentH: contentHeight,
    };
  }, [containerRef, contentWidth, contentHeight]);

  const getBounds = useCallback(() => {
    const d = getDims();
    return calcBounds(state.zoom, d.containerW, d.containerH, d.contentW, d.contentH);
  }, [getDims, state.zoom]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    if (momentumRef.current) cancelAnimationFrame(momentumRef.current);
    dragRef.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, lastTime: Date.now(), vx: 0, vy: 0 };
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    const now = Date.now();
    const dt = Math.max(now - dragRef.current.lastTime, 1);
    dragRef.current.vx = dx / dt * 16;
    dragRef.current.vy = dy / dt * 16;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    dragRef.current.lastTime = now;
    dispatch({ type: 'pan', dx, dy, bounds: getBounds() });
  }, [getBounds]);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    const { vx, vy } = dragRef.current;
    dragRef.current = null;

    if (Math.abs(vx) > MOMENTUM_MIN_VELOCITY || Math.abs(vy) > MOMENTUM_MIN_VELOCITY) {
      let mvx = vx, mvy = vy;
      const tick = () => {
        mvx *= MOMENTUM_FRICTION;
        mvy *= MOMENTUM_FRICTION;
        if (Math.abs(mvx) < MOMENTUM_MIN_VELOCITY && Math.abs(mvy) < MOMENTUM_MIN_VELOCITY) return;
        dispatch({ type: 'pan', dx: mvx, dy: mvy, bounds: getBounds() });
        momentumRef.current = requestAnimationFrame(tick);
      };
      momentumRef.current = requestAnimationFrame(tick);
    }
  }, [getBounds]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const d = getDims();
    dispatch({ type: 'zoom', delta, cx, cy, ...d });
    lastZoomTime.current = Date.now();
  }, [containerRef, getDims]);

  const onDoubleClick = useCallback((e) => {
    if (state.zoom > MIN_ZOOM) {
      dispatch({ type: 'reset' });
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const d = getDims();
      dispatch({ type: 'zoom', delta: 1.0, cx, cy, ...d });
    }
  }, [state.zoom, containerRef, getDims]);

  useEffect(() => {
    const handleKey = (e) => {
      const bounds = getBounds();
      const d = getDims();
      switch (e.key) {
        case 'ArrowLeft': dispatch({ type: 'pan', dx: PAN_STEP, dy: 0, bounds }); break;
        case 'ArrowRight': dispatch({ type: 'pan', dx: -PAN_STEP, dy: 0, bounds }); break;
        case 'ArrowUp': dispatch({ type: 'pan', dx: 0, dy: PAN_STEP, bounds }); break;
        case 'ArrowDown': dispatch({ type: 'pan', dx: 0, dy: -PAN_STEP, bounds }); break;
        case '+': case '=': dispatch({ type: 'zoom', delta: ZOOM_STEP, cx: 0, cy: 0, ...d }); lastZoomTime.current = Date.now(); break;
        case '-': case '_': dispatch({ type: 'zoom', delta: -ZOOM_STEP, cx: 0, cy: 0, ...d }); lastZoomTime.current = Date.now(); break;
        case 'Home': dispatch({ type: 'reset' }); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [getBounds, getDims]);

  useEffect(() => () => {
    if (momentumRef.current) cancelAnimationFrame(momentumRef.current);
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const zoomIn = useCallback(() => {
    const d = getDims();
    dispatch({ type: 'zoom', delta: ZOOM_STEP, cx: 0, cy: 0, ...d });
    lastZoomTime.current = Date.now();
  }, [getDims]);
  const zoomOut = useCallback(() => {
    const d = getDims();
    dispatch({ type: 'zoom', delta: -ZOOM_STEP, cx: 0, cy: 0, ...d });
    lastZoomTime.current = Date.now();
  }, [getDims]);

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onWheel,
    onDoubleClick,
  };

  return { x: state.x, y: state.y, zoom: state.zoom, lastZoomTime, handlers, reset, zoomIn, zoomOut, MIN_ZOOM, MAX_ZOOM };
}
