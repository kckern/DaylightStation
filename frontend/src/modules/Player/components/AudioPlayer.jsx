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
  
  // Fallback for artist/album from metadata if not directly available
  // (Plex track metadata often has artist/album in metadata object, or grandparentTitle/parentTitle)
  const effectiveArtist = artist || media?.metadata?.artist || media?.grandparentTitle || media?.metadata?.grandparentTitle || null;
  const effectiveAlbum = album || media?.metadata?.album || media?.parentTitle || media?.metadata?.parentTitle || null;
  const effectiveAlbumArtist = albumArtist || media?.metadata?.albumArtist || null;
  
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
  const header = !!effectiveArtist && !!effectiveAlbum ? `${effectiveArtist} - ${effectiveAlbum}` : !!effectiveArtist ? effectiveArtist : !!effectiveAlbum ? effectiveAlbum : title || 'Audio Track';
  const shaderState = percent < 0.1 || seconds > duration - 2 ? 'on' : 'off';
  const footer = `${title}${effectiveAlbumArtist && effectiveAlbumArtist !== effectiveArtist ? ` (${effectiveAlbumArtist})` : ''}`;

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

  // Enhanced blackout diagnostics - log all layer dimensions for prod debugging
  useEffect(() => {
    if (shader !== 'blackout') return;
    const logger = getLogger();

    const logBlackoutDimensions = (trigger = 'mount') => {
      const audioPlayer = audioPlayerRef.current;
      const playerParent = audioPlayer?.closest('.player');
      const tvApp = audioPlayer?.closest('.tv-app');
      const shaderEl = shaderRef.current;

      // Viewport and document dimensions
      const viewport = {
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        clientW: document.documentElement.clientWidth,
        clientH: document.documentElement.clientHeight,
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        dpr: window.devicePixelRatio || 1
      };

      const body = {
        scrollH: document.body.scrollHeight,
        clientH: document.body.clientHeight,
        offsetH: document.body.offsetHeight
      };

      const getRect = (el, label) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          x: Math.round(r.x * 100) / 100,
          y: Math.round(r.y * 100) / 100,
          w: Math.round(r.width * 100) / 100,
          h: Math.round(r.height * 100) / 100,
          bottom: Math.round(r.bottom * 100) / 100,
          right: Math.round(r.right * 100) / 100,
          position: style.position,
          overflow: style.overflow
        };
      };

      const tvAppRect = getRect(tvApp, 'tvApp');
      const playerRect = getRect(playerParent, 'player');
      const audioRect = getRect(audioPlayer, 'audioPlayer');
      const shaderRect = getRect(shaderEl, 'shader');

      // Calculate gaps from each layer to viewport edge
      const calcGaps = (rect) => rect ? {
        top: Math.round(rect.y * 100) / 100,
        left: Math.round(rect.x * 100) / 100,
        bottom: Math.round((viewport.innerH - rect.bottom) * 100) / 100,
        right: Math.round((viewport.innerW - rect.right) * 100) / 100
      } : null;

      logger.warn('blackout.dimensions', {
        trigger,
        env: process.env.NODE_ENV || 'unknown',
        viewport,
        body,
        layers: {
          tvApp: tvAppRect,
          player: playerRect,
          audioPlayer: audioRect,
          shader: shaderRect
        },
        gaps: {
          tvApp: calcGaps(tvAppRect),
          player: calcGaps(playerRect),
          audioPlayer: calcGaps(audioRect),
          shader: calcGaps(shaderRect)
        },
        ts: Date.now()
      });
    };

    // Log on mount, resize, and orientation change
    const timeoutId = setTimeout(() => logBlackoutDimensions('mount'), 200);
    const handleResize = () => logBlackoutDimensions('resize');
    const handleOrientation = () => logBlackoutDimensions('orientation');

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientation);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientation);
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
