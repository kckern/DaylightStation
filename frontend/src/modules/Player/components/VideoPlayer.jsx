import React, { useState } from 'react';
import PropTypes from 'prop-types';
import 'dash-video-element';
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
  showQuality,
  stallConfig 
}) {
  const isPlex = ['dash_video'].includes(media.media_type);
  const [displayReady, setDisplayReady] = useState(false);
  
  const {
    isDash,
    containerRef,
    seconds,
    isPaused,
    duration,
    isStalled,
    isSeeking,
    handleProgressClick,
    quality,
    adaptVideoBitrate
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
    showQuality,
    stallConfig
  });

  const { show, season, title, media_url } = media;
  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const heading = !!show && !!season && !!title
    ? `${show} - ${season}: ${title}`
    : !!show && !!season
    ? `${show} - ${season}`
    : !!show
    ? show
    : title;

  return (
    <div className={`video-player ${shader}`}>
      <h2>
        {heading} {`(${playbackRate}×)`}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {(seconds === 0 || isStalled || isSeeking) && (
        <LoadingOverlay
          seconds={seconds}
          isPaused={isPaused}
          fetchVideoInfo={fetchVideoInfo}
          stalled={isStalled}
          initialStart={media.seconds || 0}
          plexId={media?.media_key || media?.key || media?.plex || null}
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
          getMediaEl={() => {
            const el = (containerRef.current?.shadowRoot?.querySelector('video')) || containerRef.current;
            return el || null;
          }}
        />
      )}
      {isDash ? (
        <dash-video
          ref={containerRef}
          class={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          onCanPlay={() => setDisplayReady(true)}
          onPlaying={() => setDisplayReady(true)}
        />
      ) : (
        <video
          autoPlay
          ref={containerRef}
          className={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          onCanPlay={() => setDisplayReady(true)}
          onPlaying={() => setDisplayReady(true)}
        />
      )}
      {showQuality && quality?.supported && (
        <QualityOverlay stats={quality} />
      )}
    </div>
  );
}

function QualityOverlay({ stats }) {
  const pctText = `${stats.totalVideoFrames > 0 ? stats.droppedPct.toFixed(1) : '0.0'}%`;
  return (
    <div className="quality-overlay">
      Dropped Frames: {stats.droppedVideoFrames} ({pctText})
    </div>
  );
}

QualityOverlay.propTypes = {
  stats: PropTypes.shape({
    droppedVideoFrames: PropTypes.number,
    totalVideoFrames: PropTypes.number,
    droppedPct: PropTypes.number,
    supported: PropTypes.bool
  })
};

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
  showQuality: PropTypes.bool,
  stallConfig: PropTypes.object
};
