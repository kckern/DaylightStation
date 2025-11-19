import React, { useCallback, useMemo, useEffect } from 'react';
import PropTypes from 'prop-types';
import ShakaVideoStreamer from 'vimond-replay/video-streamer/shaka-player';
import { useCommonMediaController, shouldRestartFromBeginning } from '../hooks/useCommonMediaController.js';
import { ProgressBar } from './ProgressBar.jsx';
import { LoadingOverlay } from './LoadingOverlay.jsx';

const deriveApproxDurationSeconds = (media = {}) => {
  const numericFields = [
    media?.duration,
    media?.duration_seconds,
    media?.runtime,
    media?.runtimeSeconds,
    media?.media_duration
  ];
  const explicitDuration = numericFields.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
  if (Number.isFinite(explicitDuration)) {
    return explicitDuration;
  }
  const seconds = Number(media?.seconds);
  const percent = Number(media?.percent);
  if (Number.isFinite(seconds) && Number.isFinite(percent) && percent > 0) {
    return seconds / (percent / 100);
  }
  return null;
};

const resolveInitialStartSeconds = (media) => {
  const rawStart = Number(media?.seconds);
  const normalizedStart = Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 0;
  const approxDuration = deriveApproxDurationSeconds(media);
  const decision = shouldRestartFromBeginning(approxDuration, normalizedStart);
  return {
    startSeconds: decision.restart ? 0 : normalizedStart,
    decision,
    approxDuration
  };
};

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
  
  const { show, season, title, media_url } = media;

  const { startSeconds: initialStartSeconds } = useMemo(
    () => resolveInitialStartSeconds(media),
    [
      media?.seconds,
      media?.percent,
      media?.duration,
      media?.duration_seconds,
      media?.runtime,
      media?.runtimeSeconds,
      media?.media_duration
    ]
  );

  const videoKey = useMemo(
    () => `${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}`,
    [media_url, media?.maxVideoBitrate]
  );

  const {
    isDash,
    containerRef,
    seconds,
    duration,
    handleProgressClick,
    overlayProps,
    mediaInstanceKey
  } = useCommonMediaController({
    start: initialStartSeconds,
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
    instanceKey: videoKey,
    fetchVideoInfo,
    resilience
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
    const startPosition = Number.isFinite(initialStartSeconds) && initialStartSeconds > 0 ? initialStartSeconds : undefined;
    return startPosition != null
      ? { streamUrl: media_url, contentType: 'application/dash+xml', startPosition }
      : { streamUrl: media_url, contentType: 'application/dash+xml' };
  }, [media_url, initialStartSeconds]);

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  
  
  const heading = !!show && !!season && !!title
    ? `${show} - ${season}: ${title}`
    : !!show && !!season
    ? `${show} - ${season}`
    : !!show
    ? show
    : title;


  useEffect(() => {
    const mediaEl = getCurrentMediaElement();
    if (!mediaEl) return;
    mediaEl.style.objectFit = 'contain';
    mediaEl.style.maxWidth = '100%';
    mediaEl.style.maxHeight = '100%';
    mediaEl.style.width = '100%';
    mediaEl.style.height = '100%';
  }, [getCurrentMediaElement, mediaInstanceKey]);

  return (
    <div className={`video-player ${shader}`}>
      <h2>
        {heading} {`(${playbackRate}×)`}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {overlayProps && <LoadingOverlay {...overlayProps} />}
      {isDash ? (
        <div ref={containerRef} className="video-element-host">
          <ShakaVideoStreamer
            key={mediaInstanceKey}
            className="video-element"
            source={dashSource}
            configuration={{ playsInline: true }}
          />
        </div>
      ) : (
        <video
          key={mediaInstanceKey}
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
