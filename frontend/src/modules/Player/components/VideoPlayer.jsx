import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import ShakaVideoStreamer from 'vimond-replay/video-streamer/shaka-player';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
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
  onController
}) {
  // console.log('[VideoPlayer] Received keyboardOverrides:', keyboardOverrides ? Object.keys(keyboardOverrides) : 'undefined');
  const isPlex = ['dash_video'].includes(media.media_type);
  
  const {
    isDash,
    containerRef,
    seconds,
    isPaused,
    duration,
    isSeeking,
    handleProgressClick
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
    onController
  });

  const { show, season, title, media_url } = media;

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

  const videoKey = useMemo(
    () => `${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}`,
    [media_url, media?.maxVideoBitrate]
  );

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

  return (
    <div className={`video-player ${shader}`}>
      <h2>
        {heading} {`(${playbackRate}×)`}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <LoadingOverlay
        show={shouldShowLoadingOverlay}
        waitForPlaybackStart
        waitForPlaybackKey={videoKey}
        gracePeriodMs={500}
        reloadOnStallMs={5000}
        seconds={seconds}
        isPaused={isPaused}
        fetchVideoInfo={fetchVideoInfo}
        initialStart={media.seconds || 0}
        plexId={plexIdValue}
        debugContext={{
          scope: 'video',
          mediaType: media?.media_type,
          title,
          show,
          season,
          url: media_url,
          media_key: media?.media_key || media?.key || media?.plex,
          isDash,
          shader
        }}
        getMediaEl={getCurrentMediaElement}
      />
      {isDash ? (
        <div ref={containerRef} className="video-element-host">
          <ShakaVideoStreamer
            key={videoKey}
            className="video-element"
            source={dashSource}
            configuration={{ playsInline: true }}
          />
        </div>
      ) : (
        <video
          key={videoKey}
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
  onController: PropTypes.func
};
