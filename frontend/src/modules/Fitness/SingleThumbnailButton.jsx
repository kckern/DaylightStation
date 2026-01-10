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
  *  - seekTime (number) overrides the seek target (defaults to rangeStart/pos)
  *  - labelTime (number) anchor used when tapping the time label to zoom
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
  fallbackZoomWindow = 120, // seconds
  seekTime,
  labelTime,
  telemetryMeta = null,
  onTelemetry
}) {
  const longPressTimeout = useRef();
  const hasRange = enableZoom && Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeEnd > rangeStart;
  const btnRange = hasRange ? [rangeStart, rangeEnd] : null;

  const resolveSeekTime = () => {
    if (Number.isFinite(seekTime)) return seekTime;
    if (btnRange) return btnRange[0];
    if (Number.isFinite(rangeStart)) return rangeStart;
    return pos;
  };

  const resolveRangeAnchor = () => {
    if (btnRange) return btnRange[0];
    if (Number.isFinite(rangeStart)) return rangeStart;
    if (Number.isFinite(seekTime)) return seekTime;
    return pos;
  };

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

  const emitTelemetry = (phase, extra = {}) => {
    if (typeof onTelemetry !== 'function') return;
    onTelemetry(phase, {
      ...extra,
      telemetryMeta,
      timestamp: Date.now()
    });
  };

  const handlePointerDown = (e) => {
    const timeElt = isTimeElement(e);
    const reason = timeElt ? 'time-label' : (e.button === 2 ? 'right-button' : 'seek-default');
    const targetSeek = resolveSeekTime();
    const anchor = resolveRangeAnchor();
    // DEBUG: Trace what SingleThumbnailButton is sending
    console.log('[SingleThumbnailButton]', {
      targetSeek,
      anchor,
      seekTime,
      rangeStart,
      rangeEnd,
      pos,
      btnRange,
      reason
    });
    emitTelemetry('pointer-down', {
      pointerType: e.pointerType || (e.touches ? 'touch' : 'mouse'),
      button: typeof e.button === 'number' ? e.button : null,
      reason,
      timeElement: timeElt,
      targetSeek,
      anchor,
      pos,
      rangeStart,
      rangeEnd,
      labelTime
    });
    if ((e.button === 2 || timeElt) && enableZoom) {
      e.preventDefault();
      e.stopPropagation();
      if (btnRange) {
        onZoom?.(btnRange);
        emitTelemetry('zoom-trigger', { source: reason, zoomBounds: btnRange });
      } else if (timeElt) {
        const anchor = Number.isFinite(labelTime) ? labelTime : pos;
        const zoomSignal = [anchor, anchor];
        onZoom?.(zoomSignal);
        emitTelemetry('zoom-trigger', { source: reason, zoomBounds: zoomSignal });
      }
      return;
    }
    onSeek?.(targetSeek, anchor);
    emitTelemetry('seek-requested', {
      targetSeek,
      anchor
    });
  };
  const handleContext = (e) => {
    if (!btnRange) return;
    e.preventDefault();
    e.stopPropagation();
    onZoom?.(btnRange);
    emitTelemetry('context-zoom', { zoomBounds: btnRange });
  };
  const handleTouchStart = () => {
    startLong();
    emitTelemetry('touch-start', { rangeStart, rangeEnd });
  };
  const handleTouchEnd = () => {
    clearLong();
    emitTelemetry('touch-end', { rangeStart, rangeEnd });
  };
  const handleTouchCancel = () => {
    clearLong();
    emitTelemetry('touch-cancel', { rangeStart, rangeEnd });
  };

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
