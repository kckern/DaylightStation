import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import usePlayerController from '../Player/usePlayerController.js';

/**
 * FitnessPlayerFooterSeekThumbnails
 * Props:
 *  - duration (seconds)
 *  - currentTime (seconds)
 *  - fallbackDuration (seconds) optional default if duration invalid
 *  - onSeek(seconds) (optional external handler)
 *  - seekButtons (React nodes)
 */
const FitnessPlayerFooterSeekThumbnails = ({ duration, currentTime, isSeeking = false, fallbackDuration = 600, onSeek, seekButtons, playerRef }) => {
  // ---------- Helpers ----------
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const percentOf = (t, total) => total > 0 ? clamp01(t / total) : 0;
  const BASE_PENDING_TOLERANCE = 0.05;  // keeps optimistic bar until near actual
  const CLEAR_PENDING_TOLERANCE = 0.25; // when to clear internal pending state

  const baseDurationProp = (duration && !isNaN(duration) ? duration : fallbackDuration);
  const { seek } = usePlayerController(playerRef);

  // ---------- Intent State ----------
  const [pendingTime, setPendingTime] = useState(null);   // committed seek awaiting media time
  const [previewTime, setPreviewTime] = useState(null);   // hover / drag preview (only while seeking)
  const rafRef = useRef(); // for throttling preview updates

  // ---------- Seek Positions & Total Duration ----------
  const seekMeta = useMemo(() => {
    if (!seekButtons) return { positions: [], total: baseDurationProp };
    const positions = [];
    React.Children.forEach(seekButtons, (child) => {
      if (!React.isValidElement(child)) return;
      const raw = parseFloat(child.props['data-pos']);
      if (Number.isFinite(raw)) positions.push(raw);
    });
    positions.sort((a,b)=>a-b);
    const last = positions.length ? positions[positions.length - 1] : 0;
    return { positions, total: Math.max(baseDurationProp, last) };
  }, [seekButtons, baseDurationProp]);

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
    const clickX = clientX - rect.left;
    return clamp01(clickX / rect.width) * seekMeta.total;
  }, [seekMeta.total]);

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
  const renderedSeekButtons = useMemo(() => {
    if (!seekButtons) return null;
    return React.Children.map(seekButtons, (child) => {
      if (!React.isValidElement(child)) return child;
      const raw = parseFloat(child.props['data-pos']);
      if (!Number.isFinite(raw)) return child;
      const state = activePos != null && raw === activePos ? 'active' : (activePos != null && raw < activePos ? 'past' : 'future');
      const onClick = (e) => { commit(raw); child.props.onClick?.(e); };
      return React.cloneElement(child, { onClick, 'data-state': state });
    });
  }, [seekButtons, activePos, commit]);

  const progressPct = percentOf(displayTime, seekMeta.total) * 100;
  const showingIntent = pendingTime != null || (isSeeking && previewTime != null);

  return (
    <div className="footer-seek-thumbnails">
      <div
        className="progress-bar"
        data-intent={showingIntent ? '1' : '0'}
        onClick={handleClick}
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
};

export default FitnessPlayerFooterSeekThumbnails;
