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
 *  - commitRef: optional ref to expose commit function for external use
 */
const FitnessPlayerFooterSeekThumbnails = ({ duration, currentTime, isSeeking = false, fallbackDuration = 600, onSeek, seekButtons, playerRef, range, onZoomChange, onZoomReset, currentItem, generateThumbnailUrl, commitRef, getTimeRef }) => {
  // ---------- Helpers ----------
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const percentOf = (t, total) => total > 0 ? clamp01(t / total) : 0;
  const BASE_PENDING_TOLERANCE = 0.05;  // keeps optimistic bar until near actual
  const CLEAR_PENDING_TOLERANCE = 0.25; // when to clear internal pending state
  // Hoisted time formatter (used in synthetic thumbnail generation)
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2,'0');
  }

  const baseDurationProp = (duration && !isNaN(duration) ? duration : fallbackDuration);

  // Zoom state: null = not zoomed, [start,end] = zoomed range
  // Special anchor signal: [p,p] means user tapped time-label at position p and we should create
  // a synthetic 10-thumbnail window starting at that anchor using original thumbnail spacing.
  const [zoomRange, setZoomRange] = useState(null);
  // Preserve the last un-zoomed thumbnail positions so an anchor signal [p,p] can expand to its neighbor
  const unzoomedPositionsRef = useRef([]);

  // Capture original thumbnail positions (stable across zooms) for synthetic generation
  // Helper to derive a 10-point array for a given [start,end]
  const buildRangePositions = useCallback((start, end) => {
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) return [];
    const span = end - start;
    const arr = [];
    for (let i = 0; i < 11; i++) {
      const frac = i / 9.5; // 0..1
      arr.push(start + frac * span);
    }
    //remove last item because it duplicates end time
    arr.pop();
    return arr;
  }, []);
  const effectiveRange = useMemo(() => {
    // Base (non-zoom) range resolution
    let baseRange = [0, baseDurationProp];
    if (Array.isArray(range) && range.length === 2) {
      const [rs, re] = range.map(parseFloat);
      if (Number.isFinite(rs) && Number.isFinite(re) && re > rs) baseRange = [rs, re];
    }
    if (!zoomRange) return baseRange;
    if (!Array.isArray(zoomRange) || zoomRange.length !== 2) return baseRange;
    const [zs, ze] = zoomRange;
    // Normal zoom (explicit range)
    if (Number.isFinite(zs) && Number.isFinite(ze) && ze > zs) return [zs, ze];
    // Anchor signal (zs === ze). We expand to the next (preferred) or previous base position.
    if (Number.isFinite(zs) && zs === ze) {
      const basePositions = unzoomedPositionsRef.current || [];
      if (basePositions.length) {
        // Find index of anchor within tolerance
        const idx = basePositions.findIndex(p => Math.abs(p - zs) < 0.51); // ~0.5s tolerance
        if (idx >= 0) {
          if (idx < basePositions.length - 1) {
            return [basePositions[idx], basePositions[idx + 1]];
          } else if (idx > 0) {
            return [basePositions[idx - 1], basePositions[idx]];
          }
        }
      }
      // Fallback: create a small window (1/10th of duration) forward
      const segment = baseDurationProp / 10;
      const end = Math.min(zs + segment, baseRange[1]);
      if (end > zs) return [zs, end];
    }
    return baseRange;
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
  // Build the 10 evenly spaced positions for current effective range
  const rangePositions = useMemo(() => buildRangePositions(rangeStart, rangeEnd), [rangeStart, rangeEnd, buildRangePositions]);
  // Capture unzoomed positions for future anchor zoom expansion
  useEffect(() => {
    if (!zoomRange) {
      unzoomedPositionsRef.current = rangePositions;
    }
  }, [zoomRange, rangePositions]);

  // ---------- Display Time Resolution ----------
  const displayTime = useMemo(() => {
    // Show pendingTime if it's significantly different from currentTime (either direction)
    if (pendingTime != null && Math.abs(currentTime - pendingTime) > BASE_PENDING_TOLERANCE) {
      // console.log('[FitnessPlayerFooterSeekThumbnails] displayTime using pendingTime:', { pendingTime, currentTime, diff: Math.abs(currentTime - pendingTime) });
      return pendingTime;
    }
    if (isSeeking && previewTime != null) {
      // console.log('[FitnessPlayerFooterSeekThumbnails] displayTime using previewTime:', previewTime);
      return previewTime;
    }
    // console.log('[FitnessPlayerFooterSeekThumbnails] displayTime using currentTime:', currentTime);
    return currentTime;
  }, [pendingTime, previewTime, currentTime, isSeeking]);

  // ---------- Active Thumbnail (binary search) ----------
  const activePos = useMemo(() => {
    if (!rangePositions.length) return null;
    let lo = 0, hi = rangePositions.length - 1, ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rangePositions[mid] <= displayTime) { ans = rangePositions[mid]; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }, [rangePositions, displayTime]);

  // ---------- Effects ----------
  useEffect(() => {
    if (pendingTime == null) return;
    // Clear pendingTime once currentTime catches up (within tolerance)
    if (Math.abs(currentTime - pendingTime) <= CLEAR_PENDING_TOLERANCE) {
      console.log('[FitnessPlayerFooterSeekThumbnails] Clearing pendingTime:', { currentTime, pendingTime, diff: Math.abs(currentTime - pendingTime) });
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
    console.log('[FitnessPlayerFooterSeekThumbnails] commit called:', { t, currentPendingTime: pendingTime });
    setPendingTime(t);
    seek(t);
    onSeek?.(t);
  }, [seek, onSeek]);

  // Expose commit function to parent via ref
  useEffect(() => {
    if (commitRef) {
      commitRef.current = commit;
    }
  }, [commitRef, commit]);

  // Expose getTime function to parent via ref (returns displayTime for arrow key calculations)
  useEffect(() => {
    if (getTimeRef) {
      getTimeRef.current = () => displayTime;
    }
  }, [getTimeRef, displayTime]);

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
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const seekTime = positionToSeconds(clientX, rect);
    console.log('[FitnessPlayerFooterSeekThumbnails] Progress bar clicked:', { seekTime, clientX });
    commit(seekTime);
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
    if (!currentItem) return null;
    const plexObj = {
      plex: currentItem.plex || currentItem.id,
      id: currentItem.id,
      thumb_id: currentItem.thumb_id ? (typeof currentItem.thumb_id === 'number' ? currentItem.thumb_id : parseInt(currentItem.thumb_id,10)) : null,
      image: currentItem.image,
      media_key: currentItem.media_key,
      ratingKey: currentItem.ratingKey,
      metadata: currentItem.metadata
    };
    return rangePositions.map((pos, idx) => {
      const minutes = Math.floor(pos / 60);
      const seconds = Math.floor(pos % 60);
      const label = `${minutes}:${String(seconds).padStart(2,'0')}`;
      const isOrigin = pos === 0; // ensure the very first (0:00) uses season / show artwork
      let imgSrc;
      if (isOrigin) {
        imgSrc = currentItem?.seasonImage || currentItem?.image || (generateThumbnailUrl ? generateThumbnailUrl(plexObj, pos) : undefined);
      } else {
        imgSrc = generateThumbnailUrl ? generateThumbnailUrl(plexObj, pos) : undefined;
      }
      const state = activePos != null && Math.abs(activePos - pos) < 0.001 ? 'active' : (activePos != null && pos < activePos ? 'past' : 'future');
      const classNames = `seek-button-container ${state}${isOrigin ? ' origin' : ''}`;
      return (
        <SingleThumbnailButton
          key={'rng-'+idx+'-'+Math.round(pos)}
          pos={pos}
          rangeStart={null}
          rangeEnd={null}
          state={state}
          onSeek={commit}
          onZoom={setZoomRange}
          globalStart={rangeStart}
          globalEnd={rangeEnd}
        >
          <div className={classNames} data-pos={pos}>
            <div className="thumbnail-wrapper">
              {imgSrc && (
                <img src={imgSrc} alt={`Thumbnail ${label}`} className="seek-thumbnail" loading="lazy" />
              )}
              <span className="thumbnail-time">{label}</span>
            </div>
          </div>
        </SingleThumbnailButton>
      );
    });
  }, [rangePositions, activePos, currentItem, generateThumbnailUrl, commit, rangeStart, rangeEnd]);

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
