# Persistent Media Player Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Lift the Player component to Scroll level for persistent playback, enable direct play from feed cards, and upgrade the mini bar to a real player control surface.

**Architecture:** Single persistent `<Player>` at Scroll level controlled via ref. Mini bar and detail view are independent consumers of playback state. `contentId` derived from `item.id` (already `plex:{key}` format).

**Tech Stack:** React refs + useImperativeHandle (existing Player API), requestAnimationFrame for progress, DOM reparenting for video relocation.

**Design doc:** `docs/_wip/plans/2026-02-17-persistent-media-player-design.md`

---

### Task 1: Create PersistentPlayer wrapper

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/PersistentPlayer.jsx`

**Context:**
The Player component (`frontend/src/modules/Player/Player.jsx`) is a `forwardRef` component exposing `seek()`, `play()`, `pause()`, `toggle()`, `getCurrentTime()`, `getDuration()`, `getMediaElement()` via `useImperativeHandle`. Currently it lives inside `PlayerSection` (inside DetailView) and unmounts when detail closes.

PersistentPlayer is a thin wrapper that lazy-loads Player and keeps it mounted as long as `activeMedia` is set.

**Step 1: Create PersistentPlayer.jsx**

```jsx
import { lazy, Suspense, forwardRef } from 'react';

const Player = lazy(() => import('../../../Player/Player.jsx'));

const PersistentPlayer = forwardRef(function PersistentPlayer({ contentId, onEnd }, ref) {
  if (!contentId) return null;

  return (
    <div
      style={{
        position: 'fixed',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        <Player
          ref={ref}
          play={{ contentId }}
          clear={onEnd}
          ignoreKeys
          playerType="feed"
        />
      </Suspense>
    </div>
  );
});

export default PersistentPlayer;
```

**Notes:**
- Visually hidden (0x0 with overflow hidden) — audio plays without a viewport.
- Video viewport relocation is Task 7 (Phase 2).
- `onEnd` fires when the player naturally finishes, clearing `activeMedia`.
- `ignoreKeys` prevents feed player from capturing keyboard shortcuts meant for other parts of the app.

**Step 2: Verify no import errors**

Run the dev server and confirm no build errors. The component is created but not yet wired in — that's Task 3.

---

### Task 2: Create usePlaybackObserver hook

**Files:**
- Create: `frontend/src/modules/Feed/Scroll/hooks/usePlaybackObserver.js`

**Context:**
The mini bar and detail controller both need playback state (playing, currentTime, duration). Rather than duplicating polling logic, this hook encapsulates it. It uses a coarse `setInterval` (~500ms) for React state and exposes a `progressRef` callback for rAF-driven DOM updates.

**Step 1: Create the hook**

```js
import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Observes playback state from a Player ref.
 * Returns React state (updated ~2x/sec) and a progressRef for rAF DOM updates.
 *
 * @param {React.RefObject} playerRef - ref to Player imperative handle
 * @param {boolean} active - whether to poll (true when activeMedia is set)
 */
export function usePlaybackObserver(playerRef, active) {
  const [state, setState] = useState({ playing: false, currentTime: 0, duration: 0 });
  const progressElRef = useRef(null);
  const rafIdRef = useRef(null);

  // Coarse React state update (~500ms)
  useEffect(() => {
    if (!active) {
      setState({ playing: false, currentTime: 0, duration: 0 });
      return;
    }

    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const currentTime = p.getCurrentTime?.() || 0;
      const duration = p.getDuration?.() || 0;
      const el = p.getMediaElement?.();
      const playing = el ? !el.paused : false;
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

  const toggle = useCallback(() => {
    playerRef.current?.toggle?.();
  }, [playerRef]);

  const seek = useCallback((t) => {
    playerRef.current?.seek?.(t);
  }, [playerRef]);

  return { ...state, toggle, seek, progressElRef };
}
```

**Notes:**
- `progressElRef` is a ref the consumer assigns to a DOM element (the progress bar fill). The rAF loop directly sets its width — zero React re-renders for smooth animation.
- `toggle` and `seek` are convenience wrappers so consumers don't need the raw playerRef.
- `getMediaElement().paused` is the reliable way to check play/pause state.

---

### Task 3: Wire PersistentPlayer into Scroll.jsx

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`

**Context:**
Currently `activeMedia` is `{ item }` and the Player only exists inside DetailView's PlayerSection. We need to:
1. Add `playerRef`
2. Render `<PersistentPlayer>` at Scroll level
3. Expand `activeMedia` to include `contentId`
4. Pass playback state to mini bar and detail views

**Step 1: Add imports and ref**

At the top of `Scroll.jsx`, add:
```js
import PersistentPlayer from './PersistentPlayer.jsx';
import { usePlaybackObserver } from './hooks/usePlaybackObserver.js';
```

Inside the `Scroll` component, add:
```js
const playerRef = useRef(null);
```

**Step 2: Add playback observer**

After the `playerRef` line:
```js
const playback = usePlaybackObserver(playerRef, !!activeMedia);
```

**Step 3: Update onPlay handler**

Change from:
```js
onPlay={(item) => setActiveMedia(item ? { item } : null)}
```

To a handler that derives `contentId` from item.id:
```js
const handlePlay = useCallback((item) => {
  if (!item) {
    setActiveMedia(null);
    return;
  }
  setActiveMedia({ item, contentId: item.id });
}, []);
```

Update all `onPlay` props on DetailView, DetailModal to use `handlePlay`:
```js
onPlay={handlePlay}
```

**Step 4: Render PersistentPlayer**

Inside the JSX return, after the `FeedPlayerMiniBar` block, add:
```jsx
<PersistentPlayer
  ref={playerRef}
  contentId={activeMedia?.contentId || null}
  onEnd={() => setActiveMedia(null)}
/>
```

**Step 5: Pass playback state to mini bar**

Update the FeedPlayerMiniBar render to include playback props:
```jsx
{activeMedia && !urlSlug && (
  <FeedPlayerMiniBar
    item={activeMedia.item}
    playback={playback}
    onOpen={() => navigate(`/feed/scroll/${encodeItemId(activeMedia.item.id)}`)}
    onClose={() => setActiveMedia(null)}
  />
)}
```

**Step 6: Pass playback state to detail views**

Add `playback` and `playerRef` props to both DetailView and DetailModal:
```jsx
playback={playback}
playerRef={playerRef}
```

These components will forward them to PlayerSection (Task 4).

---

### Task 4: Convert PlayerSection to controller mode

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/detail/sections/PlayerSection.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/detail/DetailView.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/detail/DetailModal.jsx`

**Context:**
PlayerSection currently lazy-loads `<Player>` when `isPlaying`. It needs to render controls-only UI instead, since the actual Player now lives in PersistentPlayer at Scroll level.

**Step 1: Update DetailView and DetailModal to forward playback props**

In both `DetailView.jsx` and `DetailModal.jsx`, accept and forward `playback` and `playerRef` props to sections. Find where `PlayerSection` is rendered (via the sections registry) and pass these props through.

The section rendering pattern in DetailView passes `onPlay` and `activeMedia` to sections. Add `playback` and `playerRef` alongside them.

**Step 2: Rewrite PlayerSection**

Replace the current PlayerSection with a controller-only version:

```jsx
export default function PlayerSection({ data, onPlay, activeMedia, item, playback }) {
  if (!data?.contentId) return null;

  const isPlaying = activeMedia?.item?.id === item?.id;

  if (!isPlaying) {
    return (
      <button
        onClick={() => onPlay?.(item)}
        style={{
          width: '100%',
          padding: '1rem',
          background: '#1a1b1e',
          border: '1px solid #25262b',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
          <path d="M8 5v14l11-7z" />
        </svg>
        Play
      </button>
    );
  }

  // Controller mode — playback is active
  const { playing, currentTime, duration, toggle, seek, progressElRef } = playback || {};

  const formatTime = (s) => {
    if (!s || !Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      background: '#1a1b1e',
      borderRadius: '8px',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
    }}>
      {/* Play/pause + time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          onClick={toggle}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff">
            {playing
              ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
              : <path d="M8 5v14l11-7z" />
            }
          </svg>
        </button>
        <span style={{ fontSize: '0.75rem', color: '#868e96', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      {/* Scrubber */}
      <div
        style={{
          height: '4px',
          background: '#25262b',
          borderRadius: '2px',
          cursor: 'pointer',
          position: 'relative',
        }}
        onClick={(e) => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seek?.(pct * duration);
        }}
      >
        <div
          ref={progressElRef}
          style={{
            height: '100%',
            background: '#228be6',
            borderRadius: '2px',
            width: '0%',
            transition: 'none',
          }}
        />
      </div>
    </div>
  );
}
```

**Notes:**
- The `<Player>` lazy import is removed entirely from this file.
- The `progressElRef` from the hook is assigned to the scrubber fill div — rAF updates it directly.
- Click-to-seek on the scrubber bar calls `seek(time)`.

---

### Task 5: Card-level play

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/cards/FeedCard.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/cards/index.jsx` (if renderFeedCard wraps FeedCard)

**Context:**
The play triangle overlay on card hero images is currently visual-only (no onClick). We need to wire it to `handlePlay` so clicking the play button starts playback directly without navigating to the detail view.

**Step 1: Add onPlay prop to FeedCard**

In `FeedCard.jsx`, add `onPlay` to the destructured props:
```jsx
export default function FeedCard({ item, colors = {}, onDismiss, onPlay }) {
```

**Step 2: Wire play overlay click**

Change the play overlay div (lines 95-112) to a clickable button:
```jsx
{(item.source === 'plex' || item.meta?.youtubeId) && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onPlay?.(item);
    }}
    style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      background: 'rgba(0,0,0,0.55)',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      padding: 0,
    }}
    aria-label="Play"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
      <path d="M8 5v14l11-7z" />
    </svg>
  </button>
)}
```

Key changes: `<div>` → `<button>`, added `onClick` with `e.stopPropagation()`, added `border: none`, `cursor: pointer`, `aria-label`.

**Step 3: Pass onPlay through Scroll.jsx**

In `Scroll.jsx`, find where `renderFeedCard` is called (line 245):
```jsx
{renderFeedCard(item, colors)}
```

Check `cards/index.jsx` to see the signature of `renderFeedCard`. It likely needs updating to accept and forward `onPlay`. Update the call:
```jsx
{renderFeedCard(item, colors, { onPlay: handlePlay })}
```

Update `renderFeedCard` in `cards/index.jsx` to forward the `onPlay` prop to `FeedCard`.

---

### Task 6: Enhance mini bar with thumbnail, play/pause, and progress

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss` (lines 176-234)

**Context:**
The mini bar currently shows only source name, title, and a close button. It needs a thumbnail, play/pause toggle, and a thin progress bar.

**Step 1: Update FeedPlayerMiniBar.jsx**

```jsx
import { proxyImage } from './cards/utils.js';

export default function FeedPlayerMiniBar({ item, playback, onOpen, onClose }) {
  if (!item) return null;

  const { playing, toggle, progressElRef } = playback || {};
  const thumb = item.image ? proxyImage(item.image) : null;

  return (
    <div className="feed-mini-bar" role="region" aria-label="Now playing">
      {/* Thumbnail */}
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="feed-mini-bar-thumb"
          onClick={onOpen}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}
      {/* Info */}
      <div className="feed-mini-bar-info" onClick={onOpen}>
        <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
        <span className="feed-mini-bar-title">{item.title}</span>
      </div>
      {/* Play/Pause */}
      <button
        className="feed-mini-bar-toggle"
        onClick={(e) => { e.stopPropagation(); toggle?.(); }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          {playing
            ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
            : <path d="M8 5v14l11-7z" />
          }
        </svg>
      </button>
      {/* Close */}
      <button
        className="feed-mini-bar-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
      {/* Progress bar */}
      <div className="feed-mini-bar-progress">
        <div className="feed-mini-bar-progress-fill" ref={progressElRef} />
      </div>
    </div>
  );
}
```

**Step 2: Update Scroll.scss**

Replace the mini bar styles (lines 176-234) with:

```scss
// Mini player bar
.feed-mini-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  background: #1a1b1e;
  border-top: 1px solid #25262b;
  max-width: 540px;
  margin: 0 auto;
  flex-wrap: wrap;
}

@media (min-width: 900px) {
  .feed-mini-bar {
    max-width: 640px;
    left: 50%;
    transform: translateX(-50%);
  }
}

.feed-mini-bar-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
  cursor: pointer;
}

.feed-mini-bar-info {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  cursor: pointer;
}

.feed-mini-bar-source {
  font-size: 0.6rem;
  color: #5c636a;
  text-transform: uppercase;
  font-weight: 600;
}

.feed-mini-bar-title {
  font-size: 0.8rem;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feed-mini-bar-toggle {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 0.25rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;

  &:hover { color: #228be6; }
  &:focus-visible { outline: 2px solid #228be6; outline-offset: 2px; }
}

.feed-mini-bar-close {
  background: none;
  border: none;
  color: #868e96;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  flex-shrink: 0;

  &:hover { color: #fff; }
  &:focus-visible { outline: 2px solid #228be6; outline-offset: 2px; }
}

.feed-mini-bar-progress {
  width: 100%;
  height: 3px;
  background: #25262b;
  border-radius: 1.5px;
  order: 99; // always last in flex layout
  flex-basis: 100%;
  margin-top: 0.25rem;
}

.feed-mini-bar-progress-fill {
  height: 100%;
  background: #228be6;
  border-radius: 1.5px;
  width: 0%;
  transition: none; // rAF handles updates
}
```

---

### Task 7: Video viewport in mini bar (Phase 2)

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/PersistentPlayer.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.scss`

**Context:**
When playing video with the detail view closed, the mini bar expands upward to show the video viewport. The `<video>` element from PersistentPlayer renders inside the mini bar's expanded area.

**Approach:**
- PersistentPlayer accepts a `videoContainerRef` prop — instead of rendering in a hidden 0x0 div, the Player's video element is appended to `videoContainerRef.current` via DOM reparenting.
- FeedPlayerMiniBar exposes a `videoContainerRef` div above its controls when `item.meta?.type` is a video type (movie, episode, show).
- Mini bar SCSS adds an expanded video area above the control row.

**Deferred** — implement after Tasks 1-6 are verified working with audio. Video playback will work (audio plays from the hidden player) but without a visible viewport until this task is complete.

---

### Task 8: Video DOM reparenting between mini bar and detail view (Phase 2)

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/detail/sections/PlayerSection.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/PersistentPlayer.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`

**Context:**
When the detail view opens for a playing video item, the `<video>` element should relocate from the mini bar's expanded area into the detail view's player section. When detail closes, it moves back. This uses `element.appendChild()` on the raw DOM node — no unmount/remount, so playback is uninterrupted.

**Approach:**
- PersistentPlayer provides a method `getMediaElement()` (already exposed by Player's imperative handle).
- When detail view mounts for the playing item, PlayerSection calls `playerRef.current.getMediaElement()` and appends it to a local container div.
- On unmount, PlayerSection returns the element to PersistentPlayer's default container (or the mini bar's video area).
- Use a `useEffect` cleanup function for the return.

**Deferred** — implement after Task 7.
