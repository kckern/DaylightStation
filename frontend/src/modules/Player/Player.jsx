import React, { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import './Player.scss';
import { useQueueController } from './hooks/useQueueController.js';
import { CompositePlayer } from './components/CompositePlayer.jsx';
import { SinglePlayer } from './components/SinglePlayer.jsx';
import { PlayerOverlayLoading } from './components/PlayerOverlayLoading.jsx';
import { PlayerOverlayPaused } from './components/PlayerOverlayPaused.jsx';

/**
 * Main Player component
 * Handles both single media playback and queue/playlist management
 * Supports composite overlays (video with audio background)
 */
const Player = forwardRef(function Player(props, ref) {
  if (props.play?.overlay || props.queue?.overlay) {
    return <CompositePlayer {...props} Player={Player} />;
  }
  
  let {
    play,
    queue,
    clear,
    playbackrate,
    playbackKeys,
    playerType,
    ignoreKeys,
    keyboardOverrides,
    resilience,
    mediaResilienceConfig,
    onResilienceState,
    mediaResilienceRef
  } = props || {};
  
  // console.log('[Player] Received keyboardOverrides:', keyboardOverrides ? Object.keys(keyboardOverrides) : 'undefined');
  
  // Override playback rate if passed in via menu selection
  if (playbackrate && play) play['playbackRate'] = playbackrate;
  // Convert lowercase to camelCase
  if (play?.playbackrate && !play?.playbackRate) play['playbackRate'] = play.playbackrate;

  const {
    classes,
    cycleThroughClasses,
    shader: queueShader,
    setShader,
    isQueue,
    volume: queueVolume,
    queuePosition,
    playbackRate: queuePlaybackRate,
    playQueue,
    advance
  } = useQueueController({ play, queue, clear });

  const singlePlayerProps = (() => {
    if (isQueue && playQueue?.length > 0) {
      return { key: playQueue[0].guid, ...playQueue[0] };
    }
    if (play && !Array.isArray(play)) {
      return { ...play };
    }
    return null;
  })();

  // Get playback rate from the current item, falling back to queue/play level, then default
  const currentItemPlaybackRate = singlePlayerProps?.playbackRate || singlePlayerProps?.playbackrate;
  const effectivePlaybackRate = currentItemPlaybackRate || queuePlaybackRate;

  // Get volume from the current item, falling back to queue/play level, then default
  const currentItemVolume = singlePlayerProps?.volume;
  const effectiveVolume = currentItemVolume !== undefined ? currentItemVolume : queueVolume;

  // Get shader from the current item, falling back to queue/play level, then default
  const currentItemShader = singlePlayerProps?.shader;
  const effectiveShader = currentItemShader || queueShader;

  // Create appropriate advance function for single continuous items
  const singleAdvance = useCallback(() => {
    if (singlePlayerProps?.continuous) {
      // For continuous single items, check if native loop is already handling it
      const mediaEl = document.querySelector(`[data-key="${singlePlayerProps.media_key || singlePlayerProps.plex}"]`);
      if (mediaEl && !mediaEl.loop) {
        // If not using native loop, manually restart
        mediaEl.currentTime = 0;
        mediaEl.play();
      }
      // If using native loop (mediaEl.loop = true), the browser handles it automatically
    } else {
      clear();
    }
  }, [singlePlayerProps?.continuous, singlePlayerProps?.media_key, singlePlayerProps?.plex, clear]);

  const exposedMediaRef = useRef(null);
  const controllerRef = useRef(null);
  const fallbackResilienceRef = useRef(null);

  // Compose onMediaRef so we keep existing external callback semantics
  const handleMediaRef = useCallback((el) => {
    exposedMediaRef.current = el;
    if (props.onMediaRef) props.onMediaRef(el);
  }, [props.onMediaRef]);

  const handleController = useCallback((controller) => {
    controllerRef.current = controller;
    if (props.onController) props.onController(controller);
  }, [props.onController]);

  const withTransport = useCallback((handler, fallback) => {
    const controller = controllerRef.current;
    if (!controller) {
      return typeof fallback === 'function' ? fallback() : null;
    }
    const api = controller.transport || controller;
    if (!api) {
      return typeof fallback === 'function' ? fallback() : null;
    }
    try {
      return handler(api);
    } catch (_) {
      return null;
    }
  }, []);

  const baseResilience = {
    config: resilience?.config ?? mediaResilienceConfig,
    onStateChange: resilience?.onStateChange ?? onResilienceState,
    controllerRef: resilience?.controllerRef ?? mediaResilienceRef
  };

  const sanitizedSinglePlayerProps = singlePlayerProps ? { ...singlePlayerProps } : null;

  const legacyItemResilience = sanitizedSinglePlayerProps
    ? {
        config: sanitizedSinglePlayerProps.mediaResilienceConfig,
        onStateChange: sanitizedSinglePlayerProps.onResilienceState,
        controllerRef: sanitizedSinglePlayerProps.mediaResilienceRef
      }
    : {};

  const itemResilience = sanitizedSinglePlayerProps?.resilience || legacyItemResilience;

  const resolvedResilience = {
    config: itemResilience?.config ?? baseResilience.config,
    onStateChange: itemResilience?.onStateChange ?? baseResilience.onStateChange,
    controllerRef: itemResilience?.controllerRef ?? baseResilience.controllerRef
  };

  const resilienceControllerRef = resolvedResilience.controllerRef || fallbackResilienceRef;
  resolvedResilience.controllerRef = resilienceControllerRef;

  if (sanitizedSinglePlayerProps) {
    delete sanitizedSinglePlayerProps.key;
    delete sanitizedSinglePlayerProps.resilience;
    delete sanitizedSinglePlayerProps.mediaResilienceConfig;
    delete sanitizedSinglePlayerProps.onResilienceState;
    delete sanitizedSinglePlayerProps.mediaResilienceRef;
  }

  const isValidImperativeRef = typeof ref === 'function' || (ref && typeof ref === 'object' && 'current' in ref);
  useImperativeHandle(isValidImperativeRef ? ref : null, () => ({
    seek: (t) => {
      if (!Number.isFinite(t)) return;
      withTransport((api) => api.seek?.(t));
    },
    play: () => { withTransport((api) => api.play?.()); },
    pause: () => { withTransport((api) => api.pause?.()); },
    toggle: () => { withTransport((api) => api.toggle?.()); },
    getCurrentTime: () => withTransport((api) => api.getCurrentTime?.()) || 0,
    getDuration: () => withTransport((api) => api.getDuration?.()) || 0,
    getMediaElement: () => controllerRef.current?.transport?.getMediaEl?.() || exposedMediaRef.current,
    getMediaController: () => controllerRef.current,
    getMediaResilienceController: () => resilienceControllerRef.current,
    getMediaResilienceState: () => resilienceControllerRef.current?.getState?.() || null,
    resetMediaResilience: () => resilienceControllerRef.current?.reset?.(),
    forceMediaReload: (opts) => resilienceControllerRef.current?.forceReload?.(opts),
    forceMediaInfoFetch: (opts) => resilienceControllerRef.current?.forceFetchInfo?.(opts),
    getPlaybackState: () => controllerRef.current?.getPlaybackState?.() || controllerRef.current?.transport?.getPlaybackState?.() || null
  }), []);

  const playerProps = {
    advance: isQueue ? advance : singleAdvance,
    clear,
    shader: effectiveShader,
    volume: effectiveVolume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackRate: effectivePlaybackRate,
    playbackKeys,
    playerType,
    queuePosition,
    ignoreKeys,
    keyboardOverrides,
    onProgress: props.onProgress,
    onMediaRef: handleMediaRef,
    onController: handleController,
    resilience: resolvedResilience
  };

  // Extract plexId for health checks (from queue or play object)
  const plexId = queue?.plex || play?.plex || singlePlayerProps?.plex || singlePlayerProps?.media_key || null;

  return sanitizedSinglePlayerProps ? (
    <SinglePlayer
      {...sanitizedSinglePlayerProps}
      {...playerProps}
    />
  ) : (
    <div className={`player ${effectiveShader} ${props.playerType || ''}`}>
      <>
        <PlayerOverlayLoading
        shouldRender
        isVisible
        isPaused={false}
        seconds={0}
        stalled={false}
        waitingToPlay
        showPauseOverlay={false}
        showDebug={false}
        togglePauseOverlay={() => {}}
        plexId={plexId}
        debugContext={{ scope: 'idle' }}
        />
        <PlayerOverlayPaused
          shouldRender
          isVisible
          pauseOverlayActive
          seconds={0}
          stalled={false}
          waitingToPlay
          togglePauseOverlay={() => {}}
        />
      </>
    </div>
  );
});

Player.propTypes = {
  play: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  queue: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  clear: PropTypes.func,
  playbackrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  playbackKeys: PropTypes.arrayOf(PropTypes.string),
  playerType: PropTypes.string,
  ignoreKeys: PropTypes.bool,
  keyboardOverrides: PropTypes.object,
  resilience: PropTypes.shape({
    config: PropTypes.object,
    onStateChange: PropTypes.func,
    controllerRef: PropTypes.shape({ current: PropTypes.any })
  }),
  mediaResilienceConfig: PropTypes.object,
  onResilienceState: PropTypes.func,
  mediaResilienceRef: PropTypes.shape({ current: PropTypes.any }),
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  onController: PropTypes.func
};

export default Player;

// Export components for external use
export { PlayerOverlayLoading } from './components/PlayerOverlayLoading.jsx';
export { PlayerOverlayPaused } from './components/PlayerOverlayPaused.jsx';
export { SinglePlayer } from './components/SinglePlayer.jsx';
export { AudioPlayer } from './components/AudioPlayer.jsx';
export { VideoPlayer } from './components/VideoPlayer.jsx';
