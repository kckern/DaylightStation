/**
 * Centralized Keyboard Configuration
 * This file manages all keyboard mappings and can be easily extended or modified
 */

// Global keyboard shortcuts that work across all components
export const GLOBAL_SHORTCUTS = {
  'Escape': 'escape',
  'Enter': 'togglePlayPause',
  ' ': 'togglePlayPause',
  'Space': 'togglePlayPause',
  'MediaPlayPause': 'togglePlayPause'
};

// Media player specific shortcuts
export const MEDIA_SHORTCUTS = {
  'ArrowLeft': 'seekBackward',
  'ArrowRight': 'seekForward',
  'Tab': 'nextTrack',
  'Backspace': 'previousTrack'
};

// Display/UI shortcuts
export const UI_SHORTCUTS = {
  'ArrowUp': 'cycleShadersUp',
  'ArrowDown': 'cycleShadersDown'
};

// Component-specific configuration
export const COMPONENT_CONFIGS = {
  // Player components with queue support
  player: {
    keyMappings: { ...GLOBAL_SHORTCUTS, ...MEDIA_SHORTCUTS, ...UI_SHORTCUTS },
    enableDoubleClick: true,
    doubleClickDelay: 350
  },
  
  // Scripture components - simpler controls
  scriptures: {
    keyMappings: { ...GLOBAL_SHORTCUTS, ...MEDIA_SHORTCUTS },
    enableDoubleClick: false,
    seekIncrement: (duration) => Math.max(5, duration / 30)
  },
  
  // ContentScroller components
  contentScroller: {
    keyMappings: { ...GLOBAL_SHORTCUTS, ...MEDIA_SHORTCUTS, ...UI_SHORTCUTS },
    enableDoubleClick: true
  },
  
  // Office app (global navigation)
  officeApp: {
    keyMappings: { ...GLOBAL_SHORTCUTS },
    enableDoubleClick: false
  }
};

// Utility function to get configuration for a specific component
export function getKeyboardConfig(componentType, overrides = {}) {
  const baseConfig = COMPONENT_CONFIGS[componentType] || COMPONENT_CONFIGS.player;
  
  return {
    ...baseConfig,
    ...overrides,
    keyMappings: {
      ...baseConfig.keyMappings,
      ...(overrides.keyMappings || {})
    }
  };
}

// Helper to merge playback keys from external config (keyboard.yaml)
export function mergePlaybackKeys(baseConfig, playbackKeys) {
  const playbackKeyMappings = {};
  
  // Map playback keys to actions
  Object.entries(playbackKeys).forEach(([action, keys]) => {
    (keys || []).forEach(key => {
      playbackKeyMappings[key] = action;
    });
  });
  
  return {
    ...baseConfig,
    playbackKeys: playbackKeyMappings
  };
}
