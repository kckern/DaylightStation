import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import usePlayerController from '../../Player/usePlayerController.js';
import playbackLog from '../../Player/lib/playbackLogger.js';
import FitnessPlayerFooterSeekThumbnail from './FitnessPlayerFooterSeekThumbnail.jsx';
import ProgressFrame from './ProgressFrame.jsx';
import './FitnessPlayerFooterSeekThumbnails.scss';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const FOOTER_LOG_EVENT = 'fitness-footer';
const DEBUG_FOOTER = false;
const FOOTER_LOG_PHASES = new Set([
  'seek-intent-recorded',
  'seek-intent-restored',
  'seek-commit',
  'seek-dispatch',
  'media-seeked',
  'thumbnail-seek-intent'
]);

const logFooterEvent = (phase, payload = {}) => {
  if (!DEBUG_FOOTER) return;
  if (!FOOTER_LOG_PHASES.has(phase)) return;
  playbackLog(FOOTER_LOG_EVENT, { phase, ...payload });
};

const resolveSeekDirection = (targetSeconds, referenceSeconds) => {
  if (!Number.isFinite(targetSeconds) || !Number.isFinite(referenceSeconds)) return 'unknown';
  const EPSILON = 0.001;
  if (targetSeconds > referenceSeconds + EPSILON) return 'forward';
  if (targetSeconds < referenceSeconds - EPSILON) return 'backward';
  return 'steady';
};

const FitnessPlayerFooterSeekThumbnails = ({
  duration,
  currentTime,
  isSeeking = false,
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
  const BASE_PENDING_TOLERANCE = 0.05;
  const CLEAR_PENDING_TOLERANCE = 0.25;
  const STICKY_INTENT_MS = 700;
  const SETTLED_GRACE_MS = 650;
  const PENDING_MAX_HOLD_MS = 2500;

  const formatTime = useCallback((seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }, []);

  const baseDurationProp = (duration && !Number.isNaN(duration) ? duration : (currentItem?.duration || fallbackDuration));

  const [zoomRange, setZoomRange] = useState(null);
  const unzoomedPositionsRef = useRef([]);
  const zoomStackRef = useRef([]);
  const lastViewSnapshotRef = useRef({ positions: [], range: [0, baseDurationProp] });
  const navStateRef = useRef(null);
  const lastSeekIntentRef = useRef(null);
  const lastInteractionRef = useRef(null);
  const lastCommitRef = useRef(null);
  const currentMediaIdentity = useMemo(() => {
    if (!currentItem) return null;
    return currentItem.media_key || currentItem.id || currentItem.plex || currentItem.ratingKey || null;
  }, [currentItem]);

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
    let baseRange = [0, baseDurationProp];
    if (Array.isArray(range) && range.length === 2) {
      const [rs, re] = range.map(parseFloat);
      if (Number.isFinite(rs) && Number.isFinite(re) && re > rs) baseRange = [rs, re];
    }
    if (!zoomRange) return baseRange;
    if (!Array.isArray(zoomRange) || zoomRange.length !== 2) return baseRange;
    const [zs, ze] = zoomRange;
    if (Number.isFinite(zs) && Number.isFinite(ze) && ze > zs) return [zs, ze];
    if (Number.isFinite(zs) && zs === ze) {
      const basePositions = unzoomedPositionsRef.current || [];
      if (basePositions.length) {
        const idx = basePositions.findIndex((p) => Math.abs(p - zs) < 0.51);
        if (idx >= 0) {
          if (idx < basePositions.length - 1) {
            return [basePositions[idx], basePositions[idx + 1]];
          }
          if (idx > 0) {
            return [basePositions[idx - 1], basePositions[idx]];
          }
        }
      }
      const segment = baseDurationProp / 10;
      const end = Math.min(zs + segment, baseRange[1]);
      return [zs, end];
    }
    return baseRange;
  }, [range, zoomRange, baseDurationProp]);

  const [rangeStart, rangeEnd] = effectiveRange;
  const rangeSpan = Math.max(0, rangeEnd - rangeStart);

  const rangePositions = useMemo(() => {
    const arr = buildRangePositions(rangeStart, rangeEnd);
    if (!zoomRange) {
      unzoomedPositionsRef.current = arr;
    }
    return arr;
  }, [rangeStart, rangeEnd, buildRangePositions, zoomRange]);

  useEffect(() => {
    lastViewSnapshotRef.current = {
      positions: Array.isArray(rangePositions) ? rangePositions.slice() : [],
      range: [rangeStart, rangeEnd]
    };
  }, [rangePositions, rangeStart, rangeEnd]);

  useEffect(() => {
    if (!zoomRange) {
      zoomStackRef.current = [];
    }
  }, [zoomRange]);

  const [pendingTime, setPendingTime] = useState(null);
  const [previewTime, setPreviewTime] = useState(null);
  const lastSeekRef = useRef({ time: null, expireAt: 0 });
  const awaitingSettleRef = useRef(false);
  const resetZoomOnPlayingRef = useRef(false);
  const rafRef = useRef(null);
  const pendingMetaRef = useRef({ target: null, startedAt: 0, settledAt: 0 });

  const nowTs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  const { seek, getCurrentTime: getPlayerCurrentTime } = usePlayerController(playerRef);

  const resolveActualPlaybackTime = useCallback(() => {
    if (typeof getPlayerCurrentTime !== 'function') return null;
    const value = getPlayerCurrentTime();
    return Number.isFinite(value) ? value : null;
  }, [getPlayerCurrentTime]);

  const syncSeekIntentToResilience = useCallback((seconds) => {
    if (!Number.isFinite(seconds)) return false;
    const api = playerRef?.current || null;
    const controller = api?.getMediaResilienceController?.();
    if (!controller) return false;
    if (typeof controller.recordSeekIntentSeconds === 'function') {
      controller.recordSeekIntentSeconds(seconds);
      return true;
    }
    if (typeof controller.recordSeekIntentMs === 'function') {
      controller.recordSeekIntentMs(Math.max(0, seconds * 1000));
      return true;
    }
    return false;
  }, [playerRef]);

  const recordSeekIntent = useCallback((targetSeconds) => {
    const api = playerRef?.current || null;
    const controller = api?.getMediaResilienceController?.() || null;
    const normalizedSeconds = Number.isFinite(targetSeconds) ? Math.max(0, targetSeconds) : null;
    const seekToIntentMs = normalizedSeconds != null ? normalizedSeconds * 1000 : null;

    if (normalizedSeconds != null) {
      const snapshot = {
        seconds: normalizedSeconds,
        identity: currentMediaIdentity || null
      };
      lastSeekIntentRef.current = snapshot;
      const synced = syncSeekIntentToResilience(normalizedSeconds);
      logFooterEvent('seek-intent-recorded', {
        targetSeconds: normalizedSeconds,
        mediaIdentity: snapshot.identity,
        synced,
        interaction: lastInteractionRef.current
      });
    }

    return { api, controller, seekToIntentMs };
  }, [playerRef, currentMediaIdentity, syncSeekIntentToResilience]);

  useEffect(() => {
    const payload = lastSeekIntentRef.current;
    if (!payload || !Number.isFinite(payload.seconds)) return;
    if (payload.identity && currentMediaIdentity && payload.identity !== currentMediaIdentity) {
      lastSeekIntentRef.current = null;
      return;
    }
    const synced = syncSeekIntentToResilience(payload.seconds);
    logFooterEvent('seek-intent-restored', {
      targetSeconds: payload.seconds,
      mediaIdentity: payload.identity,
      synced,
      mediaElementKey,
      interaction: lastInteractionRef.current
    });
  }, [syncSeekIntentToResilience, mediaElementKey, currentMediaIdentity]);

  const requestHardResetAt = useCallback((targetSeconds, intentMeta = null) => {
    const meta = intentMeta || recordSeekIntent(targetSeconds);
    const api = meta?.api || playerRef?.current;
    if (!api) return false;
    const controller = meta?.controller || api.getMediaResilienceController?.();
    const seekToIntentMs = meta?.seekToIntentMs ?? (Number.isFinite(targetSeconds) ? Math.max(0, targetSeconds * 1000) : null);

    if (controller?.forceReload) {
      controller.forceReload({ reason: 'fitness-stalled-seek', seekToIntentMs });
      return true;
    }
    if (api?.forceMediaReload) {
      api.forceMediaReload({ reason: 'fitness-stalled-seek', seekToIntentMs });
      return true;
    }
    return false;
  }, [playerRef, recordSeekIntent]);

  const displayTime = useMemo(() => {
    if (previewTime != null) return previewTime;
    if (pendingTime != null) return pendingTime;
    return currentTime;
  }, [previewTime, pendingTime, currentTime]);

  const handleThumbnailInteraction = useCallback((phase, detail = {}) => {
    const snapshot = {
      phase,
      ...detail,
      currentTimeSnapshot: currentTime,
      displayTimeSnapshot: displayTime,
      pendingTime,
      previewTime,
      mediaIdentity: currentMediaIdentity,
      timestamp: Date.now()
    };
    lastInteractionRef.current = snapshot;
    logFooterEvent(phase, snapshot);
  }, [currentTime, displayTime, pendingTime, previewTime, currentMediaIdentity]);

  const isZoomed = !!zoomRange;

  const getActiveZoomSnapshot = useCallback(() => {
    const stack = zoomStackRef.current;
    if (!Array.isArray(stack) || !stack.length) return null;
    return stack[stack.length - 1];
  }, []);

  const handleZoomRequest = useCallback((bounds) => {
    if (disabled) return;
    if (!Array.isArray(bounds) || bounds.length !== 2) return;
    const [start, end] = bounds;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (zoomRange && Math.abs((zoomRange[0] ?? 0) - start) < 0.0001 && Math.abs((zoomRange[1] ?? 0) - end) < 0.0001) {
      return;
    }
    const snapshot = lastViewSnapshotRef.current;
    if (snapshot) {
      const positionsClone = Array.isArray(snapshot.positions) ? snapshot.positions.slice() : [];
      const rangeClone = Array.isArray(snapshot.range) ? snapshot.range.slice() : [rangeStart, rangeEnd];
      zoomStackRef.current = [...zoomStackRef.current, { positions: positionsClone, range: rangeClone }];
    }
    setZoomRange(bounds);
  }, [disabled, rangeStart, rangeEnd, zoomRange]);

  const resolveZoomIndex = useCallback(() => {
    const snapshot = getActiveZoomSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return -1;
    const target = Number.isFinite(rangeStart) ? rangeStart : positions[0];
    if (!Number.isFinite(target)) return -1;
    let foundIndex = positions.findIndex((pos) => Math.abs(pos - target) < 0.001);
    if (foundIndex >= 0) return foundIndex;
    let nearestIndex = 0;
    let nearestDelta = Infinity;
    for (let i = 0; i < positions.length; i++) {
      const delta = Math.abs(positions[i] - target);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearestIndex = i;
      }
    }
    return nearestIndex;
  }, [getActiveZoomSnapshot, rangeStart]);

  const setZoomRangeFromIndex = useCallback((targetIndex) => {
    const snapshot = getActiveZoomSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return;
    const [, parentEnd] = Array.isArray(snapshot?.range) ? snapshot.range : [];
    const parentRangeEnd = Number.isFinite(parentEnd) ? parentEnd : baseDurationProp;
    const maxIndex = positions.length - 1;
    const clampedIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    const start = positions[clampedIndex];
    const nextBoundary = clampedIndex < maxIndex ? positions[clampedIndex + 1] : parentRangeEnd;
    if (!Number.isFinite(start) || !Number.isFinite(nextBoundary) || nextBoundary <= start) return;
    setZoomRange((prev) => {
      if (prev && Math.abs(prev[0] - start) < 0.001 && Math.abs(prev[1] - nextBoundary) < 0.001) {
        return prev;
      }
      return [start, nextBoundary];
    });
  }, [getActiveZoomSnapshot, baseDurationProp]);

  const stepZoomBackward = useCallback(() => {
    if (disabled || !isZoomed) return;
    const snapshot = getActiveZoomSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return;
    const idx = resolveZoomIndex();
    if (idx <= 0) return;
    setZoomRangeFromIndex(idx - 1);
  }, [disabled, isZoomed, getActiveZoomSnapshot, resolveZoomIndex, setZoomRangeFromIndex]);

  const stepZoomForward = useCallback(() => {
    if (disabled || !isZoomed) return;
    const snapshot = getActiveZoomSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) return;
    const idx = resolveZoomIndex();
    if (idx < 0 || idx >= positions.length - 1) return;
    setZoomRangeFromIndex(idx + 1);
  }, [disabled, isZoomed, getActiveZoomSnapshot, resolveZoomIndex, setZoomRangeFromIndex]);

  const { canStepBackward, canStepForward } = useMemo(() => {
    if (!isZoomed || disabled) {
      return { canStepBackward: false, canStepForward: false };
    }
    const snapshot = getActiveZoomSnapshot();
    const positions = Array.isArray(snapshot?.positions) ? snapshot.positions : [];
    if (!positions.length) {
      return { canStepBackward: false, canStepForward: false };
    }
    const idx = resolveZoomIndex();
    const hasPrev = idx > 0;
    const hasNext = idx >= 0 && idx < positions.length - 1;
    return { canStepBackward: hasPrev, canStepForward: hasNext };
  }, [isZoomed, disabled, getActiveZoomSnapshot, resolveZoomIndex]);

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

  useEffect(() => {
    if (onZoomReset && typeof onZoomReset === 'object') {
      onZoomReset.current = () => {
        zoomStackRef.current = [];
        setZoomRange(null);
      };
    }
  }, [onZoomReset]);

  const positionToSeconds = useCallback((clientX, rect) => {
    if (!rect) return rangeStart;
    const clickX = clientX - rect.left;
    const pct = clamp01(clickX / rect.width);
    return rangeStart + pct * rangeSpan;
  }, [rangeStart, rangeSpan]);

  const commit = useCallback((t) => {
    if (disabled) return;
    const normalizedTarget = Number.isFinite(t) ? Math.max(0, t) : 0;
    // Telemetry for testing - logs seek target for verification
    if (typeof window !== 'undefined') {
      console.log('[FitnessPlayerFooterSeekThumbnails] commit called', { t: normalizedTarget });
    }
    const seekDirection = resolveSeekDirection(normalizedTarget, currentTime);
    const intentMeta = recordSeekIntent(normalizedTarget);
    setPendingTime(normalizedTarget);
    awaitingSettleRef.current = true;
    pendingMetaRef.current = { target: normalizedTarget, startedAt: nowTs(), settledAt: 0 };
    lastSeekRef.current.time = normalizedTarget;
    const performedReset = isStalled ? requestHardResetAt(normalizedTarget, intentMeta) : false;
    const commitSnapshot = {
      target: normalizedTarget,
      performedReset,
      isStalled,
      intentMeta,
      pendingMeta: pendingMetaRef.current,
      interaction: lastInteractionRef.current,
      previousPreviewTime: previewTime,
      previousPendingTime: pendingTime,
      currentTimeSnapshot: currentTime,
      direction: seekDirection,
      mediaIdentity: currentMediaIdentity
    };
    lastCommitRef.current = commitSnapshot;
    logFooterEvent('seek-commit', commitSnapshot);
    logFooterEvent('seek-dispatch', {
      target: normalizedTarget,
      direction: seekDirection,
      performedReset,
      transport: performedReset ? 'resilience-force-reset' : 'player-seek',
      interaction: lastInteractionRef.current,
      pendingMeta: pendingMetaRef.current,
      previousPreviewTime: previewTime,
      previousPendingTime: pendingTime,
      currentTimeSnapshot: currentTime
    });
    if (!performedReset) {
      seek(normalizedTarget);
    }
    onSeek?.(normalizedTarget);
  }, [seek, onSeek, disabled, isStalled, requestHardResetAt, recordSeekIntent, previewTime, pendingTime, currentTime, currentMediaIdentity]);

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
        logFooterEvent('media-seeked', {
          pendingMeta: pendingMetaRef.current,
          lastCommit: lastCommitRef.current,
          interaction: lastInteractionRef.current,
          actualTime: resolveActualPlaybackTime()
        });
      }
    };
    const handlePlaying = () => {
      handleSettled();
      if (resetZoomOnPlayingRef.current) {
        resetZoomOnPlayingRef.current = false;
        setZoomRange(null);
      }
      logFooterEvent('media-playing', {
        pendingMeta: pendingMetaRef.current,
        lastCommit: lastCommitRef.current,
        interaction: lastInteractionRef.current,
        actualTime: resolveActualPlaybackTime()
      });
    };
    const handleRecovery = () => {
      if (awaitingSettleRef.current || pendingTime != null) {
        awaitingSettleRef.current = false;
        pendingMetaRef.current = { target: null, startedAt: 0, settledAt: 0 };
        setPendingTime(null);
        lastSeekRef.current.expireAt = nowTs() + STICKY_INTENT_MS;
        logFooterEvent('media-recovery', {
          interaction: lastInteractionRef.current,
          actualTime: resolveActualPlaybackTime()
        });
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
  }, [playerRef, pendingTime, mediaElementKey, resolveActualPlaybackTime]);

  useEffect(() => {
    if (pendingTime == null) return;
    const meta = pendingMetaRef.current || {};
    const target = Number.isFinite(meta.target) ? meta.target : pendingTime;
    if (!Number.isFinite(target)) {
      logFooterEvent('pending-cleared', {
        reason: 'invalid-target',
        pendingMeta: meta,
        pendingTime,
        currentTimeSnapshot: currentTime
      });
      pendingMetaRef.current = { target: null, startedAt: 0, settledAt: 0 };
      awaitingSettleRef.current = false;
      setPendingTime(null);
      lastSeekRef.current.expireAt = nowTs() + STICKY_INTENT_MS;
      return;
    }
    const now = nowTs();
    const delta = Math.abs(currentTime - target);
    const tolerance = awaitingSettleRef.current ? BASE_PENDING_TOLERANCE : CLEAR_PENDING_TOLERANCE;
    const pendingDirection = resolveSeekDirection(target, currentTime);
    const clearIntent = (reason, extra = {}) => {
      logFooterEvent('pending-cleared', {
        reason,
        targetSeconds: target,
        delta,
        tolerance,
        pendingMeta: meta,
        pendingTime,
        currentTimeSnapshot: currentTime,
        direction: pendingDirection,
        ...extra
      });
      pendingMetaRef.current = { target: null, startedAt: 0, settledAt: 0 };
      awaitingSettleRef.current = false;
      setPendingTime(null);
      lastSeekRef.current.expireAt = now + STICKY_INTENT_MS;
    };

    if (delta <= tolerance) {
      clearIntent('within-tolerance');
      return;
    }

    if (meta.settledAt) {
      const relaxedTolerance = CLEAR_PENDING_TOLERANCE * 1.5;
      if (now - meta.settledAt > SETTLED_GRACE_MS && delta <= relaxedTolerance) {
        clearIntent('grace-window', { relaxedTolerance });
        return;
      }
    }

    if (meta.startedAt && now - meta.startedAt > PENDING_MAX_HOLD_MS) {
      clearIntent('max-hold-expired', { holdDurationMs: now - meta.startedAt });
    }
  }, [currentTime, pendingTime]);

  useEffect(() => {
    if (commitRef) {
      commitRef.current = commit;
    }
  }, [commitRef, commit]);

  useEffect(() => {
    if (getTimeRef) {
      getTimeRef.current = () => displayTime;
    }
  }, [getTimeRef, displayTime]);

  const updatePreview = useCallback((clientX, rect) => {
    if (!isSeeking || disabled) return;
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

  const getGreyShade = useCallback((pos) => {
    const seed = Math.floor(pos * 1000);
    const hash = (seed * 9301 + 49297) % 233280;
    const normalized = hash / 233280;
    const greyValue = Math.floor(25 + normalized * 35);
    return `rgb(${greyValue}, ${greyValue}, ${greyValue})`;
  }, []);

  const handleThumbnailSeek = useCallback((seekTarget, rangeAnchor, meta = null) => {
    if (disabled) return;
    const resolvedTarget = Number.isFinite(rangeAnchor)
      ? rangeAnchor
      : (Number.isFinite(seekTarget) ? seekTarget : rangeStart);
    const direction = resolveSeekDirection(resolvedTarget, currentTime);
    logFooterEvent('thumbnail-seek-intent', {
      seekTarget,
      rangeAnchor,
      resolvedTarget,
      direction,
      thumbnailMeta: meta,
      interaction: lastInteractionRef.current,
      currentTimeSnapshot: currentTime,
      displayTimeSnapshot: displayTime
    });
    commit(resolvedTarget);
    if (zoomRange) {
      resetZoomOnPlayingRef.current = true;
    }
  }, [commit, zoomRange, rangeStart, disabled, currentTime, displayTime]);

  const renderedSeekButtons = useMemo(() => {
    if (!currentItem) return null;
    const posterSrc = currentItem?.seasonImage || currentItem?.image;
    const plexObj = {
      plex: currentItem.plex || currentItem.id,
      id: currentItem.id,
      thumb_id: currentItem.thumb_id ? (typeof currentItem.thumb_id === 'number' ? currentItem.thumb_id : parseInt(currentItem.thumb_id, 10)) : null,
      image: currentItem.image,
      media_key: currentItem.media_key,
      ratingKey: currentItem.ratingKey,
      metadata: currentItem.metadata
    };
    return rangePositions.map((pos, idx) => {
      const segmentStart = pos;
      const nextBoundary = idx < rangePositions.length - 1 ? rangePositions[idx + 1] : rangeEnd;
      const segmentEnd = Number.isFinite(nextBoundary) ? nextBoundary : segmentStart;
      const segmentDuration = Math.max(segmentEnd - segmentStart, 0);
      const nominalSegmentDuration = rangeSpan > 0 && rangePositions.length > 0
        ? rangeSpan / rangePositions.length
        : null;
      const visibleRatio = nominalSegmentDuration
        ? clamp01(segmentDuration / nominalSegmentDuration)
        : 1;

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

      const sampleTime = segmentStart;
      const labelTime = isActive ? displayTime : segmentStart;
      const seekTime = segmentStart;

      const isOrigin = !isZoomed && Math.abs(segmentStart - rangeStart) < 0.001;
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

      let thumbnailProgress = 0;
      let isActivelyPlaying = false;
      if (isActive) {
        const endTime = segmentEnd;
        const durationWindow = endTime - segmentStart;
        const BOUNDARY_TOLERANCE = 0.1;
        const effectiveEnd = endTime - BOUNDARY_TOLERANCE;
        if (durationWindow > 0 && currentTime >= segmentStart && currentTime < effectiveEnd) {
          const progressInSegment = currentTime - segmentStart;
          thumbnailProgress = clamp01(progressInSegment / durationWindow);
          isActivelyPlaying = true;
        }
      }

      const label = formatTime(Math.max(labelTime, 0));
      const telemetryMeta = {
        thumbnailIndex: idx,
        label,
        labelTime,
        segmentStart,
        segmentEnd,
        seekTime,
        sampleTime,
        state,
        isActive,
        isPast,
        isOrigin,
        visibleRatio,
        greyBg,
        currentTimeSnapshot: currentTime,
        displayTimeSnapshot: displayTime
      };
      const progressRatio = clamp01(thumbnailProgress);
      const showSpark = progressRatio > 0 && progressRatio < 1;

      return (
        <FitnessPlayerFooterSeekThumbnail
          key={`rng-${idx}-${Math.round(segmentStart)}`}
          index={idx}
          state={state}
          isOrigin={isOrigin}
          disabled={disabled}
          className={classNames}
          segmentStart={segmentStart}
          segmentEnd={segmentEnd}
          globalRangeStart={rangeStart}
          globalRangeEnd={rangeEnd}
          sampleTime={sampleTime}
          labelTime={labelTime}
          seekTime={seekTime}
          imgSrc={imgSrc}
          posterSrc={posterSrc}
          greyBg={greyBg}
          label={label}
          isActive={isActive}
          progressRatio={progressRatio}
          showSpark={showSpark}
          onSeek={(target, anchor) => handleThumbnailSeek(target, anchor, telemetryMeta)}
          onZoom={disabled ? undefined : handleZoomRequest}
          enableZoom={!disabled}
          visibleRatio={visibleRatio}
          telemetryMeta={telemetryMeta}
          onTelemetry={handleThumbnailInteraction}
        />
      );
    });
  }, [currentItem, rangePositions, rangeEnd, displayTime, formatTime, isZoomed, rangeStart, generateThumbnailUrl, getGreyShade, currentTime, disabled, handleThumbnailSeek, handleZoomRequest, handleThumbnailInteraction, rangeSpan]);

  const fullDuration = baseDurationProp || 0;
  const progressPct = useMemo(() => {
    if (!Number.isFinite(fullDuration) || fullDuration <= 0) return 0;
    const normalized = clamp01(displayTime / fullDuration);
    return normalized * 100;
  }, [displayTime, fullDuration]);
  const showingIntent = pendingTime != null || (isSeeking && previewTime != null);

  const zoomOverlay = useMemo(() => {
    if (!isZoomed || !Number.isFinite(fullDuration) || fullDuration <= 0) return null;
    const start = Number.isFinite(rangeStart) ? rangeStart : 0;
    const end = Number.isFinite(rangeEnd) ? rangeEnd : 0;
    const span = end - start;
    if (!Number.isFinite(span) || span <= 0) return null;
    if (span >= fullDuration * 0.98) return null;
    const leftUnit = clamp01(start / fullDuration);
    const rightUnit = clamp01(end / fullDuration);
    const widthUnit = Math.max(0, rightUnit - leftUnit);
    return { leftPct: leftUnit * 100, widthPct: widthUnit * 100 };
  }, [isZoomed, rangeStart, rangeEnd, fullDuration]);

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
      >
        <div className="progress" style={{ width: `${progressPct}%` }} />
        {zoomOverlay && (
          <ProgressFrame leftPct={zoomOverlay.leftPct} widthPct={zoomOverlay.widthPct} />
        )}
      </div>
      <div className={`seek-thumbnails${disabled ? ' disabled' : ''}`}>
        {renderedSeekButtons}
      </div>
    </div>
  );
};

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
  mediaElementKey: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  isStalled: PropTypes.bool
};

export default FitnessPlayerFooterSeekThumbnails;
