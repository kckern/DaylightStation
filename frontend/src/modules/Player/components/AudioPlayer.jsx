import React, { useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { formatTime } from '../lib/helpers.js';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { ProgressBar } from './ProgressBar.jsx';
import { getLogger } from '../../../lib/logging/Logger.js';

/**
 * Audio player component for playing audio tracks
 */
export function AudioPlayer({ 
  media, 
  advance, 
  clear, 
  shader, 
  setShader, 
  volume, 
  playbackRate, 
  cycleThroughClasses, 
  classes,
  playbackKeys,
  queuePosition, 
  fetchVideoInfo, 
  ignoreKeys, 
  onProgress, 
  onMediaRef, 
  onController,
  resilienceBridge,
  watchedDurationProvider
}) {
  const { media_url, title, artist, albumArtist, album, image, type } = media || {};
  const baseMediaKey = useMemo(
    () => `${media_url || ''}:${media?.media_key || media?.key || media?.id || ''}`,
    [media_url, media?.media_key, media?.key, media?.id]
  );
  const {
    seconds,
    duration,
    containerRef,
    handleProgressClick,
    mediaInstanceKey,
    getMediaEl,
    isPaused,
    isSeeking,
    hardReset
  } = useCommonMediaController({
    start: media.seconds,
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: true,
    isVideo: false,
    meta: media,
    type: ['track'].includes(type) ? 'plex' : 'media',
    shader,
    setShader,
    cycleThroughClasses,
    classes,
    volume,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    onProgress,
    onMediaRef,
    onController,
    instanceKey: baseMediaKey,
    fetchVideoInfo,
    seekToIntentSeconds: resilienceBridge?.seekToIntentSeconds,
    resilienceBridge,
    watchedDurationProvider
  });
  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const header = !!artist && !!album ? `${artist} - ${album}` : !!artist ? artist : !!album ? album : media_url;
  const shaderState = percent < 0.1 || seconds > duration - 2 ? 'on' : 'off';
  const footer = `${title}${albumArtist && albumArtist !== artist ? ` (${albumArtist})` : ''}`;

  // Prod telemetry: cover image loaded
  const handleCoverLoad = useCallback(() => {
    const logger = getLogger();
    logger.info('playback.cover-loaded', {
      title,
      mediaKey: media?.media_key || media?.key || media?.plex,
      loadedTs: Date.now()
    });
  }, [title, media?.media_key, media?.key, media?.plex]);

  return (
    <div className={`audio-player ${shader}`}>
      <div className={`shader ${shaderState}`} />
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <div className="audio-content">
        <div className="image-container">
          {image && (
            <>
              <img src={image} alt={title} className="cover" onLoad={handleCoverLoad} />
              <div className="image-backdrop" />
            </>
          )}
        </div>
        <div className="audio-info">
          <p className="audio-header">{header}</p>
          <p className="audio-timing">{formatTime(seconds)} / {formatTime(duration)}</p>
          <p className="audio-footer">{footer}</p>
        </div>
      </div>
      <audio
        key={mediaInstanceKey}
        ref={containerRef}
        src={media_url}
        autoPlay
        style={{ display: 'none' }}
      />
    </div>
  );
}

AudioPlayer.propTypes = {
  media: PropTypes.object.isRequired,
  advance: PropTypes.func.isRequired,
  clear: PropTypes.func.isRequired,
  shader: PropTypes.string,
  setShader: PropTypes.func,
  volume: PropTypes.number,
  playbackRate: PropTypes.number,
  cycleThroughClasses: PropTypes.func,
  classes: PropTypes.arrayOf(PropTypes.string),
  playbackKeys: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.string),
    PropTypes.objectOf(PropTypes.arrayOf(PropTypes.string))
  ]),
  queuePosition: PropTypes.number,
  fetchVideoInfo: PropTypes.func,
  ignoreKeys: PropTypes.bool,
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  onController: PropTypes.func,
  watchedDurationProvider: PropTypes.func,
  resilienceBridge: PropTypes.shape({
    onPlaybackMetrics: PropTypes.func,
    onRegisterMediaAccess: PropTypes.func,
    seekToIntentSeconds: PropTypes.number,
    onSeekRequestConsumed: PropTypes.func,
    onStartupSignal: PropTypes.func
  })
};
