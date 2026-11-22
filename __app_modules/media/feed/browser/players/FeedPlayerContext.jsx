/* eslint-disable react-refresh/only-export-components -- provider and its required consumer hook form one context module */
import { createContext, useContext, useReducer, useRef, useCallback, useMemo } from 'react';
import { browserPreference } from '@/lib/browserPreference.js';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

// Recreate child each call to pick up sessionLog context set by FeedApp
function log() { return getLogger().child({ module: 'feed-player' }); }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2];
const DEFAULT_VOLUME = 1;

function decodeNumber(raw) {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const volumePreference = browserPreference('feedPlayer:volume', DEFAULT_VOLUME, raw => {
  const value = decodeNumber(raw);
  return value !== null && value >= 0 && value <= 1 ? value : null;
});
const speedPreference = browserPreference('feedPlayer:speed', 1, raw => {
  const value = decodeNumber(raw);
  return SPEED_STEPS.includes(value) ? value : null;
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function buildInitialState() {
  const volume = volumePreference.read();
  const speed = speedPreference.read();
  const preMuteVolume = volume > 0 ? volume : DEFAULT_VOLUME;
  return {
    activeMedia: null,      // null | { item, contentId, position? }
    pausedMedia: null,       // null | { item, contentId, position }
    volume,                  // 0-1
    speed,                   // playback rate
    muted: volume === 0,
    preMuteVolume,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

// The renderer boundary seeks within one mounted on-demand item. A collection,
// live stream, or unmapped source must reopen through its normal playback entry.
function capturePosition(handle) {
  const contentId = handle?.getMountedContentId();
  if (!contentId) return null;
  const item = handle.getNowPlaying()?.item;
  const timeline = item?.contentTimeline;
  // The mounted operation seeks in renderer seconds; a remapped transport may
  // reopen at a different origin and cannot safely use this absolute target.
  if (item?.isLive || timeline?.rendererStartSeconds !== timeline?.contentStartSeconds) return null;
  const position = handle.getContentTime();
  const native = handle.getCurrentTime();
  const duration = handle.getDuration();
  return Number.isFinite(position) && position >= 0 && Number.isFinite(native) && native >= 0
    && Number.isFinite(duration) && native < duration
    ? { contentId, position } : null;
}

function parkMedia(active, captured) {
  return { ...active, position: captured?.contentId === active.contentId ? captured?.position : null };
}

function feedPlayerReducer(state, action) {
  switch (action.type) {
    case 'PLAY': {
      const { item, contentId, currentPosition } = action.payload;
      log().info('player.play', { title: item?.title, contentId, hadActive: !!state.activeMedia });
      // Pause current active → pausedMedia (capture position from caller)
      const pausedMedia = state.activeMedia
        ? parkMedia(state.activeMedia, currentPosition)
        : state.pausedMedia;
      return {
        ...state,
        // Reader inline playback parks the previous source without claiming the persistent renderer.
        activeMedia: contentId ? { item, contentId } : null,
        pausedMedia,
      };
    }

    case 'STOP':
      log().info('player.stop', { had: !!state.activeMedia });
      return { ...state, activeMedia: null };

    case 'RESUME_PAUSED': {
      if (!state.pausedMedia) return state;
      log().info('player.resumePaused', { title: state.pausedMedia.item?.title });
      // Swap paused ↔ active; capture current active position from caller
      const { currentPosition } = action.payload || {};
      const newPaused = state.activeMedia
        ? parkMedia(state.activeMedia, currentPosition)
        : null;
      return {
        ...state,
        activeMedia: state.pausedMedia,
        pausedMedia: newPaused,
      };
    }

    case 'SET_VOLUME': {
      const volume = Math.max(0, Math.min(1, action.payload));
      volumePreference.write(volume);
      return {
        ...state,
        volume,
        muted: volume === 0,
        preMuteVolume: volume > 0 ? volume : state.preMuteVolume,
      };
    }

    case 'TOGGLE_MUTE': {
      if (state.muted || state.volume === 0) {
        const volume = state.preMuteVolume > 0 ? state.preMuteVolume : DEFAULT_VOLUME;
        volumePreference.write(volume);
        return { ...state, muted: false, volume, preMuteVolume: volume };
      }
      return { ...state, muted: true, preMuteVolume: state.volume, volume: 0 };
    }

    case 'SET_SPEED': {
      const speed = action.payload;
      speedPreference.write(speed);
      return { ...state, speed };
    }

    case 'CYCLE_SPEED': {
      const idx = SPEED_STEPS.indexOf(state.speed);
      const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
      speedPreference.write(next);
      return { ...state, speed: next };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const FeedPlayerContext = createContext(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function FeedPlayerProvider({ children }) {
  const [state, dispatch] = useReducer(feedPlayerReducer, undefined, buildInitialState);
  const playerRef = useRef(null);

  // ---- actions ----

  const play = useCallback((item, contentId) => {
    const currentPosition = capturePosition(playerRef.current);
    dispatch({ type: 'PLAY', payload: { item, contentId, currentPosition } });
  }, []);

  const stop = useCallback(() => {
    dispatch({ type: 'STOP' });
  }, []);

  const resumePaused = useCallback(() => {
    const currentPosition = capturePosition(playerRef.current);
    dispatch({ type: 'RESUME_PAUSED', payload: { currentPosition } });
  }, []);

  const setVolume = useCallback((v) => {
    dispatch({ type: 'SET_VOLUME', payload: v });
  }, []);

  const toggleMute = useCallback(() => {
    dispatch({ type: 'TOGGLE_MUTE' });
  }, []);

  const setSpeed = useCallback((s) => {
    dispatch({ type: 'SET_SPEED', payload: s });
  }, []);

  const cycleSpeed = useCallback(() => {
    dispatch({ type: 'CYCLE_SPEED' });
  }, []);

  // Memoize context value to prevent unnecessary consumer re-renders.
  // Without this, every provider render creates a new object reference,
  // triggering all consumers (Scroll, FeedLayout, etc.) to re-render.
  const value = useMemo(() => ({
    ...state,
    playerRef,
    play,
    stop,
    resumePaused,
    setVolume,
    toggleMute,
    setSpeed,
    cycleSpeed,
    dispatch,
  }), [
    state,
    play, stop, resumePaused, setVolume, toggleMute,
    setSpeed, cycleSpeed,
  ]);

  return (
    <FeedPlayerContext.Provider value={value}>
      {children}
    </FeedPlayerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFeedPlayer() {
  const ctx = useContext(FeedPlayerContext);
  if (!ctx) {
    throw new Error('useFeedPlayer must be used within a FeedPlayerProvider');
  }
  return ctx;
}
