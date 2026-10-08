import React, { useRef, useEffect, useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'AudioLayer' });
const DUCK_TRANSITION_MS = 300;

const clampVolume = value => Math.max(0, Math.min(1, Number(value) || 0));

function useRampedVolume(target, durationMs) {
  const [volume, setVolume] = useState(1);
  const volumeRef = useRef(1);
  const frameRef = useRef(null);

  useEffect(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);

    const from = volumeRef.current;
    const to = clampVolume(target);
    if (from === to) return undefined;

    const startedAt = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const next = from + ((to - from) * progress);
      volumeRef.current = next;
      setVolume(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [target, durationMs]);

  return volume;
}

/**
 * AudioLayer — configurable audio track alongside a visual queue.
 * Renders an inner <Player> for actual playback. Controls pause/duck/skip
 * behavior based on the current queue item's media type.
 *
 * Uses DOM queries to find the audio element because React 18.3's internal
 * ref format breaks useImperativeHandle forwarding for nested forwardRef
 * components — playerRef.current never gets populated.
 *
 * Modes: hidden | overlay | mini
 * Behaviors: pause (default) | duck | skip
 */
export function AudioLayer({
  contentId,
  behavior = 'pause',
  mode = 'hidden',
  duckLevel = 0.15,
  currentItemMediaType,
  Player,
  ignoreKeys: parentIgnoreKeys,
}) {
  const containerRef = useRef(null);
  const isPausedForVideoRef = useRef(false);
  const [audioQueue, setAudioQueue] = useState(null);

  /** Find the audio/video element rendered by the nested Player */
  const getAudioEl = useCallback(() => {
    if (!containerRef.current) return null;
    return containerRef.current.querySelector('audio, video');
  }, []);

  // Mount/unmount logging
  useEffect(() => {
    logger.info('audio-layer-mount', { contentId, behavior, mode });
    return () => {
      logger.debug('audio-layer-unmount', { contentId });
    };
  }, [contentId, behavior, mode]);

  // Resolve contentId to playable queue via API
  useEffect(() => {
    if (!contentId) return;

    let cancelled = false;
    const resolve = async () => {
      try {
        const response = await fetch(`/api/v1/queue/${encodeURIComponent(contentId)}`);
        if (!response.ok) {
          logger.warn('audio-layer-resolve-failed', { contentId, status: response.status });
          return;
        }
        const data = await response.json();
        if (!cancelled) {
          const items = data.items || data;
          setAudioQueue(items);
          logger.info('audio-layer-resolved', {
            contentId,
            itemCount: items.length,
            tracks: items.slice(0, 5).map(t => ({ id: t.id, title: t.title })),
          });
        }
      } catch (err) {
        logger.error('audio-layer-resolve-error', { contentId, error: err.message });
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [contentId]);

  const isVideo = currentItemMediaType === 'video';
  // Make the nested music Player the sole owner of music volume. Its media
  // controller applies this value together with screen master volume on mount,
  // prop changes, master changes, and track changes. The foreground video is a
  // different Player and never receives this prop.
  const targetMusicVolume = behavior === 'duck' && isVideo ? clampVolume(duckLevel) : 1;
  const musicVolume = useRampedVolume(targetMusicVolume, DUCK_TRANSITION_MS);

  useEffect(() => {
    if (behavior !== 'duck') return;
    logger.info(isVideo ? 'audio-layer-duck' : 'audio-layer-unduck', {
      contentId,
      reason: isVideo ? 'video-start' : 'video-end',
      fromMusicPlayerVolume: musicVolume,
      targetMusicPlayerVolume: targetMusicVolume,
      transitionMs: DUCK_TRANSITION_MS,
      owner: 'nested-player-prop',
    });
  // Log the requested transition once; musicVolume intentionally is not a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, behavior, contentId, targetMusicVolume]);

  // Pause behavior still needs a transport action. Duck behavior is entirely
  // declarative above, avoiding two owners racing over HTMLMediaElement.volume.
  useEffect(() => {
    const el = getAudioEl();
    if (behavior === 'duck') return;
    if (behavior !== 'pause' || !el) return;
    if (isVideo && !isPausedForVideoRef.current) {
      isPausedForVideoRef.current = true;
      logger.info('audio-layer-pause', { contentId, reason: 'video-start' });
      el.pause();
    } else if (!isVideo && isPausedForVideoRef.current) {
      isPausedForVideoRef.current = false;
      logger.info('audio-layer-resume', { contentId, reason: 'video-end' });
      el.play().catch(() => {});
    }
  }, [isVideo, behavior, audioQueue, getAudioEl, contentId]);

  const noop = useCallback(() => {}, []);

  if (!audioQueue || !Player) return null;

  const isHidden = mode === 'hidden';
  const containerStyle = isHidden
    ? { position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }
    : {};
  const containerClass = `audio-layer audio-layer--${mode}`;

  return (
    <div ref={containerRef} className={containerClass} style={containerStyle} data-track="audio">
      <Player
        playerType="background"
        queue={audioQueue}
        clear={noop}
        ignoreKeys={isHidden ? true : parentIgnoreKeys}
        queueNavigationKeys={{ previous: 'ArrowUp', next: 'ArrowDown' }}
        volume={musicVolume}
        shuffle={true}
      />
    </div>
  );
}

AudioLayer.propTypes = {
  contentId: PropTypes.string.isRequired,
  behavior: PropTypes.oneOf(['pause', 'duck', 'skip']),
  mode: PropTypes.oneOf(['hidden', 'overlay', 'mini']),
  duckLevel: PropTypes.number,
  currentItemMediaType: PropTypes.string,
  Player: PropTypes.elementType.isRequired,
  ignoreKeys: PropTypes.bool,
};
