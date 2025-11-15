import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import SingleThumbnailButton from './SingleThumbnailButton.jsx';
import usePlayerController from '../Player/usePlayerController.js';

const CONFIG = Object.freeze({
  thumbnail: {
    sampleFraction: 0.2,
    labelFraction: 0.5,
    seekFraction: 0.05
  }
});

const BORDER_VIEWBOX = 100;
const BORDER_STROKE = 3;
const BORDER_CORNER_RADIUS = 4;
const BORDER_OFFSET = BORDER_STROKE / 2;
const BORDER_MARGIN = BORDER_OFFSET;
const BORDER_RECT_SIZE = BORDER_VIEWBOX - BORDER_STROKE;
const BORDER_STRAIGHT_LENGTH = BORDER_RECT_SIZE - (BORDER_CORNER_RADIUS * 2);
const BORDER_CORNER_LENGTH = (Math.PI * BORDER_CORNER_RADIUS) / 2;
const BORDER_PERIMETER = (BORDER_STRAIGHT_LENGTH * 4) + (BORDER_CORNER_LENGTH * 4);

const BORDER_POINTS = Object.freeze({
  topY: BORDER_OFFSET,
  bottomY: BORDER_VIEWBOX - BORDER_OFFSET,
  leftX: BORDER_OFFSET,
  rightX: BORDER_VIEWBOX - BORDER_OFFSET,
  topStraightStartX: BORDER_OFFSET + BORDER_CORNER_RADIUS,
  topStraightEndX: BORDER_VIEWBOX - BORDER_OFFSET - BORDER_CORNER_RADIUS,
  sideStraightStartY: BORDER_OFFSET + BORDER_CORNER_RADIUS,
  sideStraightEndY: BORDER_VIEWBOX - BORDER_OFFSET - BORDER_CORNER_RADIUS
});

const BORDER_CENTERS = Object.freeze({
  topRight: {
    x: BORDER_POINTS.rightX - BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.topY + BORDER_CORNER_RADIUS
  },
  bottomRight: {
    x: BORDER_POINTS.rightX - BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.bottomY - BORDER_CORNER_RADIUS
  },
  bottomLeft: {
    x: BORDER_POINTS.leftX + BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.bottomY - BORDER_CORNER_RADIUS
  },
  topLeft: {
    x: BORDER_POINTS.leftX + BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.topY + BORDER_CORNER_RADIUS
  }
});

const toPercent = (value) => (value / BORDER_VIEWBOX) * 100;

const clampRatio = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

const getSparkPoint = (ratioInput) => {
  const ratio = clampRatio(ratioInput >= 1 ? 0.9999 : ratioInput);
  let remaining = ratio * BORDER_PERIMETER;

  const consume = (length) => {
    const amount = Math.min(length, remaining);
    remaining -= amount;
    return amount / length;
  };

  // Top straight (left -> right)
  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = consume(BORDER_STRAIGHT_LENGTH);
    const x = BORDER_POINTS.topStraightStartX + (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(x), top: toPercent(BORDER_POINTS.topY) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  // Top-right corner arc (-90° -> 0°)
  if (remaining <= BORDER_CORNER_LENGTH) {
    const t = remaining / BORDER_CORNER_LENGTH;
    const angle = (-Math.PI / 2) + (t * (Math.PI / 2));
    const x = BORDER_CENTERS.topRight.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
    const y = BORDER_CENTERS.topRight.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
    return { left: toPercent(x), top: toPercent(y) };
  }
  remaining -= BORDER_CORNER_LENGTH;

  // Right straight (top -> bottom)
  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = remaining / BORDER_STRAIGHT_LENGTH;
    const y = BORDER_POINTS.sideStraightStartY + (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(BORDER_POINTS.rightX), top: toPercent(y) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  // Bottom-right corner arc (0° -> 90°)
  if (remaining <= BORDER_CORNER_LENGTH) {
    const t = remaining / BORDER_CORNER_LENGTH;
    const angle = 0 + (t * (Math.PI / 2));
    const x = BORDER_CENTERS.bottomRight.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
    const y = BORDER_CENTERS.bottomRight.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
    return { left: toPercent(x), top: toPercent(y) };
  }
  remaining -= BORDER_CORNER_LENGTH;

  // Bottom straight (right -> left)
  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = remaining / BORDER_STRAIGHT_LENGTH;
    const x = BORDER_POINTS.topStraightEndX - (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(x), top: toPercent(BORDER_POINTS.bottomY) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  // Bottom-left corner arc (90° -> 180°)
  if (remaining <= BORDER_CORNER_LENGTH) {
    const t = remaining / BORDER_CORNER_LENGTH;
    const angle = (Math.PI / 2) + (t * (Math.PI / 2));
    const x = BORDER_CENTERS.bottomLeft.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
    const y = BORDER_CENTERS.bottomLeft.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
    return { left: toPercent(x), top: toPercent(y) };
  }
  remaining -= BORDER_CORNER_LENGTH;

  // Left straight (bottom -> top)
  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = remaining / BORDER_STRAIGHT_LENGTH;
    const y = BORDER_POINTS.sideStraightEndY - (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(BORDER_POINTS.leftX), top: toPercent(y) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  // Top-left corner arc (180° -> 270°)
  const t = (remaining / BORDER_CORNER_LENGTH);
  const angle = Math.PI + (t * (Math.PI / 2));
  const x = BORDER_CENTERS.topLeft.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
  const y = BORDER_CENTERS.topLeft.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
  return { left: toPercent(x), top: toPercent(y) };
};

/**
 * FitnessPlayerFooterSeekThumbnails
 * Props:
 *  - duration (seconds)
 *  - currentTime (seconds)
 *  - fallbackDuration (seconds) optional default if duration invalid
 *  - onSeek(seconds) (optional external handler)
 *  - range: [startSeconds, endSeconds] optional; defines the time window represented by the thumbnails & progress bar
 *           Defaults to [0, duration] (or fallback) when omitted/invalid. All thumbnail positions are clamped to this window.
 *  - commitRef: optional ref to expose commit function for external use
 *  - onZoomNavStateChange: optional callback receiving zoom navigation helpers (prev/next)
 */
const FitnessPlayerFooterSeekThumbnails = ({ duration, currentTime, isSeeking = false, fallbackDuration = 600, onSeek, playerRef, range, onZoomChange, onZoomReset, currentItem, generateThumbnailUrl, commitRef, getTimeRef, onZoomNavStateChange, disabled = false, mediaElementKey = 0 }) => {
  // ---------- Helpers ----------
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
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

  const getBaseSnapshot = useCallback(() => {
    return baseRangeSnapshotRef.current || null;
  }, []);

  const resolveZoomIndex = useCallback(() => {
    const snapshot = getBaseSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return -1;
    let foundIndex = positions.findIndex((pos) => Math.abs(pos - rangeStart) < 0.51);
    if (foundIndex >= 0) return foundIndex;
    let nearestIndex = 0;
    let nearestDelta = Infinity;
    for (let i = 0; i < positions.length; i++) {
      const delta = Math.abs(positions[i] - rangeStart);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearestIndex = i;
      }
    }
    return nearestIndex;
  }, [getBaseSnapshot, rangeStart]);

  const setZoomRangeFromIndex = useCallback((targetIndex) => {
    const snapshot = getBaseSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return;
    const maxIndex = positions.length - 1;
    const clampedIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    const start = positions[clampedIndex];
    const baseRangeEnd = Array.isArray(snapshot?.range) && snapshot.range.length === 2 ? snapshot.range[1] : baseDurationProp;
    const nextBoundary = clampedIndex < maxIndex ? positions[clampedIndex + 1] : baseRangeEnd;
    if (!Number.isFinite(start) || !Number.isFinite(nextBoundary) || nextBoundary <= start) return;
    setZoomRange((prev) => {
      if (prev && Math.abs(prev[0] - start) < 0.001 && Math.abs(prev[1] - nextBoundary) < 0.001) {
        return prev;
      }
      return [start, nextBoundary];
    });
  }, [getBaseSnapshot, baseDurationProp]);

  const stepZoomBackward = useCallback(() => {
    if (disabled || !isZoomed) return;
    const snapshot = getBaseSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return;
    const idx = resolveZoomIndex();
    if (idx <= 0) return;
    setZoomRangeFromIndex(idx - 1);
  }, [disabled, isZoomed, getBaseSnapshot, resolveZoomIndex, setZoomRangeFromIndex]);

  const stepZoomForward = useCallback(() => {
    if (disabled || !isZoomed) return;
    const snapshot = getBaseSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return;
    const idx = resolveZoomIndex();
    if (idx < 0 || idx >= positions.length - 1) return;
    setZoomRangeFromIndex(idx + 1);
  }, [disabled, isZoomed, getBaseSnapshot, resolveZoomIndex, setZoomRangeFromIndex]);

  const { canStepBackward, canStepForward } = useMemo(() => {
    if (!isZoomed || disabled) {
      return { canStepBackward: false, canStepForward: false };
    }
    const snapshot = getBaseSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) {
      return { canStepBackward: false, canStepForward: false };
    }
    const idx = resolveZoomIndex();
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx < positions.length - 1;
    return { canStepBackward: hasPrev, canStepForward: hasNext };
  }, [isZoomed, disabled, getBaseSnapshot, resolveZoomIndex]);

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

      const progressRatio = clamp01(thumbnailProgress / 100);
      const strokeDashoffset = (1 - progressRatio) * BORDER_PERIMETER;
      const showSpark = progressRatio > 0 && progressRatio < 1;
      const sparkPoint = showSpark ? getSparkPoint(progressRatio) : null;
      const sparkStyle = sparkPoint
        ? {
            left: `${sparkPoint.left}%`,
            top: `${sparkPoint.top}%`
          }
        : null;

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
                  <svg
                    className="progress-border-overlay__svg"
                    viewBox={`0 0 ${BORDER_VIEWBOX} ${BORDER_VIEWBOX}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <rect
                      className="progress-border-overlay__track"
                      x={BORDER_MARGIN}
                      y={BORDER_MARGIN}
                      width={BORDER_RECT_SIZE}
                      height={BORDER_RECT_SIZE}
                      rx={BORDER_CORNER_RADIUS}
                      ry={BORDER_CORNER_RADIUS}
                      strokeWidth={BORDER_STROKE}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      className="progress-border-overlay__fill"
                      x={BORDER_MARGIN}
                      y={BORDER_MARGIN}
                      width={BORDER_RECT_SIZE}
                      height={BORDER_RECT_SIZE}
                      rx={BORDER_CORNER_RADIUS}
                      ry={BORDER_CORNER_RADIUS}
                      strokeWidth={BORDER_STROKE}
                      strokeDasharray={BORDER_PERIMETER}
                      strokeDashoffset={strokeDashoffset}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                    />
                  </svg>
                  {showSpark && sparkStyle && (
                    <div className="progress-border-overlay__spark" style={sparkStyle}>
                      <div className="spark-core" />
                    </div>
                  )}
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

FitnessPlayerFooterSeekThumbnails.propTypes = {
  duration: PropTypes.number,
  currentTime: PropTypes.number,
  isSeeking: PropTypes.bool,
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
    metadata: PropTypes.object
  }),
  generateThumbnailUrl: PropTypes.func,
  commitRef: PropTypes.shape({ current: PropTypes.func }),
  getTimeRef: PropTypes.shape({ current: PropTypes.func }),
  onZoomNavStateChange: PropTypes.func,
  disabled: PropTypes.bool,
  mediaElementKey: PropTypes.oneOfType([PropTypes.number, PropTypes.string])
};
