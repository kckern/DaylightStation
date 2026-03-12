import React, { useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import 'dash-video-element';
import { useCommonMediaController } from '../hooks/useCommonMediaController.js';
import { ProgressBar } from '../components/ProgressBar.jsx';
import { useUpscaleEffects } from '../hooks/useUpscaleEffects.js';
import { useRenderFpsMonitor } from '../hooks/useRenderFpsMonitor.js';
import { getLogger } from '../../../lib/logging/Logger.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { cleanupDashElement } from '../lib/dashCleanup.js';

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
  const isPlex = ['dash_video'].includes(media.mediaType);
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
    elementKey,
    getMediaEl,
    getContainerEl
  } = useCommonMediaController({
    start: media.segment ? media.segment.start : media.seconds,
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta: media,
    type: isPlex ? 'plex' : 'files',
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

  // Render FPS monitoring for blur overlay performance diagnosis
  const renderFps = useRenderFpsMonitor({
    enabled: displayReady && !isPaused,
    mediaContext: {
      title: media?.title,
      grandparentTitle: media?.grandparentTitle,
      parentTitle: media?.parentTitle,
      mediaKey: media?.assetId || media?.key || media?.plex,
      shader
    }
  });

  // Track whether the browser has blocked autoplay (NotAllowedError).
  // Surfaced via resilienceBridge so Player.jsx can render the click-to-play overlay.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Hard reset: seek to position, reload, and resume playback.
  // Uses getMediaEl to traverse shadow DOM for dash-video,
  // falling back to containerRef for native video/audio.
  const hardReset = useCallback(({ seekToSeconds } = {}) => {
    const target = getMediaEl() || containerRef.current;
    if (!target) return;
    const normalized = Number.isFinite(seekToSeconds) ? Math.max(0, seekToSeconds) : 0;
    try { target.currentTime = normalized; } catch (_) {}
    target.load?.();
    const p = target.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (err?.name === 'NotAllowedError') {
          setAutoplayBlocked(true);
          playbackLog('autoplay-blocked', { source: 'hardReset' }, { level: 'warn' });
        }
      });
    }
  }, [containerRef, getMediaEl]);

  // Register accessors with resilience bridge
  useEffect(() => {
    if (resilienceBridge?.registerAccessors) {
      resilienceBridge.registerAccessors({ getMediaEl, getContainerEl });
    }
    // Also register with legacy onRegisterMediaAccess for backward compatibility
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      resilienceBridge.onRegisterMediaAccess({
        getMediaEl,
        hardReset,
        fetchVideoInfo: fetchVideoInfo || null,
        autoplayBlocked,
        onAutoplayResolved: () => {
          // Guard: ignore if already resolving (prevents AbortError flood from rapid taps)
          if (!autoplayBlocked) return;
          setAutoplayBlocked(false); // Dismiss overlay immediately

          // Clear any pending seek intent — after autoplay block, the video should
          // play from its current position (0:00) rather than seeking to resume position.
          resilienceBridge?.onSeekRequestConsumed?.();

          // Called from user gesture context (tap/key overlay).
          // <dash-video> is a web component with no play() method — must use the
          // inner <video> from shadow DOM directly.
          const el = containerRef.current;
          const inner = el?.shadowRoot?.querySelector('video, audio') || el;
          if (!inner) {
            playbackLog('autoplay-blocked-retry-no-element', {}, { level: 'warn' });
            return;
          }

          const p = inner.play?.();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              playbackLog('autoplay-blocked-resolved', { method: 'user-gesture' });
            }).catch((err) => {
              if (err?.name === 'NotAllowedError') {
                setAutoplayBlocked(true);
                playbackLog('autoplay-blocked-retry-failed', { error: 'NotAllowedError' }, { level: 'warn' });
              } else {
                playbackLog('autoplay-blocked-retry-failed', { error: err?.name || err?.message }, { level: 'warn' });
              }
            });
          } else {
            playbackLog('autoplay-blocked-retry-no-play-method', { tagName: inner?.tagName }, { level: 'warn' });
          }
        }
      });
    }
    return () => {
      if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
        resilienceBridge.onRegisterMediaAccess({});
      }
    };
  }, [resilienceBridge, getMediaEl, getContainerEl, hardReset, fetchVideoInfo, autoplayBlocked]);

  // Clean up DASH resources on unmount to prevent SourceBuffer orphans.
  useEffect(() => {
    const el = containerRef.current;
    return () => { cleanupDashElement(el); };
  }, []);

  const { grandparentTitle, parentTitle, title, mediaUrl } = media;

  // If the mediaUrl (or its effective bitrate cap) changes, reset display readiness so UI transitions are correct
  useEffect(() => {
    setDisplayReady(false);
    displayReadyLoggedRef.current = false;
  }, [mediaUrl, media?.maxVideoBitrate]);

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
          grandparentTitle: media?.grandparentTitle,
          parentTitle: media?.parentTitle,
          mediaKey: media?.assetId || media?.key || media?.plex,
          readyTs: Date.now()
        });
      }
    };

    // --- dash.js diagnostic logging ---
    const dashLog = getLogger().child({ component: 'dash-diag' });
    const waitForApi = setInterval(() => {
      if (!el.api) return;
      clearInterval(waitForApi);
      const api = el.api;
      const Dash = api.constructor;
      const events = Dash?.events || {};

      dashLog.info('dash.api-ready', { src: el.src, events: Object.keys(events).length });

      let consecutiveEmptyFragments = 0;
      const EMPTY_FRAGMENT_THRESHOLD = 6;

      // Manifest loaded
      api.on('manifestLoaded', (e) => {
        dashLog.info('dash.manifest-loaded', {
          url: e?.data?.url?.substring(0, 120),
          type: e?.data?.type,
          duration: e?.data?.mediaPresentationDuration
        });
      });

      // Stream initialized
      api.on('streamInitialized', (e) => {
        dashLog.info('dash.stream-initialized', { streamInfo: e?.streamInfo?.id });
      });

      // Fragment loading
      api.on('fragmentLoadingStarted', (e) => {
        const r = e?.request;
        dashLog.info('dash.fragment-loading', {
          type: r?.mediaType,
          url: r?.url?.substring(0, 150),
          index: r?.index,
          startTime: r?.startTime,
          duration: r?.duration
        });
      });

      api.on('fragmentLoadingCompleted', (e) => {
        const r = e?.request;
        const resp = e?.response;
        const bytes = resp?.byteLength ?? resp?.length ?? null;

        dashLog.info('dash.fragment-loaded', {
          type: r?.mediaType,
          index: r?.index,
          startTime: r?.startTime,
          bytes,
          status: r?.requestEndDate ? 'ok' : 'unknown'
        });

        if (bytes === 0 || bytes === null) {
          consecutiveEmptyFragments++;
          if (consecutiveEmptyFragments === EMPTY_FRAGMENT_THRESHOLD) {
            dashLog.warn('dash.transcode-warming', {
              consecutiveEmpty: consecutiveEmptyFragments,
              lastType: r?.mediaType,
              lastIndex: r?.index,
              lastStartTime: r?.startTime
            });
            el.dispatchEvent(new CustomEvent('transcodewarming', {
              detail: { consecutiveEmpty: consecutiveEmptyFragments }
            }));
          }
        } else {
          if (consecutiveEmptyFragments > 0) {
            dashLog.info('dash.transcode-warmed', {
              emptyCount: consecutiveEmptyFragments,
              firstDataType: r?.mediaType,
              firstDataIndex: r?.index,
              firstDataBytes: bytes
            });
            el.dispatchEvent(new CustomEvent('transcodewarmed'));
          }
          consecutiveEmptyFragments = 0;
        }
      });

      api.on('fragmentLoadingAbandoned', (e) => {
        const r = e?.request;
        dashLog.warn('dash.fragment-abandoned', {
          type: r?.mediaType,
          url: r?.url?.substring(0, 150),
          index: r?.index
        });
      });

      // Buffer events
      api.on('bufferLevelUpdated', (e) => {
        if (Math.random() < 0.1) { // sample 10% to avoid log spam
          dashLog.info('dash.buffer-level', {
            type: e?.mediaType,
            level: e?.bufferLevel?.toFixed(2)
          });
        }
      });

      api.on('bufferStalled', (e) => {
        dashLog.warn('dash.buffer-stalled', { type: e?.mediaType });
      });

      // Playback events
      api.on('playbackStarted', () => dashLog.info('dash.playback-started'));
      api.on('playbackSeeking', (e) => dashLog.info('dash.seeking', { seekTime: e?.seekTime }));
      api.on('playbackSeeked', () => dashLog.info('dash.seeked'));
      api.on('playbackWaiting', () => dashLog.warn('dash.waiting'));
      api.on('playbackStalled', () => dashLog.warn('dash.playback-stalled'));

      // Errors — critical
      api.on('error', (e) => {
        dashLog.error('dash.error', {
          error: e?.error?.code,
          message: e?.error?.message?.substring(0, 200),
          data: e?.error?.data ? JSON.stringify(e.error.data).substring(0, 300) : null
        });
      });

      // Quality/representation changes
      api.on('qualityChangeRendered', (e) => {
        dashLog.info('dash.quality-change', {
          type: e?.mediaType,
          oldQuality: e?.oldQuality,
          newQuality: e?.newQuality
        });
      });
    }, 100);
    // --- end dash.js diagnostic logging ---

    // Detect autoplay block: Firefox won't fire canplay when autoplay is blocked
    // (readyState stays at 1). Poll the inner <video> after 3s — if it's still
    // paused, try play() to surface NotAllowedError.
    const autoplayCheckTimer = setTimeout(() => {
      const inner = el.shadowRoot?.querySelector('video, audio') || el;
      if (inner.paused) {
        const p = inner.play?.();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            if (err?.name === 'NotAllowedError') {
              setAutoplayBlocked(true);
              playbackLog('autoplay-blocked', { source: 'initial-autoplay' }, { level: 'warn' });
            }
          });
        }
      }
    }, 3000);

    const handlePlaying = () => {
      handleReady();
      setAutoplayBlocked(false);
    };

    el.addEventListener('canplay', handleReady);
    el.addEventListener('playing', handlePlaying);

    return () => {
      el.removeEventListener('canplay', handleReady);
      el.removeEventListener('playing', handlePlaying);
      clearTimeout(autoplayCheckTimer);
      clearInterval(waitForApi);
    };
  }, [isDash, mediaUrl, elementKey]);

  // FPS logging every 10 seconds during playback
  // TIMER THRASHING FIX: Use ref for timer ID and stable dependencies
  const fpsIntervalRef = useRef(null);
  const fpsLoggingActiveRef = useRef(false);

  useEffect(() => {
    // Clear any existing timer first to prevent duplicates
    if (fpsIntervalRef.current) {
      clearInterval(fpsIntervalRef.current);
      fpsIntervalRef.current = null;
    }

    // Only log if video is playing (not paused, not stalled, has started)
    const shouldLog = !isPaused && !isStalled && seconds > 0 && displayReady && quality?.supported;
    
    if (!shouldLog) {
      fpsLoggingActiveRef.current = false;
      return;
    }

    fpsLoggingActiveRef.current = true;

    fpsIntervalRef.current = setInterval(() => {
      // Re-check conditions inside interval since they may change
      if (!fpsLoggingActiveRef.current) return;

      const logger = getLogger();
      const mediaEl = getMediaEl();
      
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
        grandparentTitle: media?.grandparentTitle,
        parentTitle: media?.parentTitle,
        mediaKey: media?.assetId || media?.key || media?.plex,
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

    return () => {
      fpsLoggingActiveRef.current = false;
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
        fpsIntervalRef.current = null;
      }
    };
  }, [isPaused, isStalled, displayReady, quality?.supported]); // Reduced dependencies - only track state changes that determine timer creation

  // Keep refs up to date with latest values for use in interval callback
  const latestDataRef = useRef({ seconds, quality, droppedFramePct, currentMaxKbps, duration, media, isDash, shader });
  useEffect(() => {
    latestDataRef.current = { seconds, quality, droppedFramePct, currentMaxKbps, duration, media, isDash, shader };
  }, [seconds, quality, droppedFramePct, currentMaxKbps, duration, media, isDash, shader]);

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const plexIdValue = media?.assetId || media?.key || media?.plex || null;
  
  
  const heading = !!grandparentTitle && !!parentTitle && !!title
    ? `${grandparentTitle} - ${parentTitle}: ${title}`
    : !!grandparentTitle && !!parentTitle
    ? `${grandparentTitle} - ${parentTitle}`
    : !!grandparentTitle
    ? grandparentTitle
    : title;

  return (
    <div className={`video-player ${shader}`}>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {isDash ? (
        <dash-video
          key={`${mediaUrl || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`}
          ref={containerRef}
          class={`video-element ${displayReady ? 'show' : ''}`}
          src={mediaUrl}
          autoplay=""
          style={effectStyles}
        />
      ) : (
        <video
          key={`${mediaUrl || ''}:${media?.maxVideoBitrate ?? 'unlimited'}:${elementKey}`}
          autoPlay
          ref={containerRef}
          className={`video-element ${displayReady ? 'show' : ''}`}
          src={mediaUrl}
          style={effectStyles}
          onCanPlay={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
          onPlaying={() => { setDisplayReady(true); setIsAdapting(false); setAdaptMessage(undefined); }}
        />
      )}
      {overlayProps.showCRT && (
        <div className={overlayProps.className} />
      )}
      {showQuality && quality?.supported && (
        <QualityOverlay stats={quality} capKbps={currentMaxKbps} avgPct={droppedFramePct} renderFps={renderFps} />
      )}
    </div>
  );
}

function QualityOverlay({ stats, capKbps, avgPct, renderFps }) {
  // console.log('[QualityOverlay] Rendering with capKbps:', capKbps);
  const pctText = `${stats.totalVideoFrames > 0 ? stats.droppedPct.toFixed(1) : '0.0'}%`;
  const avgText = typeof avgPct === 'number' ? `${(avgPct * 100).toFixed(1)}%` : null;
  return (
    <div className="quality-overlay">
      <div> Dropped Frames: {stats.droppedVideoFrames} ({pctText}) </div>
      <div> Bitrate Cap: {capKbps == null ? 'unlimited' : `${capKbps} kbps`} </div>
      {avgText && <div> Avg (rolling): {avgText} </div>}
      {renderFps !== null && <div> Render FPS: {renderFps} </div>}
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
  avgPct: PropTypes.number,
  renderFps: PropTypes.number
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
