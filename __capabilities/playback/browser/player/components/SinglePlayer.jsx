import { createContentTimeline } from '../lib/recovery/contentTimeline.js';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import AppContainer from '../../../../../frontend/src/modules/AppContainer/AppContainer.jsx';
import { getRenderer, isMediaFormat } from '../lib/registry.js';
import { fetchMediaInfo } from '../lib/api.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { browserPreference } from '../../../../../frontend/src/lib/browserPreference.js';
import { useRefreshableRead } from '../../../../../frontend/src/lib/hooks/useRefreshableRead.js';
import { AudioPlayer } from '../renderers/AudioPlayer.jsx';
import { VideoPlayer } from '../renderers/VideoPlayer.jsx';
import { ImageFrame } from '../renderers/ImageFrame.jsx';
import { TitleCardRenderer } from '../renderers/TitleCardRenderer.jsx';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';
import { SlideshowMetadataOverlay } from './SlideshowMetadataOverlay.jsx';
import { useShaderDiagnostics } from '../hooks/useShaderDiagnostics.js';
import { useIntroHost } from '../hooks/useIntroHost.js';
import { useVideoIntro } from '../../presentation.mjs';
import { REVIEW_GOTO } from '../../player-support/reviewParams.js';

/** useVideoIntro arguments that ask for no intro. */
const NO_INTRO_ARGS = Object.freeze({ media: null, isPlex: false });
const PLEX_ID = /^plex:\d+$/;

/**
 * Single player component that handles different media types
 * Routes to appropriate player based on media type
 */
export function SinglePlayer(props = {}) {
  const {
    onResolvedMeta,
    onPlaybackMetrics,
    onDeliveryObservation,
    onRegisterMediaAccess,
    onRegisterResilienceBridge,
    onRequestRecovery,
    onTerminalCandidate,
    recoveryHeld = false,
    seekToIntentSeconds = null,
    onSeekRequestConsumed,
    remountDiagnostics,
    // Player's itemSessionKey — the recoveryLedger session scope. Distinct from
    // the local playbackSessionKey below (watchedDuration storage key).
    resilienceSessionKey = null,
    recoveryIdentity = null,
    wrapWithContainer = true,
    suppressLocalOverlay = false,
    plexClientSession = null,
    // Opt-in track choice (RQ-STEER-14): the Player passes a resolver that
    // returns the item unchanged unless its owner remembered a choice.
    resolveTracks = null,
    ...play
  } = props;
  const resolveTracksRef = useRef(resolveTracks);
  resolveTracksRef.current = resolveTracks;
  const withTracks = (info) => {
    // The owner-authored clip survives a fresh transport descriptor, which
    // describes the full item when restarting the same content.
    const resolvedInfo = play?.segment ? { ...info, segment: play.segment } : info;
    const descriptor = resolvedInfo.contentTimeline;
    const isVideo = ['video', 'hls_video', 'dash_video'].includes(info.format)
      || ['video', 'hls_video', 'dash_video'].includes(info.mediaType);
    const normalized = isVideo ? { ...resolvedInfo, contentTimeline: createContentTimeline({
      catalogDurationSeconds: descriptor ? descriptor.expectedEndSeconds : info.duration,
      rendererStartSeconds: descriptor?.rendererStartSeconds,
      contentStartSeconds: descriptor?.contentStartSeconds,
      clipStartSeconds: resolvedInfo.segment?.start ?? descriptor?.clipStartSeconds,
      clipEndSeconds: resolvedInfo.segment?.end ?? descriptor?.clipEndSeconds,
    }) } : resolvedInfo;
    return typeof resolveTracksRef.current === 'function' ? resolveTracksRef.current(normalized) ?? normalized : normalized;
  };
  const {
    contentId: contentIdProp,
    plex,
    media,
    advance,
    manualAdvance = advance,
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
    upscaleEffects,
    nextMedia
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

  // Shader diagnostics for loading state
  const loadingShaderRef = useRef(null);
  const playerContainerRef = useRef(null);

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);
  const [videoMetaVisible, setVideoMetaVisible] = useState(false);
  const videoMetaTimerRef = useRef(null);
  const watchedDurationRef = useRef(0);
  const playbackTimerRef = useRef({ lastTickTs: null });

  // Shader is only used for media playback formats (video/audio).
  // Non-media formats (scrollers, apps, etc.) handle their own chrome.
  const isMediaPlayback = isReady && isMediaFormat(mediaInfo?.format);
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

  const watchedDurationPreference = useMemo(() => {
    if (!playbackSessionKey || typeof window === 'undefined') return null;
    return browserPreference(`watchedDuration:${playbackSessionKey}`, 0, raw => {
      const parsed = JSON.parse(raw);
      const value = typeof parsed === 'number' ? parsed : parsed?.value;
      return Number.isFinite(value) && value >= 0 ? value : 0;
    });
  }, [playbackSessionKey]);

  const handleProgress = useCallback((payload = {}) => {
    const watchedDuration = accumulateWatchedDuration(payload);
    if (watchedDurationPreference) {
      const percentValue = Number(payload?.percent);
      if (Number.isFinite(percentValue) && percentValue >= 99) {
        watchedDurationPreference.clear();
      } else {
        watchedDurationPreference.write(JSON.stringify({ value: watchedDuration, updatedAt: Date.now() }));
      }
    }
    // Forward playback metrics to Player.jsx for resilience tracking
    // This bridges useCommonMediaController's stall state to useMediaResilience
    if (typeof onPlaybackMetrics === 'function') {
      onPlaybackMetrics({
        seconds: Object.prototype.hasOwnProperty.call(payload, 'contentSeconds') ? payload.contentSeconds : payload?.currentTime,
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
  }, [accumulateWatchedDuration, onPlaybackMetrics, onProgress, watchedDurationPreference]);

  const contentScrollerBridge = {
    onResolvedMeta,
    onPlaybackMetrics,
    onRegisterMediaAccess,
    seekToIntentSeconds,
    onSeekRequestConsumed,
    remountDiagnostics,
    // Content formats (scrollers) otherwise never reach the onProgress
    // consumer — only AudioPlayer/VideoPlayer were wired to handleProgress,
    // so a shell like ReadalongPlaylistPlayer saw position/duration stuck at
    // zero for readalong content.
    onProgress: handleProgress
  };

  useEffect(() => {
    setWatchedDurationValue(watchedDurationPreference?.read() ?? 0);
  }, [watchedDurationPreference, setWatchedDurationValue]);

  const readVideoInfo = useCallback(async (isCurrent, signal) => {
    setIsReady(false);

    // Direct-play bypass: if the play prop already contains mediaUrl and a media format,
    // skip the /play API call entirely. This happens when queue items come from
    // the /queue endpoint with pre-resolved media URLs.
    // Content formats (readalong, singalong, etc.) need the /play API for full content data.
    const directFormat = play?.format;
    const directMediaUrl = play?.mediaUrl;
    const isRecoveryRemount = !!remountDiagnostics;
    // Title cards are self-contained (no mediaUrl needed). Queue images are also
    // authoritative, resolved descriptors: re-fetching an Immich image through
    // `/play` downgrades it to a browse item and drops both its display URL and
    // queue-owned slideshow policy.
    const isResolvedImmichMedia = Boolean(directMediaUrl)
      && String(effectiveContentId || '').startsWith('immich:')
      && (directFormat === 'image' || isMediaFormat(directFormat));
    const isSelfContainedFormat = directFormat === 'titlecard'
      || (directFormat === 'image' && Boolean(directMediaUrl))
      || isResolvedImmichMedia;
    // A queue item may carry an opaque transport URL plus a stale format. When
    // it has a canonical content id, `/play` is the transport authority (and
    // may correctly describe that same opaque Plex stream as HLS). Reserve the
    // direct-media bypass for identity-less embeds, which have no descriptor to
    // resolve; otherwise a stale queue `dash_video` makes dash.js parse HLS.
    const hasResolvableContent = Boolean(effectiveContentId);
    // Some queue items own playback shape `/play` cannot reproduce: a photo's
    // preview URL + slideshow config (`/play` returns an image with no mediaUrl
    // at all), and a clip's segment window. Neither is an opaque stream with a
    // stale format, so the queue item stays authoritative for them.
    const queueOwnsPlayback = directFormat === 'image' || play?.segment != null;
    if (isSelfContainedFormat || ((directMediaUrl && directFormat && !getRenderer(directFormat)
      && (!hasResolvableContent || queueOwnsPlayback)) && !isRecoveryRemount)) {
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
      if (play?.origin) directInfo.origin = play.origin;
      if (play?.resumePosition !== undefined && directInfo.seconds === undefined) {
        directInfo.seconds = play.resumePosition;
      }
      // A queue-owned clip plays the item's own mediaUrl as given: no `/play`
      // mint, so no resume offset was baked into the stream, and its window is
      // authored in that file's own clock. Without origins the clip's end can
      // never be mapped (it would play to the recording's end and stall as
      // `timeline-unverified`), so a native-video clip that arrives without
      // them starts both clocks at zero. Origins the queue item does carry win.
      const isVideoClip = play?.segment != null
        && ['video', 'hls_video', 'dash_video'].includes(directInfo.format ?? directInfo.mediaType);
      const timeline = directInfo.contentTimeline;
      if (isVideoClip && timeline?.rendererStartSeconds == null && timeline?.contentStartSeconds == null) {
        directInfo.contentTimeline = { ...(timeline ?? {}), rendererStartSeconds: 0, contentStartSeconds: 0 };
      }
      setMediaInfo(withTracks(directInfo));
      setIsReady(true);
      return;
    }

    let info;
    try {
      info = await fetchMediaInfo({
        contentId: effectiveContentId,
        plex,
        media,
        shuffle,
        maxVideoBitrate: play?.maxVideoBitrate,
        maxResolution: play?.maxResolution,
        transcode: play?.transcode,
        adaptive: play?.adaptive,
        session: plexClientSession,
        // An explicit start (`seconds` on the request, or ?goto / ?start)
        // overrides the server's resume, so the server must not apply it
        // either: a Plex stream minted at the saved offset would be sought
        // away from at once (a rebuffer).
        resume: play?.resume ?? ((play?.seconds != null || REVIEW_GOTO != null) ? false : undefined),
        signal,
      });
    } catch (error) {
      if (isCurrent()) throw error;
      return;
    }
    if (!isCurrent()) return;

    if (info) {
      // Detect if this is a collection/folder (format: "list", or no mediaUrl/playable mediaType)
      const isPlayable = info.format !== 'list'
        && (info.mediaUrl || ['dash_video', 'video', 'audio'].includes(info.mediaType)
            || getRenderer(info.format));

      if (!isPlayable && effectiveContentId) {
        // This is a collection - fetch first playable item
        try {
          const { items } = await DaylightAPI(`/api/v1/queue/${effectiveContentId}?limit=1`, {}, 'GET', { signal });
          if (!isCurrent()) return;
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
                transcode: play?.transcode,
                adaptive: play?.adaptive,
                session: plexClientSession,
                signal,
              });
              if (!isCurrent()) return;
              if (playableInfo) info = playableInfo;
            }
          }
        } catch (error) {
          if (!isCurrent()) return;
          playbackLog('collection-expansion-failed', { contentId: effectiveContentId, error: error?.message }, { level: 'error' });
        }
      }

      const withCap = {
        ...info,
        continuous,
        maxVideoBitrate: play?.maxVideoBitrate ?? null,
        maxResolution: play?.maxResolution ?? null
      };

      // A clip keeps its own identity. `/play` describes the recording it was
      // cut from (`plex:<id>`, not `plex:<id>#<n>`); keeping that id would log
      // the clip's heartbeats as the concert's own progress, open a media
      // server session for the whole recording, and could mark it watched.
      if (play?.segment != null) {
        withCap.id = play.id ?? play.contentId ?? withCap.id;
        withCap.assetId = play.assetId ?? withCap.id;
      }

      // Override seconds if explicitly provided in play object
      if (play?.seconds !== undefined) {
        withCap.seconds = play.seconds;
      }

      // Override resume if explicitly provided in play object
      if (play?.resume !== undefined) {
        withCap.resume = play.resume;
      }

      // Who started this playback (a routine, another device), for the
      // play ledger — reported on play/log (media tech doc §2.4).
      if (play?.origin) withCap.origin = play.origin;

      setMediaInfo(withTracks(withCap));
      setIsReady(true);
    } else if (open) {
      setGoToApp(open);
    }
  // `play` itself is deliberately excluded: it is commonly passed as a fresh
  // object literal from parents, and depending on it directly reproduces a
  // documented incident (2026-08-16) where object-identity churn on `play`
  // caused runaway remounts and 495 Plex transcode sessions in four minutes.
  // Keep this scoped to the stable lookup inputs. The direct-media bypass and
  // presentation metadata also read values from the committed play snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveContentId, plex, media, open, shuffle, continuous, play?.maxVideoBitrate, play?.maxResolution, play?.transcode, play?.adaptive, play?.seconds, play?.resume, plexClientSession, remountDiagnostics]);

  const { reload: fetchVideoInfo } = useRefreshableRead(readVideoInfo);
  useEffect(() => {
    // The descriptor transport logs genuine request failures. The initial read
    // has no caller awaiting its rejection.
    void fetchVideoInfo().catch(() => {});
  }, [fetchVideoInfo]);

  useEffect(() => {
    if (!isReady || (!mediaInfo?.mediaType && !mediaInfo?.format)) {
      return;
    }
    onResolvedMeta?.(mediaInfo);
  }, [isReady, mediaInfo, onResolvedMeta]);

  // Video metadata overlay: show shortly after video starts, hide after a few seconds
  const showVideoMeta = isReady && mediaInfo?.slideshow?.showMetadata
    && mediaInfo?.format !== 'image' && isMediaFormat(mediaInfo?.format);
  useEffect(() => {
    if (videoMetaTimerRef.current) {
      clearTimeout(videoMetaTimerRef.current);
      videoMetaTimerRef.current = null;
    }
    if (!showVideoMeta) {
      setVideoMetaVisible(false);
      return;
    }
    // Fade in after 500ms, fade out after 4s
    videoMetaTimerRef.current = setTimeout(() => {
      setVideoMetaVisible(true);
      videoMetaTimerRef.current = setTimeout(() => {
        setVideoMetaVisible(false);
      }, 4000);
    }, 500);
    return () => {
      if (videoMetaTimerRef.current) clearTimeout(videoMetaTimerRef.current);
    };
  }, [showVideoMeta, mediaInfo?.id, mediaInfo?.mediaUrl]);

  // The installed intro (e.g. Media's provenance scene) is owned here from the
  // play request, so the scene, not a spinner, covers the play-info fetch.
  // VideoPlayer's gate times it once it mounts (hooks/useIntroHost.js).
  const readyFormat = isReady ? mediaInfo?.format : null;
  const introForVideo = !isReady
    || (isMediaFormat(readyFormat) && readyFormat !== 'audio' && readyFormat !== 'image');
  const introContentId = isReady
    ? (mediaInfo?.assetId || mediaInfo?.key || mediaInfo?.plex || null)
    : effectiveContentId;
  const introEligible = introForVideo && PLEX_ID.test(String(introContentId || ''));
  const intro = useVideoIntro(introEligible ? { media: { assetId: introContentId }, isPlex: true } : NO_INTRO_ARGS);
  // A start the request already fixes; otherwise the intro's own read of where
  // a play of the title would start (null: unknown, so no early cover).
  const explicitStartSec = REVIEW_GOTO != null ? REVIEW_GOTO
    : play?.segment ? play.segment.start
    : play?.seconds != null ? play.seconds
    : play?.resume === false ? 0
    : null;
  const { stage: introStage, introHost } = useIntroHost({
    intro,
    knownStartSec: explicitStartSec != null ? Number(explicitStartSec) : (intro?.startSec ?? null),
    recovery: remountDiagnostics != null,
    resetKey: introContentId,
  });
  const introLayer = intro && (introStage === 'covering' || introStage === 'holding' || introStage === 'playing')
    // Its own layer, below the loading/recovery layer (Player.scss): recovery UI paints over the scene.
    ? <div className="player-intro-layer">{intro.render(introStage)}</div>
    : null;

  // Calculate plexId from available sources - plex prop is passed directly from Player
  const initialPlexId = plex || media || mediaInfo?.assetId || mediaInfo?.key || mediaInfo?.plex || null;

  // Create ref to hold registered accessors
  const mediaAccessorsRef = useRef({ getMediaEl: () => null, getContainerEl: () => null });

  const resilienceBridge = useMemo(() => ({
    onPlaybackMetrics,
    onDeliveryObservation,
    onRegisterMediaAccess,
    onTerminalCandidate,
    held: recoveryHeld,
    seekToIntentSeconds,
    onSeekRequestConsumed,
    remountDiagnostics,
    requestRecovery: typeof onRequestRecovery === 'function' ? onRequestRecovery : null,
    // Ledger session scope for renderer-level recovery actors (dash-error).
    playbackSessionKey: resilienceSessionKey,
    recoveryIdentity,
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
  }), [onPlaybackMetrics, onDeliveryObservation, onRegisterMediaAccess, seekToIntentSeconds, onSeekRequestConsumed, remountDiagnostics, onRequestRecovery, onTerminalCandidate, recoveryHeld, resilienceSessionKey, recoveryIdentity]);

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

    // Title card → rendered like a media item (needs media/advance/resilienceBridge)
    if (format === 'titlecard') {
      return (
        <TitleCardRenderer
          media={mediaInfo}
          advance={advance}
          resilienceBridge={resilienceBridge}
        />
      );
    }

    // Media playback formats → video/audio player
    if (isMediaFormat(format)) {
      if (format === 'image') {
        return (
          <ImageFrame
            media={mediaInfo}
            advance={advance}
            manualAdvance={manualAdvance}
            clear={clear}
            shader={shader}
            resilienceBridge={resilienceBridge}
            ignoreKeys={ignoreKeys}
            nextMedia={nextMedia}
          />
        );
      }
      const PlayerComponent = format === 'audio' ? AudioPlayer : VideoPlayer;
      const videoEl = (
        <PlayerComponent
          media={mediaInfo}
          advance={advance}
          manualAdvance={manualAdvance}
          clear={clear}
          shader={shader}
          volume={volume}
          playbackRate={playbackRate}
          setShader={setShader}
          cycleThroughClasses={cycleThroughClasses}
          classes={classes}
          playbackKeys={playbackKeys}
          queuePosition={queuePosition}
          fetchVideoInfo={fetchVideoInfo}
          ignoreKeys={ignoreKeys}
          onProgress={handleProgress}
          onMediaRef={onMediaRef}
          keyboardOverrides={play?.keyboardOverrides}
          onController={play?.onController}
          onDeliveryObservation={onDeliveryObservation}
          resilienceBridge={resilienceBridge}
          maxVideoBitrate={mediaInfo?.maxVideoBitrate ?? play?.maxVideoBitrate ?? null}
          maxResolution={mediaInfo?.maxResolution ?? play?.maxResolution ?? null}
          watchedDurationProvider={getWatchedDuration}
          upscaleEffects={upscaleEffects}
          {...(PlayerComponent === VideoPlayer ? { introHost } : {})}
        />
      );
      if (!showVideoMeta) return videoEl;
      const videoMediaId = mediaInfo?.id || mediaInfo?.assetId || effectiveContentId;
      return (
        <>
          {videoEl}
          <SlideshowMetadataOverlay
            mediaId={videoMediaId}
            visible={videoMetaVisible}
            preloaded={{
              capturedAt: mediaInfo?.metadata?.capturedAt || null,
              localDateTime: mediaInfo?.metadata?.localDateTime || null,
              people: mediaInfo?.metadata?.people || null,
              location: mediaInfo?.metadata?.location || null,
              captureTimeZone: (
                mediaInfo?.metadata?.captureTimeZone
                && mediaInfo.metadata.captureTimeZone !== 'UTC'
                  ? mediaInfo.metadata.captureTimeZone
                  : null
              ) || mediaInfo?.slideshow?.captureTimeZone
                || mediaInfo?.metadata?.captureTimeZone || null,
            }}
          />
        </>
      );
    }

    // Content format → registered component (scrollers, readers, etc.)
    const ContentComponent = getRenderer(format);
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

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;

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
      {introLayer}
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
  manualAdvance: PropTypes.func,
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
  onDeliveryObservation: PropTypes.func,
  onRegisterMediaAccess: PropTypes.func,
  onRegisterResilienceBridge: PropTypes.func,
  seekToIntentSeconds: PropTypes.number,
  onSeekRequestConsumed: PropTypes.func,
  resilienceSessionKey: PropTypes.string,
  remountDiagnostics: PropTypes.shape({
    reason: PropTypes.string,
    source: PropTypes.string,
    seekSeconds: PropTypes.number,
    remountNonce: PropTypes.number,
    waitKey: PropTypes.string,
    trigger: PropTypes.object,
    conditions: PropTypes.object,
    timestamp: PropTypes.number,
    wasPaused: PropTypes.bool
  }),
  suppressLocalOverlay: PropTypes.bool,
  maxVideoBitrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  maxResolution: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  upscaleEffects: PropTypes.oneOf(['auto', 'blur-only', 'crt-only', 'aggressive', 'none']),
  onRequestRecovery: PropTypes.func
};
