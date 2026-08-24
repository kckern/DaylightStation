import { useCallback, useEffect, useRef } from 'react';

// Shared press-and-hold: hold ≥ holdMs → onLongPress (and suppress the tap);
// quick release → onTap; drift past moveCancelPx → cancel. Mirrors the inlined
// pattern in producer/LibraryBrowser.jsx, extracted for the settings chip seam.
export function useLongPress(onLongPress, { holdMs = 550, moveCancelPx = 10, onTap } = {}) {
  const timer = useRef(null);
  const start = useRef(null);
  const fired = useRef(false);
  const suppressClick = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const onPointerDown = useCallback((e) => {
    fired.current = false;
    start.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    clear();
    timer.current = setTimeout(() => { fired.current = true; suppressClick.current = true; timer.current = null; onLongPress?.(); }, holdMs);
  }, [clear, holdMs, onLongPress]);

  const onPointerMove = useCallback((e) => {
    if (!start.current || timer.current === null) return;
    const dx = (e.clientX ?? 0) - start.current.x;
    const dy = (e.clientY ?? 0) - start.current.y;
    if (Math.hypot(dx, dy) > moveCancelPx) clear();
  }, [clear, moveCancelPx]);

  const onPointerUp = useCallback(() => {
    const wasArmed = timer.current !== null;
    clear();
    if (!fired.current && wasArmed) { suppressClick.current = true; onTap?.(); }
  }, [clear, onTap]);

  const onPointerLeave = clear;
  const onPointerCancel = clear;
  const onKeyDown = useCallback((e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    e.preventDefault();
    fired.current = false;
    clear();
    timer.current = setTimeout(() => { fired.current = true; suppressClick.current = true; timer.current = null; onLongPress?.(); }, holdMs);
  }, [clear, holdMs, onLongPress]);

  const onKeyUp = useCallback((e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const wasArmed = timer.current !== null;
    clear();
    if (!fired.current && wasArmed) { suppressClick.current = true; onTap?.(); }
  }, [clear, onTap]);

  const onClick = useCallback(() => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onTap?.(); // assistive technology may dispatch click without pointer/key events
  }, [onTap]);

  useEffect(() => clear, [clear]);
  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel, onKeyDown, onKeyUp, onClick };
}
