import { useMemo, useRef, useEffect } from 'react';
import { DaylightAPI } from '../api.mjs';
import { usePlayerKeyboard } from '../keyboard/keyboardManager.js';
import { acquirePlayerKeyboard } from './playerKeyboardOwnership.js';
import { createMediaTransportAdapter } from './mediaTransportAdapter.js';
import { playbackLog } from '../../modules/Player/lib/playbackLogger.js';
import { getChildLogger } from '../logging/singleton.js';
import { resolveContentId } from '../../modules/Surround/segments.js';
// The restart grace period that used to be a literal `5` in `previousTrack`
// lives in segmentNav now, as the one rule it always was — `previousSegmentAction`
// applies it, so there is nothing left to compare against here.
import { nextSegmentAction, previousSegmentAction } from '../../modules/Surround/segmentNav.js';

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
    assetId,
    setCurrentTime,
    keyboardOverrides = {},
    controller,
    isPaused: isPausedProp,
    isVideo = false
  } = config;

  const logger = useMemo(() => getChildLogger({ component: 'useMediaKeyboardHandler' }), []);
  const pausedNoticeLogged = useRef(false);

  const mediaController = createMediaTransportAdapter({
    controller,
    mediaRef,
    getMediaEl
  });

  const mediaIdentityKey = meta?.assetId || assetId || meta?.id || null;
  const mediaTitle = meta?.title || meta?.name || meta?.grandparentTitle || null;

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

  // Claim keyboard ownership while a fullscreen video is mounted so the
  // Player's bindings (Space/arrows/Esc) win over other global keydown
  // handlers beneath it — chiefly the base Menu, which treats Space/Enter as
  // "select". See playerKeyboardOwnership.js. Audio-only players and
  // ignoreKeys players don't claim it (the menu stays live beneath them).
  useEffect(() => {
    if (!isVideo || ignoreKeys) return undefined;
    return acquirePlayerKeyboard();
  }, [isVideo, ignoreKeys]);

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

  // What `next`/`previous` have to know about the piece, read off the SAME
  // object the surround host reads (`meta.surround`) so the transport can never
  // be walking a different piece than the rail is drawing. An item with no
  // sidecar yields an empty list, which segmentNav treats as the un-segmented
  // case by construction — no flag, no branch here.
  const segmentInput = (position) => ({
    segments: meta?.surround?.segments,
    contentId: resolveContentId(meta),
    position
  });

  /**
   * Move the playhead inside the current file. Tagged `'segment'` rather than
   * `'bump'`: a movement jump is a long seek that will rebuffer, so it should
   * read like a progress-bar click to the resilience layer, not like an arrow
   * key — while still being distinguishable from one in the logs.
   */
  const seekToSegment = (seconds) => {
    try { const el = getMediaEl?.(); if (el) el.__seekSource = 'segment'; } catch { /* ignore */ }
    const next = mediaController.seek?.(seconds);
    setCurrentTime && setCurrentTime(Number.isFinite(next) ? next : seconds);
  };

  /**
   * THE LINE THAT WILL BE ARGUED ABOUT LATER.
   *
   * Every press that ends up moving the QUEUE instead of the playhead says so
   * under one event name, with the reason it fell through — `no-segments` (the
   * item was never segmented), `last-segment` (the piece is over), `next-part` /
   * `prev-part` (the neighbouring segment lives in another file, which only the
   * queue can reach), `first-segment` / `before-first-segment`. Without this, a
   * queue advance that ends a one-item piece is indistinguishable in the log
   * store from one the user meant.
   */
  const logSegmentFallthrough = (direction, action, position) => {
    const data = {
      direction,
      reason: action.reason,
      step: action.step,
      seconds: Number.isFinite(position) ? position : null,
      contentId: resolveContentId(meta),
      segmentCount: Array.isArray(meta?.surround?.segments) ? meta.surround.segments.length : 0,
      surroundId: meta?.surround?.id ?? null,
      mediaKey: mediaIdentityKey,
      title: mediaTitle,
      queuePosition,
      trigger: 'keyboard'
    };
    playbackLog('player.segment-fallthrough', data, {
      level: 'info',
      context: { source: 'useMediaKeyboardHandler', mediaKey: mediaIdentityKey, queuePosition }
    });
    try {
      logger.info('player.segment-fallthrough', data, {
        context: { mediaKey: mediaIdentityKey, queuePosition },
        tags: ['keyboard', 'segment']
      });
    } catch (_) {
      // logger best effort
    }
  };

  // Custom action handlers for Player-specific logging
  const customActionHandlers = {
    nextTrack: () => {
      const { currentTime, percent } = readProgressSnapshot();

      // Inside a segmented piece, `next` is the next MOVEMENT. The queue is
      // where it goes only when the piece has no further segment in this file —
      // which is what stopped a press during the Eroica's first movement from
      // ending the symphony.
      const segmentPlan = nextSegmentAction(segmentInput(currentTime));
      if (segmentPlan.kind === 'seek') {
        logUserAction('segment-skip', {
          direction: 'next',
          seconds: Number.isFinite(currentTime) ? currentTime : null,
          toSeconds: segmentPlan.seconds,
          segmentIndex: segmentPlan.segmentIndex,
          trigger: 'keyboard'
        });
        seekToSegment(segmentPlan.seconds);
        return;
      }
      logSegmentFallthrough('next', segmentPlan, currentTime);

      logUserAction('queue-skip', {
        direction: 'next',
        seconds: Number.isFinite(currentTime) ? currentTime : null,
        percent: Number.isFinite(percent) ? percent : null,
        trigger: 'keyboard'
      });
      if (meta && type && assetId) {
        const { currentTime, percent } = readProgressSnapshot();
        const title = meta.title + (meta.grandparentTitle ? ` (${meta.grandparentTitle} - ${meta.parentTitle})` : '');
        const progressPercent = Number.isFinite(percent) ? percent : 100;
        const logType = meta.source || (meta.plex ? 'plex' : null) || type;
        DaylightAPI('api/v1/play/log', { title, type: logType, assetId, seconds: currentTime, percent: progressPercent, listId: meta?.listId || null });
        DaylightAPI('api/v1/harvest/watchlist');
      }

      onEnd && onEnd(1);
    },

    previousTrack: () => {
      const { currentTime } = readProgressSnapshot();
      const resolvedCurrent = Number.isFinite(currentTime) ? currentTime : 0;

      // Same rule as before the piece had segments — restart what is playing if
      // we are more than the grace period into it, otherwise step back — except
      // that "what is playing" is now the SEGMENT when there is one. With no
      // segments the item is one segment starting at 0, so this is byte-for-byte
      // today's behaviour, arrived at by the same arithmetic.
      const segmentPlan = previousSegmentAction(segmentInput(resolvedCurrent));
      if (segmentPlan.kind === 'seek') {
        logUserAction(segmentPlan.segmentIndex === -1 ? 'queue-skip' : 'segment-skip', {
          direction: segmentPlan.restart ? 'restart-current' : 'previous',
          seconds: resolvedCurrent,
          toSeconds: segmentPlan.seconds,
          segmentIndex: segmentPlan.segmentIndex,
          trigger: 'keyboard'
        });
        seekToSegment(segmentPlan.seconds);
        return;
      }

      logSegmentFallthrough('previous', segmentPlan, resolvedCurrent);
      logUserAction('queue-skip', {
        direction: 'previous',
        seconds: resolvedCurrent,
        trigger: 'keyboard'
      });
      onEnd && onEnd(-1);
    },

    // Override default seek to use Player-specific increment calculation
    seekForward: () => {
      const increment = resolveSeekIncrement();
      logUserAction('seek', {
        direction: 'forward',
        deltaSeconds: increment,
        trigger: 'keyboard'
      }, 'debug');
      try { const el = getMediaEl?.(); if (el) el.__seekSource = 'bump'; } catch { /* ignore */ }
      applySeekDelta(increment);
    },

    seekBackward: () => {
      const increment = resolveSeekIncrement();
      logUserAction('seek', {
        direction: 'backward',
        deltaSeconds: increment,
        trigger: 'keyboard'
      }, 'debug');
      try { const el = getMediaEl?.(); if (el) el.__seekSource = 'bump'; } catch { /* ignore */ }
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
    assetId,
    setCurrentTime,
    actionHandlers: customActionHandlers,
    componentOverrides: conditionalOverrides
  });
}
