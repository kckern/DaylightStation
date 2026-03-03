import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'AudioLayer' });

/**
 * AudioLayer — configurable audio track alongside a visual queue.
 * Renders an inner <Player> for actual playback. Controls pause/duck/skip
 * behavior based on the current queue item's media type.
 *
 * Modes: hidden | overlay | mini
 * Behaviors: pause (default) | duck | skip
 */
export function AudioLayer({
  contentId,
  behavior = 'pause',
  mode = 'hidden',
  currentItemMediaType,
  Player,
  ignoreKeys: parentIgnoreKeys,
}) {
  const playerRef = useRef(null);
  const prevMediaTypeRef = useRef(currentItemMediaType);
  const savedVolumeRef = useRef(1);
  const [audioQueue, setAudioQueue] = useState(null);

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
          setAudioQueue(data.items || data);
          logger.info('audio-layer-resolved', { contentId, itemCount: (data.items || data).length });
        }
      } catch (err) {
        logger.error('audio-layer-resolve-error', { contentId, error: err.message });
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [contentId]);

  // React to media type changes for pause/duck/skip
  useEffect(() => {
    const prev = prevMediaTypeRef.current;
    prevMediaTypeRef.current = currentItemMediaType;

    if (!playerRef.current) return;
    if (prev === currentItemMediaType) return;

    const isVideo = currentItemMediaType === 'video';
    const wasVideo = prev === 'video';

    if (isVideo && !wasVideo) {
      if (behavior === 'pause') {
        logger.debug('audio-layer-pause', { reason: 'video-start' });
        playerRef.current.pause();
      } else if (behavior === 'duck') {
        logger.debug('audio-layer-duck', { reason: 'video-start' });
        const el = playerRef.current.getMediaElement?.();
        if (el) {
          savedVolumeRef.current = el.volume;
          el.volume = Math.max(0, el.volume * 0.1);
        }
      }
    } else if (wasVideo && !isVideo) {
      if (behavior === 'pause') {
        logger.debug('audio-layer-resume', { reason: 'video-end' });
        playerRef.current.play();
      } else if (behavior === 'duck') {
        logger.debug('audio-layer-unduck', { reason: 'video-end' });
        const el = playerRef.current.getMediaElement?.();
        if (el) {
          el.volume = savedVolumeRef.current;
        }
      }
    }
  }, [currentItemMediaType, behavior]);

  const noop = useCallback(() => {}, []);

  if (!audioQueue || !Player) return null;

  const isHidden = mode === 'hidden';
  const containerStyle = isHidden
    ? { position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }
    : {};
  const containerClass = `audio-layer audio-layer--${mode}`;

  return (
    <div className={containerClass} style={containerStyle} data-track="audio">
      <Player
        ref={playerRef}
        playerType="background"
        queue={audioQueue}
        clear={noop}
        ignoreKeys={isHidden ? true : parentIgnoreKeys}
        shuffle={true}
      />
    </div>
  );
}

AudioLayer.propTypes = {
  contentId: PropTypes.string.isRequired,
  behavior: PropTypes.oneOf(['pause', 'duck', 'skip']),
  mode: PropTypes.oneOf(['hidden', 'overlay', 'mini']),
  currentItemMediaType: PropTypes.string,
  Player: PropTypes.elementType.isRequired,
  ignoreKeys: PropTypes.bool,
};
