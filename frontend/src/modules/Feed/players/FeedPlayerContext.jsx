import { createContext, useContext, useReducer, useRef, useCallback, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2];

const LS_VOLUME = 'feedPlayer:volume';
const LS_SPEED = 'feedPlayer:speed';

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function readFloat(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeFloat(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* quota or private-mode — ignore */
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function buildInitialState() {
  const volume = readFloat(LS_VOLUME, 1);
  const speed = readFloat(LS_SPEED, 1);
  return {
    activeMedia: null,      // null | { item, contentId }
    pausedMedia: null,       // null | { item, contentId, position }
    volume,                  // 0-1
    speed,                   // playback rate
    muted: false,
    preMuteVolume: volume,
    playerVisible: false,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function feedPlayerReducer(state, action) {
  switch (action.type) {
    case 'PLAY': {
      const { item, contentId, currentPosition } = action.payload;
      // Pause current active → pausedMedia (capture position from caller)
      const pausedMedia = state.activeMedia
        ? {
            item: state.activeMedia.item,
            contentId: state.activeMedia.contentId,
            position: currentPosition ?? 0,
          }
        : state.pausedMedia;
      return {
        ...state,
        activeMedia: { item, contentId },
        pausedMedia,
      };
    }

    case 'STOP':
      return { ...state, activeMedia: null };

    case 'RESUME_PAUSED': {
      if (!state.pausedMedia) return state;
      // Swap paused ↔ active; capture current active position from caller
      const { currentPosition } = action.payload || {};
      const newPaused = state.activeMedia
        ? {
            item: state.activeMedia.item,
            contentId: state.activeMedia.contentId,
            position: currentPosition ?? 0,
          }
        : null;
      return {
        ...state,
        activeMedia: { item: state.pausedMedia.item, contentId: state.pausedMedia.contentId },
        pausedMedia: newPaused,
      };
    }

    case 'SET_VOLUME': {
      const volume = Math.max(0, Math.min(1, action.payload));
      writeFloat(LS_VOLUME, volume);
      return { ...state, volume, muted: false };
    }

    case 'TOGGLE_MUTE': {
      if (state.muted) {
        return { ...state, muted: false, volume: state.preMuteVolume };
      }
      return { ...state, muted: true, preMuteVolume: state.volume, volume: 0 };
    }

    case 'SET_SPEED': {
      const speed = action.payload;
      writeFloat(LS_SPEED, speed);
      return { ...state, speed };
    }

    case 'CYCLE_SPEED': {
      const idx = SPEED_STEPS.indexOf(state.speed);
      const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
      writeFloat(LS_SPEED, next);
      return { ...state, speed: next };
    }

    case 'SET_PLAYER_VISIBLE':
      return { ...state, playerVisible: !!action.payload };

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
  const observerRef = useRef(null);
  const observedElRef = useRef(null);

  // ---- actions ----

  const play = useCallback((item, contentId) => {
    const currentPosition = playerRef.current?.getCurrentTime?.() ?? 0;
    dispatch({ type: 'PLAY', payload: { item, contentId, currentPosition } });
  }, []);

  const stop = useCallback(() => {
    dispatch({ type: 'STOP' });
  }, []);

  const resumePaused = useCallback(() => {
    const currentPosition = playerRef.current?.getCurrentTime?.() ?? 0;
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

  const setPlayerVisible = useCallback((visible) => {
    dispatch({ type: 'SET_PLAYER_VISIBLE', payload: visible });
  }, []);

  // ---- IntersectionObserver for inline player visibility ----

  const registerPlayerEl = useCallback((domElement) => {
    // Tear down previous observer if element changed
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    observedElRef.current = domElement;

    if (!domElement) {
      dispatch({ type: 'SET_PLAYER_VISIBLE', payload: false });
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        dispatch({ type: 'SET_PLAYER_VISIBLE', payload: entry.isIntersecting });
      },
      { threshold: 0.5 }
    );
    io.observe(domElement);
    observerRef.current = io;
  }, []);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  const value = {
    ...state,
    playerRef,
    play,
    stop,
    resumePaused,
    setVolume,
    toggleMute,
    setSpeed,
    cycleSpeed,
    setPlayerVisible,
    registerPlayerEl,
    dispatch,
  };

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
