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
    setCurrentTime,
    keyboardOverrides = {},
    controller,
    isPaused: isPausedProp = false
  } = config;

  const mediaController = controller || {};

  const resolveSeekIncrement = () => {
    const duration = mediaController.getDuration?.();
    if (Number.isFinite(duration) && duration > 0) {
      return Math.max(5, Math.floor(duration / 50));
    }
    return 10;
  };

  const applySeekDelta = (deltaSeconds) => {
    if (!Number.isFinite(deltaSeconds)) return;
    if (typeof mediaController.seekRelative === 'function') {
      const next = mediaController.seekRelative(deltaSeconds);
      if (Number.isFinite(next)) {
        setCurrentTime && setCurrentTime(next);
      }
      return;
    }
    const current = Number.isFinite(mediaController.getCurrentTime?.())
      ? mediaController.getCurrentTime()
      : 0;
    const next = Math.max(0, current + deltaSeconds);
    mediaController.seek?.(next);
    setCurrentTime && setCurrentTime(next);
  };

  // Custom action handlers for Player-specific logging
  const customActionHandlers = {
    nextTrack: () => {
      if (meta && type && media_key) {
        const currentTime = Number.isFinite(mediaController.getCurrentTime?.())
          ? mediaController.getCurrentTime()
          : 0;
        const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
        DaylightAPI('media/log', { title, type, media_key, seconds: currentTime, percent: 100 });
        DaylightAPI('harvest/watchlist');
      }

      onEnd && onEnd(1);
    },

    previousTrack: () => {
      const current = Number.isFinite(mediaController.getCurrentTime?.())
        ? mediaController.getCurrentTime()
        : 0;
      if (current > 5) {
        mediaController.seek?.(0);
        setCurrentTime && setCurrentTime(0);
      } else {
        onEnd && onEnd(-1);
      }
    },

    // Override default seek to use Player-specific increment calculation
    seekForward: () => {
      const increment = resolveSeekIncrement();
      applySeekDelta(increment);
    },

    seekBackward: () => {
      const increment = resolveSeekIncrement();
      applySeekDelta(-increment);
    }
  };

  // Custom key mappings for when paused (skip up/down arrow handling)
  const conditionalOverrides = { ...keyboardOverrides };
  const isPaused = Boolean(isPausedProp);
  
  if (isPaused) {
    conditionalOverrides['ArrowUp'] = () => {}; // Let LoadingOverlay handle
    conditionalOverrides['ArrowDown'] = () => {}; // Let LoadingOverlay handle
  }

  return usePlayerKeyboard({
    mediaRef,
    getMediaEl,
    transport: mediaController,
    getPlaybackState: mediaController.getPlaybackState,
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
