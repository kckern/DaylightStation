import React, { useCallback, useMemo, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import ShakaVideoStreamer from 'vimond-replay/video-streamer/shaka-player';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { useMediaResilience, mergeMediaResilienceConfig } from '../hooks/useMediaResilience.js';
import { ProgressBar } from './ProgressBar.jsx';
import { LoadingOverlay } from './LoadingOverlay.jsx';

/**
 * Video player component for playing video content (including DASH video)
 */
export function VideoPlayer({ 
  media, 
  advance, 
  clear, 
  shader, 
  volume, 
  playbackRate,
  setShader, 
  cycleThroughClasses, 
  classes, 
  playbackKeys,
  queuePosition, 
  fetchVideoInfo, 
  ignoreKeys, 
  onProgress, 
  onMediaRef, 
  keyboardOverrides,
  onController,
  resilience
}) {
  // console.log('[VideoPlayer] Received keyboardOverrides:', keyboardOverrides ? Object.keys(keyboardOverrides) : 'undefined');
  const isPlex = ['dash_video'].includes(media.media_type);
  
  const [resilienceReloadToken, setResilienceReloadToken] = useState(0);
  const { show, season, title, media_url } = media;

  const videoKey = useMemo(
    () => `${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}`,
    [media_url, media?.maxVideoBitrate]
  );

  useEffect(() => {
    setResilienceReloadToken(0);
  }, [videoKey]);

  const playerInstanceKey = useMemo(
    () => `${videoKey}:reload-${resilienceReloadToken}`,
    [videoKey, resilienceReloadToken]
  );

  const handleResilienceReload = useCallback(() => {
    setResilienceReloadToken((token) => token + 1);
  }, []);

  const {
    isDash,
    containerRef,
    seconds,
    isPaused,
    duration,
    isSeeking,
    handleProgressClick,
    setControllerExtras
  } = useCommonMediaController({
    start: media.seconds,
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta: media,
    type: isPlex ? 'plex' : 'media',
    shader,
    volume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    onProgress,
    onMediaRef,
    keyboardOverrides,
    onController,
    instanceKey: playerInstanceKey
  });

  const getCurrentMediaElement = useCallback(() => {
    const host = containerRef.current;
    if (!host) return null;
    const selector = 'video';
    const shadowRoot = host.shadowRoot;
    if (shadowRoot && typeof shadowRoot.querySelector === 'function') {
      const shadowVideo = shadowRoot.querySelector(selector);
      if (shadowVideo) return shadowVideo;
    }

    const tagName = typeof host.tagName === 'string' ? host.tagName.toUpperCase() : '';
    if (tagName === 'VIDEO') {
      return host;
    }

    if (typeof host.querySelector === 'function') {
      const nestedVideo = host.querySelector(selector);
      if (nestedVideo) return nestedVideo;
    }

    return null;
  }, [containerRef]);


  const dashSource = useMemo(() => {
    if (!media_url) return null;
    const startPosition = Number.isFinite(media?.seconds) ? media.seconds : undefined;
    return startPosition != null
      ? { streamUrl: media_url, contentType: 'application/dash+xml', startPosition }
      : { streamUrl: media_url, contentType: 'application/dash+xml' };
  }, [media_url, media?.seconds]);

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const plexIdValue = media?.media_key || media?.key || media?.plex || null;
  
  
  const heading = !!show && !!season && !!title
    ? `${show} - ${season}: ${title}`
    : !!show && !!season
    ? `${show} - ${season}`
    : !!show
    ? show
    : title;

  const shouldShowLoadingOverlay = seconds === 0 || isSeeking;
  const { config: resilienceConfig, onStateChange: resilienceStateHandler, controllerRef: resilienceControllerRef } = resilience || {};

  const combinedResilienceConfig = useMemo(
    () => mergeMediaResilienceConfig(resilienceConfig, media?.mediaResilienceConfig),
    [resilienceConfig, media?.mediaResilienceConfig]
  );

  const { overlayProps, controller: resilienceController } = useMediaResilience({
    getMediaEl: getCurrentMediaElement,
    meta: media,
    seconds,
    isPaused,
    isSeeking,
    initialStart: media.seconds || 0,
    waitKey: playerInstanceKey,
    fetchVideoInfo,
    onStateChange: resilienceStateHandler
      ? (nextState) => resilienceStateHandler(nextState, media)
      : undefined,
    onReload: handleResilienceReload,
    configOverrides: combinedResilienceConfig,
    controllerRef: resilienceControllerRef,
    explicitShow: shouldShowLoadingOverlay,
    plexId: plexIdValue,
    debugContext: {
      scope: 'video',
      mediaType: media?.media_type,
      title,
      show,
      season,
      url: media_url,
      media_key: media?.media_key || media?.key || media?.plex,
      isDash,
      shader,
      reloadToken: resilienceReloadToken
    }
  });

  useEffect(() => {
    const mediaEl = getCurrentMediaElement();
    if (!mediaEl) return;
    mediaEl.style.objectFit = 'contain';
    mediaEl.style.maxWidth = '100%';
    mediaEl.style.maxHeight = '100%';
    mediaEl.style.width = '100%';
    mediaEl.style.height = '100%';
  }, [getCurrentMediaElement, playerInstanceKey]);

  useEffect(() => {
    if (!setControllerExtras) return;
    if (resilienceController) {
      setControllerExtras({ resilience: resilienceController });
    } else {
      setControllerExtras(null);
    }
  }, [resilienceController, setControllerExtras]);

  return (
    <div className={`video-player ${shader}`}>
      <h2>
        {heading} {`(${playbackRate}×)`}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <LoadingOverlay {...overlayProps} />
      {isDash ? (
        <div ref={containerRef} className="video-element-host">
          <ShakaVideoStreamer
            key={playerInstanceKey}
            className="video-element"
            source={dashSource}
            configuration={{ playsInline: true }}
          />
        </div>
      ) : (
        <video
          key={playerInstanceKey}
          autoPlay
          ref={containerRef}
          className="video-element"
          src={media_url}
        />
      )}
    </div>
  );
}

VideoPlayer.propTypes = {
  media: PropTypes.object.isRequired,
  advance: PropTypes.func.isRequired,
  clear: PropTypes.func.isRequired,
  shader: PropTypes.string,
  volume: PropTypes.number,
  playbackRate: PropTypes.number,
  setShader: PropTypes.func,
  cycleThroughClasses: PropTypes.func,
  classes: PropTypes.arrayOf(PropTypes.string),
  playbackKeys: PropTypes.arrayOf(PropTypes.string),
  queuePosition: PropTypes.number,
  fetchVideoInfo: PropTypes.func,
  ignoreKeys: PropTypes.bool,
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  keyboardOverrides: PropTypes.object,
  onController: PropTypes.func,
  resilience: PropTypes.shape({
    config: PropTypes.object,
    onStateChange: PropTypes.func,
    controllerRef: PropTypes.shape({ current: PropTypes.any })
  })
};
