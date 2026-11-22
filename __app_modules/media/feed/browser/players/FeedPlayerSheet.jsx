import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { useDialogFocus } from '@/lib/ui/dismiss/useDialogFocus.js';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { useOverlayFocusReturn } from '@/lib/ui/dismiss/useOverlayFocusReturn.js';
import { proxyImage, safeImage } from "../Scroll/cards/utils.js";
import { feedLog } from "../Scroll/feedLog.js";
import { useFeedPlayer, SPEED_STEPS } from "./FeedPlayerContext.jsx";
import { formatFeedPlaybackTime } from './formatTime.js';
import { formatFeedVolume } from './formatVolume.js';
import { getSeekMax } from './seekRange.js';
import SpeakerIcon from './SpeakerIcon.jsx';
import "./FeedPlayerSheet.scss";

export default function FeedPlayerSheet({ open, onClose, item, playback, openerRef }) {
  const {
    speed, setSpeed, volume, setVolume, muted, toggleMute,
    activeMedia, pausedMedia, resumePaused,
  } = useFeedPlayer();

  const { playing, currentTime, duration, toggle, seek } = playback || {};
  const seekMax = getSeekMax(duration);

  // --- Swipe-to-dismiss gesture ---
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const volumeRef = useRef(null);
  const scrubberRef = useRef(null);
  const scrubDragRef = useRef(null);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const active = open && Boolean(item);
  const usesDismissStack = useDismissLayer(active, onClose);
  useOverlayFocusReturn(active, openerRef);
  const handleKeys = useDialogFocus(active, sheetRef, closeRef);
  const showVolume = useMediaQuery('(min-width: 900px)');
  const bindVolume = useCallback(node => {
    const previous = volumeRef.current;
    volumeRef.current = node;
    // Capture focus before the responsive volume control leaves the DOM.
    if (!node && previous && document.activeElement === previous) {
      closeRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (!open || e.touches.length !== 1 || scrubDragRef.current) return;
    dragRef.current = { startY: e.touches[0].clientY, currentY: e.touches[0].clientY };
    setDragging(true);
  }, [open]);

  const handleTouchMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || e.touches.length !== 1) return;
    drag.currentY = e.touches[0].clientY;
    if (sheetRef.current) {
      const dy = drag.currentY - drag.startY;
      sheetRef.current.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    }
  }, []);

  const cancelSwipe = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = drag.currentY - drag.startY;
    cancelSwipe();
    if (dy > 80) {
      feedLog.player('sheet dismiss', { gesture: 'swipe-down', dy });
      onClose();
    }
  }, [cancelSwipe, onClose]);

  useEffect(() => {
    if (!active || usesDismissStack) return;
    const handleEscape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [active, usesDismissStack, onClose]);

  // --- Seek scrubber ---
  const [scrubTime, setScrubTime] = useState(null);
  const scrubbing = scrubTime !== null;

  const calcScrubTime = useCallback((clientX) => {
    const rect = scrubberRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * seekMax;
  }, [seekMax]);

  const startScrub = useCallback((event) => {
    if (!open || !seekMax || event.button !== 0 || scrubDragRef.current || dragRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubDragRef.current = { node: event.currentTarget, id: event.pointerId };
    setScrubTime(calcScrubTime(event.clientX));
  }, [calcScrubTime, open, seekMax]);

  const cancelScrub = useCallback(() => {
    const drag = scrubDragRef.current;
    if (!drag) return;
    scrubDragRef.current = null;
    if (drag.node.hasPointerCapture(drag.id)) drag.node.releasePointerCapture(drag.id);
    setScrubTime(null);
  }, []);

  const contentId = activeMedia?.contentId;
  useLayoutEffect(() => () => {
    cancelScrub();
    cancelSwipe();
  }, [open, contentId, cancelScrub, cancelSwipe]);

  const cancelScrubPointer = useCallback((event) => {
    if (scrubDragRef.current?.id === event.pointerId) cancelScrub();
  }, [cancelScrub]);

  const moveScrub = useCallback((event) => {
    if (!seekMax || scrubDragRef.current?.id !== event.pointerId) return;
    setScrubTime(calcScrubTime(event.clientX));
  }, [calcScrubTime, seekMax]);

  const endScrub = useCallback((event) => {
    if (!seekMax || scrubDragRef.current?.id !== event.pointerId) return;
    const time = calcScrubTime(event.clientX);
    cancelScrub();
    feedLog.player('sheet seek', { to: time.toFixed(1) });
    seek?.(time);
  }, [calcScrubTime, cancelScrub, seek, seekMax]);

  // --- Cover art ---
  // The app's own image endpoints load directly; external images go through the proxy.
  const thumb = proxyImage(item?.image) || safeImage(item?.image);

  if (!item) return null;

  const displayTime = scrubbing ? scrubTime : currentTime;
  const remaining = seekMax > 0 ? seekMax - (displayTime || 0) : 0;

  return (
    <>
      <div
        className={`feed-player-sheet-scrim${open ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={`feed-player-sheet${open ? ' open' : ''}${dragging ? ' dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        inert={open ? undefined : ''}
        aria-labelledby="feed-player-sheet-title"
        tabIndex={-1}
        onKeyDown={handleKeys}
      >
        <div className="sheet-drag-handle" aria-hidden="true"
          onTouchStart={handleTouchStart} onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd} onTouchCancel={cancelSwipe} />

        {thumb ? (
          <img
            key={thumb}
            src={thumb}
            alt=""
            className="sheet-cover"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="sheet-cover-fallback">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}

        <button ref={closeRef} type="button" className="sheet-close" onClick={onClose} aria-label="Close player">
          <UiIcon name="close" size={22} />
        </button>
        <div className="sheet-title">
          <div className="sheet-title-text" id="feed-player-sheet-title">{item.title}</div>
        </div>
        <div className="sheet-source">{item.meta?.sourceName || item.source}</div>

        {/* Seek scrubber */}
        <div
          ref={scrubberRef}
          className={`sheet-scrubber${scrubbing ? ' dragging' : ''}`}
          onPointerDown={startScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={cancelScrubPointer}
          onLostPointerCapture={cancelScrubPointer}
          role="slider"
          tabIndex={seekMax ? 0 : -1}
          aria-disabled={!seekMax}
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={Math.round(seekMax)}
          aria-valuenow={Math.round(displayTime || 0)}
          aria-valuetext={`${formatFeedPlaybackTime(displayTime)} of ${formatFeedPlaybackTime(duration)}`}
          onKeyDown={(e) => {
            if (!seekMax) return;
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? seekMax : Math.max(0, Math.min(seekMax, (currentTime || 0) + (e.key === 'ArrowLeft' ? -5 : 5)));
            seek?.(next);
          }}
        >
          <div className="sheet-scrubber-track">
            <div
              ref={open && !scrubbing ? playback?.sheetProgressElRef : null}
              className="sheet-scrubber-fill"
              style={scrubbing && seekMax > 0 ? { width: `${scrubTime / seekMax * 100}%` } : undefined}
            >
              <div className="sheet-scrubber-thumb" />
            </div>
          </div>
          <div className="sheet-scrubber-times">
            <span>{formatFeedPlaybackTime(displayTime)}</span>
            <span>-{formatFeedPlaybackTime(remaining)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="sheet-transport">
          <button
            className="sheet-skip-btn"
            disabled={!seekMax}
            onClick={() => {
              if (!seekMax) return;
              feedLog.player('sheet skip', { dir: -15 });
              seek?.(Math.max(0, (currentTime || 0) - 15));
            }}
            aria-label="Skip back 15 seconds"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
              <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">15</text>
            </svg>
          </button>
          <button
            className="sheet-play-btn"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <UiIcon name={playing ? 'pause' : 'play'} size={28} style={{ color: '#1a1b1e' }} />
          </button>
          <button
            className="sheet-skip-btn"
            disabled={!seekMax}
            onClick={() => {
              if (!seekMax) return;
              feedLog.player('sheet skip', { dir: 15 });
              seek?.(Math.min(seekMax, (currentTime || 0) + 15));
            }}
            aria-label="Skip forward 15 seconds"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
              <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">15</text>
            </svg>
          </button>
        </div>

        {/* Speed selector */}
        <div className="sheet-speed-row" role="group" aria-label="Playback speed">
          {SPEED_STEPS.map((s) => (
            <button
              key={s}
              className={`sheet-speed-pill${(speed ?? 1) === s ? ' active' : ''}`}
              onClick={() => { feedLog.player('sheet speed', { rate: s }); setSpeed(s); }}
              aria-pressed={(speed ?? 1) === s}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Volume (desktop only) */}
        {showVolume && <div className="sheet-volume-row">
          <button type="button" className="sheet-volume-icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            <SpeakerIcon volume={volume} muted={muted} size={20} />
          </button>
          <input
            type="range"
            className="sheet-volume-slider"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            ref={bindVolume}
            aria-label="Volume"
            aria-valuetext={formatFeedVolume(muted ? 0 : volume)}
          />
        </div>}

        {/* Resume previous */}
        {pausedMedia && (
          <button
            className="sheet-resume"
            onClick={() => { feedLog.player('sheet resume'); resumePaused(); }}
          >
            ↩ Resume: {pausedMedia.item?.title || 'previous'}
          </button>
        )}
      </div>
    </>
  );
}
