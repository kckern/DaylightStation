// frontend/src/modules/Media/shell/SeekBar.jsx
// Live seek bar bound to any session controller. Reads the hot position tier
// (tick-rate updates re-render only this component), holds a local scrub
// value while dragging, commits transport.seekAbs on release. Fully
// keyboard-operable (role="slider", arrow keys / Home / End). Live content
// gets a LIVE badge instead of a scrubber.
import React, { useRef, useState } from 'react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlaybackPosition } from '../controller/usePlaybackPosition.js';
import { formatTime } from './formatTime.js';
import './NowPlaying.scss';

const KEYBOARD_STEP_S = 5;

export function SeekBar({ target, availability = null }) {
  const { controller, snapshot, transport, capabilities } = useSessionController(target);
  const live = usePlaybackPosition(controller);
  const [scrub, setScrub] = useState(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const dragRectRef = useRef(null);
  const dragBindingRef = useRef(null);
  const contextRef = useRef(null);

  const item = snapshot?.currentItem;
  const owner = snapshot?.meta?.playbackOwner;
  const contextKey = JSON.stringify([
    target === 'local' ? 'local' : target?.deviceId,
    snapshot?.sessionId, item?.contentId,
    snapshot?.queue?.items?.[snapshot?.queue?.currentIndex]?.queueItemId,
    owner?.ownerInstanceId, owner?.playbackRevision,
  ]);
  // Canvas may reuse this component across screens or queue visits. Keep a
  // distinct context even for A→B→A, without tying a drag to metadata objects.
  if (contextRef.current?.key !== contextKey || contextRef.current?.controller !== controller) {
    contextRef.current = { key: contextKey, controller };
  }
  const context = contextRef.current;
  if (!item) return null;

  if (item.isLive) {
    return (
      <div className="np-seekbar np-seekbar--live">
        <span className="np-live-badge">LIVE</span>
      </div>
    );
  }

  const duration = Number.isFinite(item.duration) && item.duration > 0 ? item.duration : 0;
  const canSeek = availability?.available !== false && capabilities.seekable && duration > 0;
  const position = (scrub?.context === context ? scrub.seconds : null) ?? live.seconds ?? snapshot.position ?? 0;
  const clamped = Math.min(Math.max(0, position), duration || 0);
  const fraction = duration > 0 ? clamped / duration : 0;
  const pct = `${(fraction * 100).toFixed(3)}%`;
  const ownsGesture = () => dragBindingRef.current?.context === contextRef.current
    && dragBindingRef.current?.duration === duration
    && dragBindingRef.current?.node === (controller?.getMediaElement?.() ?? null);

  // Pointer x → seconds. Bails (null) when the track has no measurable width
  // (e.g. display:none) so a degenerate layout can never commit a bogus seek.
  const secondsFromPointer = (e, rect = trackRef.current?.getBoundingClientRect?.()) => {
    if (!rect || !(rect.width > 0) || !(duration > 0)) return null;
    if (!Number.isFinite(e.clientX)) return null;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(frac * duration);
  };

  const onPointerDown = (e) => {
    if (!canSeek) return;
    const rect = trackRef.current?.getBoundingClientRect?.();
    const secs = secondsFromPointer(e, rect);
    if (secs == null) return;
    draggingRef.current = true;
    dragBindingRef.current = { context, duration, node: controller?.getMediaElement?.() ?? null };
    // Preview time can widen its label and reflow this flex track. A pointer
    // gesture represents coordinates in the geometry where it began, so keep
    // that rect through pointerup rather than remapping the same x afterward.
    dragRectRef.current = rect;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    setScrub({ seconds: secs, context });
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current || !canSeek || !ownsGesture()) return;
    const secs = secondsFromPointer(e, dragRectRef.current);
    if (secs != null) setScrub({ seconds: secs, context });
  };

  const onPointerUp = (e) => {
    if (!draggingRef.current) return;
    // Fleet availability can change during a captured pointer gesture. Do not
    // commit a remote seek that was valid when pressed but unsafe at release.
    if (!canSeek || !ownsGesture()) {
      draggingRef.current = false;
      dragRectRef.current = null;
      dragBindingRef.current = null;
      setScrub(null);
      return;
    }
    draggingRef.current = false;
    const secs = secondsFromPointer(e, dragRectRef.current) ?? scrub?.seconds;
    dragRectRef.current = null;
    dragBindingRef.current = null;
    setScrub(null);
    // Remote seekAbs resolves on device-ack and can reject on ack timeout;
    // correctness comes from device-state, so never leak an unhandled
    // rejection. (Local seekAbs returns undefined — Promise.resolve is safe.)
    if (secs != null) Promise.resolve(transport.seekAbs?.(secs)).catch(() => {});
  };

  const onPointerCancel = () => {
    draggingRef.current = false;
    dragRectRef.current = null;
    dragBindingRef.current = null;
    setScrub(null);
  };

  const onKeyDown = (e) => {
    if (!canSeek) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(duration, clamped + KEYBOARD_STEP_S);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, clamped - KEYBOARD_STEP_S);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = duration;
    if (next == null) return;
    e.preventDefault();
    Promise.resolve(transport.seekAbs?.(next)).catch(() => {});
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
        aria-disabled={canSeek ? undefined : 'true'}
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
