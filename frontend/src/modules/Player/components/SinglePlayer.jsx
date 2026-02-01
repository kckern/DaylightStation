import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Scriptures, Hymns, Talk, Poetry } from '../../ContentScroller/ContentScroller.jsx';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import { fetchMediaInfo } from '../lib/api.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { AudioPlayer } from './AudioPlayer.jsx';
import { VideoPlayer } from './VideoPlayer.jsx';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';
import { useShaderDiagnostics } from '../hooks/useShaderDiagnostics.js';

/**
 * Single player component that handles different media types
 * Routes to appropriate player based on media type
 */
export function SinglePlayer(props = {}) {
  const {
    onResolvedMeta,
    onPlaybackMetrics,
    onRegisterMediaAccess,
    onRegisterResilienceBridge,
    onStartupSignal,
    seekToIntentSeconds = null,
    onSeekRequestConsumed,
    remountDiagnostics,
    wrapWithContainer = true,
    suppressLocalOverlay = false,
    plexClientSession = null,
    ...play
  } = props;
  const {
    plex,
    media,
    hymn,
    primary,
    scripture,
    talk,
    poem,
    rate,
    advance,
    open,
    clear,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,
    queuePosition,
    playerType,
    ignoreKeys,
    shuffle,
    continuous,
    shader,
    volume,
    playbackRate,
    onProgress,
    onMediaRef,
    assetId: mediaKeyProp,
    upscaleEffects
  } = play || {};
  
  // Prepare common props for content scroller components
  const contentProps = {
    ...play,
    playbackKeys,
    ignoreKeys,
    queuePosition
  };

  const contentScrollerBridge = {
    onResolvedMeta,
    onPlaybackMetrics,
    onRegisterMediaAccess,
    seekToIntentSeconds,
    onSeekRequestConsumed,
    remountDiagnostics,
    onStartupSignal
  };

  // Shader diagnostics for loading state - must be called before early returns
  const loadingShaderRef = useRef(null);
  const playerContainerRef = useRef(null);
  // Content scroller types don't use the shader, so disable for them
  const isContentScrollerType = !!(scripture || hymn || primary || talk || poem);
  useShaderDiagnostics({
    shaderRef: loadingShaderRef,
    containerRef: playerContainerRef,
    label: 'loading-shader',
    shaderState: 'on',
    enabled: !isContentScrollerType && !suppressLocalOverlay
  });

  if (!!scripture) return <Scriptures {...contentProps} {...contentScrollerBridge} />;
  if (!!hymn) return <Hymns {...contentProps} {...contentScrollerBridge} />;
  if (!!primary) return <Hymns {...contentProps} {...contentScrollerBridge} hymn={primary} subfolder="primary" />;
  if (!!talk) return <Talk {...contentProps} {...contentScrollerBridge} />;
  if (!!poem) return <Poetry {...contentProps} {...contentScrollerBridge} />;

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);
  const watchedDurationRef = useRef(0);
  const playbackTimerRef = useRef({ lastTickTs: null });

  const setWatchedDurationValue = useCallback((value = 0) => {
    const numeric = Number(value);
    watchedDurationRef.current = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
    playbackTimerRef.current.lastTickTs = null;
  }, []);

  const getWatchedDuration = useCallback(() => watchedDurationRef.current, []);

  const accumulateWatchedDuration = useCallback((progress = {}) => {
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    const paused = Boolean(progress?.paused);
    if (!paused) {
      if (playbackTimerRef.current.lastTickTs != null) {
        const deltaSeconds = Math.max(0, (now - playbackTimerRef.current.lastTickTs) / 1000);
        watchedDurationRef.current += deltaSeconds;
      }
      playbackTimerRef.current.lastTickTs = now;
    } else {
      playbackTimerRef.current.lastTickTs = null;
    }
    return watchedDurationRef.current;
  }, []);

  const playbackSessionKey = useMemo(() => {
    const candidates = [
      mediaInfo?.assetId,
      mediaInfo?.key,
      mediaInfo?.plex,
      mediaInfo?.id,
      mediaInfo?.mediaUrl,
      plex,
      mediaKeyProp,
      media
    ];
    const firstDefined = candidates.find((value) => value != null && String(value).length);
    return firstDefined != null ? String(firstDefined) : null;
  }, [mediaInfo?.assetId, mediaInfo?.key, mediaInfo?.plex, mediaInfo?.id, mediaInfo?.mediaUrl, plex, mediaKeyProp, media]);

  const handleProgress = useCallback((payload = {}) => {
    const watchedDuration = accumulateWatchedDuration(payload);
    if (typeof window !== 'undefined') {
      const percentValue = Number(payload?.percent);
      const storageKey = playbackSessionKey ? `watchedDuration:${playbackSessionKey}` : null;
      if (storageKey) {
        try {
          if (Number.isFinite(percentValue) && percentValue >= 99) {
            window.localStorage.removeItem(storageKey);
          } else {
            window.localStorage.setItem(storageKey, JSON.stringify({
              value: watchedDuration,
              updatedAt: Date.now()
            }));
          }
        } catch (_) {
          // Ignore storage errors; timer state remains in memory
        }
      }
    }
    // Forward playback metrics to Player.jsx for resilience tracking
    // This bridges useCommonMediaController's stall state to useMediaResilience
    if (typeof onPlaybackMetrics === 'function') {
      onPlaybackMetrics({
        seconds: payload?.currentTime,
        isPaused: payload?.paused,
        isSeeking: payload?.isSeeking ?? false,
        stalled: payload?.stalled,
        stallState: payload?.stallState
      });
    }
    if (typeof onProgress === 'function') {
      onProgress({
        ...payload,
        watchedDuration
      });
    }
  }, [accumulateWatchedDuration, onPlaybackMetrics, onProgress, playbackSessionKey]);

  useEffect(() => {
    if (!playbackSessionKey || typeof window === 'undefined') {
      setWatchedDurationValue(0);
      return;
    }
    const storageKey = `watchedDuration:${playbackSessionKey}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setWatchedDurationValue(0);
        return;
      }
      const parsed = JSON.parse(raw);
      const storedValue = typeof parsed === 'number'
        ? parsed
        : Number.isFinite(parsed?.value)
          ? parsed.value
          : null;
      if (Number.isFinite(storedValue) && storedValue >= 0) {
        setWatchedDurationValue(storedValue);
      } else {
        setWatchedDurationValue(0);
      }
    } catch (_) {
      setWatchedDurationValue(0);
    }
  }, [playbackSessionKey, setWatchedDurationValue]);

  const fetchVideoInfoCallback = useCallback(async () => {
    setIsReady(false);

    const info = await fetchMediaInfo({
      plex,
      media,
      shuffle,
      maxVideoBitrate: play?.maxVideoBitrate,
      maxResolution: play?.maxResolution,
      session: plexClientSession
    });

    if (info) {
      // Detect if this is a collection/folder (no mediaUrl, no playable mediaType)
      const isPlayable = info.mediaUrl || ['dash_video', 'video', 'audio'].includes(info.mediaType);

      if (!isPlayable && plex) {
        // This is a collection - fetch first playable item
        try {
          const { items } = await DaylightAPI(`/api/v1/item/plex/${plex}/playable`);
          if (items && items.length > 0) {
            const firstItem = items[0];
            const firstItemPlex = firstItem.plex || firstItem.play?.plex || firstItem.metadata?.plex;
            if (firstItemPlex) {
              // Fetch media info for the first playable item
              const playableInfo = await fetchMediaInfo({
                plex: firstItemPlex,
                shuffle: false,
                maxVideoBitrate: play?.maxVideoBitrate,
                maxResolution: play?.maxResolution,
                session: plexClientSession
              });
              if (playableInfo) {
                const withCap = {
                  ...playableInfo,
                  continuous,
                  maxVideoBitrate: play?.maxVideoBitrate ?? null,
                  maxResolution: play?.maxResolution ?? null
                };
                if (play?.seconds !== undefined) withCap.seconds = play.seconds;
                if (play?.resume !== undefined) withCap.resume = play.resume;
                setMediaInfo(withCap);
                setIsReady(true);
                return;
              }
            }
          }
        } catch (err) {
          console.error('[SinglePlayer] Failed to expand collection:', err);
        }
      }

      const withCap = {
        ...info,
        continuous,
        maxVideoBitrate: play?.maxVideoBitrate ?? null,
        maxResolution: play?.maxResolution ?? null
      };

      // Override seconds if explicitly provided in play object
      if (play?.seconds !== undefined) {
        withCap.seconds = play.seconds;
      }

      // Override resume if explicitly provided in play object
      if (play?.resume !== undefined) {
        withCap.resume = play.resume;
      }

      setMediaInfo(withCap);
      setIsReady(true);
    } else if (!!open) {
      setGoToApp(open);
    }
  }, [plex, media, open, shuffle, continuous, play?.maxVideoBitrate, play?.maxResolution, play?.seconds, play?.resume, plexClientSession]);

  useEffect(() => {
    fetchVideoInfoCallback();
  }, [fetchVideoInfoCallback]);

  useEffect(() => {
    if (!isReady || !mediaInfo?.mediaType) {
      return;
    }
    onResolvedMeta?.(mediaInfo);
  }, [isReady, mediaInfo, onResolvedMeta]);

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;
  
  // Calculate plexId from available sources - plex prop is passed directly from Player
  const initialPlexId = plex || media || mediaInfo?.assetId || mediaInfo?.key || mediaInfo?.plex || null;

  // Create ref to hold registered accessors
  const mediaAccessorsRef = useRef({ getMediaEl: () => null, getContainerEl: () => null });

  const resilienceBridge = useMemo(() => ({
    onPlaybackMetrics,
    onRegisterMediaAccess,
    seekToIntentSeconds,
    onSeekRequestConsumed,
    remountDiagnostics,
    onStartupSignal,
    // New: accessor registration for children
    registerAccessors: ({ getMediaEl, getContainerEl }) => {
      mediaAccessorsRef.current = {
        getMediaEl: getMediaEl || (() => null),
        getContainerEl: getContainerEl || (() => null)
      };
    },
    // New: accessors that delegate to registered functions
    getMediaEl: () => mediaAccessorsRef.current.getMediaEl(),
    getContainerEl: () => mediaAccessorsRef.current.getContainerEl()
  }), [onPlaybackMetrics, onRegisterMediaAccess, seekToIntentSeconds, onSeekRequestConsumed, remountDiagnostics, onStartupSignal]);

  // Register the resilienceBridge with the parent Player component
  useEffect(() => {
    if (typeof onRegisterResilienceBridge === 'function') {
      onRegisterResilienceBridge(resilienceBridge);
    }
    return () => {
      if (typeof onRegisterResilienceBridge === 'function') {
        onRegisterResilienceBridge(null);
      }
    };
  }, [resilienceBridge, onRegisterResilienceBridge]);

  const playerBody = (
    <>
      {!isReady && !suppressLocalOverlay && (
        <div ref={loadingShaderRef} className={`shader on notReady ${shader}`}>
          <PlayerOverlayLoading
            shouldRender
            isVisible
            isPaused={false}
            seconds={0}
            stalled={false}
            waitingToPlay
            showPauseOverlay={false}
            showDebug={false}
            plexId={initialPlexId}
            debugContext={{ scope: 'media-info' }}
          />
        </div>
      )}
      {isReady && ['dash_video', 'video', 'audio'].includes(mediaInfo.mediaType) && (
        React.createElement(
          {
            audio: AudioPlayer,
            video: VideoPlayer,
            dash_video: VideoPlayer
          }[mediaInfo.mediaType],
          {
            media: mediaInfo,
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
            fetchVideoInfo: fetchVideoInfoCallback,
            ignoreKeys,
            onProgress: handleProgress,
            onMediaRef,
            keyboardOverrides: play?.keyboardOverrides,
            onController: play?.onController,
            resilienceBridge,
            maxVideoBitrate: mediaInfo?.maxVideoBitrate ?? play?.maxVideoBitrate ?? null,
            maxResolution: mediaInfo?.maxResolution ?? play?.maxResolution ?? null,
            watchedDurationProvider: getWatchedDuration,
            upscaleEffects
          }
        )
      )}
      {isReady && !['dash_video', 'video', 'audio'].includes(mediaInfo.mediaType) && (
        <pre>
          {JSON.stringify(mediaInfo, null, 2)}
        </pre>
      )}
    </>
  );

  if (!wrapWithContainer) {
    return playerBody;
  }

  return (
    <div ref={playerContainerRef} className={`player ${playerType || ''}`}>
      {playerBody}
    </div>
  );
}

SinglePlayer.propTypes = {
  plex: PropTypes.string,
  media: PropTypes.string,
  hymn: PropTypes.any,
  primary: PropTypes.any,
  scripture: PropTypes.any,
  talk: PropTypes.any,
  poem: PropTypes.any,
  rate: PropTypes.number,
  advance: PropTypes.func,
  open: PropTypes.string,
  clear: PropTypes.func,
  setShader: PropTypes.func,
  cycleThroughClasses: PropTypes.func,
  classes: PropTypes.arrayOf(PropTypes.string),
  playbackKeys: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.string),
    PropTypes.objectOf(PropTypes.arrayOf(PropTypes.string))
  ]),
  queuePosition: PropTypes.number,
  playerType: PropTypes.string,
  ignoreKeys: PropTypes.bool,
  shuffle: PropTypes.oneOfType([PropTypes.bool, PropTypes.number]),
  continuous: PropTypes.bool,
  shader: PropTypes.string,
  volume: PropTypes.number,
  playbackRate: PropTypes.number,
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  keyboardOverrides: PropTypes.objectOf(PropTypes.func),
  onController: PropTypes.func,
  wrapWithContainer: PropTypes.bool,
  onResolvedMeta: PropTypes.func,
  onPlaybackMetrics: PropTypes.func,
  onRegisterMediaAccess: PropTypes.func,
  onRegisterResilienceBridge: PropTypes.func,
  onStartupSignal: PropTypes.func,
  seekToIntentSeconds: PropTypes.number,
  onSeekRequestConsumed: PropTypes.func,
  remountDiagnostics: PropTypes.shape({
    reason: PropTypes.string,
    source: PropTypes.string,
    seekSeconds: PropTypes.number,
    remountNonce: PropTypes.number,
    waitKey: PropTypes.string,
    trigger: PropTypes.object,
    conditions: PropTypes.object,
    timestamp: PropTypes.number
  }),
  suppressLocalOverlay: PropTypes.bool,
  maxVideoBitrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  maxResolution: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  upscaleEffects: PropTypes.oneOf(['auto', 'blur-only', 'crt-only', 'aggressive', 'none'])
};
