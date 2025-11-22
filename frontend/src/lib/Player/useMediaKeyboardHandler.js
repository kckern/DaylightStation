import { DaylightAPI } from '../api.mjs';
import { usePlayerKeyboard } from '../keyboard/keyboardManager.js';
import { createMediaTransportAdapter } from './mediaTransportAdapter.js';

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
    isPaused: isPausedProp
  } = config;

  const mediaController = createMediaTransportAdapter({
    controller,
    mediaRef,
    getMediaEl
  });

  const getPlaybackState = () => mediaController.getPlaybackState?.();

  const readProgressSnapshot = () => {
    const currentTime = Number.isFinite(mediaController.getCurrentTime?.())
      ? mediaController.getCurrentTime()
      : 0;
    const duration = Number.isFinite(mediaController.getDuration?.())
      ? mediaController.getDuration()
      : null;
    const percent = Number.isFinite(duration) && duration > 0
      ? Math.min(100, (currentTime / duration) * 100)
      : null;
    return { currentTime, duration, percent };
  };

  const resolveSeekIncrement = () => {
    const duration = mediaController.getDuration?.();
    if (Number.isFinite(duration) && duration > 0) {
      return Math.max(5, Math.floor(duration / 50));
    }
    return 10;
  };

  const applySeekDelta = (deltaSeconds) => {
    if (!Number.isFinite(deltaSeconds)) return;
    const nextFromRelative = mediaController.seekRelative?.(deltaSeconds);
    if (Number.isFinite(nextFromRelative)) {
      setCurrentTime && setCurrentTime(nextFromRelative);
      return;
    }
    const current = Number.isFinite(mediaController.getCurrentTime?.())
      ? mediaController.getCurrentTime()
      : 0;
    const duration = mediaController.getDuration?.();
    const unclamped = current + deltaSeconds;
    const capped = Number.isFinite(duration) && duration > 0
      ? Math.min(unclamped, duration)
      : unclamped;
    const bounded = Math.max(0, capped);
    const next = mediaController.seek?.(bounded);
    const finalTime = Number.isFinite(next) ? next : bounded;
    setCurrentTime && setCurrentTime(finalTime);
  };

  // Custom action handlers for Player-specific logging
  const customActionHandlers = {
    nextTrack: () => {
      if (meta && type && media_key) {
        const { currentTime, percent } = readProgressSnapshot();
        const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
        const progressPercent = Number.isFinite(percent) ? percent : 100;
        DaylightAPI('media/log', { title, type, media_key, seconds: currentTime, percent: progressPercent });
        DaylightAPI('harvest/watchlist');
      }

      onEnd && onEnd(1);
    },

    previousTrack: () => {
      const { currentTime } = readProgressSnapshot();
      const resolvedCurrent = Number.isFinite(currentTime) ? currentTime : 0;
      if (resolvedCurrent > 5) {
        const next = mediaController.seek?.(0);
        setCurrentTime && setCurrentTime(Number.isFinite(next) ? next : 0);
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
  const hasExplicitPaused = Object.prototype.hasOwnProperty.call(config, 'isPaused');
  const derivedState = getPlaybackState?.();
  const isPaused = hasExplicitPaused
    ? Boolean(isPausedProp)
    : Boolean(derivedState?.isPaused ?? derivedState?.paused);
  
  if (isPaused) {
    conditionalOverrides['ArrowUp'] = () => {}; // Let pause overlay handle
    conditionalOverrides['ArrowDown'] = () => {}; // Let pause overlay handle
  }

  return usePlayerKeyboard({
    mediaRef,
    getMediaEl,
    transport: mediaController,
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
    actionHandlers: customActionHandlers,
    componentOverrides: conditionalOverrides
  });
}
