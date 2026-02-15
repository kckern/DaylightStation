/**
 * useZoomState - Manages zoom/pan navigation for the fitness player footer
 * 
 * CRITICAL: Zoom operations NEVER trigger seeks.
 * Zoom is NAVIGATION only - it changes what time range is visible,
 * but does NOT change the video playhead position.
 * 
 * State:
 * - zoomRange: [start, end] or null (full timeline)
 * - zoomStack: History for back navigation
 * - Navigation: canStepBack, canStepForward, stepBack, stepForward
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { getDaylightLogger } from '@/lib/logging/singleton.js';

const logger = getDaylightLogger({ context: { component: 'useZoomState' } });

/**
 * Build array of 10 evenly-spaced positions within a range
 */
const buildRangePositions = (start, end) => {
  if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) return [];
  const span = end - start;
  const segments = 10;
  const step = span / segments;
  const arr = new Array(segments);
  for (let i = 0; i < segments; i++) {
    arr[i] = start + step * i;
  }
  return arr;
};

export default function useZoomState({
  baseDuration,
  baseRange = null,
  playerRef,
  onZoomChange,
  disabled = false
}) {
  // Core state
  const [zoomRange, setZoomRange] = useState(null);

  // Refs for state that shouldn't trigger re-renders
  const zoomStackRef = useRef([]);
  const unzoomedPositionsRef = useRef([]);
  const lastViewSnapshotRef = useRef(null);
  const pendingResetRef = useRef(null);

  /**
   * Compute the effective visible range
   */
  const effectiveRange = useMemo(() => {
    // Start with base range or full duration
    let baseRangeValue = [0, baseDuration];
    if (Array.isArray(baseRange) && baseRange.length === 2) {
      const [rs, re] = baseRange.map(parseFloat);
      if (Number.isFinite(rs) && Number.isFinite(re) && re > rs) {
        baseRangeValue = [rs, re];
      }
    }

    // No zoom - return base
    if (!zoomRange) {
      return baseRangeValue;
    }

    // Validate zoom range
    if (!Array.isArray(zoomRange) || zoomRange.length !== 2) {
      return baseRangeValue;
    }

    const [zs, ze] = zoomRange;
    
    // Valid zoom range
    if (Number.isFinite(zs) && Number.isFinite(ze) && ze > zs) {
      return [zs, ze];
    }

    // Zoom signal (equal start/end) - compute a segment
    if (Number.isFinite(zs) && zs === ze) {
      const positions = unzoomedPositionsRef.current || [];
      if (positions.length) {
        const idx = positions.findIndex((p) => Math.abs(p - zs) < 0.51);
        if (idx >= 0) {
          if (idx < positions.length - 1) {
            return [positions[idx], positions[idx + 1]];
          }
          if (idx > 0) {
            return [positions[idx - 1], positions[idx]];
          }
        }
      }
      // Fallback: compute 1/10 segment
      const segment = baseDuration / 10;
      const end = Math.min(zs + segment, baseRangeValue[1]);
      return [zs, end];
    }

    return baseRangeValue;
  }, [baseDuration, baseRange, zoomRange]);

  const [rangeStart, rangeEnd] = effectiveRange;
  const rangeSpan = Math.max(0, rangeEnd - rangeStart);
  const isZoomed = zoomRange != null;

  /**
   * Compute positions for current range
   */
  const rangePositions = useMemo(() => {
    const positions = buildRangePositions(rangeStart, rangeEnd);
    
    // Store unzoomed positions for navigation
    if (!zoomRange) {
      unzoomedPositionsRef.current = positions;
    }
    
    // Store snapshot for zoom stack
    lastViewSnapshotRef.current = {
      positions: positions.slice(),
      range: [rangeStart, rangeEnd]
    };
    
    return positions;
  }, [rangeStart, rangeEnd, zoomRange]);

  /**
   * Clear zoom stack when not zoomed
   */
  useEffect(() => {
    if (!zoomRange) {
      zoomStackRef.current = [];
    }
  }, [zoomRange]);

  /**
   * Clear any pending auto-seek from transport layer when zoom changes
   * This prevents the BUG-06 offset issue
   */
  useEffect(() => {
    if (!playerRef?.current) return;
    
    // Clear pending auto-seek
    if (typeof playerRef.current.clearPendingAutoSeek === 'function') {
      playerRef.current.clearPendingAutoSeek();
      logger.info('cleared-pending-autoseek-on-zoom-change', { zoomRange });
    }
    
    // Clear seek intent on unzoom to prevent stale offset
    if (!zoomRange && typeof playerRef.current.clearSeekIntent === 'function') {
      playerRef.current.clearSeekIntent('zoom-range-reset');
      logger.info('cleared-seek-intent-on-unzoom');
    }
  }, [zoomRange, playerRef]);

  /**
   * Notify parent of zoom state changes
   */
  useEffect(() => {
    onZoomChange?.(isZoomed);
  }, [isZoomed, onZoomChange]);

  /**
   * Cancel any pending zoom reset
   */
  const cancelZoomReset = useCallback(() => {
    if (pendingResetRef.current) {
      clearTimeout(pendingResetRef.current);
      pendingResetRef.current = null;
      logger.info('zoom-reset-cancelled');
    }
  }, []);

  /**
   * Get the current zoom stack snapshot (for navigation)
   */
  const getActiveSnapshot = useCallback(() => {
    const stack = zoomStackRef.current;
    return (stack.length > 0) ? stack[stack.length - 1] : null;
  }, []);

  /**
   * Find current position index within zoom stack
   */
  const resolveCurrentIndex = useCallback(() => {
    const snapshot = getActiveSnapshot();
    const positions = snapshot?.positions || [];
    if (!positions.length) return -1;
    
    const target = Number.isFinite(rangeStart) ? rangeStart : positions[0];
    if (!Number.isFinite(target)) return -1;
    
    // Exact match
    let idx = positions.findIndex((pos) => Math.abs(pos - target) < 0.001);
    if (idx >= 0) return idx;
    
    // Nearest match
    let nearestIdx = 0;
    let nearestDelta = Infinity;
    for (let i = 0; i < positions.length; i++) {
      const delta = Math.abs(positions[i] - target);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearestIdx = i;
      }
    }
    return nearestIdx;
  }, [getActiveSnapshot, rangeStart]);

  /**
   * Set zoom to a specific index within the current zoom stack
   */
  const setZoomToIndex = useCallback((targetIndex) => {
    const snapshot = getActiveSnapshot();
    const positions = snapshot?.positions || [];
    if (!positions.length) return;
    
    const parentEnd = snapshot?.range?.[1];
    const parentRangeEnd = Number.isFinite(parentEnd) ? parentEnd : baseDuration;
    
    const maxIndex = positions.length - 1;
    const clampedIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    
    const start = positions[clampedIndex];
    const nextBoundary = clampedIndex < maxIndex ? positions[clampedIndex + 1] : parentRangeEnd;
    
    if (!Number.isFinite(start) || !Number.isFinite(nextBoundary) || nextBoundary <= start) {
      return;
    }
    
    setZoomRange((prev) => {
      if (prev && Math.abs(prev[0] - start) < 0.001 && Math.abs(prev[1] - nextBoundary) < 0.001) {
        return prev; // No change
      }
      return [start, nextBoundary];
    });
  }, [getActiveSnapshot, baseDuration]);

  /**
   * Zoom IN to a specific range
   * @param {[number, number]} bounds - The range to zoom into
   */
  const zoomIn = useCallback((bounds) => {
    if (disabled) return;
    if (!Array.isArray(bounds) || bounds.length !== 2) return;

    const [start, end] = bounds;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;

    // Check for duplicate
    if (zoomRange &&
        Math.abs((zoomRange[0] ?? 0) - start) < 0.0001 &&
        Math.abs((zoomRange[1] ?? 0) - end) < 0.0001) {
      logger.info('zoom-request-duplicate', { bounds, currentZoom: zoomRange });
      return;
    }

    // Cancel any pending zoom reset - user is actively navigating
    cancelZoomReset();

    logger.info('zoom-in', { bounds, currentZoom: zoomRange, currentRange: [rangeStart, rangeEnd] });
    
    // Push current view to stack
    const snapshot = lastViewSnapshotRef.current;
    if (snapshot) {
      zoomStackRef.current = [
        ...zoomStackRef.current,
        {
          positions: snapshot.positions.slice(),
          range: snapshot.range.slice()
        }
      ];
    }
    
    setZoomRange(bounds);
  }, [disabled, zoomRange, rangeStart, rangeEnd, cancelZoomReset]);

  /**
   * Zoom OUT completely (back to full timeline)
   */
  const zoomOut = useCallback(() => {
    logger.info('zoom-out', { currentZoom: zoomRange, stackSize: zoomStackRef.current.length });
    zoomStackRef.current = [];
    setZoomRange(null);
  }, [zoomRange]);

  /**
   * Schedule a zoom reset after a delay (e.g., after seek completes)
   * @param {number} delayMs - Delay before resetting (default 800ms)
   */
  const scheduleZoomReset = useCallback((delayMs = 800) => {
    if (!zoomRange) return; // Already at base level
    cancelZoomReset();
    logger.info('zoom-reset-scheduled', { delayMs, currentZoom: zoomRange });
    pendingResetRef.current = setTimeout(() => {
      logger.info('zoom-reset-executing');
      zoomStackRef.current = [];
      setZoomRange(null);
      pendingResetRef.current = null;
    }, delayMs);
  }, [zoomRange, cancelZoomReset]);

  /**
   * Step backward in zoom view (shift left)
   */
  const stepBackward = useCallback(() => {
    if (disabled || !isZoomed) return;

    // Cancel any pending zoom reset - user is actively navigating
    cancelZoomReset();

    const idx = resolveCurrentIndex();
    logger.info('zoom-step-backward', {
      currentIndex: idx,
      stackSize: zoomStackRef.current.length,
      currentZoom: zoomRange
    });

    if (idx <= 0) return;
    setZoomToIndex(idx - 1);
  }, [disabled, isZoomed, resolveCurrentIndex, setZoomToIndex, zoomRange, cancelZoomReset]);

  /**
   * Step forward in zoom view (shift right)
   */
  const stepForward = useCallback(() => {
    if (disabled || !isZoomed) return;

    // Cancel any pending zoom reset - user is actively navigating
    cancelZoomReset();

    const snapshot = getActiveSnapshot();
    const positions = snapshot?.positions || [];
    const idx = resolveCurrentIndex();

    logger.info('zoom-step-forward', {
      currentIndex: idx,
      maxIndex: positions.length - 1,
      currentZoom: zoomRange
    });

    if (idx < 0 || idx >= positions.length - 1) return;
    setZoomToIndex(idx + 1);
  }, [disabled, isZoomed, getActiveSnapshot, resolveCurrentIndex, setZoomToIndex, zoomRange, cancelZoomReset]);

  /**
   * Compute navigation capabilities
   */
  const navigationState = useMemo(() => {
    if (!isZoomed || disabled) {
      return { canStepBackward: false, canStepForward: false };
    }
    
    const snapshot = getActiveSnapshot();
    const positions = snapshot?.positions || [];
    if (!positions.length) {
      return { canStepBackward: false, canStepForward: false };
    }
    
    const idx = resolveCurrentIndex();
    return {
      canStepBackward: idx > 0,
      canStepForward: idx >= 0 && idx < positions.length - 1
    };
  }, [isZoomed, disabled, getActiveSnapshot, resolveCurrentIndex]);

  /**
   * Compute zoom overlay info for progress bar
   */
  const zoomOverlay = useMemo(() => {
    if (!isZoomed || !Number.isFinite(baseDuration) || baseDuration <= 0) {
      return null;
    }
    
    const start = Number.isFinite(rangeStart) ? rangeStart : 0;
    const end = Number.isFinite(rangeEnd) ? rangeEnd : 0;
    const span = end - start;
    
    if (!Number.isFinite(span) || span <= 0) return null;
    if (span >= baseDuration * 0.98) return null; // Basically full view
    
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const leftUnit = clamp01(start / baseDuration);
    const rightUnit = clamp01(end / baseDuration);
    const widthUnit = Math.max(0, rightUnit - leftUnit);
    
    return { 
      leftPct: leftUnit * 100, 
      widthPct: widthUnit * 100 
    };
  }, [isZoomed, baseDuration, rangeStart, rangeEnd]);

  return {
    // State
    isZoomed,
    zoomRange,
    effectiveRange,
    rangeStart,
    rangeEnd,
    rangeSpan,
    rangePositions,
    zoomOverlay,
    
    // Navigation state
    canStepBackward: navigationState.canStepBackward,
    canStepForward: navigationState.canStepForward,
    
    // Actions (NONE of these trigger seeks!)
    zoomIn,           // Zoom into a range
    zoomOut,          // Zoom out to full timeline
    stepBackward,     // Pan zoom window left
    stepForward,      // Pan zoom window right

    // Auto-reset after seek
    scheduleZoomReset,  // Schedule zoom reset after delay
    cancelZoomReset,    // Cancel pending zoom reset
  };
}
