# Feed Player Bottom Sheet — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an expandable bottom sheet player to the feed (Spotify-style), fix the broken speed button, and make all player UI non-selectable.

**Architecture:** New `FeedPlayerSheet` component rendered alongside the mini bar in `FeedApp.jsx`, controlled by a local `sheetOpen` state. Reads from the same `useFeedPlayer()` context and `usePlaybackObserver()` hook. Speed fix: sync `context.speed` → `el.playbackRate` via effect in `usePlaybackObserver`. Mobile-first with desktop adaptations at 900px breakpoint.

**Tech Stack:** React (JSX), SCSS, touch/mouse gesture handling (no libraries)

**Design doc:** `docs/plans/2026-03-12-feed-player-bottom-sheet-design.md`

---

### Task 1: Fix Speed Bug

The speed button in the mini bar calls `cycleSpeed()` which updates state + localStorage but never sets `el.playbackRate`. Fix this first since the sheet will rely on the same mechanism.

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/hooks/usePlaybackObserver.js`

**Step 1: Add speed sync effect**

In `usePlaybackObserver.js`, add an effect that syncs the context speed to the media element. Also accept `speed` from context as a parameter so the observer doesn't maintain its own duplicate state.

Replace the entire file content of `frontend/src/modules/Feed/Scroll/hooks/usePlaybackObserver.js` with:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
import { feedLog } from '../feedLog.js';

/**
 * Observes playback state from a Player ref.
 * Returns React state (updated ~2x/sec) and a progressElRef for rAF DOM updates.
 *
 * INVARIANT: progressElRef can only be assigned to ONE DOM element at a time.
 * This works because the mini bar and detail view are mutually exclusive in the
 * render tree (mini bar hides when urlSlug is set). If that changes, convert to
 * a multi-element pattern (Set of elements iterated in the rAF loop).
 *
 * @param {React.RefObject} playerRef - ref to Player imperative handle
 * @param {boolean} active - whether to poll (true when activeMedia is set)
 * @param {number} contextSpeed - speed from FeedPlayerContext (synced to el.playbackRate)
 */
export function usePlaybackObserver(playerRef, active, contextSpeed) {
  const [state, setState] = useState({ playing: false, currentTime: 0, duration: 0 });
  const progressElRef = useRef(null);
  const rafIdRef = useRef(null);

  // Coarse React state update (~500ms)
  useEffect(() => {
    if (!active) {
      feedLog.player('observer inactive — resetting state');
      setState({ playing: false, currentTime: 0, duration: 0 });
      return;
    }

    feedLog.player('observer active — starting 500ms poll');
    let prevPlaying = null;
    let loggedNull = false;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) { if (!loggedNull) { feedLog.player('poll: playerRef.current is null'); loggedNull = true; } return; }
      loggedNull = false;
      const currentTime = p.getCurrentTime?.() || 0;
      const duration = p.getDuration?.() || 0;
      const el = p.getMediaElement?.();
      const playing = el ? !el.paused : false;
      if (playing !== prevPlaying) {
        feedLog.player('state change', { playing, currentTime: currentTime.toFixed(1), duration: duration.toFixed(1) });
        prevPlaying = playing;
      }
      setState({ playing, currentTime, duration });
    }, 500);

    return () => clearInterval(id);
  }, [playerRef, active]);

  // Fine-grained progress bar update (rAF, direct DOM)
  useEffect(() => {
    if (!active) return;

    const tick = () => {
      const p = playerRef.current;
      const el = progressElRef.current;
      if (p && el) {
        const cur = p.getCurrentTime?.() || 0;
        const dur = p.getDuration?.() || 0;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        el.style.width = `${pct}%`;
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [playerRef, active]);

  // Sync context speed → media element playbackRate
  useEffect(() => {
    if (!active || !contextSpeed) return;
    const el = playerRef.current?.getMediaElement?.();
    if (el) {
      feedLog.player('speed sync', { rate: contextSpeed });
      el.playbackRate = contextSpeed;
    }
  }, [contextSpeed, active, playerRef]);

  const toggle = useCallback(() => {
    feedLog.player('toggle');
    playerRef.current?.toggle?.();
  }, [playerRef]);

  const seek = useCallback((t) => {
    feedLog.player('seek', { to: t });
    playerRef.current?.seek?.(t);
  }, [playerRef]);

  return { ...state, toggle, seek, progressElRef };
}
```

**Step 2: Update callers to pass contextSpeed**

In `frontend/src/Apps/FeedApp.jsx`, line 74, change:
```jsx
const playback = usePlaybackObserver(playerRef, !!activeMedia);
```
to:
```jsx
const { speed } = useFeedPlayer();
```
Wait — `speed` is already destructured implicitly via `useFeedPlayer()`. We need to pull `speed` from the context. Change line 73-74:

```jsx
const { activeMedia, playerVisible, playerRef, stop, speed } = useFeedPlayer();
const playback = usePlaybackObserver(playerRef, !!activeMedia, speed);
```

In `frontend/src/modules/Feed/Scroll/Scroll.jsx`, find the `usePlaybackObserver` call (line 135):
```jsx
const playback = usePlaybackObserver(playerRef, !!activeMedia);
```
Change to:
```jsx
const { speed } = useFeedPlayer();
const playback = usePlaybackObserver(playerRef, !!activeMedia, speed);
```
Note: `useFeedPlayer` is already imported and destructured on line 129. Add `speed` to that destructuring instead of a separate call:
```jsx
const { activeMedia, play: contextPlay, stop: contextStop, playerRef, speed } = useFeedPlayer();
```
Then pass it:
```jsx
const playback = usePlaybackObserver(playerRef, !!activeMedia, speed);
```

**Step 3: Verify speed works**

Build and deploy, then manually test: play a Plex item in the feed, tap the speed button in the mini bar, confirm the audio speed actually changes.

Run:
```bash
npx vite build --mode development 2>&1 | tail -5
```
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/hooks/usePlaybackObserver.js \
       frontend/src/Apps/FeedApp.jsx \
       frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "fix(feed): wire speed button to media element playbackRate

cycleSpeed() in FeedPlayerContext updated state + localStorage but never
set el.playbackRate on the audio element. Add speed sync effect in
usePlaybackObserver that applies contextSpeed to the media element.
Remove duplicate speed state from observer — context is SSOT."
```

---

### Task 2: Add user-select: none to Mini Bar

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss:190`

**Step 1: Add user-select to .feed-mini-bar**

After line 203 (`width: 100vw;`), add:
```scss
  user-select: none;
  -webkit-user-select: none;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.scss
git commit -m "style(feed): disable text selection on mini bar"
```

---

### Task 3: Create FeedPlayerSheet Component

**Files:**
- Create: `frontend/src/modules/Feed/players/FeedPlayerSheet.jsx`
- Create: `frontend/src/modules/Feed/players/FeedPlayerSheet.scss`

**Step 1: Create the SCSS**

Create `frontend/src/modules/Feed/players/FeedPlayerSheet.scss`:

```scss
.feed-player-sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 300ms ease;
  pointer-events: none;

  &.open {
    opacity: 1;
    pointer-events: auto;
  }
}

.feed-player-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 201;
  background: #1a1b1e;
  border-radius: 16px 16px 0 0;
  transform: translateY(100%);
  transition: transform 300ms cubic-bezier(0.32, 0.72, 0, 1);
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  padding: 0 1.5rem 2rem;
  max-height: 80vh;
  overflow-y: auto;

  &.open {
    transform: translateY(0);
  }

  &.dragging {
    transition: none;
  }

  @media (min-width: 900px) {
    max-width: 420px;
    left: 50%;
    transform: translateX(-50%) translateY(100%);

    &.open {
      transform: translateX(-50%) translateY(0);
    }

    &.dragging {
      transition: none;
    }
  }
}

.sheet-drag-handle {
  display: flex;
  justify-content: center;
  padding: 12px 0 8px;
  cursor: grab;

  &::after {
    content: '';
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: #555;
  }

  @media (min-width: 900px) {
    display: none;
  }
}

.sheet-cover {
  width: 200px;
  height: 200px;
  border-radius: 12px;
  object-fit: cover;
  margin: 0.5rem auto 1rem;
  display: block;
}

.sheet-cover-fallback {
  width: 200px;
  height: 200px;
  border-radius: 12px;
  margin: 0.5rem auto 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #25262b;
  color: #5c636a;
}

.sheet-title {
  text-align: center;
  margin-bottom: 0.25rem;
}

.sheet-title-text {
  font-size: 1.1rem;
  font-weight: 600;
  color: #fff;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.sheet-source {
  font-size: 0.8rem;
  color: #5c636a;
  text-transform: uppercase;
  font-weight: 600;
  text-align: center;
  margin-bottom: 1rem;
}

// Seek scrubber
.sheet-scrubber {
  margin-bottom: 0.25rem;
  padding: 8px 0;
  cursor: pointer;
  touch-action: none;
}

.sheet-scrubber-track {
  position: relative;
  height: 4px;
  background: #333;
  border-radius: 2px;
}

.sheet-scrubber-fill {
  height: 100%;
  background: #228be6;
  border-radius: 2px;
  width: 0%;
  position: relative;
}

.sheet-scrubber-thumb {
  position: absolute;
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  opacity: 0;
  transition: opacity 150ms ease;

  .sheet-scrubber:hover &,
  .sheet-scrubber.dragging & {
    opacity: 1;
  }
}

.sheet-scrubber-times {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #5c636a;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
}

// Transport controls
.sheet-transport {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  margin: 1rem 0;
}

.sheet-skip-btn {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover { background: rgba(255, 255, 255, 0.1); }
  &:active { background: rgba(255, 255, 255, 0.15); }
}

.sheet-play-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:hover { background: #e0e0e0; }
  &:active { background: #ccc; }
}

// Speed selector
.sheet-speed-row {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.sheet-speed-pill {
  background: transparent;
  border: 1px solid #5c636a;
  border-radius: 16px;
  color: #868e96;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.3rem 0.75rem;
  font-variant-numeric: tabular-nums;
  min-width: 44px;
  min-height: 32px;

  &:hover { color: #fff; border-color: #868e96; }

  &.active {
    background: #228be6;
    border-color: #228be6;
    color: #fff;
  }
}

// Volume (desktop only)
.sheet-volume-row {
  display: none;

  @media (min-width: 900px) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    padding: 0 1rem;
  }
}

.sheet-volume-icon {
  color: #868e96;
  flex-shrink: 0;
  cursor: pointer;

  &:hover { color: #fff; }
}

.sheet-volume-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: #333;
  border-radius: 2px;
  outline: none;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    cursor: pointer;
  }
}

// Resume button
.sheet-resume {
  width: 100%;
  padding: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: #fff;
  font-size: 0.8rem;
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover { border-color: rgba(255, 255, 255, 0.4); }
}
```

**Step 2: Create the component**

Create `frontend/src/modules/Feed/players/FeedPlayerSheet.jsx`:

```jsx
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
```

**Step 3: Verify build**

Run:
```bash
npx vite build --mode development 2>&1 | tail -5
```
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/players/FeedPlayerSheet.jsx \
       frontend/src/modules/Feed/players/FeedPlayerSheet.scss
git commit -m "feat(feed): add player bottom sheet component

Spotify-style bottom sheet with cover art, draggable seek scrubber,
skip ±15s, speed selector pills, volume slider (desktop), resume
button. Swipe-down-to-dismiss on mobile, Escape key on desktop.
Mobile-first, max-width 420px centered on desktop."
```

---

### Task 4: Wire Sheet into FeedApp

**Files:**
- Modify: `frontend/src/Apps/FeedApp.jsx`

**Step 1: Import sheet and add state**

At the top of FeedApp.jsx, add the import after the existing FeedPlayerMiniBar import (line 9):
```jsx
import FeedPlayerSheet from '../modules/Feed/players/FeedPlayerSheet.jsx';
```

**Step 2: Add sheetOpen state and handlers**

In the `FeedLayout` function, after line 75 (`const showMiniBar = ...`), add:
```jsx
const [sheetOpen, setSheetOpen] = useState(false);
```

**Step 3: Update mini bar onOpen and visibility**

Change the mini bar section (lines 116-122) from:
```jsx
{showMiniBar && (
  <FeedPlayerMiniBar
    item={activeMedia.item}
    playback={playback}
    onOpen={() => {}}
    onClose={stop}
  />
)}
```
to:
```jsx
{showMiniBar && !sheetOpen && (
  <FeedPlayerMiniBar
    item={activeMedia.item}
    playback={playback}
    onOpen={() => setSheetOpen(true)}
    onClose={stop}
  />
)}
<FeedPlayerSheet
  open={sheetOpen && !!activeMedia}
  onClose={() => setSheetOpen(false)}
  item={activeMedia?.item}
  playback={playback}
/>
```

**Step 4: Close sheet when media stops**

After the `sheetOpen` state declaration, add an effect:
```jsx
// Close sheet if media is cleared
useEffect(() => {
  if (!activeMedia) setSheetOpen(false);
}, [activeMedia]);
```

**Step 5: Verify build**

Run:
```bash
npx vite build --mode development 2>&1 | tail -5
```
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add frontend/src/Apps/FeedApp.jsx
git commit -m "feat(feed): wire player sheet into FeedApp layout

Mini bar onOpen opens the sheet, mini bar hides when sheet is open.
Sheet auto-closes when media is stopped/cleared."
```

---

### Task 5: Add Swipe-Up Gesture to Mini Bar

**Files:**
- Modify: `frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx`

**Step 1: Add swipe-up gesture handling**

In `FeedPlayerMiniBar`, add touch tracking for swipe-up. Add before the `return` statement:

```jsx
const touchRef = useRef({ startY: 0 });
const handleBarTouchStart = (e) => { touchRef.current.startY = e.touches[0].clientY; };
const handleBarTouchEnd = (e) => {
  const dy = e.changedTouches[0].clientY - touchRef.current.startY;
  if (dy < -60) {
    feedLog.player('minibar swipe-up');
    onOpen?.();
  }
};
```

Add `useRef` to the import at the top of the file (it's not currently imported — you'll need to add it):
```jsx
import { useRef } from 'react';
```

**Step 2: Attach handlers to the mini bar container**

Change the opening `<div>` of the mini bar:
```jsx
<div className="feed-mini-bar" role="region" aria-label="Now playing">
```
to:
```jsx
<div
  className="feed-mini-bar"
  role="region"
  aria-label="Now playing"
  onTouchStart={handleBarTouchStart}
  onTouchEnd={handleBarTouchEnd}
>
```

**Step 3: Verify build**

Run:
```bash
npx vite build --mode development 2>&1 | tail -5
```
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx
git commit -m "feat(feed): add swipe-up gesture on mini bar to open sheet"
```

---

### Task 6: Build, Deploy, and Test on Prod

**Step 1: Build Docker image**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```

**Step 2: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

**Step 3: Wait for health**

```bash
sleep 8 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3111/api/v1/feed/scroll
```
Expected: `200`

**Step 4: Run existing playback tests**

```bash
BASE_URL=http://localhost:3111 npx playwright test tests/live/flow/feed/feed-detail-playback.runtime.test.mjs tests/live/flow/feed/feed-minibar-playback.runtime.test.mjs --reporter=line
```
Expected: Both pass (no regressions).

**Step 5: Write Playwright test for sheet**

Create `tests/live/flow/feed/feed-player-sheet.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Player Sheet', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
  });

  test('clicking mini bar info opens sheet with full controls', async ({ page }) => {
    await page.goto('/feed/scroll?filter=plex', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Start playback via card play button
    const playBtn = page.locator('.feed-card button[aria-label="Play"]').first();
    await expect(playBtn).toBeVisible({ timeout: 10000 });
    await playBtn.click();

    // Wait for mini bar
    const miniBar = page.locator('.feed-mini-bar');
    await expect(miniBar).toBeVisible({ timeout: 10000 });

    // Click mini bar info area to open sheet
    await miniBar.locator('.feed-mini-bar-info').click();

    // Sheet should be visible
    const sheet = page.locator('.feed-player-sheet.open');
    await expect(sheet, 'Bottom sheet should open').toBeVisible({ timeout: 5000 });

    // Mini bar should be hidden
    await expect(miniBar).not.toBeVisible();

    // Sheet should have key controls
    await expect(sheet.locator('.sheet-play-btn'), 'Play/pause button').toBeVisible();
    await expect(sheet.locator('.sheet-skip-btn').first(), 'Skip button').toBeVisible();
    await expect(sheet.locator('.sheet-speed-pill').first(), 'Speed pills').toBeVisible();
    await expect(sheet.locator('.sheet-scrubber'), 'Seek scrubber').toBeVisible();
    await expect(sheet.locator('.sheet-cover, .sheet-cover-fallback').first(), 'Cover art').toBeVisible();

    // Close by clicking scrim
    await page.locator('.feed-player-sheet-scrim').click({ position: { x: 10, y: 10 } });

    // Sheet should close, mini bar should return
    await expect(sheet).not.toBeVisible({ timeout: 3000 });
    await expect(miniBar).toBeVisible({ timeout: 3000 });

    console.log('Player sheet open/close verified');
  });

  test('speed pills change playback rate', async ({ page }) => {
    await page.goto('/feed/scroll?filter=plex', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Start playback
    const playBtn = page.locator('.feed-card button[aria-label="Play"]').first();
    await expect(playBtn).toBeVisible({ timeout: 10000 });
    await playBtn.click();

    // Open sheet
    const miniBar = page.locator('.feed-mini-bar');
    await expect(miniBar).toBeVisible({ timeout: 10000 });
    await miniBar.locator('.feed-mini-bar-info').click();

    const sheet = page.locator('.feed-player-sheet.open');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Click the 1.5x speed pill
    const pill15 = sheet.locator('.sheet-speed-pill', { hasText: '1.5x' });
    await pill15.click();

    // Verify the pill is active
    await expect(pill15).toHaveClass(/active/);

    // Verify the actual media element playback rate changed
    await expect(async () => {
      const rate = await page.evaluate(() => {
        const el = document.querySelector('audio, video');
        return el?.playbackRate;
      });
      expect(rate, 'Media playback rate should be 1.5').toBe(1.5);
    }).toPass({ timeout: 5000 });

    console.log('Speed pill change verified');
  });
});
```

**Step 6: Run the sheet test**

```bash
BASE_URL=http://localhost:3111 npx playwright test tests/live/flow/feed/feed-player-sheet.runtime.test.mjs --reporter=line
```
Expected: Both tests pass.

**Step 7: Commit test**

```bash
git add tests/live/flow/feed/feed-player-sheet.runtime.test.mjs
git commit -m "test(feed): add Playwright tests for player bottom sheet

Verifies sheet opens from mini bar, shows all controls (cover, scrubber,
transport, speed pills), closes via scrim click. Also tests that speed
pills actually change el.playbackRate."
```
