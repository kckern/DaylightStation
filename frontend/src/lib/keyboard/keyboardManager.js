import { useEffect, useRef } from 'react';

/**
 * Centralized Keyboard Management System
 * Eliminates duplication by providing a single, configurable keyboard handler
 */

// Default key mappings - can be overridden per component
const DEFAULT_KEY_MAPPINGS = {
  // Navigation
  'ArrowLeft': 'seekBackward',
  'ArrowRight': 'seekForward', 
  'ArrowUp': 'cycleShadersUp',
  'ArrowDown': 'cycleShadersDown',
  
  // Playback control
  'Enter': 'togglePlayPause',
  ' ': 'togglePlayPause',
  'Space': 'togglePlayPause',
  'MediaPlayPause': 'togglePlayPause',
  
  // Track navigation
  'Tab': 'nextTrack',
  'Backspace': 'previousTrack',
  
  // Escape
  'Escape': 'escape'
};

// Default action handlers - can be overridden per component
const createDefaultActions = (config) => {
  const {
    transport = {},
    seekIncrement,
    queuePosition = 0,
    onTimeUpdate,
    onNext,
    onPrevious,
    onEscape,
    onCycleShaders,
    getPlaybackState
  } = config;

  const getCurrentTime = () => {
    const current = transport.getCurrentTime?.();
    return Number.isFinite(current) ? current : 0;
  };

  const getDuration = () => {
    const duration = transport.getDuration?.();
    return Number.isFinite(duration) ? duration : 0;
  };

  const resolveIncrement = () => seekIncrement || Math.max(5, (getDuration() || 60) / 30);

  const applySeekDelta = (deltaSeconds) => {
    if (!Number.isFinite(deltaSeconds)) return;
    if (typeof transport.seekRelative === 'function') {
      const next = transport.seekRelative(deltaSeconds);
      if (Number.isFinite(next)) {
        onTimeUpdate?.(next);
      }
      return;
    }
    const current = getCurrentTime();
    const duration = getDuration();
    const unclamped = current + deltaSeconds;
    const capped = duration > 0 ? Math.min(unclamped, duration) : unclamped;
    const next = Math.max(0, capped);
    transport.seek?.(next);
    onTimeUpdate?.(next);
  };

  const togglePlayPause = () => {
    if (typeof transport.toggle === 'function') {
      transport.toggle();
      return;
    }
    const state = getPlaybackState?.();
    if (state?.isPaused) {
      transport.play?.();
    } else {
      transport.pause?.();
    }
  };

  const ensurePlayingElseAdvance = () => {
    const state = getPlaybackState?.();
    if (!state || state.isPaused) {
      transport.play?.();
    } else {
      onNext?.();
    }
  };

  const pauseOrToggle = () => {
    const state = getPlaybackState?.();
    if (state && !state.isPaused) {
      transport.pause?.();
    } else {
      transport.play?.();
    }
  };

  const restartOrPrevious = () => {
    const current = getCurrentTime();
    if (current > 5) {
      transport.seek?.(0);
      onTimeUpdate?.(0);
      return;
    }
    if (queuePosition > 0) {
      onPrevious?.();
      return;
    }
    transport.seek?.(0);
    onTimeUpdate?.(0);
  };

  return {
    seekBackward: () => applySeekDelta(-resolveIncrement()),
    seekForward: () => applySeekDelta(resolveIncrement()),
    togglePlayPause,
    play: ensurePlayingElseAdvance,
    pause: pauseOrToggle,
    rew: () => applySeekDelta(-resolveIncrement()),
    fwd: () => applySeekDelta(resolveIncrement()),
    prev: restartOrPrevious,
    next: () => onNext?.(),
    nextTrack: () => onNext?.(),
    previousTrack: () => onPrevious?.(),
    escape: () => onEscape?.(),
    cycleShadersUp: () => onCycleShaders?.(1),
    cycleShadersDown: () => onCycleShaders?.(-1)
  };
};

/**
 * Advanced keyboard handler with double-click detection and customizable actions
 */
export function useAdvancedKeyboardHandler(config = {}) {
  const {
    transport,
    getPlaybackState,
    
    // Custom key mappings (overrides defaults)
    keyMappings = {},
    
    // Custom action handlers (overrides defaults)  
    actionHandlers = {},
    
    // Playback key mappings from external config (e.g., keyboard.yaml)
    playbackKeys = {},
    
    // Double-click detection
    enableDoubleClick = true,
    doubleClickDelay = 350,
    
    // Callbacks
    onTimeUpdate,
    onNext,
    onPrevious, 
    onEscape,
    onCycleShaders,
    
    // Configuration
    seekIncrement,
    queuePosition = 0,
    ignoreKeys = false,
    
    // Component-specific overrides
    componentOverrides = {}
  } = config;

  const lastKeypressTimeRef = useRef(0);

  useEffect(() => {
    if (ignoreKeys) return;

    // Merge default and custom key mappings
    const finalKeyMappings = { ...DEFAULT_KEY_MAPPINGS, ...keyMappings };
    
    // Create action handlers with config
    const defaultActions = createDefaultActions({
      transport,
      onTimeUpdate,
      onNext,
      onPrevious,
      onEscape,
      onCycleShaders,
      seekIncrement,
      queuePosition,
      getPlaybackState
    });
    
    // Merge default and custom action handlers
    const finalActionHandlers = { ...defaultActions, ...actionHandlers };

    // Add playback key mappings from external config
    const playbackKeyMappings = {};
    Object.entries(playbackKeys).forEach(([action, keys]) => {
      (keys || []).forEach(key => {
        playbackKeyMappings[key] = action;
      });
    });

    const handleKeyDown = (event) => {
      if (event.repeat) return;

      // Log arrow key presses for debugging
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        console.log('[keyboardManager] Arrow key pressed:', event.key, { 
          hasComponentOverride: !!componentOverrides[event.key],
          overrideKeys: Object.keys(componentOverrides)
        });
      }

      // Check component-specific overrides first
      if (componentOverrides[event.key]) {
        event.preventDefault();
        componentOverrides[event.key](event);
        return;
      }

      // Check playback key mappings
      const playbackAction = playbackKeyMappings[event.key];
      if (playbackAction && finalActionHandlers[playbackAction]) {
        event.preventDefault();
        finalActionHandlers[playbackAction](event);
        return;
      }

      // Check standard key mappings
      const actionName = finalKeyMappings[event.key];
      if (!actionName || !finalActionHandlers[actionName]) return;

      // Handle double-click detection for navigation keys
      if (enableDoubleClick && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const now = Date.now();
        const isDoubleClick = now - lastKeypressTimeRef.current < doubleClickDelay;
        lastKeypressTimeRef.current = now;

        if (isDoubleClick) {
          // Double-click: skip to next/previous track
          const skipAction = event.key === 'ArrowRight' ? 'nextTrack' : 'previousTrack';
          if (finalActionHandlers[skipAction]) {
            event.preventDefault();
            finalActionHandlers[skipAction](event);
            return;
          }
        }
      }

      // Execute the mapped action
      event.preventDefault();
      finalActionHandlers[actionName](event);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    actionHandlers,
    componentOverrides,
    doubleClickDelay,
    enableDoubleClick,
    getPlaybackState,
    ignoreKeys,
    keyMappings,
    onCycleShaders,
    onEscape,
    onNext,
    onPrevious,
    onTimeUpdate,
    playbackKeys,
    queuePosition,
    seekIncrement,
    transport
  ]);
}

/**
 * Simple keyboard handler for basic media controls
 * Wrapper around useAdvancedKeyboardHandler with sensible defaults
 */
export function useSimpleMediaKeyboard({
  mediaRef,
  onAdvance,
  onClear,
  onTimeUpdate,
  seekIncrement,
  customKeys = {}
}) {
  return useAdvancedKeyboardHandler({
    mediaRef,
    onNext: onAdvance,
    onEscape: onClear,
    onTimeUpdate,
    seekIncrement,
    componentOverrides: customKeys
  });
}

/**
 * Hook specifically for Player components
 * Maintains compatibility with existing useMediaKeyboardHandler
 */
export function usePlayerKeyboard(config) {
  const {
    mediaRef,
    getMediaEl,
    transport,
    getPlaybackState,
    onEnd,
    onClear,
    cycleThroughClasses,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    meta,
    type,
    media_key,
    setCurrentTime,
    actionHandlers = {},
    componentOverrides = {}
  } = config;

  // Default action handlers for Player-specific logic
  const defaultPlayerActions = {
    previousTrack: () => {
      const current = Number.isFinite(transport?.getCurrentTime?.())
        ? transport.getCurrentTime()
        : 0;
      if (current > 5) {
        transport?.seek?.(0);
        setCurrentTime?.(0);
      } else {
        onEnd?.(-1);
      }
    }
  };

  return useAdvancedKeyboardHandler({
    mediaRef,
    getMediaEl,
    transport,
    getPlaybackState,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    onNext: () => onEnd?.(1),
    onPrevious: () => onEnd?.(-1),
    onEscape: onClear,
    onCycleShaders: cycleThroughClasses,
    onTimeUpdate: setCurrentTime,
    
    // Merge default and custom action handlers
    actionHandlers: { ...defaultPlayerActions, ...actionHandlers },
    componentOverrides
  });
}
