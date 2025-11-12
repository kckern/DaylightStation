import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import SingleThumbnailButton from './SingleThumbnailButton.jsx';
import usePlayerController from '../Player/usePlayerController.js';

const CONFIG = Object.freeze({
  thumbnail: {
    sampleFraction: 0.2,
    labelFraction: 0.5,
    seekFraction: 0.05
  }
});

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
 *  - onZoomNavStateChange: optional callback receiving zoom navigation helpers (prev/next)
 */
const FitnessPlayerFooterSeekThumbnails = ({ duration, currentTime, isSeeking = false, fallbackDuration = 600, onSeek, seekButtons, playerRef, range, onZoomChange, onZoomReset, currentItem, generateThumbnailUrl, commitRef, getTimeRef, onZoomNavStateChange, disabled = false, mediaElementKey = 0 }) => {
  // ---------- Helpers ----------
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const percentOf = (t, total) => total > 0 ? clamp01(t / total) : 0;
  const BASE_PENDING_TOLERANCE = 0.05;  // keeps optimistic bar until near actual
  const CLEAR_PENDING_TOLERANCE = 0.25; // when to clear internal pending state
  const STICKY_INTENT_MS = 700;
  const SETTLED_GRACE_MS = 650;
  const PENDING_MAX_HOLD_MS = 2500;
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
  const baseRangeSnapshotRef = useRef({ positions: [], range: [0, baseDurationProp] });
  const navStateRef = useRef(null);

  // Capture original thumbnail positions (stable across zooms) for synthetic generation
  // Helper to derive an evenly spaced 10-point array for a given [start,end)
  const buildRangePositions = useCallback((start, end) => {
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) return [];
    const span = end - start;
    const segments = 10;
    const step = span / segments;
    const arr = new Array(segments);
    for (let i = 0; i < segments; i++) {
      arr[i] = start + step * i;
    }
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
      return [zs, end];
    }
    return baseRange;
  }, [range, zoomRange, baseDurationProp]);

  // ---------- Derived Range & Positions ----------
  const [rangeStart, rangeEnd] = effectiveRange;
  const rangeSpan = Math.max(0, rangeEnd - rangeStart);

  const rangePositions = useMemo(() => {
    const arr = buildRangePositions(rangeStart, rangeEnd);
    // Keep snapshot of unzoomed positions for anchor-expansion logic
    if (!zoomRange) {
      unzoomedPositionsRef.current = arr;
    }
    return arr;
  }, [rangeStart, rangeEnd, buildRangePositions, zoomRange]);

  useEffect(() => {
    if (!zoomRange) {
      baseRangeSnapshotRef.current = {
        positions: Array.isArray(rangePositions) ? rangePositions.slice() : [],
        range: [rangeStart, rangeEnd]
      };
    }
  }, [zoomRange, rangePositions, rangeStart, rangeEnd]);

  // ---------- Playback Intent State ----------
  const [pendingTime, setPendingTime] = useState(null); // optimistic seek time
  const [previewTime, setPreviewTime] = useState(null); // hover / drag preview
  const lastSeekRef = useRef({ time: null, expireAt: 0 });
  const awaitingSettleRef = useRef(false);
  const resetZoomOnPlayingRef = useRef(false);
  const rafRef = useRef(null);
  const pendingMetaRef = useRef({ target: null, startedAt: 0, settledAt: 0 });

  const nowTs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  const { seek } = usePlayerController(playerRef);

  // Display time prefers preview, then pending, then actual
  const displayTime = useMemo(() => {
    if (previewTime != null) return previewTime;
    if (pendingTime != null) return pendingTime;
    return currentTime;
  }, [previewTime, pendingTime, currentTime]);

  const isZoomed = !!zoomRange;

  const baseSnapshot = baseRangeSnapshotRef.current || {};
  const basePositions = Array.isArray(baseSnapshot.positions) ? baseSnapshot.positions : [];
  const baseRangeEnd = Array.isArray(baseSnapshot.range) && baseSnapshot.range.length === 2 ? baseSnapshot.range[1] : baseDurationProp;

  const resolveZoomIndex = useCallback(() => {
    if (!basePositions.length) return -1;
    let foundIndex = basePositions.findIndex((pos) => Math.abs(pos - rangeStart) < 0.51);
    if (foundIndex >= 0) return foundIndex;
    let nearestIndex = 0;
    let nearestDelta = Infinity;
    for (let i = 0; i < basePositions.length; i++) {
      const delta = Math.abs(basePositions[i] - rangeStart);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearestIndex = i;
      }
    }
    return nearestIndex;
  }, [basePositions, rangeStart]);

  const setZoomRangeFromIndex = useCallback((targetIndex) => {
    if (!basePositions.length) return;
    const maxIndex = basePositions.length - 1;
    const clampedIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    const start = basePositions[clampedIndex];
    const nextBoundary = clampedIndex < maxIndex ? basePositions[clampedIndex + 1] : baseRangeEnd;
    if (!Number.isFinite(start) || !Number.isFinite(nextBoundary) || nextBoundary <= start) return;
    setZoomRange((prev) => {
      if (prev && Math.abs(prev[0] - start) < 0.001 && Math.abs(prev[1] - nextBoundary) < 0.001) {
        return prev;
      }
      return [start, nextBoundary];
    });
  }, [basePositions, baseRangeEnd, setZoomRange]);

  const stepZoomBackward = useCallback(() => {
    if (disabled || !isZoomed || !basePositions.length) return;
    const idx = resolveZoomIndex();
    if (idx <= 0) return;
    setZoomRangeFromIndex(idx - 1);
  }, [disabled, isZoomed, basePositions, resolveZoomIndex, setZoomRangeFromIndex]);

  const stepZoomForward = useCallback(() => {
    if (disabled || !isZoomed || !basePositions.length) return;
    const idx = resolveZoomIndex();
    if (idx < 0 || idx >= basePositions.length - 1) return;
    setZoomRangeFromIndex(idx + 1);
  }, [disabled, isZoomed, basePositions, resolveZoomIndex, setZoomRangeFromIndex]);

  const zoomIndex = useMemo(() => {
    if (!isZoomed || !basePositions.length) return -1;
    return resolveZoomIndex();
  }, [isZoomed, basePositions, resolveZoomIndex]);

  const canStepBackward = !disabled && zoomIndex > 0;
  const canStepForward = !disabled && basePositions.length > 0 && zoomIndex >= 0 && zoomIndex < basePositions.length - 1;

  // Notify parent when zoom state changes
  useEffect(() => {
    onZoomChange?.(isZoomed);
  }, [isZoomed, onZoomChange]);

  useEffect(() => {
    if (!onZoomNavStateChange) return;
    const nextState = {
      canStepBackward,
      canStepForward,
      stepBackward: stepZoomBackward,
      stepForward: stepZoomForward
    };
    const prevState = navStateRef.current;
    const changed = !prevState
      || prevState.canStepBackward !== nextState.canStepBackward
      || prevState.canStepForward !== nextState.canStepForward
      || prevState.stepBackward !== nextState.stepBackward
      || prevState.stepForward !== nextState.stepForward;
    if (changed) {
      navStateRef.current = nextState;
      onZoomNavStateChange(nextState);
    }
  }, [canStepBackward, canStepForward, stepZoomBackward, stepZoomForward, onZoomNavStateChange]);

  // Expose zoom reset function to parent via ref
  useEffect(() => {
    if (onZoomReset && typeof onZoomReset === 'object' && onZoomReset.current !== undefined) {
      onZoomReset.current = () => {
        setZoomRange(null);
      };
    }
  }, [onZoomReset]);

  // Map x coordinate to seconds within effective range
  const positionToSeconds = useCallback((clientX, rect) => {
    if (!rect) return rangeStart;
    const clickX = clientX - rect.left;
    const pct = clamp01(clickX / rect.width);
    return rangeStart + pct * rangeSpan;
  }, [rangeStart, rangeSpan]);

  const commit = useCallback((t) => {
    if (disabled) return;
    setPendingTime(t);
    awaitingSettleRef.current = true;
    pendingMetaRef.current = { target: t, startedAt: nowTs(), settledAt: 0 };
    // remember intent so we can keep highlight sticky after settle
    lastSeekRef.current.time = t;
    seek(t);
    onSeek?.(t);
  }, [seek, onSeek, disabled]);

  // Clear pendingTime on playback resume/seek settled
  useEffect(() => {
    const el = playerRef?.current?.getMediaElement?.();
    if (!el) return;
    const handleSettled = () => {
      if (awaitingSettleRef.current) {
        awaitingSettleRef.current = false;
        pendingMetaRef.current = {
          ...pendingMetaRef.current,
          settledAt: nowTs()
        };
      }
    };
    const handlePlaying = () => {
      handleSettled();
      // Reset zoom if a thumbnail seek requested it
      if (resetZoomOnPlayingRef.current) {
        resetZoomOnPlayingRef.current = false;
        setZoomRange(null);
      }
    };
    // Also clear on 'loadedmetadata' which fires during stall recovery reloads
    const handleRecovery = () => {
      // If we get a fresh loadedmetadata while waiting for settle, clear the pending state
      if (awaitingSettleRef.current || pendingTime != null) {
        awaitingSettleRef.current = false;
        pendingMetaRef.current = { target: null, startedAt: 0, settledAt: 0 };
        setPendingTime(null);
        lastSeekRef.current.expireAt = nowTs() + STICKY_INTENT_MS;
      }
    };
    el.addEventListener('seeked', handleSettled);
    el.addEventListener('playing', handlePlaying);
    el.addEventListener('loadedmetadata', handleRecovery);
    return () => {
      el.removeEventListener('seeked', handleSettled);
      el.removeEventListener('playing', handlePlaying);
      el.removeEventListener('loadedmetadata', handleRecovery);
    };
  }, [playerRef, pendingTime, mediaElementKey]);

  useEffect(() => {
    if (pendingTime == null) return;
    const meta = pendingMetaRef.current || {};
    const target = Number.isFinite(meta.target) ? meta.target : pendingTime;
    if (!Number.isFinite(target)) {
      pendingMetaRef.current = { target: null, startedAt: 0, settledAt: 0 };
      awaitingSettleRef.current = false;
      setPendingTime(null);
      lastSeekRef.current.expireAt = nowTs() + STICKY_INTENT_MS;
      return;
    }
    const now = nowTs();
    const delta = Math.abs(currentTime - target);
    const tolerance = awaitingSettleRef.current ? BASE_PENDING_TOLERANCE : CLEAR_PENDING_TOLERANCE;
    const clearIntent = () => {
      pendingMetaRef.current = { target: null, startedAt: 0, settledAt: 0 };
      awaitingSettleRef.current = false;
      setPendingTime(null);
      lastSeekRef.current.expireAt = now + STICKY_INTENT_MS;
    };

    if (delta <= tolerance) {
      clearIntent();
      return;
    }

    if (meta.settledAt) {
      const relaxedTolerance = CLEAR_PENDING_TOLERANCE * 1.5;
      if (now - meta.settledAt > SETTLED_GRACE_MS && delta <= relaxedTolerance) {
        clearIntent();
        return;
      }
    }

    if (meta.startedAt && now - meta.startedAt > PENDING_MAX_HOLD_MS) {
      clearIntent();
    }
  }, [currentTime, pendingTime]);

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
    if (!isSeeking || disabled) return; // only show preview while in seeking phase
    const t = positionToSeconds(clientX, rect);
    setPreviewTime(t);
  }, [isSeeking, positionToSeconds, disabled]);

  const updatePreviewThrottled = useCallback((clientX, rect) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => updatePreview(clientX, rect));
  }, [updatePreview]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // ---------- Event Handlers ----------
  const handleClick = useCallback((e) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const seekTime = positionToSeconds(clientX, rect);
    console.log('[FitnessPlayerFooterSeekThumbnails] Progress bar clicked:', { seekTime, clientX });
    commit(seekTime);
  }, [positionToSeconds, commit, disabled]);

  const handlePointerMove = useCallback((e) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    updatePreviewThrottled(clientX, rect);
  }, [updatePreviewThrottled, disabled]);

  const handleLeave = useCallback(() => { setPreviewTime(null); }, []);

  const handleTouchEnd = useCallback(() => {
    if (disabled) return;
    if (previewTime != null) commit(previewTime);
    setPreviewTime(null);
  }, [previewTime, commit, disabled]);

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

  const handleThumbnailSeek = useCallback((seekTarget) => {
    if (disabled) return;
    const resolvedTarget = Number.isFinite(seekTarget) ? seekTarget : rangeStart;
    commit(resolvedTarget);
    // When zoomed, mark for delayed zoom reset (will happen on 'playing' event)
    if (zoomRange) {
      resetZoomOnPlayingRef.current = true;
    }
  }, [commit, zoomRange, rangeStart, disabled]);

  const renderedSeekButtons = useMemo(() => {
    if (!currentItem) return null;
    const posterSrc = currentItem?.seasonImage || currentItem?.image;
    const plexObj = {
      plex: currentItem.plex || currentItem.id,
      id: currentItem.id,
      thumb_id: currentItem.thumb_id ? (typeof currentItem.thumb_id === 'number' ? currentItem.thumb_id : parseInt(currentItem.thumb_id,10)) : null,
      image: currentItem.image,
      media_key: currentItem.media_key,
      ratingKey: currentItem.ratingKey,
      metadata: currentItem.metadata
    };
  const sampleFraction = clamp01(CONFIG.thumbnail.sampleFraction);
  const labelFraction = clamp01(CONFIG.thumbnail.labelFraction);
  const seekFraction = clamp01(CONFIG.thumbnail.seekFraction);

  return rangePositions.map((pos, idx) => {
      const segmentStart = pos;
      const nextBoundary = idx < rangePositions.length - 1 ? rangePositions[idx + 1] : rangeEnd;
      const segmentEnd = Number.isFinite(nextBoundary) ? nextBoundary : segmentStart;
      const segmentDuration = Math.max(segmentEnd - segmentStart, 0);

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

      const sampleTime = segmentDuration > 0
        ? segmentStart + segmentDuration * sampleFraction
        : segmentStart;
      const labelTime = segmentDuration > 0
        ? segmentStart + segmentDuration * labelFraction
        : segmentStart;
      const seekTime = segmentDuration > 0
        ? segmentStart + segmentDuration * seekFraction
        : segmentStart;

      const baseLabel = formatTime(labelTime);

  const isOrigin = !isZoomed && Math.abs(segmentStart - rangeStart) < 0.001; // ensure the very first window uses season / show artwork only when not zoomed
      let imgSrc;
      if (isOrigin) {
        imgSrc = posterSrc || (generateThumbnailUrl ? generateThumbnailUrl(plexObj, sampleTime) : undefined);
      } else {
        imgSrc = generateThumbnailUrl ? generateThumbnailUrl(plexObj, sampleTime) : undefined;
        if (!imgSrc && posterSrc) {
          imgSrc = posterSrc;
        }
      }
      const classNames = `seek-button-container ${state}${isOrigin ? ' origin' : ''}`;
      const greyBg = getGreyShade(segmentStart);

      // Calculate progress within this thumbnail's time range (for border animation)
      // Progress is based on real playback (currentTime) not intent; hide during sticky pin if not in segment
      let thumbnailProgress = 0;
      let isActivelyPlaying = false;
      if (isActive) {
        const endTime = segmentEnd;
        const duration = endTime - segmentStart;

        // Add tolerance to prevent showing 100% on previous thumbnail at boundary
        const BOUNDARY_TOLERANCE = 0.1; // 100ms buffer (actual seconds)
        const effectiveEnd = endTime - BOUNDARY_TOLERANCE;

        // Only calculate progress if currentTime is actually in this segment
        if (duration > 0 && currentTime >= segmentStart && currentTime < effectiveEnd) {
          const progressInSegment = currentTime - segmentStart;
          thumbnailProgress = clamp01(progressInSegment / duration) * 100;
          isActivelyPlaying = true;
        }
      }

      // For active thumbnail, show current playback time only when actively playing
      let label;
      if (isActive && isActivelyPlaying) {
        label = formatTime(currentTime);
      } else {
        label = baseLabel;
      }

      return (
        <SingleThumbnailButton
          key={'rng-'+idx+'-'+Math.round(segmentStart)}
          pos={sampleTime}
          rangeStart={segmentStart}
          rangeEnd={segmentEnd}
          state={state}
          onSeek={handleThumbnailSeek}
          onZoom={disabled ? undefined : setZoomRange}
          globalStart={rangeStart}
          globalEnd={rangeEnd}
          seekTime={seekTime}
          labelTime={labelTime}
          enableZoom={!disabled}
        >
          <div
            className={`${classNames}${disabled ? ' disabled' : ''}`}
            data-pos={segmentStart}
            data-sample-time={sampleTime}
            data-label-time={labelTime}
          >
            <div className="thumbnail-wrapper">
              {imgSrc ? (
                <img
                  key={`${imgSrc}-${segmentStart}`}
                  src={imgSrc}
                  alt=""
                  className="seek-thumbnail"
                  loading="lazy"
                  onLoad={(e) => {
                    // Ensure image is visible on successful load
                    e.target.style.display = '';
                  }}
                  onError={(e) => {
                    // Only try poster fallback once if it's different from current src
                    if (posterSrc && e.target.src !== posterSrc && !e.target.hasAttribute('data-poster-tried')) {
                      e.target.setAttribute('data-poster-tried', 'true');
                      e.target.src = posterSrc;
                    } else {
                      // Hide image and show grey fallback
                      e.target.style.display = 'none';
                    }
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
              {isActive && (
                <div className="progress-border-overlay">
                  {(() => {
                    // Calculate per-edge fill percentages and derive spark position within each edge wrapper
                    const p = thumbnailProgress;
                    const topFill = Math.min(p / 25 * 100, 100);
                    const rightFill = Math.min(Math.max(p - 25, 0) / 25 * 100, 100);
                    const bottomFill = Math.min(Math.max(p - 50, 0) / 25 * 100, 100);
                    const leftFill = Math.min(Math.max(p - 75, 0) / 25 * 100, 100);
                    const edgeIndex = Math.min(Math.floor(p / 25), 3);

                    return (
                      <>
                        {/* Top edge: left-to-right */}
                        <div className="edge edge-top">
                          <div className="edge-fill" style={{ width: `${topFill}%` }} />
                          {edgeIndex === 0 && p > 0 && (
                            <div className="progress-spark" style={{ left: `${topFill}%`, top: '50%' }}>
                              <div className="spark-core" />
                            </div>
                          )}
                        </div>

                        {/* Right edge: top-to-bottom */}
                        <div className="edge edge-right">
                          <div className="edge-fill" style={{ height: `${rightFill}%` }} />
                          {edgeIndex === 1 && p > 25 && (
                            <div className="progress-spark" style={{ top: `${rightFill}%`, left: '50%' }}>
                              <div className="spark-core" />
                            </div>
                          )}
                        </div>

                        {/* Bottom edge: right-to-left */}
                        <div className="edge edge-bottom">
                          <div className="edge-fill" style={{ width: `${bottomFill}%` }} />
                          {edgeIndex === 2 && p > 50 && (
                            <div className="progress-spark" style={{ left: `${Math.max(0, 100 - bottomFill)}%`, top: '50%' }}>
                              <div className="spark-core" />
                            </div>
                          )}
                        </div>

                        {/* Left edge: bottom-to-top */}
                        <div className="edge edge-left">
                          <div className="edge-fill" style={{ height: `${leftFill}%` }} />
                          {edgeIndex === 3 && p > 75 && (
                            <div className="progress-spark" style={{ top: `${Math.max(0, 100 - leftFill)}%`, left: '50%' }}>
                              <div className="spark-core" />
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              <span className="thumbnail-time">{label}</span>
            </div>
          </div>
        </SingleThumbnailButton>
      );
    });
  }, [rangePositions, currentItem, generateThumbnailUrl, rangeStart, rangeEnd, getGreyShade, currentTime, handleThumbnailSeek, disabled, isZoomed, displayTime]);

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
    <div className={`footer-seek-thumbnails${disabled ? ' disabled' : ''}`}>
      <div
        className={`progress-bar${disabled ? ' disabled' : ''}`}
        data-intent={showingIntent ? '1' : '0'}
        aria-disabled={disabled ? 'true' : undefined}
        onPointerDown={handleClick}
        onMouseMove={handlePointerMove}
        onMouseLeave={handleLeave}
        onTouchStart={handlePointerMove}
        onTouchMove={handlePointerMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'relative',
          overflow: 'hidden',
          pointerEvents: disabled ? 'none' : undefined,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1
        }}
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
      <div className={`seek-thumbnails${disabled ? ' disabled' : ''}`}>
        {renderedSeekButtons}
      </div>
    </div>
  );
}

export default FitnessPlayerFooterSeekThumbnails;
