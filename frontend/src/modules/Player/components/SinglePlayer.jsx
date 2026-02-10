import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import { SingalongScroller } from '../../ContentScroller/SingalongScroller.jsx';
import { ReadalongScroller } from '../../ContentScroller/ReadalongScroller.jsx';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import PlayableAppShell from './PlayableAppShell.jsx';
import PagedReader from './PagedReader.jsx';
import FlowReader from './FlowReader.jsx';
import { fetchMediaInfo } from '../lib/api.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { AudioPlayer } from './AudioPlayer.jsx';
import { VideoPlayer } from './VideoPlayer.jsx';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';
import { useShaderDiagnostics } from '../hooks/useShaderDiagnostics.js';

/** Formats that render via the video/audio player (not scrollers or apps). */
const MEDIA_PLAYBACK_FORMATS = ['video', 'dash_video', 'audio'];

/** Format → component registry: declarative mapping from API format to renderer. */
const CONTENT_FORMAT_COMPONENTS = {
  singalong: SingalongScroller,
  readalong: ReadalongScroller,
  app: PlayableAppShell,
  readable_paged: PagedReader,
  readable_flow: FlowReader,
};

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
    contentId: contentIdProp,
    plex,
    media,
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

  // Compute effective contentId. Prefers the canonical contentId prop;
  // falls back to legacy plex/media props for backward compatibility.
  const effectiveContentId = contentIdProp
    || (plex ? `plex:${plex}` : null)
    || media
    || null;

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

  // Shader diagnostics for loading state
  const loadingShaderRef = useRef(null);
  const playerContainerRef = useRef(null);

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);
  const watchedDurationRef = useRef(0);
  const playbackTimerRef = useRef({ lastTickTs: null });

  // Shader is only used for media playback formats (video/audio).
  // Non-media formats (scrollers, apps, etc.) handle their own chrome.
  const isMediaPlayback = isReady && MEDIA_PLAYBACK_FORMATS.includes(mediaInfo?.format);
  useShaderDiagnostics({
    shaderRef: loadingShaderRef,
    containerRef: playerContainerRef,
    label: 'loading-shader',
    shaderState: 'on',
    enabled: (!isReady || isMediaPlayback) && !suppressLocalOverlay
  });

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
      mediaInfo?.contentId,
      mediaInfo?.assetId,
      mediaInfo?.key,
      mediaInfo?.plex,
      mediaInfo?.id,
      mediaInfo?.mediaUrl,
      effectiveContentId,
      plex,
      mediaKeyProp,
      media
    ];
    const firstDefined = candidates.find((value) => value != null && String(value).length);
    return firstDefined != null ? String(firstDefined) : null;
  }, [mediaInfo?.contentId, mediaInfo?.assetId, mediaInfo?.key, mediaInfo?.plex, mediaInfo?.id, mediaInfo?.mediaUrl, effectiveContentId, plex, mediaKeyProp, media]);

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

    // Direct-play bypass: if the play prop already contains mediaUrl and format,
    // skip the /play API call entirely. This happens when queue items come from
    // the /queue endpoint with pre-resolved media URLs.
    const directFormat = play?.format;
    const directMediaUrl = play?.mediaUrl;
    if (directMediaUrl && directFormat) {
      const directInfo = {
        ...play,
        id: play.id || play.contentId || effectiveContentId,
        assetId: play.assetId || play.id || play.contentId || effectiveContentId,
        continuous,
        maxVideoBitrate: play?.maxVideoBitrate ?? null,
        maxResolution: play?.maxResolution ?? null,
      };
      if (play?.seconds !== undefined) directInfo.seconds = play.seconds;
      if (play?.resume !== undefined) directInfo.resume = play.resume;
      if (play?.resumePosition !== undefined && directInfo.seconds === undefined) {
        directInfo.seconds = play.resumePosition;
      }
      setMediaInfo(directInfo);
      setIsReady(true);
      return;
    }

    const info = await fetchMediaInfo({
      contentId: effectiveContentId,
      plex,
      media,
      shuffle,
      maxVideoBitrate: play?.maxVideoBitrate,
      maxResolution: play?.maxResolution,
      session: plexClientSession
    });

    if (info) {
      // Detect if this is a collection/folder (format: "list", or no mediaUrl/playable mediaType)
      const isPlayable = info.format !== 'list'
        && (info.mediaUrl || ['dash_video', 'video', 'audio'].includes(info.mediaType)
            || CONTENT_FORMAT_COMPONENTS[info.format]);

      if (!isPlayable && effectiveContentId) {
        // This is a collection - fetch first playable item
        try {
          const { items } = await DaylightAPI(`/api/v1/queue/${effectiveContentId}?limit=1`);
          if (items && items.length > 0) {
            const firstItem = items[0];
            const firstItemId = firstItem.contentId || firstItem.id;
            if (firstItemId) {
              // Fetch media info for the first playable item
              const resolvedId = String(firstItemId).includes(':') ? firstItemId : `plex:${firstItemId}`;
              const playableInfo = await fetchMediaInfo({
                contentId: resolvedId,
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
  }, [effectiveContentId, plex, media, open, shuffle, continuous, play?.maxVideoBitrate, play?.maxResolution, play?.seconds, play?.resume, plexClientSession]);

  useEffect(() => {
    fetchVideoInfoCallback();
  }, [fetchVideoInfoCallback]);

  useEffect(() => {
    if (!isReady || (!mediaInfo?.mediaType && !mediaInfo?.format)) {
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

  // Format-based dispatch: the API's `format` field drives which component renders.
  function renderByFormat() {
    if (!isReady) return null;

    const format = mediaInfo?.format;

    // Media playback formats → video/audio player
    if (MEDIA_PLAYBACK_FORMATS.includes(format)) {
      const PlayerComponent = format === 'audio' ? AudioPlayer : VideoPlayer;
      return (
        <PlayerComponent
          media={mediaInfo}
          advance={advance}
          clear={clear}
          shader={shader}
          volume={volume}
          playbackRate={playbackRate}
          setShader={setShader}
          cycleThroughClasses={cycleThroughClasses}
          classes={classes}
          playbackKeys={playbackKeys}
          queuePosition={queuePosition}
          fetchVideoInfo={fetchVideoInfoCallback}
          ignoreKeys={ignoreKeys}
          onProgress={handleProgress}
          onMediaRef={onMediaRef}
          keyboardOverrides={play?.keyboardOverrides}
          onController={play?.onController}
          resilienceBridge={resilienceBridge}
          maxVideoBitrate={mediaInfo?.maxVideoBitrate ?? play?.maxVideoBitrate ?? null}
          maxResolution={mediaInfo?.maxResolution ?? play?.maxResolution ?? null}
          watchedDurationProvider={getWatchedDuration}
          upscaleEffects={upscaleEffects}
        />
      );
    }

    // Content format → registered component (scrollers, readers, etc.)
    const ContentComponent = CONTENT_FORMAT_COMPONENTS[format];
    if (ContentComponent) {
      return <ContentComponent contentId={mediaInfo.id || effectiveContentId} initialData={mediaInfo} {...contentProps} {...contentScrollerBridge} />;
    }

    // Unknown format: render debug info
    return (
      <pre>
        {JSON.stringify(mediaInfo, null, 2)}
      </pre>
    );
  }

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
      {renderByFormat()}
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
  contentId: PropTypes.string,
  plex: PropTypes.string,
  media: PropTypes.string,
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
