import React, { useRef, useCallback } from 'react';

/**
 * SingleThumbnailButton - Gesture handler for thumbnail interactions
 * 
 * CRITICAL DESIGN PRINCIPLE:
 * - SEEK operations (onSeek) and ZOOM operations (onZoom) are COMPLETELY SEPARATE
 * - A single gesture triggers EITHER seek OR zoom, NEVER both
 * - onSeek receives the EXACT segmentStart time (not computed from displayTime)
 * - onZoom receives the segment bounds for navigation (NO seek involved)
 * 
 * Gesture mapping:
 * - Left click: SEEK to segmentStart
 * - Right click: ZOOM to segment (no seek)
 * - Long press (touch): ZOOM to segment (no seek)
 * - Click on time label: ZOOM to segment (no seek)
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
  seekTime,      // Explicit seek target (defaults to rangeStart)
  labelTime,     // Time shown on label (for zoom signal)
  telemetryMeta = null,
  onTelemetry
}) {
  const longPressTimeout = useRef(null);
  const longPressTriggered = useRef(false);
  
  // Determine if we have a valid zoom range
  const hasValidRange = enableZoom && 
    Number.isFinite(rangeStart) && 
    Number.isFinite(rangeEnd) && 
    rangeEnd > rangeStart;
  const zoomBounds = hasValidRange ? [rangeStart, rangeEnd] : null;

  /**
   * Resolve the EXACT seek target
   * Priority: explicit seekTime > rangeStart > pos
   */
  const getSeekTarget = useCallback(() => {
    if (Number.isFinite(seekTime)) return seekTime;
    if (Number.isFinite(rangeStart)) return rangeStart;
    return pos;
  }, [seekTime, rangeStart, pos]);

  /**
   * Resolve zoom bounds for this segment
   */
  const getZoomBounds = useCallback(() => {
    if (zoomBounds) return zoomBounds;
    // If no range, create a zoom signal (same start/end triggers auto-expand)
    const anchor = Number.isFinite(labelTime) ? labelTime : pos;
    return [anchor, anchor];
  }, [zoomBounds, labelTime, pos]);

  /**
   * Check if the click target is the time label element
   */
  const isTimeLabel = useCallback((e) => {
    // Check composed path first (handles shadow DOM)
    const path = e.nativeEvent?.composedPath?.() || [];
    for (const node of path) {
      if (node?.classList?.contains('thumbnail-time')) return true;
    }
    // Fallback: traverse up from target
    let el = e.target;
    while (el && el !== e.currentTarget) {
      if (el.classList?.contains('thumbnail-time')) return true;
      el = el.parentElement;
    }
    return false;
  }, []);

  /**
   * Emit telemetry event
   */
  const emitTelemetry = useCallback((phase, extra = {}) => {
    if (typeof onTelemetry !== 'function') return;
    onTelemetry(phase, {
      ...extra,
      telemetryMeta,
      timestamp: Date.now()
    });
  }, [onTelemetry, telemetryMeta]);

  /**
   * Clear long press timer
   */
  const clearLongPress = useCallback(() => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  }, []);

  /**
   * Start long press timer for zoom
   */
  const startLongPress = useCallback(() => {
    if (!enableZoom) return;
    clearLongPress();
    longPressTriggered.current = false;
    longPressTimeout.current = setTimeout(() => {
      longPressTriggered.current = true;
      const bounds = getZoomBounds();
      onZoom?.(bounds);
      emitTelemetry('zoom-trigger', { source: 'long-press', zoomBounds: bounds });
    }, 400);
  }, [enableZoom, clearLongPress, getZoomBounds, onZoom, emitTelemetry]);

  /**
   * Handle pointer down - determines SEEK vs ZOOM
   */
  const handlePointerDown = useCallback((e) => {
    const isTimeLabelClick = isTimeLabel(e);
    const isRightClick = e.button === 2;
    
    // Determine if this is a ZOOM gesture
    const isZoomGesture = enableZoom && (isRightClick || isTimeLabelClick);
    
    emitTelemetry('pointer-down', {
      pointerType: e.pointerType || 'mouse',
      button: e.button,
      isTimeLabelClick,
      isRightClick,
      isZoomGesture,
      seekTarget: getSeekTarget(),
      rangeStart,
      rangeEnd
    });

    if (isZoomGesture) {
      // ZOOM PATH - No seek!
      e.preventDefault();
      e.stopPropagation();
      const bounds = getZoomBounds();
      onZoom?.(bounds);
      emitTelemetry('zoom-trigger', { 
        source: isTimeLabelClick ? 'time-label' : 'right-click', 
        zoomBounds: bounds 
      });
      return;
    }

    // SEEK PATH - No zoom!
    const target = getSeekTarget();
    onSeek?.(target);
    emitTelemetry('seek-trigger', { seekTarget: target });
  }, [enableZoom, isTimeLabel, getSeekTarget, getZoomBounds, onSeek, onZoom, emitTelemetry, rangeStart, rangeEnd]);

  /**
   * Handle context menu (right-click) - triggers ZOOM
   */
  const handleContextMenu = useCallback((e) => {
    if (!enableZoom) return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = getZoomBounds();
    onZoom?.(bounds);
    emitTelemetry('zoom-trigger', { source: 'context-menu', zoomBounds: bounds });
  }, [enableZoom, getZoomBounds, onZoom, emitTelemetry]);

  /**
   * Handle touch start - initiates long press for zoom
   */
  const handleTouchStart = useCallback((e) => {
    if (!enableZoom) return;
    longPressTriggered.current = false;
    startLongPress();
    emitTelemetry('touch-start', { rangeStart, rangeEnd });
  }, [enableZoom, startLongPress, emitTelemetry, rangeStart, rangeEnd]);

  /**
   * Handle touch end - complete SEEK if no long press triggered
   */
  const handleTouchEnd = useCallback((e) => {
    clearLongPress();
    
    // If long press triggered zoom, don't also seek
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      emitTelemetry('touch-end', { action: 'zoom-completed' });
      return;
    }

    // No long press - treat as seek
    const target = getSeekTarget();
    onSeek?.(target);
    emitTelemetry('touch-end', { action: 'seek', seekTarget: target });
  }, [clearLongPress, getSeekTarget, onSeek, emitTelemetry]);

  /**
   * Handle touch cancel
   */
  const handleTouchCancel = useCallback(() => {
    clearLongPress();
    longPressTriggered.current = false;
    emitTelemetry('touch-cancel', {});
  }, [clearLongPress, emitTelemetry]);

  return React.cloneElement(React.Children.only(children), {
    onPointerDown: handlePointerDown,
    onContextMenu: enableZoom ? handleContextMenu : undefined,
    onTouchStart: enableZoom ? handleTouchStart : undefined,
    onTouchEnd: enableZoom ? handleTouchEnd : undefined,
    onTouchCancel: enableZoom ? handleTouchCancel : undefined,
    'data-range-start': zoomBounds ? rangeStart : undefined,
    'data-range-end': zoomBounds ? rangeEnd : undefined,
    'data-state': state,
    role: 'button',
    'aria-label': enableZoom 
      ? 'Seek marker (right-click / long-press / time click to zoom)' 
      : 'Seek marker'
  });
}
