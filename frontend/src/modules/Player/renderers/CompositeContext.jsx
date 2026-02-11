import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';

/**
 * CompositeContext - Shared state management for composed presentations.
 *
 * Coordinates visual and audio tracks with graceful degradation support.
 * Uses reducer pattern for predictable state transitions.
 *
 * @see docs/plans/2026-01-31-composed-presentation-design.md
 */

// Status constants for type safety
export const VISUAL_STATUS = Object.freeze({
  loading: 'loading',
  loaded: 'loaded',
  error: 'error',
  partial: 'partial'
});

export const AUDIO_STATUS = Object.freeze({
  loading: 'loading',
  loaded: 'loaded',
  error: 'error',
  silent: 'silent'
});

// Action types
const ActionTypes = Object.freeze({
  DEGRADE_VISUAL: 'DEGRADE_VISUAL',
  DEGRADE_AUDIO: 'DEGRADE_AUDIO',
  RETRY_VISUAL: 'RETRY_VISUAL',
  SET_VISUAL_INDEX: 'SET_VISUAL_INDEX',
  SET_VISUAL_STATUS: 'SET_VISUAL_STATUS',
  SET_AUDIO_STATUS: 'SET_AUDIO_STATUS',
  SET_PLAYING: 'SET_PLAYING',
  INCREMENT_VISUAL_ERROR: 'INCREMENT_VISUAL_ERROR',
  INCREMENT_AUDIO_ERROR: 'INCREMENT_AUDIO_ERROR'
});

// Initial state factory
const createInitialState = () => ({
  visual: {
    status: VISUAL_STATUS.loading,
    errorCount: 0
  },
  audio: {
    status: AUDIO_STATUS.loading,
    errorCount: 0
  },
  currentVisualIndex: 0,
  isPlaying: true
});

/**
 * Reducer for composite presentation state.
 * Handles all state transitions with predictable updates.
 */
function compositeReducer(state, action) {
  switch (action.type) {
    case ActionTypes.DEGRADE_VISUAL:
      return {
        ...state,
        visual: {
          ...state.visual,
          status: VISUAL_STATUS.error
        }
      };

    case ActionTypes.DEGRADE_AUDIO:
      return {
        ...state,
        audio: {
          ...state.audio,
          status: AUDIO_STATUS.silent
        }
      };

    case ActionTypes.RETRY_VISUAL:
      return {
        ...state,
        visual: {
          status: VISUAL_STATUS.loading,
          errorCount: 0
        }
      };

    case ActionTypes.SET_VISUAL_INDEX:
      return {
        ...state,
        currentVisualIndex: action.payload
      };

    case ActionTypes.SET_VISUAL_STATUS:
      return {
        ...state,
        visual: {
          ...state.visual,
          status: action.payload
        }
      };

    case ActionTypes.SET_AUDIO_STATUS:
      return {
        ...state,
        audio: {
          ...state.audio,
          status: action.payload
        }
      };

    case ActionTypes.SET_PLAYING:
      return {
        ...state,
        isPlaying: action.payload
      };

    case ActionTypes.INCREMENT_VISUAL_ERROR:
      return {
        ...state,
        visual: {
          ...state.visual,
          errorCount: state.visual.errorCount + 1,
          status: state.visual.errorCount + 1 >= 3 ? VISUAL_STATUS.error : VISUAL_STATUS.partial
        }
      };

    case ActionTypes.INCREMENT_AUDIO_ERROR:
      return {
        ...state,
        audio: {
          ...state.audio,
          errorCount: state.audio.errorCount + 1
        }
      };

    default:
      return state;
  }
}

// Create context with null default (enforces provider usage)
const CompositeContext = createContext(null);
CompositeContext.displayName = 'CompositeContext';

/**
 * CompositeProvider - Context provider for composed presentation state.
 *
 * Provides state and memoized actions to all child components.
 * Use with useCompositeContext hook to access state and actions.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - Child components
 * @param {Object} [props.initialState] - Optional initial state override
 */
export function CompositeProvider({ children, initialState }) {
  const [state, dispatch] = useReducer(
    compositeReducer,
    initialState,
    (init) => init ? { ...createInitialState(), ...init } : createInitialState()
  );

  // Memoize all actions to prevent unnecessary re-renders
  const degradeVisual = useCallback(() => {
    dispatch({ type: ActionTypes.DEGRADE_VISUAL });
  }, []);

  const degradeAudio = useCallback(() => {
    dispatch({ type: ActionTypes.DEGRADE_AUDIO });
  }, []);

  const retryVisual = useCallback(() => {
    dispatch({ type: ActionTypes.RETRY_VISUAL });
  }, []);

  const setVisualIndex = useCallback((index) => {
    dispatch({ type: ActionTypes.SET_VISUAL_INDEX, payload: index });
  }, []);

  const setVisualStatus = useCallback((status) => {
    dispatch({ type: ActionTypes.SET_VISUAL_STATUS, payload: status });
  }, []);

  const setAudioStatus = useCallback((status) => {
    dispatch({ type: ActionTypes.SET_AUDIO_STATUS, payload: status });
  }, []);

  const setPlaying = useCallback((isPlaying) => {
    dispatch({ type: ActionTypes.SET_PLAYING, payload: isPlaying });
  }, []);

  const incrementVisualError = useCallback(() => {
    dispatch({ type: ActionTypes.INCREMENT_VISUAL_ERROR });
  }, []);

  const incrementAudioError = useCallback(() => {
    dispatch({ type: ActionTypes.INCREMENT_AUDIO_ERROR });
  }, []);

  // Memoize context value to prevent provider re-renders from propagating
  const contextValue = useMemo(() => ({
    // State
    visual: state.visual,
    audio: state.audio,
    currentVisualIndex: state.currentVisualIndex,
    isPlaying: state.isPlaying,

    // Actions
    degradeVisual,
    degradeAudio,
    retryVisual,
    setVisualIndex,
    setVisualStatus,
    setAudioStatus,
    setPlaying,
    incrementVisualError,
    incrementAudioError
  }), [
    state.visual,
    state.audio,
    state.currentVisualIndex,
    state.isPlaying,
    degradeVisual,
    degradeAudio,
    retryVisual,
    setVisualIndex,
    setVisualStatus,
    setAudioStatus,
    setPlaying,
    incrementVisualError,
    incrementAudioError
  ]);

  return (
    <CompositeContext.Provider value={contextValue}>
      {children}
    </CompositeContext.Provider>
  );
}

CompositeProvider.displayName = 'CompositeProvider';

/**
 * useCompositeContext - Hook to access composed presentation state and actions.
 *
 * Must be used within a CompositeProvider.
 *
 * @returns {Object} Context value with state and actions
 * @throws {Error} If used outside CompositeProvider
 *
 * @example
 * const { visual, audio, currentVisualIndex, isPlaying, setPlaying } = useCompositeContext();
 *
 * // Check visual status
 * if (visual.status === VISUAL_STATUS.error) {
 *   // Handle degraded visual state
 * }
 *
 * // Toggle playback
 * setPlaying(!isPlaying);
 */
export function useCompositeContext() {
  const context = useContext(CompositeContext);

  if (context === null) {
    throw new Error('useCompositeContext must be used within a CompositeProvider');
  }

  return context;
}
