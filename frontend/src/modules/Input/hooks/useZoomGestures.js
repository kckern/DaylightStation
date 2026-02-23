import { useEffect, useRef, useCallback } from 'react';

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
        onPinch(scaleDelta, cx, cy);
        pinchStartDistRef.current = dist;
      }
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);

      if (pointers.size === 0) {
        if (!movedRef.current) {
          const { x, y } = getRelative(e);
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

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      pointers.clear();
    };
  }, [ref, enabled, onTap, onPan, onPinch, getRelative]);
}
