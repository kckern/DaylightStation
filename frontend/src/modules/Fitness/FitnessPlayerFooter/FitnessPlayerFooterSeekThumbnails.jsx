/**
 * FitnessPlayerFooterSeekThumbnails - Main seek/zoom UI component
 * 
 * REFACTORED ARCHITECTURE:
 * - Uses useSeekState for all seek-related state management
 * - Uses useZoomState for all zoom/pan navigation
 * - CRITICAL: Seek and Zoom are COMPLETELY separate operations
 * - Thumbnails are dumb/presentational components
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useSeekState, useZoomState } from './hooks/index.js';
import FitnessPlayerFooterSeekThumbnail from './FitnessPlayerFooterSeekThumbnail.jsx';
import ProgressFrame from './ProgressFrame.jsx';
import { getDaylightLogger } from '../../../lib/logging/singleton.js';
import './FitnessPlayerFooterSeekThumbnails.scss';

const logger = getDaylightLogger({ context: { component: 'SeekThumbnails' } });
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Format seconds as M:SS
 */
const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + String(s).padStart(2, '0');
};

/**
 * Generate a deterministic grey shade from a position value
 */
const getGreyShade = (pos) => {
  const seed = Math.floor(pos * 1000);
  const hash = (seed * 9301 + 49297) % 233280;
  const normalized = hash / 233280;
  const greyValue = Math.floor(25 + normalized * 35);
  return `rgb(${greyValue}, ${greyValue}, ${greyValue})`;
};

const FitnessPlayerFooterSeekThumbnails = ({
  duration,
  currentTime,
  fallbackDuration = 600,
  onSeek,
  playerRef,
  isStalled = false,
  range,
  onZoomChange,
  onZoomReset,
  currentItem,
  generateThumbnailUrl,
  commitRef,
  getTimeRef,
  onZoomNavStateChange,
  disabled = false,
  mediaElementKey = 0
}) => {
  // Compute base duration
  const baseDuration = (duration && !Number.isNaN(duration)) 
    ? duration 
    : (currentItem?.duration || fallbackDuration);

  // --- SEEK STATE (from hook) ---
  const {
    displayTime,
    intentTime,
    previewTime,
    isSeekPending,
    commitSeek,
    setPreview,
    setPreviewThrottled,
    clearPreview,
    clearIntent
  } = useSeekState({
    currentTime,
    playerRef,
    mediaElementKey,
    onSeekCommit: onSeek,
    isStalled
  });

  // --- ZOOM STATE (from hook) ---
  const {
    isZoomed,
    zoomRange,
    rangeStart,
    rangeEnd,
    rangeSpan,
    rangePositions,
    zoomOverlay,
    canStepBackward,
    canStepForward,
    zoomIn,
    zoomOut,
    stepBackward,
    stepForward,
    scheduleZoomReset,
    cancelZoomReset
  } = useZoomState({
    baseDuration,
    baseRange: range,
    playerRef,
    onZoomChange,
    disabled
  });

  // --- CLEAR SEEK INTENT ON ZOOM CHANGES ---
  // This prevents the stale seek intent bug (BUG-02, BUG-03)
  const prevZoomRangeRef = useRef(zoomRange);
  useEffect(() => {
    // Only clear when zoomRange actually changes (not on every render)
    if (prevZoomRangeRef.current !== zoomRange) {
      prevZoomRangeRef.current = zoomRange;
      clearIntent('zoom-change');
    }
  }, [zoomRange, clearIntent]);

  // --- AUTO-RESET ZOOM AFTER SEEK COMPLETES ---
  // When a seek completes and playback resumes, schedule zoom reset to base level
  const prevSeekPendingRef = useRef(isSeekPending);
  useEffect(() => {
    const wasSeekPending = prevSeekPendingRef.current;
    prevSeekPendingRef.current = isSeekPending;

    // Detect seek completion: was pending, now not pending, and we're zoomed
    if (wasSeekPending && !isSeekPending && isZoomed) {
      logger.info('seek-completed-scheduling-zoom-reset', { isZoomed, zoomRange });
      scheduleZoomReset(800);
    }

    // Cancel zoom reset when a new seek starts
    if (!wasSeekPending && isSeekPending) {
      cancelZoomReset();
    }
  }, [isSeekPending, isZoomed, zoomRange, scheduleZoomReset, cancelZoomReset]);

  // --- EXPOSE REFS TO PARENT ---
  useEffect(() => {
    if (commitRef) {
      commitRef.current = commitSeek;
    }
  }, [commitRef, commitSeek]);

  useEffect(() => {
    if (getTimeRef) {
      getTimeRef.current = () => displayTime;
    }
  }, [getTimeRef, displayTime]);

  // --- EXPOSE ZOOM RESET TO PARENT ---
  useEffect(() => {
    if (onZoomReset && typeof onZoomReset === 'object') {
      onZoomReset.current = zoomOut;
    }
  }, [onZoomReset, zoomOut]);

  // --- EXPOSE ZOOM NAV STATE TO PARENT ---
  const navStateRef = useRef(null);
  useEffect(() => {
    if (!onZoomNavStateChange) return;
    
    const nextState = {
      canStepBackward,
      canStepForward,
      stepBackward,
      stepForward
    };
    
    const prevState = navStateRef.current;
    const changed = !prevState
      || prevState.canStepBackward !== nextState.canStepBackward
      || prevState.canStepForward !== nextState.canStepForward;
    
    if (changed) {
      navStateRef.current = nextState;
      onZoomNavStateChange(nextState);
    }
  }, [canStepBackward, canStepForward, stepBackward, stepForward, onZoomNavStateChange]);

  // --- PROGRESS BAR INTERACTIONS ---
  const positionToSeconds = useCallback((clientX, rect) => {
    if (!rect) return rangeStart;
    const clickX = clientX - rect.left;
    const pct = clamp01(clickX / rect.width);
    return rangeStart + pct * rangeSpan;
  }, [rangeStart, rangeSpan]);

  const handleProgressBarClick = useCallback((e) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const seekTime = positionToSeconds(clientX, rect);
    commitSeek(seekTime);
  }, [positionToSeconds, commitSeek, disabled]);

  const handleProgressBarMove = useCallback((e) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const previewSeconds = positionToSeconds(clientX, rect);
    setPreviewThrottled(previewSeconds);
  }, [positionToSeconds, setPreviewThrottled, disabled]);

  const handleProgressBarLeave = useCallback(() => {
    clearPreview();
  }, [clearPreview]);

  const handleProgressBarTouchEnd = useCallback(() => {
    if (disabled) return;
    if (previewTime != null) {
      commitSeek(previewTime);
    }
    clearPreview();
  }, [previewTime, commitSeek, clearPreview, disabled]);

  // --- THUMBNAIL SEEK HANDLER ---
  // This receives the EXACT segmentStart from the thumbnail
  // NO computation based on displayTime!
  const handleThumbnailSeek = useCallback((segmentStart) => {
    if (disabled) return;
    commitSeek(segmentStart);
  }, [commitSeek, disabled]);

  // --- THUMBNAIL ZOOM HANDLER ---
  // This ONLY handles zoom - no seek!
  const handleThumbnailZoom = useCallback((bounds) => {
    if (disabled) return;
    zoomIn(bounds);
  }, [zoomIn, disabled]);

  // --- RENDER THUMBNAILS ---
  const renderedThumbnails = useMemo(() => {
    if (!currentItem) return null;

    const posterSrc = currentItem?.seasonImage || currentItem?.image;
    const plexObj = {
      plex: currentItem.plex || currentItem.id,
      id: currentItem.id,
      thumb_id: currentItem.thumb_id ? 
        (typeof currentItem.thumb_id === 'number' ? currentItem.thumb_id : parseInt(currentItem.thumb_id, 10)) 
        : null,
      image: currentItem.image,
      media_key: currentItem.media_key,
      ratingKey: currentItem.ratingKey,
      metadata: currentItem.metadata
    };

    return rangePositions.map((pos, idx) => {
      // Compute segment bounds
      const segmentStart = pos;
      const nextBoundary = idx < rangePositions.length - 1 ? rangePositions[idx + 1] : rangeEnd;
      const segmentEnd = Number.isFinite(nextBoundary) ? nextBoundary : segmentStart;
      const segmentDuration = Math.max(segmentEnd - segmentStart, 0);

      // Compute visible ratio for partial segments
      const nominalSegmentDuration = rangeSpan > 0 && rangePositions.length > 0
        ? rangeSpan / rangePositions.length
        : null;
      const visibleRatio = nominalSegmentDuration
        ? clamp01(segmentDuration / nominalSegmentDuration)
        : 1;

      // Determine state (active/past/future)
      const TIME_TOLERANCE = 0.001;
      const dynamicTolerance = segmentDuration > 0
        ? Math.min(TIME_TOLERANCE, segmentDuration * 0.25)
        : TIME_TOLERANCE;
      const activeUpperBound = segmentDuration > 0
        ? Math.max(segmentStart, segmentEnd - dynamicTolerance)
        : segmentEnd;
      
      const isActive = segmentDuration > 0
        ? (displayTime >= segmentStart && displayTime < activeUpperBound)
        : Math.abs(displayTime - segmentStart) < TIME_TOLERANCE;
      const pastThreshold = segmentEnd - dynamicTolerance;
      const isPast = displayTime >= pastThreshold;
      const state = isActive ? 'active' : (isPast ? 'past' : 'future');

      // Label time: show current displayTime for active, segmentStart otherwise
      const labelTime = isActive ? displayTime : segmentStart;
      const label = formatTime(Math.max(labelTime, 0));

      // Is this the origin thumbnail? (first one when not zoomed)
      const isOrigin = !isZoomed && Math.abs(segmentStart - rangeStart) < 0.001;

      // Thumbnail image source
      let imgSrc;
      if (isOrigin) {
        imgSrc = posterSrc || (generateThumbnailUrl ? generateThumbnailUrl(plexObj, segmentStart) : undefined);
      } else {
        imgSrc = generateThumbnailUrl ? generateThumbnailUrl(plexObj, segmentStart) : undefined;
        if (!imgSrc && posterSrc) {
          imgSrc = posterSrc;
        }
      }

      // Progress within active segment
      let progressRatio = 0;
      if (isActive && segmentDuration > 0) {
        const BOUNDARY_TOLERANCE = 0.1;
        const effectiveEnd = segmentEnd - BOUNDARY_TOLERANCE;
        if (displayTime >= segmentStart && displayTime < effectiveEnd) {
          const progressInSegment = displayTime - segmentStart;
          progressRatio = clamp01(progressInSegment / segmentDuration);
        }
      }

      // Show spark when active and not at 100%
      const showSpark = isActive && progressRatio < 1;

      const classNames = `seek-button-container ${state}${isOrigin ? ' origin' : ''}`;
      const greyBg = getGreyShade(segmentStart);

      return (
        <FitnessPlayerFooterSeekThumbnail
          key={`thumb-${idx}-${Math.round(segmentStart)}`}
          index={idx}
          state={state}
          isOrigin={isOrigin}
          disabled={disabled}
          isActive={isActive}
          className={classNames}
          segmentStart={segmentStart}
          segmentEnd={segmentEnd}
          globalRangeStart={rangeStart}
          globalRangeEnd={rangeEnd}
          seekTime={segmentStart}
          labelTime={labelTime}
          imgSrc={imgSrc}
          posterSrc={posterSrc}
          greyBg={greyBg}
          label={label}
          progressRatio={progressRatio}
          showSpark={showSpark}
          visibleRatio={visibleRatio}
          onSeek={handleThumbnailSeek}
          onZoom={handleThumbnailZoom}
          enableZoom={!disabled}
        />
      );
    });
  }, [
    currentItem,
    rangePositions,
    rangeEnd,
    rangeStart,
    rangeSpan,
    displayTime,
    isZoomed,
    disabled,
    generateThumbnailUrl,
    handleThumbnailSeek,
    handleThumbnailZoom
  ]);

  // --- PROGRESS BAR PERCENTAGE ---
  const progressPct = useMemo(() => {
    if (!Number.isFinite(baseDuration) || baseDuration <= 0) return 0;
    const normalized = clamp01(displayTime / baseDuration);
    return normalized * 100;
  }, [displayTime, baseDuration]);

  const showingIntent = isSeekPending || previewTime != null;

  return (
    <div className={`footer-seek-thumbnails${disabled ? ' disabled' : ''}`}>
      <div
        className={`progress-bar${disabled ? ' disabled' : ''}`}
        data-intent={showingIntent ? '1' : '0'}
        aria-disabled={disabled ? 'true' : undefined}
        onPointerDown={handleProgressBarClick}
        onMouseMove={handleProgressBarMove}
        onMouseLeave={handleProgressBarLeave}
        onTouchStart={handleProgressBarMove}
        onTouchMove={handleProgressBarMove}
        onTouchEnd={handleProgressBarTouchEnd}
      >
        <div className="progress" style={{ width: `${progressPct}%` }} />
        {zoomOverlay && (
          <ProgressFrame leftPct={zoomOverlay.leftPct} widthPct={zoomOverlay.widthPct} />
        )}
      </div>
      <div className={`seek-thumbnails${disabled ? ' disabled' : ''}`}>
        {renderedThumbnails}
      </div>
    </div>
  );
};

FitnessPlayerFooterSeekThumbnails.propTypes = {
  duration: PropTypes.number,
  currentTime: PropTypes.number,
  fallbackDuration: PropTypes.number,
  onSeek: PropTypes.func,
  playerRef: PropTypes.shape({ current: PropTypes.object }),
  range: PropTypes.arrayOf(PropTypes.number),
  onZoomChange: PropTypes.func,
  onZoomReset: PropTypes.shape({ current: PropTypes.func }),
  currentItem: PropTypes.shape({
    seasonImage: PropTypes.string,
    image: PropTypes.string,
    plex: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    thumb_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    media_key: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    ratingKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    metadata: PropTypes.object,
    duration: PropTypes.number
  }),
  generateThumbnailUrl: PropTypes.func,
  commitRef: PropTypes.shape({ current: PropTypes.func }),
  getTimeRef: PropTypes.shape({ current: PropTypes.func }),
  onZoomNavStateChange: PropTypes.func,
  disabled: PropTypes.bool,
  mediaElementKey: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  isStalled: PropTypes.bool
};

export default FitnessPlayerFooterSeekThumbnails;
