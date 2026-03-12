import { useState, useRef, useCallback, useEffect } from 'react';
import { proxyImage } from '../Scroll/cards/utils.js';
import { feedLog } from '../Scroll/feedLog.js';
import { useFeedPlayer, SPEED_STEPS } from './FeedPlayerContext.jsx';
import './FeedPlayerSheet.scss';

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function FeedPlayerSheet({ open, onClose, item, playback }) {
  const {
    speed, setSpeed, volume, setVolume, muted, toggleMute,
    pausedMedia, resumePaused,
  } = useFeedPlayer();

  const { playing, currentTime, duration, toggle, seek } = playback || {};

  // --- Swipe-to-dismiss gesture ---
  const sheetRef = useRef(null);
  const dragRef = useRef({ startY: 0, currentY: 0, dragging: false });
  const [dragging, setDragging] = useState(false);

  const handleTouchStart = useCallback((e) => {
    dragRef.current = { startY: e.touches[0].clientY, currentY: e.touches[0].clientY, dragging: true };
    setDragging(true);
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!dragRef.current.dragging) return;
    dragRef.current.currentY = e.touches[0].clientY;
    const dy = dragRef.current.currentY - dragRef.current.startY;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const dy = dragRef.current.currentY - dragRef.current.startY;
    dragRef.current.dragging = false;
    setDragging(false);
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    if (dy > 80) {
      feedLog.player('sheet dismiss', { gesture: 'swipe-down', dy });
      onClose();
    }
  }, [onClose]);

  // --- Escape key (desktop) ---
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // --- Seek scrubber ---
  const scrubberRef = useRef(null);
  const scrubFillRef = useRef(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const scrubDragRef = useRef(false);

  const calcScrubTime = useCallback((clientX) => {
    if (!scrubberRef.current || !duration) return 0;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * duration;
  }, [duration]);

  const startScrub = useCallback((clientX) => {
    scrubDragRef.current = true;
    setScrubbing(true);
    setScrubTime(calcScrubTime(clientX));
  }, [calcScrubTime]);

  const moveScrub = useCallback((clientX) => {
    if (!scrubDragRef.current) return;
    const t = calcScrubTime(clientX);
    setScrubTime(t);
    if (scrubFillRef.current && duration) {
      scrubFillRef.current.style.width = `${(t / duration) * 100}%`;
    }
  }, [calcScrubTime, duration]);

  const endScrub = useCallback(() => {
    if (!scrubDragRef.current) return;
    scrubDragRef.current = false;
    setScrubbing(false);
    feedLog.player('sheet seek', { to: scrubTime.toFixed(1) });
    seek?.(scrubTime);
  }, [scrubTime, seek]);

  // Mouse support for scrubber
  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e) => moveScrub(e.clientX);
    const onUp = () => endScrub();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [scrubbing, moveScrub, endScrub]);

  // rAF progress sync when not scrubbing
  const scrubRafRef = useRef(null);
  useEffect(() => {
    if (!open || scrubbing) return;
    const tick = () => {
      if (scrubFillRef.current && duration > 0) {
        const pct = (currentTime / duration) * 100;
        scrubFillRef.current.style.width = `${pct}%`;
      }
      scrubRafRef.current = requestAnimationFrame(tick);
    };
    scrubRafRef.current = requestAnimationFrame(tick);
    return () => { if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current); };
  }, [open, scrubbing, currentTime, duration]);

  // --- Cover art ---
  const thumb = item?.image
    ? (item.image.startsWith('/api/') ? item.image : proxyImage(item.image))
    : null;

  if (!item) return null;

  const displayTime = scrubbing ? scrubTime : currentTime;
  const remaining = duration > 0 ? duration - displayTime : 0;

  return (
    <>
      <div
        className={`feed-player-sheet-scrim${open ? ' open' : ''}`}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className={`feed-player-sheet${open ? ' open' : ''}${dragging ? ' dragging' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="sheet-drag-handle" />

        {thumb ? (
          <img
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

        <div className="sheet-title">
          <div className="sheet-title-text">{item.title}</div>
        </div>
        <div className="sheet-source">{item.meta?.sourceName || item.source}</div>

        {/* Seek scrubber */}
        <div
          ref={scrubberRef}
          className={`sheet-scrubber${scrubbing ? ' dragging' : ''}`}
          onMouseDown={(e) => startScrub(e.clientX)}
          onTouchStart={(e) => startScrub(e.touches[0].clientX)}
          onTouchMove={(e) => moveScrub(e.touches[0].clientX)}
          onTouchEnd={endScrub}
        >
          <div className="sheet-scrubber-track">
            <div ref={scrubFillRef} className="sheet-scrubber-fill">
              <div className="sheet-scrubber-thumb" />
            </div>
          </div>
          <div className="sheet-scrubber-times">
            <span>{formatTime(displayTime)}</span>
            <span>-{formatTime(remaining)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="sheet-transport">
          <button
            className="sheet-skip-btn"
            onClick={() => { feedLog.player('sheet skip', { dir: -15 }); seek?.(Math.max(0, (currentTime || 0) - 15)); }}
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
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#1a1b1e">
              {playing
                ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
                : <path d="M8 5v14l11-7z" />
              }
            </svg>
          </button>
          <button
            className="sheet-skip-btn"
            onClick={() => { feedLog.player('sheet skip', { dir: 15 }); seek?.(Math.min(duration || 0, (currentTime || 0) + 15)); }}
            aria-label="Skip forward 15 seconds"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
              <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">15</text>
            </svg>
          </button>
        </div>

        {/* Speed selector */}
        <div className="sheet-speed-row">
          {SPEED_STEPS.map((s) => (
            <button
              key={s}
              className={`sheet-speed-pill${(speed ?? 1) === s ? ' active' : ''}`}
              onClick={() => { feedLog.player('sheet speed', { rate: s }); setSpeed(s); }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Volume (desktop only) */}
        <div className="sheet-volume-row">
          <div className="sheet-volume-icon" onClick={toggleMute}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              {muted || volume === 0
                ? <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                : <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              }
            </svg>
          </div>
          <input
            type="range"
            className="sheet-volume-slider"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
          />
        </div>

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
