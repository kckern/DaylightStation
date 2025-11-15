import React, { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import './Player.scss';
import { useQueueController } from './hooks/useQueueController.js';
import { CompositePlayer } from './components/CompositePlayer.jsx';
import { SinglePlayer } from './components/SinglePlayer.jsx';
import { LoadingOverlay } from './components/LoadingOverlay.jsx';

/**
 * Main Player component
 * Handles both single media playback and queue/playlist management
 * Supports composite overlays (video with audio background)
 */
const Player = forwardRef(function Player(props, ref) {
  if (props.play?.overlay || props.queue?.overlay) {
    return <CompositePlayer {...props} Player={Player} />;
  }
  
  let { play, queue, clear, playbackrate, playbackKeys, playerType, ignoreKeys, keyboardOverrides } = props || {};
  
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

  // Compose onMediaRef so we keep existing external callback semantics
  const handleMediaRef = useCallback((el) => {
    exposedMediaRef.current = el;
    if (props.onMediaRef) props.onMediaRef(el);
  }, [props.onMediaRef]);

  const handleController = useCallback((controller) => {
    controllerRef.current = controller;
    if (props.onController) props.onController(controller);
  }, [props.onController]);

  useImperativeHandle(ref, () => ({
    seek: (t) => { 
      const el = exposedMediaRef.current; 
      if (el && Number.isFinite(t)) { 
        try { el.currentTime = t; } catch(_){} 
      } 
    },
    play: () => { 
      const el = exposedMediaRef.current; 
      try { el?.play(); } catch(_){} 
    },
    pause: () => { 
      const el = exposedMediaRef.current; 
      try { el?.pause(); } catch(_){} 
    },
    toggle: () => { 
      const el = exposedMediaRef.current; 
      if (el) { el.paused ? el.play() : el.pause(); } 
    },
    getCurrentTime: () => exposedMediaRef.current?.currentTime || 0,
    getDuration: () => exposedMediaRef.current?.duration || 0,
    getMediaElement: () => exposedMediaRef.current,
    getMediaController: () => controllerRef.current
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
    onController: handleController
  };
  
  if (singlePlayerProps?.key) delete singlePlayerProps.key;

  // Extract plexId for health checks (from queue or play object)
  const plexId = queue?.plex || play?.plex || singlePlayerProps?.plex || singlePlayerProps?.media_key || null;

  return singlePlayerProps ? (
    <SinglePlayer {...singlePlayerProps} {...playerProps} />
  ) : (
    <div className={`player ${effectiveShader} ${props.playerType || ''}`}>
      <LoadingOverlay plexId={plexId} />
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
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  onController: PropTypes.func
};

export default Player;

// Export components for external use
export { LoadingOverlay } from './components/LoadingOverlay.jsx';
export { SinglePlayer } from './components/SinglePlayer.jsx';
export { AudioPlayer } from './components/AudioPlayer.jsx';
export { VideoPlayer } from './components/VideoPlayer.jsx';
