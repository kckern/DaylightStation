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
  const awaitingSettleRef = useRef(false);                // guard to hold highlight until playback resumes
  const [previewTime, setPreviewTime] = useState(null);   // hover / drag preview (only while seeking)
  const rafRef = useRef(); // for throttling preview updates

  // ---------- Seek Positions & Total Duration ----------
  // Each button can have its own range: data-range-start, data-range-end
  // Build the 10 evenly spaced positions for current effective range
  const rangePositions = useMemo(() => buildRangePositions(rangeStart, rangeEnd), [rangeStart, rangeEnd, buildRangePositions]);
  // Capture unzoomed positions for future anchor zoom expansion
  // Always remember the positions from the last rendered level so an anchor ([p,p]) can
  // expand against the immediate prior level, enabling multi-level drill-down.
  useEffect(() => {
    unzoomedPositionsRef.current = rangePositions;
  }, [rangePositions]);

  // ---------- Display Time Resolution ----------
  const displayTime = useMemo(() => {
    // Optimistic: while a seek is pending, keep highlighting the intended target
    if (pendingTime != null) return pendingTime;
    if (isSeeking && previewTime != null) return previewTime;
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
    // Only clear when we're close AND not explicitly waiting for settle
    if (!awaitingSettleRef.current && Math.abs(currentTime - pendingTime) <= CLEAR_PENDING_TOLERANCE) {
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
    awaitingSettleRef.current = true;
    seek(t);
    onSeek?.(t);
  }, [seek, onSeek]);

  // Clear pendingTime on playback resume/seek settled
  useEffect(() => {
    const el = playerRef?.current?.getMediaElement?.();
    if (!el) return;
    const handleSettled = () => {
      if (awaitingSettleRef.current) {
        awaitingSettleRef.current = false;
        setPendingTime(null);
      }
    };
    // Also clear on 'loadedmetadata' which fires during stall recovery reloads
    const handleRecovery = () => {
      // If we get a fresh loadedmetadata while waiting for settle, clear the pending state
      if (awaitingSettleRef.current || pendingTime != null) {
        awaitingSettleRef.current = false;
        setPendingTime(null);
      }
    };
    el.addEventListener('seeked', handleSettled);
    el.addEventListener('playing', handleSettled);
    el.addEventListener('loadedmetadata', handleRecovery);
    return () => {
      el.removeEventListener('seeked', handleSettled);
      el.removeEventListener('playing', handleSettled);
      el.removeEventListener('loadedmetadata', handleRecovery);
    };
  }, [playerRef, pendingTime]);

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

  // Generate a consistent random dark grey color based on position
  const getGreyShade = useCallback((pos) => {
    // Use position as seed for consistent color per thumbnail
    const seed = Math.floor(pos * 1000);
    const hash = (seed * 9301 + 49297) % 233280;
    const normalized = hash / 233280;
    // Generate grey value between 25-60 (dark greys)
    const greyValue = Math.floor(25 + normalized * 35);
    return `rgb(${greyValue}, ${greyValue}, ${greyValue})`;
  }, []);

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
      const isActive = activePos != null && Math.abs(activePos - pos) < 0.001;
      const minutes = Math.floor(pos / 60);
      const seconds = Math.floor(pos % 60);
      const baseLabel = `${minutes}:${String(seconds).padStart(2,'0')}`;
      
      // For active thumbnail, show current playback time instead of thumbnail position
      let label;
      if (isActive) {
        const currentMinutes = Math.floor(displayTime / 60);
        const currentSeconds = Math.floor(displayTime % 60);
        label = `${currentMinutes}:${String(currentSeconds).padStart(2,'0')}`;
      } else {
        label = baseLabel;
      }
      
      const isOrigin = pos === 0; // ensure the very first (0:00) uses season / show artwork
      let imgSrc;
      if (isOrigin) {
        imgSrc = currentItem?.seasonImage || currentItem?.image || (generateThumbnailUrl ? generateThumbnailUrl(plexObj, pos) : undefined);
      } else {
        imgSrc = generateThumbnailUrl ? generateThumbnailUrl(plexObj, pos) : undefined;
      }
      const state = isActive ? 'active' : (activePos != null && pos < activePos ? 'past' : 'future');
      const classNames = `seek-button-container ${state}${isOrigin ? ' origin' : ''}`;
      const greyBg = getGreyShade(pos);
      
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
              {imgSrc ? (
                <img 
                  src={imgSrc} 
                  alt="" 
                  className="seek-thumbnail" 
                  loading="lazy"
                  onError={(e) => {
                    // Hide image and show grey fallback on error
                    e.target.style.display = 'none';
                  }}
                />
              ) : null}
              <div 
                className="thumbnail-fallback" 
                style={{ 
                  backgroundColor: greyBg,
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  display: imgSrc ? 'none' : 'block',
                  zIndex: 0
                }}
              />
              <span className="thumbnail-time">{label}</span>
            </div>
          </div>
        </SingleThumbnailButton>
      );
    });
  }, [rangePositions, activePos, currentItem, generateThumbnailUrl, commit, rangeStart, rangeEnd, getGreyShade, displayTime]);

  // Progress bar should always represent entire video duration, independent of zoomed thumbnail range
  const fullDuration = baseDurationProp || 0;
  const progressPct = useMemo(() => {
    if (!Number.isFinite(fullDuration) || fullDuration <= 0) return 0;
    // Use displayTime so pending seeks reflect optimistically on bar
    const normalized = clamp01(displayTime / fullDuration);
    return normalized * 100;
  }, [displayTime, fullDuration]);
  const showingIntent = pendingTime != null || (isSeeking && previewTime != null);

  // Zoom overlay box (perimeter) indicates the currently drilled-in thumbnail window on top of full-duration progress bar
  const zoomOverlay = useMemo(() => {
    if (!isZoomed || !Number.isFinite(fullDuration) || fullDuration <= 0) return null;
    // Avoid drawing if zoom covers essentially entire duration
    const start = Number.isFinite(rangeStart) ? rangeStart : 0;
    const end = Number.isFinite(rangeEnd) ? rangeEnd : 0;
    const span = end - start;
    if (!Number.isFinite(span) || span <= 0) return null;
    if (span >= fullDuration * 0.98) return null; // nearly full length
    // Clamp to bar bounds and compute width as right-left to avoid overflow
    const leftUnit = clamp01(start / fullDuration);
    const rightUnit = clamp01(end / fullDuration);
    const widthUnit = Math.max(0, rightUnit - leftUnit);
    return { leftPct: leftUnit * 100, widthPct: widthUnit * 100 };
  }, [isZoomed, rangeStart, rangeEnd, fullDuration]);

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
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        <div className="progress" style={{ width: `${progressPct}%` }} />
        {zoomOverlay && (
          <div
            className="progress-zoom-window"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${zoomOverlay.leftPct}%`,
              width: `${zoomOverlay.widthPct}%`,
              boxSizing: 'border-box',
              border: '1px solid #FFD400',
              background: 'rgba(255, 212, 0, 0.12)',
              pointerEvents: 'none'
            }}
          />
        )}
      </div>
      <div className="seek-thumbnails">
        {renderedSeekButtons}
      </div>
    </div>
  );
}

export default FitnessPlayerFooterSeekThumbnails;
