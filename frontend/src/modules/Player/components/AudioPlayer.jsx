import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { formatTime } from '../lib/helpers.js';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { ProgressBar } from './ProgressBar.jsx';
import { getLogger } from '../../../lib/logging/Logger.js';
import { useImageUpscaleBlur } from '../hooks/useImageUpscaleBlur.js';
import { useShaderDiagnostics } from '../hooks/useShaderDiagnostics.js';

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
    getContainerEl,
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

  // Register accessors with resilience bridge
  useEffect(() => {
    if (resilienceBridge?.registerAccessors) {
      resilienceBridge.registerAccessors({ getMediaEl, getContainerEl });
    }
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      resilienceBridge.onRegisterMediaAccess({
        getMediaEl,
        hardReset,
        fetchVideoInfo: fetchVideoInfo || null
      });
    }
    return () => {
      if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
        resilienceBridge.onRegisterMediaAccess({});
      }
    };
  }, [resilienceBridge, getMediaEl, getContainerEl, hardReset, fetchVideoInfo]);

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const header = !!artist && !!album ? `${artist} - ${album}` : !!artist ? artist : !!album ? album : media_url;
  const shaderState = percent < 0.1 || seconds > duration - 2 ? 'on' : 'off';
  const footer = `${title}${albumArtist && albumArtist !== artist ? ` (${albumArtist})` : ''}`;

  // Image upscale blur for album art
  const coverImageRef = useRef(null);
  const { blurStyle: coverBlurStyle } = useImageUpscaleBlur(coverImageRef);

  // Shader diagnostics - track dimensions for debugging coverage issues
  const shaderRef = useRef(null);
  const audioPlayerRef = useRef(null);
  useShaderDiagnostics({
    shaderRef,
    containerRef: audioPlayerRef,
    label: 'audio-shader',
    shaderState
  });

  // Enhanced blackout diagnostics - log all layer dimensions
  useEffect(() => {
    if (shader !== 'blackout') return;
    const logger = getLogger();
    const logBlackoutDimensions = () => {
      const audioPlayer = audioPlayerRef.current;
      const playerParent = audioPlayer?.closest('.player');
      const shaderEl = shaderRef.current;
      const viewport = { w: window.innerWidth, h: window.innerHeight };

      const getRect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
      };

      const playerRect = getRect(playerParent);
      const audioRect = getRect(audioPlayer);
      const shaderRect = getRect(shaderEl);

      logger.warn('blackout.dimensions', {
        viewport,
        player: playerRect,
        audioPlayer: audioRect,
        shader: shaderRect,
        gaps: playerRect ? {
          top: playerRect.y,
          left: playerRect.x,
          bottom: viewport.h - playerRect.bottom,
          right: viewport.w - playerRect.right
        } : null
      });
    };

    // Log on mount and resize
    const timeoutId = setTimeout(logBlackoutDimensions, 200);
    window.addEventListener('resize', logBlackoutDimensions);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', logBlackoutDimensions);
    };
  }, [shader]);

  // Prod telemetry: cover image loaded
  const handleCoverLoad = useCallback(() => {
    const logger = getLogger();
    logger.info('playback.cover-loaded', {
      title,
      artist,
      album,
      mediaKey: media?.media_key || media?.key || media?.plex,
      loadedTs: Date.now()
    });
  }, [title, artist, album, media?.media_key, media?.key, media?.plex]);

  return (
    <div ref={audioPlayerRef} className={`audio-player ${shader}`}>
      <div ref={shaderRef} className={`shader ${shaderState}`} />
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <div className="audio-content">
        <div className="image-container">
          {image && (
            <>
              <img
                ref={coverImageRef}
                src={image}
                alt={title}
                className="cover"
                style={coverBlurStyle}
                onLoad={handleCoverLoad}
              />
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
