import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import SingleThumbnailButton from './SingleThumbnailButton.jsx';
import usePlayerController from '../Player/usePlayerController.js';

/**
 * FitnessPlayerFooterSeekThumbnails
 * Props:
 *  - duration (seconds)
 *  - currentTime (seconds)
 *  - fallbackDuration (seconds) optional default if duration invalid
 *  - onSeek(seconds) (optional external handler)
 *  - seekButtons (React nodes)
 *  - range: [startSeconds, endSeconds] optional; defines the time window represented by the thumbnails & progress bar
 *           Defaults to [0, duration] (or fallback) when omitted/invalid. All thumbnail positions are clamped to this window.
 */
const FitnessPlayerFooterSeekThumbnails = ({ duration, currentTime, isSeeking = false, fallbackDuration = 600, onSeek, seekButtons, playerRef, range, onZoomChange, onZoomReset }) => {
  // ---------- Helpers ----------
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const percentOf = (t, total) => total > 0 ? clamp01(t / total) : 0;
  const BASE_PENDING_TOLERANCE = 0.05;  // keeps optimistic bar until near actual
  const CLEAR_PENDING_TOLERANCE = 0.25; // when to clear internal pending state

  const baseDurationProp = (duration && !isNaN(duration) ? duration : fallbackDuration);

  // Zoom state: null = not zoomed, [start,end] = zoomed range
  const [zoomRange, setZoomRange] = useState(null);
  const effectiveRange = useMemo(() => {
    if (zoomRange && Array.isArray(zoomRange) && zoomRange.length === 2) return zoomRange;
    if (Array.isArray(range) && range.length === 2) {
      const [rs, re] = range.map(parseFloat);
      if (Number.isFinite(rs) && Number.isFinite(re) && re > rs) return [rs, re];
    }
    return [0, baseDurationProp];
  }, [zoomRange, range, baseDurationProp]);
  const [rangeStart, rangeEnd] = effectiveRange;
  const rangeSpan = Math.max(0, rangeEnd - rangeStart);
  const isZoomed = !!zoomRange;

  // Expose isZoomed and resetZoom to parent if needed
  useEffect(() => { onZoomChange?.(isZoomed); }, [isZoomed, onZoomChange]);
  useEffect(() => { if (onZoomReset) onZoomReset.current = () => setZoomRange(null); }, [onZoomReset]);
  const { seek } = usePlayerController(playerRef);

  // ---------- Intent State ----------
  const [pendingTime, setPendingTime] = useState(null);   // committed seek awaiting media time
  const [previewTime, setPreviewTime] = useState(null);   // hover / drag preview (only while seeking)
  const rafRef = useRef(); // for throttling preview updates

  // ---------- Seek Positions & Total Duration ----------
  // Each button can have its own range: data-range-start, data-range-end
  const seekMeta = useMemo(() => {
    if (!seekButtons) return { positions: [], total: rangeSpan, ranges: [] };
    const positions = [];
    const ranges = [];
    React.Children.forEach(seekButtons, (child) => {
      if (!React.isValidElement(child)) return;
      const raw = parseFloat(child.props['data-pos']);
      let rStart = child.props['data-range-start'], rEnd = child.props['data-range-end'];
      rStart = Number.isFinite(parseFloat(rStart)) ? parseFloat(rStart) : null;
      rEnd = Number.isFinite(parseFloat(rEnd)) ? parseFloat(rEnd) : null;
      if (Number.isFinite(raw)) {
        if (raw >= rangeStart && raw <= rangeEnd) positions.push(raw);
        if (rStart != null && rEnd != null && rEnd > rStart) ranges.push([rStart, rEnd]);
        else ranges.push(null);
      } else {
        ranges.push(null);
      }
    });
      positions.sort((a,b)=>a-b);
      return { positions, total: rangeSpan, ranges };
    }, [seekButtons, rangeStart, rangeEnd, rangeSpan]);

  // ---------- Display Time Resolution ----------
  const displayTime = useMemo(() => {
    if (pendingTime != null && currentTime < pendingTime - BASE_PENDING_TOLERANCE) return pendingTime;
    if (isSeeking && previewTime != null) return previewTime;
    return currentTime;
  }, [pendingTime, previewTime, currentTime, isSeeking]);

  // ---------- Active Thumbnail (binary search) ----------
  const activePos = useMemo(() => {
    const arr = seekMeta.positions;
    if (!arr.length) return null;
    let lo = 0, hi = arr.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= displayTime) { ans = arr[mid]; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }, [seekMeta.positions, displayTime]);

  // ---------- Effects ----------
  useEffect(() => {
    if (pendingTime == null) return;
    if (currentTime >= pendingTime - CLEAR_PENDING_TOLERANCE) {
      setPendingTime(null);
    }
  }, [currentTime, pendingTime]);

  // ---------- Core Utilities ----------
  const positionToSeconds = useCallback((clientX, rect) => {
    if (!rect.width) return rangeStart;
    const clickX = clientX - rect.left;
    const pct = clamp01(clickX / rect.width);
    return rangeStart + pct * rangeSpan;
  }, [rangeStart, rangeSpan]);

  const commit = useCallback((t) => {
    setPendingTime(t);
    seek(t);
    onSeek?.(t);
  }, [seek, onSeek]);

  const updatePreview = useCallback((clientX, rect) => {
    if (!isSeeking) return; // only show preview while in seeking phase
    const t = positionToSeconds(clientX, rect);
    setPreviewTime(t);
  }, [isSeeking, positionToSeconds]);

  const updatePreviewThrottled = useCallback((clientX, rect) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => updatePreview(clientX, rect));
  }, [updatePreview]);

  // ---------- Event Handlers ----------
  const handleClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    commit(positionToSeconds(e.clientX, rect));
  }, [positionToSeconds, commit]);

  const handlePointerMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    updatePreviewThrottled(clientX, rect);
  }, [updatePreviewThrottled]);

  const handleLeave = useCallback(() => { setPreviewTime(null); }, []);

  const handleTouchEnd = useCallback(() => {
    if (previewTime != null) commit(previewTime);
    setPreviewTime(null);
  }, [previewTime, commit]);

  // ---------- Render Thumbnails ----------
  // Long press detection
  const longPressTimeout = useRef();
  const handleLongPressStart = (rangeVal) => {
    if (!rangeVal) return;
    longPressTimeout.current = setTimeout(() => setZoomRange(rangeVal), 400);
  };
  const handleLongPressEnd = () => {
    if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
  };

  const renderedSeekButtons = useMemo(() => {
    if (!seekButtons) return null;
    return React.Children.map(seekButtons, (child) => {
      if (!React.isValidElement(child)) return child;
      const raw = parseFloat(child.props['data-pos']);
      if (!Number.isFinite(raw)) return child;
      let rStart = child.props['data-range-start'], rEnd = child.props['data-range-end'];
      rStart = Number.isFinite(parseFloat(rStart)) ? parseFloat(rStart) : null;
      rEnd = Number.isFinite(parseFloat(rEnd)) ? parseFloat(rEnd) : null;
      const state = activePos != null && raw === activePos ? 'active' : (activePos != null && raw < activePos ? 'past' : 'future');
      return (
        <SingleThumbnailButton
          key={raw + ':' + rStart + ':' + rEnd}
          pos={raw}
          rangeStart={rStart}
          rangeEnd={rEnd}
          state={state}
          onSeek={commit}
          onZoom={setZoomRange}
        >
          {child}
        </SingleThumbnailButton>
      );
    });
  }, [seekButtons, activePos, commit]);

  const progressPct = useMemo(() => {
    if (!rangeSpan) return 0;
    const normalized = (displayTime - rangeStart) / rangeSpan;
    return clamp01(normalized) * 100;
  }, [displayTime, rangeStart, rangeSpan]);
  const showingIntent = pendingTime != null || (isSeeking && previewTime != null);

  // Removed global capture listeners; rely on per-thumbnail handlers for zoom.

  return (
    <div className="footer-seek-thumbnails">
      <div
        className="progress-bar"
        data-intent={showingIntent ? '1' : '0'}
        onPointerDown={handleClick}
        onMouseMove={handlePointerMove}
        onMouseLeave={handleLeave}
        onTouchStart={handlePointerMove}
        onTouchMove={handlePointerMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="progress" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="seek-thumbnails">
        {renderedSeekButtons}
      </div>
    </div>
  );
}

export default FitnessPlayerFooterSeekThumbnails;
