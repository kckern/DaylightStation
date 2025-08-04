import { DaylightAPI } from '../api.mjs';
import { usePlayerKeyboard } from '../keyboard/keyboardManager.js';

/**
 * Custom hook for handling media playback keyboard shortcuts
 * Now uses centralized keyboard management system
 * @deprecated Consider using usePlayerKeyboard directly for new components
 */
export function useMediaKeyboardHandler(config) {
  const {
    mediaRef,
    getMediaEl,
    onEnd,
    onClear,
    cycleThroughClasses,
    playbackKeys = {},
    queuePosition = 0,
    ignoreKeys = false,
    meta,
    type,
    media_key,
    setCurrentTime
  } = config;

  // Custom action handlers for Player-specific logging
  const customActionHandlers = {
    nextTrack: () => {
      const mediaEl = getMediaEl ? getMediaEl() : mediaRef?.current;
      
      // Log completion for Player components
      if (mediaEl && meta && type && media_key) {
        const percent = ((mediaEl.currentTime / mediaEl.duration) * 100).toFixed(1);
        const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
        DaylightAPI(`media/log`, { title, type, media_key, seconds: mediaEl.currentTime, percent: 100 });
        DaylightAPI(`harvest/watchlist`);
      }
      
      onEnd && onEnd(1);
    },

    previousTrack: () => {
      const mediaEl = getMediaEl ? getMediaEl() : mediaRef?.current;
      if (mediaEl && mediaEl.currentTime > 5) {
        mediaEl.currentTime = 0;
        setCurrentTime && setCurrentTime(0);
      } else {
        onEnd && onEnd(-1);
      }
    },

    // Override default seek to use Player-specific increment calculation
    seekForward: () => {
      const mediaEl = getMediaEl ? getMediaEl() : mediaRef?.current;
      if (mediaEl) {
        const increment = mediaEl.duration
          ? Math.max(5, Math.floor(mediaEl.duration / 50))
          : 10;
        const newTime = Math.min(mediaEl.currentTime + increment, mediaEl.duration || 0);
        mediaEl.currentTime = newTime;
        setCurrentTime && setCurrentTime(newTime);
      }
    },

    seekBackward: () => {
      const mediaEl = getMediaEl ? getMediaEl() : mediaRef?.current;
      if (mediaEl) {
        const increment = mediaEl.duration
          ? Math.max(5, Math.floor(mediaEl.duration / 50))
          : 10;
        const newTime = Math.max(mediaEl.currentTime - increment, 0);
        mediaEl.currentTime = newTime;
        setCurrentTime && setCurrentTime(newTime);
      }
    }
  };

  // Custom key mappings for when paused (skip up/down arrow handling)
  const conditionalOverrides = {};
  const mediaEl = getMediaEl ? getMediaEl() : mediaRef?.current;
  const isPaused = mediaEl?.paused === true;
  
  if (isPaused) {
    conditionalOverrides['ArrowUp'] = () => {}; // Let LoadingOverlay handle
    conditionalOverrides['ArrowDown'] = () => {}; // Let LoadingOverlay handle
  }

  return usePlayerKeyboard({
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
    actionHandlers: customActionHandlers,
    componentOverrides: conditionalOverrides
  });
}
