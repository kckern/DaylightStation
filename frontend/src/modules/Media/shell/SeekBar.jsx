// frontend/src/modules/Media/shell/SeekBar.jsx
// Live seek bar bound to any session controller. Reads the hot position tier
// (tick-rate updates re-render only this component), holds a local scrub
// value while dragging, commits transport.seekAbs on release. Fully
// keyboard-operable (role="slider", arrow keys / Home / End). Live content
// gets a LIVE badge instead of a scrubber.
import React, { useRef, useState } from 'react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlaybackPosition } from '../controller/usePlaybackPosition.js';
import './NowPlaying.scss';

/** m:ss / h:mm:ss timecode. Shared by the player chrome surfaces. */
export function formatTime(s) {
  const t = Math.max(0, Math.floor(s ?? 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const KEYBOARD_STEP_S = 5;

export function SeekBar({ target }) {
  const { controller, snapshot, transport, capabilities } = useSessionController(target);
  const live = usePlaybackPosition(controller);
  const [scrub, setScrub] = useState(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const item = snapshot?.currentItem;
  if (!item) return null;

  if (item.isLive || !capabilities.seekable) {
    return (
      <div className="np-seekbar np-seekbar--live">
        <span className="np-live-badge">LIVE</span>
      </div>
    );
  }

  const duration = item.duration ?? 0;
  const position = scrub ?? live.seconds ?? snapshot.position ?? 0;
  const clamped = Math.min(Math.max(0, position), duration || 0);
  const fraction = duration > 0 ? clamped / duration : 0;
  const pct = `${(fraction * 100).toFixed(3)}%`;

  // Pointer x → seconds. Bails (null) when the track has no measurable width
  // (e.g. display:none) so a degenerate layout can never commit a bogus seek.
  const secondsFromPointer = (e) => {
    const rect = trackRef.current?.getBoundingClientRect?.();
    if (!rect || !(rect.width > 0) || !(duration > 0)) return null;
    if (!Number.isFinite(e.clientX)) return null;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(frac * duration);
  };

  const onPointerDown = (e) => {
    if (!duration) return;
    const secs = secondsFromPointer(e);
    if (secs == null) return;
    draggingRef.current = true;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    setScrub(secs);
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    const secs = secondsFromPointer(e);
    if (secs != null) setScrub(secs);
  };

  const onPointerUp = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const secs = secondsFromPointer(e) ?? scrub;
    setScrub(null);
    if (secs != null) transport.seekAbs?.(secs);
  };

  const onPointerCancel = () => {
    draggingRef.current = false;
    setScrub(null);
  };

  const onKeyDown = (e) => {
    if (!duration) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(duration, clamped + KEYBOARD_STEP_S);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, clamped - KEYBOARD_STEP_S);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = duration;
    if (next == null) return;
    e.preventDefault();
    transport.seekAbs?.(next);
  };

  return (
    <div className="np-seekbar">
      <span className="np-seek-time" data-testid="np-seek-elapsed">{formatTime(clamped)}</span>
      <div
        data-testid="np-seek"
        ref={trackRef}
        className="np-seek-track"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(clamped)}
        aria-valuetext={`${formatTime(clamped)} of ${duration ? formatTime(duration) : 'unknown length'}`}
        aria-disabled={duration ? undefined : 'true'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <div className="np-seek-rail" />
        <div className="np-seek-fill" style={{ width: pct }} />
        {duration > 0 && <div className="np-seek-thumb" style={{ left: pct }} />}
      </div>
      <span className="np-seek-time" data-testid="np-seek-remaining">
        {duration ? `-${formatTime(Math.max(0, duration - clamped))}` : '–:––'}
      </span>
    </div>
  );
}

export default SeekBar;
