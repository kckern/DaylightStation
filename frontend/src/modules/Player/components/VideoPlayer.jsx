import React, { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import 'dash-video-element';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { ProgressBar } from './ProgressBar.jsx';
import { LoadingOverlay } from './LoadingOverlay.jsx';
import { useUpscaleEffects } from '../hooks/useUpscaleEffects.js';
import { getLogger } from '../../../lib/logging/Logger.js';

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
  keyboardOverrides,
  onController,
  upscaleEffects = 'auto',
  resilienceBridge
}) {
  // console.log('[VideoPlayer] Received keyboardOverrides:', keyboardOverrides ? Object.keys(keyboardOverrides) : 'undefined');
  const isPlex = ['dash_video'].includes(media.media_type);
  const [displayReady, setDisplayReady] = useState(false);
  const [isAdapting, setIsAdapting] = useState(false);
  const [adaptMessage, setAdaptMessage] = useState(undefined);
  const displayReadyLoggedRef = useRef(false);
  
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
    currentMaxKbps,
    stallState,
    elementKey
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
  onController,
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

  // Upscale detection and effects
  const { effectStyles, overlayProps } = useUpscaleEffects({
    mediaRef: containerRef,
    preset: upscaleEffects
  });

  // Register media element with resilience bridge for overlay loop detection
  useEffect(() => {
    if (typeof resilienceBridge?.onRegisterMediaAccess !== 'function') return;
    const getMediaEl = () => {
      const el = containerRef.current;
      if (!el) return null;
      // For dash-video custom element, get the inner video
      return el.shadowRoot?.querySelector('video') || el;
    };
    resilienceBridge.onRegisterMediaAccess({
      getMediaEl,
      hardReset: null,
      fetchVideoInfo: fetchVideoInfo || null
    });
    return () => { resilienceBridge.onRegisterMediaAccess({}); };
  }, [resilienceBridge, fetchVideoInfo]);

  const { show, season, title, media_url } = media;

  // If the media_url (or its effective bitrate cap) changes, reset display readiness so UI transitions are correct
  useEffect(() => {
    setDisplayReady(false);
    displayReadyLoggedRef.current = false;
  }, [media_url, media?.maxVideoBitrate]);

  // Handle dash-video custom element events (web components don't support React synthetic events)
  useEffect(() => {
    if (!isDash) return;
    const el = containerRef.current;
    if (!el) return;

    const handleReady = () => {
      setDisplayReady(true);
      setIsAdapting(false);
      setAdaptMessage(undefined);
      // Prod telemetry: video display ready (one-time per media)
      if (!displayReadyLoggedRef.current) {
        displayReadyLoggedRef.current = true;
        const logger = getLogger();
        logger.info('playback.video-ready', {
          title: media?.title,
          show: media?.show,
          season: media?.season,
          mediaKey: media?.media_key || media?.key || media?.plex,
          readyTs: Date.now()
        });
      }
    };

    el.addEventListener('canplay', handleReady);
    el.addEventListener('playing', handleReady);

    return () => {
      el.removeEventListener('canplay', handleReady);
      el.removeEventListener('playing', handleReady);
    };
  }, [isDash, media_url, elementKey]);

  // FPS logging every 10 seconds during playback
  useEffect(() => {
    // Only log if video is playing (not paused, not stalled, has started)
    if (isPaused || isStalled || seconds === 0 || !displayReady || !quality?.supported) {
      return;
    }

    const intervalId = setInterval(() => {
      const logger = getLogger();
      const mediaEl = (containerRef.current?.shadowRoot?.querySelector('video')) || containerRef.current;
      
      // Calculate instantaneous FPS if available
      let estimatedFps = null;
      if (mediaEl && typeof mediaEl.requestVideoFrameCallback === 'function') {
        // Modern browsers support this for precise frame timing
        estimatedFps = 'supported';
      } else if (quality.totalVideoFrames > 0 && duration > 0) {
        // Fallback: estimate from total frames / duration
        estimatedFps = Math.round((quality.totalVideoFrames / duration) * 100) / 100;
      }

      logger.info('playback.fps_stats', {
        title: media?.title,
        show: media?.show,
        season: media?.season,
        mediaKey: media?.media_key || media?.key || media?.plex,
        currentTime: Math.round(seconds * 10) / 10,
        duration: Math.round(duration * 10) / 10,
        droppedFrames: quality.droppedVideoFrames,
        totalFrames: quality.totalVideoFrames,
        droppedPct: quality.droppedPct?.toFixed(2),
        avgDroppedPct: droppedFramePct ? (droppedFramePct * 100).toFixed(2) : null,
        bitrateCapKbps: currentMaxKbps,
        estimatedFps,
        playbackRate: media.playbackRate || 1,
        isDash,
        shader
      });
    }, 10000); // 10 seconds

    return () => clearInterval(intervalId);
  }, [isPaused, isStalled, seconds, displayReady, quality, droppedFramePct, currentMaxKbps, duration, media, isDash, shader, containerRef]);

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const plexIdValue = media?.media_key || media?.key || media?.plex || null;
  
  
  const heading = !!show && !!season && !!title
    ? `${show} - ${season}: ${title}`
    : !!show && !!seasonc
    ? `${show} - ${season}`
    : !!show
    ? show
    : title;

  return (
    <div className={`video-player ${shader}`}>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {((seconds === 0 && isPaused) || isStalled || isSeeking || isAdapting) && (
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
            shader,
            stallState
          }}
          getMediaEl={() => {
            const el = (containerRef.current?.shadowRoot?.querySelector('video')) || containerRef.current;
            return el || null;
          }}
        />
      )}
      {isDash ? (
        <dash-video
          key={`${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`}
          ref={containerRef}
          class={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          autoplay=""
          style={effectStyles}
        />
      ) : (
        <video
          key={`${media_url || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`}
          autoPlay
          ref={containerRef}
          className={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          style={effectStyles}
          onCanPlay={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
          onPlaying={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
        />
      )}
      {overlayProps.showCRT && (
        <div className={overlayProps.className} />
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
  stallConfig: PropTypes.object,
  onController: PropTypes.func,
  upscaleEffects: PropTypes.oneOf(['auto', 'blur-only', 'crt-only', 'aggressive', 'none']),
  resilienceBridge: PropTypes.shape({
    onPlaybackMetrics: PropTypes.func,
    onRegisterMediaAccess: PropTypes.func,
    seekToIntentSeconds: PropTypes.number,
    onSeekRequestConsumed: PropTypes.func,
    onStartupSignal: PropTypes.func
  })
};
