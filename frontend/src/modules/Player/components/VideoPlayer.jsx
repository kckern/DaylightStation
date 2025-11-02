import React, { useState, useCallback } from 'react';
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
  stallConfig,
  keyboardOverrides
}) {
  // console.log('[VideoPlayer] Received keyboardOverrides:', keyboardOverrides ? Object.keys(keyboardOverrides) : 'undefined');
  const isPlex = ['dash_video'].includes(media.media_type);
  const [displayReady, setDisplayReady] = useState(false);
  const [isAdapting, setIsAdapting] = useState(false);
  const [adaptMessage, setAdaptMessage] = useState(undefined);
  
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
    droppedFramePct,
    currentMaxKbps
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
    stallConfig,
    keyboardOverrides,
    onRequestBitrateChange: useCallback(async (newCapKbps, { reason }) => {
      // Trigger a refetch with bitrate override and show overlay message
      try {
        const msg =
          reason === 'over_allowance' ? 'Lowering bitrate to reduce dropped frames…' :
          reason === 'ramp_up' ? 'Increasing bitrate after stable playback…' :
          reason === 'reset_unlimited' ? 'Restoring unlimited bitrate…' :
          reason === 'manual_reset' ? 'Resetting bitrate cap…' :
          'Adapting bitrate to device performance…';
        setAdaptMessage(msg);
        setIsAdapting(true);
        await fetchVideoInfo?.({ maxVideoBitrateOverride: newCapKbps, reason });
      } finally {
        // We will also clear during canplay/playing, but ensure it doesn't stick
        setTimeout(() => { setIsAdapting(false); setAdaptMessage(undefined); }, 5000);
      }
    }, [fetchVideoInfo])
  });

  const { show, season, title, media_url } = media;

  // If the media_url (or its effective bitrate cap) changes, reset display readiness so UI transitions are correct
  React.useEffect(() => {
    setDisplayReady(false);
  }, [media_url, media?.maxVideoBitrate]);
  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const plexIdValue = media?.media_key || media?.key || media?.plex || null;
  
  
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
      {(seconds === 0 || isStalled || isSeeking || isAdapting) && (
        <LoadingOverlay
          seconds={seconds}
          isPaused={isPaused}
          fetchVideoInfo={fetchVideoInfo}
          stalled={isStalled}
          initialStart={media.seconds || 0}
          plexId={plexIdValue}
          message={isAdapting ? adaptMessage : undefined}
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
          key={`${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}`}
          ref={containerRef}
          class={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          onCanPlay={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
          onPlaying={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
        />
      ) : (
        <video
          key={`${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}`}
          autoPlay
          ref={containerRef}
          className={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          onCanPlay={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
          onPlaying={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
        />
      )}
      {showQuality && quality?.supported && (
        <QualityOverlay stats={quality} capKbps={currentMaxKbps} avgPct={droppedFramePct} />
      )}
    </div>
  );
}

function QualityOverlay({ stats, capKbps, avgPct }) {
  // console.log('[QualityOverlay] Rendering with capKbps:', capKbps);
  const pctText = `${stats.totalVideoFrames > 0 ? stats.droppedPct.toFixed(1) : '0.0'}%`;
  const avgText = typeof avgPct === 'number' ? `${(avgPct * 100).toFixed(1)}%` : null;
  return (
    <div className="quality-overlay">
      <div> Dropped Frames: {stats.droppedVideoFrames} ({pctText}) </div>
      <div> Bitrate Cap: {capKbps == null ? 'unlimited' : `${capKbps} kbps`} </div>
      {avgText && <div> Avg (rolling): {avgText} </div>}
    </div>
  );
}

QualityOverlay.propTypes = {
  stats: PropTypes.shape({
    droppedVideoFrames: PropTypes.number,
    totalVideoFrames: PropTypes.number,
    droppedPct: PropTypes.number,
    supported: PropTypes.bool
  }),
  capKbps: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  avgPct: PropTypes.number
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
