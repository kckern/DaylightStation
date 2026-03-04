# Feed Player Manager — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** App-wide player manager with volume control, localStorage persistence, pause-on-preempt, and sticky mini-bar across Scroll/Reader views.

**Architecture:** New `FeedPlayerContext` at FeedApp level owns all playback state. Scroll and Reader consume via `useFeedPlayer()` hook. PersistentPlayer and FeedPlayerMiniBar render at FeedApp level. FeedPlayer gets volume slider and reads preferences from context.

**Tech Stack:** React Context + useReducer, IntersectionObserver, localStorage, existing RemuxPlayer/PersistentPlayer.

**Design doc:** `docs/plans/2026-02-19-feed-player-manager-design.md`

---

### Task 1: Create FeedPlayerContext with localStorage persistence

**Files:**
- Create: `frontend/src/modules/Feed/players/FeedPlayerContext.jsx`

**Step 1: Create context with reducer and localStorage helpers**

```jsx
// frontend/src/modules/Feed/players/FeedPlayerContext.jsx
import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';

const FeedPlayerContext = createContext(null);

const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2];

function readStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const initialState = {
  activeMedia: null,     // { item, contentId }
  pausedMedia: null,     // { item, contentId, position }
  volume: readStorage('feedPlayer:volume', 1),
  speed: readStorage('feedPlayer:speed', 1),
  muted: false,
  preMuteVolume: 1,
  playerVisible: true,   // IntersectionObserver flag
};

function reducer(state, action) {
  switch (action.type) {
    case 'PLAY': {
      const pausedMedia = state.activeMedia
        ? { ...state.activeMedia, position: action.currentTime ?? 0 }
        : null;
      return { ...state, activeMedia: action.media, pausedMedia };
    }
    case 'PAUSE':
      return state;  // playback state is on the DOM element, context just tracks what's active
    case 'STOP':
      return { ...state, activeMedia: null };
    case 'RESUME_PAUSED': {
      if (!state.pausedMedia) return state;
      const pausedMedia = state.activeMedia
        ? { ...state.activeMedia, position: action.currentTime ?? 0 }
        : null;
      return { ...state, activeMedia: state.pausedMedia, pausedMedia };
    }
    case 'CLEAR_PAUSED':
      return { ...state, pausedMedia: null };
    case 'SET_VOLUME': {
      writeStorage('feedPlayer:volume', action.volume);
      return { ...state, volume: action.volume, muted: false };
    }
    case 'TOGGLE_MUTE': {
      if (state.muted) {
        return { ...state, muted: false, volume: state.preMuteVolume };
      }
      return { ...state, muted: true, preMuteVolume: state.volume, volume: 0 };
    }
    case 'SET_SPEED': {
      writeStorage('feedPlayer:speed', action.speed);
      return { ...state, speed: action.speed };
    }
    case 'CYCLE_SPEED': {
      const idx = SPEED_STEPS.indexOf(state.speed);
      const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
      writeStorage('feedPlayer:speed', next);
      return { ...state, speed: next };
    }
    case 'SET_PLAYER_VISIBLE':
      return { ...state, playerVisible: action.visible };
    default:
      return state;
  }
}

export function FeedPlayerProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const playerRef = useRef(null);
  const playerElRef = useRef(null);   // DOM element of active inline player
  const observerRef = useRef(null);

  const play = useCallback((item) => {
    // Get current position of active media before replacing
    const currentTime = playerRef.current?.getCurrentTime?.() ?? 0;
    dispatch({ type: 'PLAY', media: { item, contentId: item.id }, currentTime });
  }, []);

  const stop = useCallback(() => dispatch({ type: 'STOP' }), []);

  const resumePaused = useCallback(() => {
    const currentTime = playerRef.current?.getCurrentTime?.() ?? 0;
    dispatch({ type: 'RESUME_PAUSED', currentTime });
  }, []);

  const setVolume = useCallback((v) => dispatch({ type: 'SET_VOLUME', volume: v }), []);
  const toggleMute = useCallback(() => dispatch({ type: 'TOGGLE_MUTE' }), []);
  const cycleSpeed = useCallback(() => dispatch({ type: 'CYCLE_SPEED' }), []);
  const setSpeed = useCallback((s) => dispatch({ type: 'SET_SPEED', speed: s }), []);

  // IntersectionObserver: track whether the inline player element is visible
  const registerPlayerEl = useCallback((el) => {
    // Disconnect previous observer
    if (observerRef.current) observerRef.current.disconnect();
    playerElRef.current = el;

    if (!el) {
      dispatch({ type: 'SET_PLAYER_VISIBLE', visible: false });
      return;
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => dispatch({ type: 'SET_PLAYER_VISIBLE', visible: entry.isIntersecting }),
      { threshold: 0 }
    );
    observerRef.current.observe(el);
  }, []);

  // Cleanup observer on unmount
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const value = {
    ...state,
    playerRef,
    play,
    stop,
    resumePaused,
    setVolume,
    toggleMute,
    cycleSpeed,
    setSpeed,
    registerPlayerEl,
  };

  return (
    <FeedPlayerContext.Provider value={value}>
      {children}
    </FeedPlayerContext.Provider>
  );
}

export function useFeedPlayer() {
  const ctx = useContext(FeedPlayerContext);
  if (!ctx) throw new Error('useFeedPlayer must be used within FeedPlayerProvider');
  return ctx;
}

export { SPEED_STEPS };
```

**Step 2: Verify file parses**

Run: `node -e "import('./frontend/src/modules/Feed/players/FeedPlayerContext.jsx')" 2>&1 || echo "parse check — expected (JSX needs bundler)"`
This is JSX so it won't run in Node directly — just verify no obvious syntax errors via the bundler in a later step.

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/players/FeedPlayerContext.jsx
git commit -m "feat(feed): add FeedPlayerContext with localStorage persistence"
```

---

### Task 2: Add volume slider and context integration to FeedPlayer

**Files:**
- Modify: `frontend/src/modules/Feed/players/FeedPlayer.jsx`

**Step 1: Import useFeedPlayer and wire volume/speed from context**

Replace the entire file. Key changes:
- Import `useFeedPlayer` and `SPEED_STEPS`
- Read `volume`, `speed`, `cycleSpeed`, `setVolume`, `toggleMute`, `registerPlayerEl` from context
- Remove local `speed` state (context owns it)
- Add volume slider + mute toggle to control bar
- Pass `volume` to RemuxPlayer and `<video>` element
- Call `registerPlayerEl` with the wrapper div ref for IntersectionObserver

```jsx
// frontend/src/modules/Feed/players/FeedPlayer.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { RemuxPlayer } from '../../Player/renderers/RemuxPlayer.jsx';
import { useFeedPlayer } from './FeedPlayerContext.jsx';

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function FeedPlayer({ playerData, onError, aspectRatio = '16 / 9' }) {
  const { volume, muted, speed, cycleSpeed, setVolume, toggleMute, registerPlayerEl } = useFeedPlayer();
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const progressRef = useRef(null);
  const wrapperRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef(null);
  const isSplit = !!(playerData.videoUrl && playerData.audioUrl);

  // Register wrapper element for IntersectionObserver
  useEffect(() => {
    registerPlayerEl(wrapperRef.current);
    return () => registerPlayerEl(null);
  }, [registerPlayerEl]);

  // Apply volume to video element (non-split only; split uses RemuxPlayer prop)
  useEffect(() => {
    if (!isSplit && videoRef.current) videoRef.current.volume = volume;
  }, [volume, isSplit]);

  // Apply speed to video element (non-split only; split uses RemuxPlayer prop)
  useEffect(() => {
    if (!isSplit && videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, isSplit]);

  // Auto-hide controls after 3s of playing
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    if (!playing) return;
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, [playing]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (playing) scheduleHide();
    else setControlsVisible(true);
    return () => clearTimeout(hideTimerRef.current);
  }, [playing, scheduleHide]);

  // Sync progress bar via rAF
  useEffect(() => {
    let raf;
    const update = () => {
      const v = videoRef.current;
      if (v) {
        setCurrentTime(v.currentTime);
        if (v.duration && Number.isFinite(v.duration)) setDuration(v.duration);
        if (progressRef.current && v.duration) {
          progressRef.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      audioRef.current?.play().catch(() => {});
    } else {
      v.pause();
      audioRef.current?.pause();
    }
  }, []);

  const seek = useCallback((t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    if (audioRef.current) audioRef.current.currentTime = t;
  }, []);

  const handleProgressClick = useCallback((e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(duration, pct * duration)));
  }, [duration, seek]);

  const handlePlay = useCallback(() => setPlaying(true), []);
  const handlePause = useCallback(() => setPlaying(false), []);

  const handleRemuxMediaRef = useCallback((el) => { videoRef.current = el; }, []);
  const handleRemuxRegisterMediaAccess = useCallback((access) => {
    if (access?.getMediaEl) videoRef.current = access.getMediaEl();
  }, []);

  // Volume icon paths
  const volumeIcon = muted || volume === 0
    ? <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    : volume < 0.5
      ? <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
      : <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />;

  return (
    <div
      ref={wrapperRef}
      className="feed-player"
      style={{ position: 'relative', aspectRatio, background: '#000', overflow: 'hidden' }}
      onMouseMove={showControls}
      onClick={showControls}
    >
      {isSplit ? (
        <RemuxPlayer
          videoUrl={playerData.videoUrl}
          audioUrl={playerData.audioUrl}
          onError={() => onError?.('stream-error')}
          onMediaRef={handleRemuxMediaRef}
          onRegisterMediaAccess={handleRemuxRegisterMediaAccess}
          onPlaybackMetrics={({ isPaused }) => {
            if (typeof isPaused === 'boolean') setPlaying(!isPaused);
          }}
          volume={volume}
          playbackRate={speed}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <video
          ref={videoRef}
          src={playerData.url}
          autoPlay
          playsInline
          onPlay={handlePlay}
          onPause={handlePause}
          onError={() => onError?.('stream-error')}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}

      {/* Control bar overlay */}
      <div
        className="feed-player-controls"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
          padding: '24px 8px 6px',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
          opacity: controlsVisible ? 1 : 0,
          transition: 'opacity 0.3s',
          pointerEvents: controlsVisible ? 'auto' : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div
          style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.3)', borderRadius: '2px', cursor: 'pointer', marginBottom: '4px' }}
          onClick={handleProgressClick}
        >
          <div ref={progressRef} style={{ height: '100%', background: '#fff', borderRadius: '2px', width: '0%' }} />
        </div>

        {/* Play/Pause */}
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px', display: 'flex' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            {playing
              ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
              : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>

        {/* Time */}
        <span style={{ color: '#fff', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <span style={{ flex: 1 }} />

        {/* Volume */}
        <button
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '2px', display: 'flex' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">{volumeIcon}</svg>
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          className="feed-player-volume-slider"
          style={{ width: '60px', accentColor: '#fff', cursor: 'pointer' }}
        />

        {/* Speed */}
        <button
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}x`}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', cursor: 'pointer', padding: '1px 6px', borderRadius: '3px', fontSize: '11px' }}
        >
          {speed}x
        </button>
      </div>

      {/* Click-to-toggle on video area */}
      {!isSplit && (
        <div
          style={{ position: 'absolute', inset: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget) toggle(); }}
        />
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/players/FeedPlayer.jsx
git commit -m "feat(feed): add volume slider and context integration to FeedPlayer"
```

---

### Task 3: Move FeedPlayerMiniBar to players/ and wire to context

**Files:**
- Move: `frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx` → `frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx`
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx` (update import, done in Task 5)

**Step 1: Move file**

```bash
mv frontend/src/modules/Feed/Scroll/FeedPlayerMiniBar.jsx frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx
```

**Step 2: Update FeedPlayerMiniBar to use context for volume/speed**

Key changes:
- Import `useFeedPlayer` from context
- Read `volume`, `speed`, `cycleSpeed`, `setVolume`, `toggleMute`, `pausedMedia`, `resumePaused` from context
- Add volume slider (compact)
- Add "paused" indicator if `pausedMedia` exists
- Update import paths for utils and feedLog

```jsx
// frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx
import { proxyImage } from '../Scroll/cards/utils.js';
import { feedLog } from '../Scroll/feedLog.js';
import { useFeedPlayer } from './FeedPlayerContext.jsx';

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function FeedPlayerMiniBar({ item, playback, onOpen, onClose }) {
  const { volume, muted, speed, cycleSpeed, setVolume, toggleMute, pausedMedia, resumePaused } = useFeedPlayer();

  if (!item) return null;

  const { playing, currentTime, duration, toggle, seek, progressElRef } = playback || {};

  const thumb = item.image
    ? (item.image.startsWith('/api/') ? item.image : proxyImage(item.image))
    : null;

  const handleProgressClick = (e) => {
    if (!duration || !seek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const seekTo = Math.max(0, Math.min(duration, pct * duration));
    feedLog.player('minibar seek', { pct: (pct * 100).toFixed(1) + '%', seekTo: seekTo.toFixed(1), duration: duration.toFixed(1) });
    seek(seekTo);
  };

  return (
    <div className="feed-mini-bar" role="region" aria-label="Now playing">
      {thumb && (
        <img
          src={thumb}
          alt=""
          className="feed-mini-bar-thumb"
          onClick={onOpen}
          onError={(e) => { feedLog.image('minibar thumb failed', { src: thumb }); e.target.style.display = 'none'; }}
        />
      )}
      <div className="feed-mini-bar-info" onClick={onOpen}>
        <span className="feed-mini-bar-source">{item.meta?.sourceName || item.source}</span>
        <span className="feed-mini-bar-title">{item.title}</span>
      </div>
      {duration > 0 && (
        <span className="feed-mini-bar-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      )}
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
      <button
        className="feed-mini-bar-speed"
        onClick={(e) => { e.stopPropagation(); cycleSpeed(); }}
        aria-label={`Playback speed ${speed ?? 1}x`}
      >
        {speed ?? 1}x
      </button>
      <button
        className="feed-mini-bar-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Stop playback"
      >
        &times;
      </button>
      {pausedMedia && (
        <button
          className="feed-mini-bar-resume-paused"
          onClick={(e) => { e.stopPropagation(); resumePaused(); }}
          aria-label="Resume previous"
          title={`Resume: ${pausedMedia.item?.title || 'previous'}`}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', cursor: 'pointer', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', whiteSpace: 'nowrap' }}
        >
          ↩ Prev
        </button>
      )}
      <div className="feed-mini-bar-progress" onClick={handleProgressClick}>
        <div className="feed-mini-bar-progress-fill" ref={progressElRef} />
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/players/FeedPlayerMiniBar.jsx
git commit -m "refactor(feed): move FeedPlayerMiniBar to players/, wire to context"
```

---

### Task 4: Wire FeedPlayerProvider into FeedApp with PersistentPlayer and MiniBar

**Files:**
- Modify: `frontend/src/Apps/FeedApp.jsx`

**Step 1: Update FeedApp to wrap with provider and render shared player components**

Key changes:
- Import `FeedPlayerProvider`, `useFeedPlayer` from context
- Import `PersistentPlayer` and `FeedPlayerMiniBar`
- Wrap `FeedLayout` with `FeedPlayerProvider`
- Render `PersistentPlayer` and `FeedPlayerMiniBar` inside `FeedLayout` (needs context access)
- MiniBar shows when `activeMedia` exists AND `!playerVisible`
- Import `usePlaybackObserver` for the shared playerRef

```jsx
// frontend/src/Apps/FeedApp.jsx
import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, useParams, useLocation } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import Headlines from '../modules/Feed/Headlines/Headlines.jsx';
import Scroll from '../modules/Feed/Scroll/Scroll.jsx';
import Reader from '../modules/Feed/Reader/Reader.jsx';
import { FeedPlayerProvider, useFeedPlayer } from '../modules/Feed/players/FeedPlayerContext.jsx';
import FeedPlayerMiniBar from '../modules/Feed/players/FeedPlayerMiniBar.jsx';
import PersistentPlayer from '../modules/Feed/Scroll/PersistentPlayer.jsx';
import { usePlaybackObserver } from '../modules/Feed/Scroll/hooks/usePlaybackObserver.js';
import { DaylightAPI } from '../lib/api.mjs';
import './FeedApp.scss';

function useFeedPWA() {
  useEffect(() => {
    let link = document.querySelector('link[rel="manifest"][data-feed-pwa]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      link.href = '/feed-manifest.json';
      link.setAttribute('data-feed-pwa', '');
      document.head.appendChild(link);
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/feed-sw.js', { scope: '/feed' });
    }
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, []);
}

function HeadlinesPage() {
  const { pageId } = useParams();
  return <Headlines pageId={pageId} />;
}

function FeedLayout() {
  useFeedPWA();
  const [headlinePages, setHeadlinePages] = useState([]);
  const location = useLocation();
  const isScroll = location.pathname.startsWith('/feed/scroll');

  const { activeMedia, playerVisible, playerRef, stop } = useFeedPlayer();
  const playback = usePlaybackObserver(playerRef, !!activeMedia);

  // Show mini-bar when media is active but inline player scrolled out of view
  const showMiniBar = !!activeMedia && !playerVisible;

  useEffect(() => {
    DaylightAPI('/api/v1/feed/headlines/pages')
      .then(pages => setHeadlinePages(pages || []))
      .catch(() => setHeadlinePages([]));
  }, []);

  return (
    <div className="feed-app">
      {!isScroll && (
        <nav className="feed-tabs">
          <NavLink to="/feed/reader" className={({ isActive }) => isActive ? 'active' : ''}>
            Reader
          </NavLink>
          {headlinePages.map(page => (
            <NavLink
              key={page.id}
              to={`/feed/headlines/${page.id}`}
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {page.label}
            </NavLink>
          ))}
          <NavLink to="/feed/scroll" className={({ isActive }) => isActive ? 'active' : ''}>
            Scroll
          </NavLink>
        </nav>
      )}
      <div className="feed-content">
        <Outlet />
      </div>
      {showMiniBar && (
        <FeedPlayerMiniBar
          item={activeMedia.item}
          playback={playback}
          onOpen={() => {}}
          onClose={stop}
        />
      )}
      <PersistentPlayer
        ref={playerRef}
        contentId={activeMedia?.contentId || null}
        onEnd={stop}
      />
    </div>
  );
}

const FeedApp = () => {
  return (
    <MantineProvider>
      <FeedPlayerProvider>
        <Routes>
          <Route element={<FeedLayout />}>
            <Route index element={<Navigate to="/feed/scroll" replace />} />
            <Route path="reader" element={<Reader />} />
            <Route path="headlines/:pageId" element={<HeadlinesPage />} />
            <Route path="headlines" element={<Navigate to="/feed/headlines/mainstream" replace />} />
            <Route path="scroll" element={<Scroll />} />
            <Route path="scroll/:itemId" element={<Scroll />} />
          </Route>
        </Routes>
      </FeedPlayerProvider>
    </MantineProvider>
  );
};

export default FeedApp;
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/FeedApp.jsx
git commit -m "feat(feed): wire FeedPlayerProvider into FeedApp with shared player/minibar"
```

---

### Task 5: Migrate Scroll.jsx to consume FeedPlayerContext

**Files:**
- Modify: `frontend/src/modules/Feed/Scroll/Scroll.jsx`

**Step 1: Replace local activeMedia state with context**

Key changes:
- Remove: `import FeedPlayerMiniBar`, `import PersistentPlayer`, local `activeMedia` state, `playerRef`, `usePlaybackObserver` call, `handleClearMedia`
- Add: `import { useFeedPlayer }` from context
- Replace `handlePlay` to call `context.play(item)`
- Remove `<FeedPlayerMiniBar>`, `<PersistentPlayer>` renders (now in FeedApp)
- Pass context's `activeMedia` and `playback` to DetailView/DetailModal
- Get `playback` from FeedApp via context (or keep usePlaybackObserver locally referencing context's playerRef)

In Scroll.jsx, the changes are:

**Remove these imports:**
```
import FeedPlayerMiniBar from './FeedPlayerMiniBar.jsx';
import PersistentPlayer from './PersistentPlayer.jsx';
import { usePlaybackObserver } from './hooks/usePlaybackObserver.js';
```

**Add this import:**
```
import { useFeedPlayer } from '../players/FeedPlayerContext.jsx';
```

**Inside `Scroll()` function, replace:**
```javascript
// REMOVE:
const [activeMedia, setActiveMedia] = useState(null);
const playerRef = useRef(null);
const playback = usePlaybackObserver(playerRef, !!activeMedia);

const handlePlay = useCallback((item) => {
  if (!item) { feedLog.player('clear activeMedia'); setActiveMedia(null); return; }
  feedLog.player('play', { id: item.id, title: item.title, source: item.source });
  setActiveMedia({ item, contentId: item.id });
}, []);

const handleClearMedia = useCallback(() => setActiveMedia(null), []);
```

```javascript
// ADD:
const { activeMedia, play: contextPlay, stop: contextStop } = useFeedPlayer();

const handlePlay = useCallback((item) => {
  if (!item) { feedLog.player('clear activeMedia'); contextStop(); return; }
  feedLog.player('play', { id: item.id, title: item.title, source: item.source });
  contextPlay(item);
}, [contextPlay, contextStop]);
```

**For `playback` prop on DetailView/DetailModal:** Scroll no longer owns `usePlaybackObserver` — that's in FeedApp now. We need to pass it down. Two options:
1. Add `playback` to FeedPlayerContext (recommended — context already has playerRef)
2. Keep usePlaybackObserver in Scroll reading from context's playerRef

Option 1 is cleaner. **In FeedPlayerContext.jsx**, the `FeedLayout` in FeedApp already calls `usePlaybackObserver` — we can expose it on the context value. But contexts shouldn't have rapidly-changing values. Since playback updates at 500ms, keep `usePlaybackObserver` called in FeedLayout and pass `playback` as a prop via a second context or just add it to the existing one.

**Simplest approach:** Add `playback` to the context value in FeedLayout (it already calls usePlaybackObserver). Then Scroll reads `playback` from context.

**Update FeedPlayerContext.jsx** — add `playback` to the context shape. In FeedLayout:
```javascript
const playback = usePlaybackObserver(playerRef, !!activeMedia);
```
This is already there. We need to make it available to children. Add a `setPlayback` or use a wrapper. **Simplest:** make FeedLayout set it on the context via a ref-based approach, or just pass playback as a prop on a thin wrapper.

**Actually, the cleanest approach:** Keep `usePlaybackObserver` in FeedLayout, and expose `playback` on a second lightweight context that FeedLayout provides. But that's over-engineering.

**Pragmatic approach:** Export `usePlaybackObserver` and let Scroll call it with `context.playerRef`:
```javascript
const { activeMedia, playerRef } = useFeedPlayer();
const playback = usePlaybackObserver(playerRef, !!activeMedia);
```

This means both FeedLayout (for mini-bar) and Scroll (for detail views) call usePlaybackObserver on the same ref. The 500ms polling is harmless doubled. The rAF progress bar ref (progressElRef) is the only concern — but mini-bar and detail view are still mutually exclusive, so the invariant holds.

**Remove from render:** The `<FeedPlayerMiniBar>` and `<PersistentPlayer>` JSX blocks at lines 517-529.

**Step 2: Verify Scroll renders without errors**

Run the dev server and navigate to `/feed/scroll`. Confirm:
- Cards render
- Playing a media item shows mini-bar (from FeedApp, not Scroll)
- Detail view shows playback controls

**Step 3: Commit**

```bash
git add frontend/src/modules/Feed/Scroll/Scroll.jsx
git commit -m "refactor(feed): migrate Scroll to FeedPlayerContext, remove local player state"
```

---

### Task 6: Wire Reader ArticleRow to FeedPlayerContext for preemption

**Files:**
- Modify: `frontend/src/modules/Feed/Reader/ArticleRow.jsx`

**Step 1: Import context and call play() on YouTube expand**

The ReaderYouTubePlayer currently renders FeedPlayer independently. To participate in the preemption system, it needs to notify the context when playback starts.

Key changes:
- Import `useFeedPlayer` in `ReaderYouTubePlayer`
- When native playback starts (playerData loaded), call `context.play(article)` so the context knows about it
- This automatically pauses any Scroll media that was playing

```javascript
// In ReaderYouTubePlayer, add:
import { useFeedPlayer } from '../players/FeedPlayerContext.jsx';

function ReaderYouTubePlayer({ article }) {
  const { play } = useFeedPlayer();
  // ... existing state ...

  // When playerData resolves, notify context
  useEffect(() => {
    if (playerData) {
      play({ ...article, id: `youtube:${article.meta.videoId}` });
    }
  }, [playerData, play, article]);

  // ... rest unchanged ...
}
```

Note: The iframe fallback path doesn't go through FeedPlayer, so it won't participate in context. This is acceptable — iframe videos manage their own playback and can't be programmatically paused anyway.

**Step 2: Commit**

```bash
git add frontend/src/modules/Feed/Reader/ArticleRow.jsx
git commit -m "feat(feed): wire Reader YouTube playback to FeedPlayerContext for preemption"
```

---

### Task 7: Clean up stale imports and verify end-to-end

**Files:**
- Verify: All imports referencing old `Scroll/FeedPlayerMiniBar.jsx` path are updated
- Verify: `PersistentPlayer` import only exists in `FeedApp.jsx`
- Verify: No remaining `Scroll/FeedPlayerMiniBar` references

**Step 1: Search for stale references**

```bash
grep -r "Scroll/FeedPlayerMiniBar" frontend/src/
grep -r "from.*PersistentPlayer" frontend/src/
```

Fix any remaining stale imports.

**Step 2: Run dev server and test manually**

```bash
npm run dev
```

Test checklist:
1. Open `/feed/scroll` — play a media item → mini-bar appears when scrolling away
2. Open `/feed/reader` — expand an Upward Thought YouTube article → video plays with volume slider
3. While Reader video plays, navigate to Scroll and play something → Reader video should be paused
4. Volume slider works and persists across page reload
5. Speed preference persists across page reload
6. Mini-bar "↩ Prev" button swaps back to previous media

**Step 3: Run existing Playwright tests**

```bash
npx playwright test tests/live/flow/feed/ --reporter=line
```

All existing tests should still pass. The mini-bar and player tests may need minor selector updates if they relied on mini-bar being inside Scroll's DOM tree.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(feed): clean up stale imports after player context migration"
```

---

### Task 8: Run YouTube render test to verify Piped + new player integration

**Files:**
- Run: `tests/live/flow/feed/feed-reader-youtube-render.runtime.test.mjs`

**Step 1: Run the test**

```bash
npx playwright test tests/live/flow/feed/feed-reader-youtube-render.runtime.test.mjs --reporter=line
```

Verify that:
- Detail endpoint still returns `type: player` (Piped working)
- FeedPlayer renders with volume slider visible
- RemuxPlayer or combined video renders (not iframe)

**Step 2: If test needs updates for new DOM structure, fix assertions**

The test checks for `.feed-player`, `video`, `audio`, `iframe` — these selectors should still work since FeedPlayer's class names haven't changed.

**Step 3: Commit if test was updated**

```bash
git add tests/live/flow/feed/feed-reader-youtube-render.runtime.test.mjs
git commit -m "test(feed): update YouTube render test for player context integration"
```
