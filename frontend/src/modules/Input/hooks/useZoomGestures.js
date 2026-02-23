import { useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useZoomGestures' });
  return _logger;
}

/**
 * useZoomGestures — pointer-event-based gesture handler for zoom/pan.
 *
 * @param {React.RefObject} ref - element to attach listeners to
 * @param {object} opts
 * @param {boolean} opts.enabled - only listen when true
 * @param {(x: number, y: number) => void} opts.onTap - single tap at (x%, y%)
 * @param {(dx: number, dy: number) => void} opts.onPan - drag delta in % of element
 * @param {(scaleDelta: number, cx: number, cy: number) => void} opts.onPinch - scale multiplier + center
 */
export default function useZoomGestures(ref, { enabled, onTap, onPan, onPinch }) {
  const pointersRef = useRef(new Map());
  const dragStartRef = useRef(null);
  const pinchStartDistRef = useRef(null);
  const movedRef = useRef(false);

  const getRelative = useCallback((e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const pointers = pointersRef.current;

    function onPointerDown(e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      movedRef.current = false;

      if (pointers.size === 1) {
        dragStartRef.current = { x: e.clientX, y: e.clientY };
      }
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchStartDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        dragStartRef.current = null;
      }
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const rect = el.getBoundingClientRect();

      if (pointers.size === 1 && dragStartRef.current) {
        const dx = (e.clientX - dragStartRef.current.x) / rect.width;
        const dy = (e.clientY - dragStartRef.current.y) / rect.height;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          movedRef.current = true;
          logger().sampled('gesture-pan', { dx, dy }, { maxPerMinute: 30, aggregate: true });
          onPan(-dx, -dy);
          dragStartRef.current = { x: e.clientX, y: e.clientY };
        }
      }

      if (pointers.size === 2 && pinchStartDistRef.current) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const scaleDelta = dist / pinchStartDistRef.current;
        const cx = ((pts[0].x + pts[1].x) / 2 - rect.left) / rect.width;
        const cy = ((pts[0].y + pts[1].y) / 2 - rect.top) / rect.height;
        movedRef.current = true;
        logger().sampled('gesture-pinch', { scaleDelta, cx, cy }, { maxPerMinute: 30, aggregate: true });
        onPinch(scaleDelta, cx, cy);
        pinchStartDistRef.current = dist;
      }
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);

      if (pointers.size === 0) {
        if (!movedRef.current) {
          const { x, y } = getRelative(e);
          logger().debug('gesture-tap', { x, y });
          onTap(x, y);
        }
        dragStartRef.current = null;
        pinchStartDistRef.current = null;
      }

      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        dragStartRef.current = { x: remaining.x, y: remaining.y };
        pinchStartDistRef.current = null;
      }
    }

    function onPointerCancel(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        dragStartRef.current = null;
        pinchStartDistRef.current = null;
      }
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    logger().info('gestures-attached');

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      pointers.clear();
      logger().info('gestures-detached');
    };
  }, [ref, enabled, onTap, onPan, onPinch, getRelative]);
}
