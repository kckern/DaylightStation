import React, { useRef } from 'react';

/**
 * SingleThumbnailButton
 * Props:
 *  - pos (number) seek position (seconds)
 *  - rangeStart (number|null)
 *  - rangeEnd (number|null)
 *  - state: 'active' | 'past' | 'future'
 *  - onSeek(pos)
 *  - onZoom([start,end])
 *  - children (thumbnail content)
 *  - enableZoom (boolean) whether zoom gestures are enabled
 */
export default function SingleThumbnailButton({
  pos,
  rangeStart,
  rangeEnd,
  state,
  onSeek,
  onZoom,
  enableZoom = true,
  children
}) {
  const longPressTimeout = useRef();
  const hasRange = enableZoom && Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeEnd > rangeStart;
  const btnRange = hasRange ? [rangeStart, rangeEnd] : null;

  const clearLong = () => { if (longPressTimeout.current) clearTimeout(longPressTimeout.current); };
  const startLong = () => {
    if (!btnRange) return;
    clearLong();
    longPressTimeout.current = setTimeout(() => onZoom?.(btnRange), 400);
  };

  // Track whether the preceding pointer/mouse down happened on a .thumbnail-time element
  const downOnTimeRef = useRef(false);

  const isTimeElement = (e) => {
    // Prefer composedPath for better shadow / text node support
    const path = e.nativeEvent?.composedPath?.() || [];
    for (const node of path) {
      if (node && node.classList && node.classList.contains('thumbnail-time')) return true;
    }
    let el = e.target;
    while (el && el !== e.currentTarget) {
      if (el.classList && el.classList.contains('thumbnail-time')) return true;
      el = el.parentElement;
    }
    return false;
  };

  const activate = (e) => {
    const timeClick = downOnTimeRef.current || (btnRange && isTimeElement(e));
    downOnTimeRef.current = false; // reset
    if (btnRange && timeClick) {
      e.preventDefault();
      e.stopPropagation();
      onZoom?.(btnRange);
      return;
    }
    onSeek?.(pos);
  };
  const handleContext = (e) => {
    if (!btnRange) return;
    e.preventDefault(); e.stopPropagation(); onZoom?.(btnRange);
  };
  const handleMouseDown = (e) => {
    // Record if the initial down was on .thumbnail-time (for browsers where click target may change)
    if (btnRange && isTimeElement(e)) downOnTimeRef.current = true;
    if (e.button === 2 && btnRange) { e.preventDefault(); e.stopPropagation(); onZoom?.(btnRange); }
  };
  const handleTouchStart = () => startLong();
  const handleTouchEnd = () => clearLong();
  const handleTouchCancel = () => clearLong();

  return React.cloneElement(React.Children.only(children), {
    onPointerDown: activate,
    onContextMenu: btnRange ? handleContext : undefined,
    onMouseDown: btnRange ? handleMouseDown : undefined,
    onTouchStart: btnRange ? handleTouchStart : undefined,
    onTouchEnd: btnRange ? handleTouchEnd : undefined,
    onTouchCancel: btnRange ? handleTouchCancel : undefined,
    'data-range-start': btnRange ? rangeStart : undefined,
    'data-range-end': btnRange ? rangeEnd : undefined,
    'data-state': state,
    role: 'button',
    'aria-label': btnRange ? 'Seek marker (right-click / long-press / time click to zoom)' : 'Seek marker'
  });
}
