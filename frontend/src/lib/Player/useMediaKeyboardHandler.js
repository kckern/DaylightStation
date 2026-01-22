import { useMemo, useRef, useEffect } from 'react';
import { DaylightAPI } from '../api.mjs';
import { usePlayerKeyboard } from '../keyboard/keyboardManager.js';
import { createMediaTransportAdapter } from './mediaTransportAdapter.js';
import { playbackLog } from '../../modules/Player/lib/playbackLogger.js';
import { getChildLogger } from '../logging/singleton.js';

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

  const logger = useMemo(() => getChildLogger({ component: 'useMediaKeyboardHandler' }), []);
  const pausedNoticeLogged = useRef(false);

  const mediaController = createMediaTransportAdapter({
    controller,
    mediaRef,
    getMediaEl
  });

  const mediaIdentityKey = meta?.media_key || media_key || meta?.id || null;
  const mediaTitle = meta?.title || meta?.name || meta?.show || null;

  const logUserAction = (action, payload = {}, level = 'info') => {
    const data = {
      action,
      type,
      mediaKey: mediaIdentityKey,
      title: mediaTitle,
      queuePosition,
      ...payload
    };
    playbackLog('player.user-action', data, {
      level,
      context: {
        source: 'useMediaKeyboardHandler',
        mediaKey: mediaIdentityKey,
        queuePosition
      }
    });
    try {
      logger[level === 'debug' ? 'debug' : level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info']('ui.key.action', data, {
        context: { mediaKey: mediaIdentityKey, queuePosition },
        tags: ['keyboard']
      });
    } catch (_) {
      // logger best effort
    }
  };

  // Log keyboard configuration once per render
  useEffect(() => {
    logger.debug('ui.keyboard.config_loaded', {
      playbackKeyCount: Object.keys(playbackKeys || {}).length,
      hasOverrides: Boolean(keyboardOverrides && Object.keys(keyboardOverrides).length),
      queuePosition,
      paused: Boolean(isPausedProp)
    });
  }, [logger, playbackKeys, keyboardOverrides, queuePosition, isPausedProp]);

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
      const { currentTime, percent } = readProgressSnapshot();
      logUserAction('queue-skip', {
        direction: 'next',
        seconds: Number.isFinite(currentTime) ? currentTime : null,
        percent: Number.isFinite(percent) ? percent : null,
        trigger: 'keyboard'
      });
      if (meta && type && media_key) {
        const { currentTime, percent } = readProgressSnapshot();
        const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
        const progressPercent = Number.isFinite(percent) ? percent : 100;
        const logType = (meta.plex || /^\d+$/.test(String(media_key))) ? 'plex' : type;
        DaylightAPI('api/v1/play/log', { title, type: logType, media_key, seconds: currentTime, percent: progressPercent });
        DaylightAPI('api/v1/harvest/watchlist');
      }

      onEnd && onEnd(1);
    },

    previousTrack: () => {
      const { currentTime } = readProgressSnapshot();
      const resolvedCurrent = Number.isFinite(currentTime) ? currentTime : 0;
      logUserAction('queue-skip', {
        direction: resolvedCurrent > 5 ? 'restart-current' : 'previous',
        seconds: resolvedCurrent,
        trigger: 'keyboard'
      });
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
      logUserAction('seek', {
        direction: 'forward',
        deltaSeconds: increment,
        trigger: 'keyboard'
      }, 'debug');
      applySeekDelta(increment);
    },

    seekBackward: () => {
      const increment = resolveSeekIncrement();
      logUserAction('seek', {
        direction: 'backward',
        deltaSeconds: increment,
        trigger: 'keyboard'
      }, 'debug');
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
    if (!pausedNoticeLogged.current) {
      logger.debug('ui.key.ignored-when-paused', { keys: ['ArrowUp', 'ArrowDown'], queuePosition });
      pausedNoticeLogged.current = true;
    }
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
