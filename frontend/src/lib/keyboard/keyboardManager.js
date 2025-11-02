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
const createDefaultActions = (config) => ({
  seekBackward: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    if (media) {
      const increment = config.seekIncrement || Math.max(5, (media.duration || 60) / 30);
      const newTime = Math.max(media.currentTime - increment, 0);
      media.currentTime = newTime;
      config.onTimeUpdate?.(newTime);
    }
  },
  
  seekForward: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    if (media) {
      const increment = config.seekIncrement || Math.max(5, (media.duration || 60) / 30);
      const newTime = Math.min(media.currentTime + increment, media.duration || 0);
      media.currentTime = newTime;
      config.onTimeUpdate?.(newTime);
    }
  },
  
  togglePlayPause: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    if (media) {
      media.paused ? media.play() : media.pause();
    }
  },
  
  // Hardware keypad actions (from keyboard.yaml)
  play: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    if (media) {
      if (media.paused) {
        media.play();
      } else {
        // If already playing, advance to next track
        config.onNext?.();
      }
    }
  },
  
  pause: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    if (media) {
      media.paused ? media.play() : media.pause();
    }
  },
  
  rew: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    if (media) {
      const increment = config.seekIncrement || Math.max(5, (media.duration || 60) / 30);
      const newTime = Math.max(media.currentTime - increment, 0);
      media.currentTime = newTime;
      config.onTimeUpdate?.(newTime);
    }
  },
  
  fwd: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    if (media) {
      const increment = config.seekIncrement || Math.max(5, (media.duration || 60) / 30);
      const newTime = Math.min(media.currentTime + increment, media.duration || 0);
      media.currentTime = newTime;
      config.onTimeUpdate?.(newTime);
    }
  },
  
  prev: () => {
    const media = config.getMediaEl?.() || config.mediaRef?.current;
    const queuePos = config.queuePosition ?? 0;
    
    if (media && media.currentTime > 5) {
      // If more than 5 seconds in, restart current item
      media.currentTime = 0;
      config.onTimeUpdate?.(0);
    } else if (queuePos > 0) {
      // Only go to previous item if not at the first position (position > 0)
      config.onPrevious?.();
    } else {
      // If at first position (position 0) and less than 5 seconds, restart current item
      if (media) {
        media.currentTime = 0;
        config.onTimeUpdate?.(0);
      }
    }
  },
  next: () => config.onNext?.(),
  
  nextTrack: () => config.onNext?.(),
  previousTrack: () => config.onPrevious?.(),
  escape: () => config.onEscape?.(),
  
  cycleShadersUp: () => config.onCycleShaders?.(1),
  cycleShadersDown: () => config.onCycleShaders?.(-1)
});

/**
 * Advanced keyboard handler with double-click detection and customizable actions
 */
export function useAdvancedKeyboardHandler(config = {}) {
  const {
    // Media reference
    mediaRef,
    getMediaEl,
    
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
      mediaRef,
      getMediaEl,
      onTimeUpdate,
      onNext,
      onPrevious,
      onEscape,
      onCycleShaders,
      seekIncrement,
      queuePosition
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
    ignoreKeys,
    enableDoubleClick,
    doubleClickDelay,
    seekIncrement,
    queuePosition
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
      const mediaEl = getMediaEl ? getMediaEl() : mediaRef?.current;
      if (mediaEl && mediaEl.currentTime > 5) {
        mediaEl.currentTime = 0;
        setCurrentTime?.(0);
      } else {
        onEnd?.(-1);
      }
    }
  };

  return useAdvancedKeyboardHandler({
    mediaRef,
    getMediaEl,
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
