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
  children,
  globalStart = 0,
  globalEnd = null,
  fallbackZoomWindow = 120 // seconds
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

  const isTimeElement = (e) => {
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

  const handlePointerDown = (e) => {
    const timeElt = isTimeElement(e);
    const reason = timeElt ? 'time-label' : (e.button === 2 ? 'right-button' : 'seek-default');
    /* eslint-disable no-console */
    console.log('[SingleThumbnailButton] pointerDown', {
      pos,
      btnRange,
      button: e.button,
      reason,
      targetClass: e.target?.className,
      hasRange,
      timeElt
    });
    /* eslint-enable no-console */
    if ((e.button === 2 || timeElt) && enableZoom) {
      e.preventDefault();
      e.stopPropagation();
      if (btnRange) {
        console.log('[SingleThumbnailButton] -> ZOOM (explicit range)', btnRange);
        onZoom?.(btnRange);
      } else if (timeElt) {
        // Fallback: derive a window centered on pos
        const durationEnd = Number.isFinite(globalEnd) ? globalEnd : (pos + fallbackZoomWindow);
        const half = fallbackZoomWindow / 2;
        let zs = Math.max(globalStart || 0, pos - half);
        let ze = Math.min(durationEnd, pos + half);
        if (ze - zs < 5) { // ensure minimal span
          if (ze + (5 - (ze - zs)) <= durationEnd) {
            ze = ze + (5 - (ze - zs));
          } else if (zs - (5 - (ze - zs)) >= (globalStart || 0)) {
            zs = zs - (5 - (ze - zs));
          } else {
            // fallback: stretch to at least 1s
            ze = Math.min(durationEnd, zs + 1);
          }
        }
        if (ze > zs) {
          const fallbackRange = [zs, ze];
            console.log('[SingleThumbnailButton] -> ZOOM (fallback range)', fallbackRange);
            onZoom?.(fallbackRange);
        } else {
          console.log('[SingleThumbnailButton] (fallback zoom aborted) invalid window', { zs, ze });
        }
      }
      return;
    }
    console.log('[SingleThumbnailButton] -> SEEK', pos);
    onSeek?.(pos);
  };
  const handleContext = (e) => {
    if (!btnRange) return; e.preventDefault(); e.stopPropagation(); onZoom?.(btnRange);
  };
  const handleTouchStart = () => startLong();
  const handleTouchEnd = () => clearLong();
  const handleTouchCancel = () => clearLong();

  return React.cloneElement(React.Children.only(children), {
    // Immediate pointerDown activation; if on the time label we zoom & stop propagation
    onPointerDown: handlePointerDown,
    onContextMenu: btnRange ? handleContext : undefined,
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
