import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Scriptures, Hymns, Talk, Poetry } from '../../ContentScroller/ContentScroller.jsx';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import { fetchMediaInfo } from '../lib/api.js';
import { AudioPlayer } from './AudioPlayer.jsx';
import { VideoPlayer } from './VideoPlayer.jsx';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

/**
 * Single player component that handles different media types
 * Routes to appropriate player based on media type
 */
export function SinglePlayer(props = {}) {
  const {
    onResolvedMeta,
    onPlaybackMetrics,
    onRegisterMediaAccess,
    onStartupSignal,
    seekToIntentSeconds = null,
    onSeekRequestConsumed,
    remountDiagnostics,
    wrapWithContainer = true,
    suppressLocalOverlay = false,
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
    media_key: mediaKeyProp
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
      mediaInfo?.media_key,
      mediaInfo?.key,
      mediaInfo?.plex,
      mediaInfo?.id,
      mediaInfo?.media_url,
      plex,
      mediaKeyProp,
      media
    ];
    const firstDefined = candidates.find((value) => value != null && String(value).length);
    return firstDefined != null ? String(firstDefined) : null;
  }, [mediaInfo?.media_key, mediaInfo?.key, mediaInfo?.plex, mediaInfo?.id, mediaInfo?.media_url, plex, mediaKeyProp, media]);

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
    if (typeof onProgress === 'function') {
      onProgress({
        ...payload,
        watchedDuration
      });
    }
  }, [accumulateWatchedDuration, onProgress, playbackSessionKey]);

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

  // Store initial max video bitrate to prevent it being lost on re-renders
  const initialMaxVideoBitrateRef = useRef(play.maxVideoBitrate);
  
  // Update ref if prop changes
  useEffect(() => {
    if (play.maxVideoBitrate !== undefined) {
      initialMaxVideoBitrateRef.current = play.maxVideoBitrate;
    }
  }, [play.maxVideoBitrate]);

  // LocalStorage helpers (per-device, per-plexId)
  const bitrateKey = useCallback((plexId) => `dashMaxVideoBitrate:${plexId}`, []);
  const readStoredBitrate = useCallback((plexId) => {
    try {
      const raw = window.localStorage.getItem(bitrateKey(plexId));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      const now = Date.now();
      if (obj.expiresAt && now > obj.expiresAt) {
        window.localStorage.removeItem(bitrateKey(plexId));
        return null;
      }
      return (obj.valueKbps ?? null);
    } catch {
      return null;
    }
  }, [bitrateKey]);
  const writeStoredBitrate = useCallback((plexId, valueKbps) => {
    try {
      const now = Date.now();
      const ttl = 30 * 24 * 60 * 60 * 1000; // 30 days
      const payload = { valueKbps: valueKbps ?? null, updatedAt: now, expiresAt: now + ttl };
      window.localStorage.setItem(bitrateKey(plexId), JSON.stringify(payload));
    } catch {}
  }, [bitrateKey]);

  const fetchVideoInfoCallback = useCallback(async (opts = {}) => {
    setIsReady(false);
    // Determine plexId (prefer explicit plex prop)
    const plexId = plex || mediaInfo?.media_key || play?.media_key || play?.plex;
    // Respect override; else use stored; else use initial maxVideoBitrate from ref
    const bitrateOverride = opts?.maxVideoBitrateOverride;
    const resolutionOverride = opts?.maxResolutionOverride;
    const stored = plexId ? readStoredBitrate(plexId) : null;
    const effectiveMax = (bitrateOverride !== undefined) ? bitrateOverride : (stored != null ? stored : initialMaxVideoBitrateRef.current);
    const effectiveResolution = (resolutionOverride !== undefined) ? resolutionOverride : play?.maxResolution;

    const info = await fetchMediaInfo({ 
      plex, 
      media, 
      shuffle, 
      maxVideoBitrate: effectiveMax,
      maxResolution: effectiveResolution
    });
    
    if (info) {
      // Attach current max to mediaInfo so the hook can seed its ref
      const withCap = {
        ...info,
        continuous,
        maxVideoBitrate: effectiveMax ?? null,
        maxResolution: effectiveResolution ?? null
      };
      
      // Override seconds if explicitly provided in play object
      if (play?.seconds !== undefined) {
        withCap.seconds = play.seconds;
      }
      
      setMediaInfo(withCap);
      setIsReady(true);
      // Persist override if provided
      if (bitrateOverride !== undefined && plexId) {
        writeStoredBitrate(plexId, bitrateOverride);
      }
    } else if (!!open) {
      setGoToApp(open);
    }
  }, [plex, media, rate, open, shuffle, continuous, mediaInfo?.media_key, play?.media_key, play?.plex, play?.maxResolution, readStoredBitrate, writeStoredBitrate]);
  // Note: initialMaxVideoBitrateRef intentionally not in deps - we use the ref to preserve the initial value

  useEffect(() => {
    fetchVideoInfoCallback();
  }, [fetchVideoInfoCallback]);

  useEffect(() => {
    if (!isReady || !mediaInfo?.media_type) {
      return;
    }
    onResolvedMeta?.(mediaInfo);
  }, [isReady, mediaInfo, onResolvedMeta]);

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;
  
  // Calculate plexId from available sources - plex prop is passed directly from Player
  const initialPlexId = plex || media || mediaInfo?.media_key || mediaInfo?.key || mediaInfo?.plex || null;
  const resilienceBridge = useMemo(() => ({
    onPlaybackMetrics,
    onRegisterMediaAccess,
    seekToIntentSeconds,
    onSeekRequestConsumed,
    remountDiagnostics,
    onStartupSignal
  }), [onPlaybackMetrics, onRegisterMediaAccess, seekToIntentSeconds, onSeekRequestConsumed, remountDiagnostics, onStartupSignal]);
  
  const playerBody = (
    <>
      {!isReady && !suppressLocalOverlay && (
        <div className={`shader on notReady ${shader}`}>
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
      {isReady && ['dash_video', 'video', 'audio'].includes(mediaInfo.media_type) && (
        React.createElement(
          {
            audio: AudioPlayer,
            video: VideoPlayer,
            dash_video: VideoPlayer
          }[mediaInfo.media_type],
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
            watchedDurationProvider: getWatchedDuration
          }
        )
      )}
      {isReady && !['dash_video', 'video', 'audio'].includes(mediaInfo.media_type) && (
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
    <div className={`player ${playerType || ''}`}>
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
  maxResolution: PropTypes.oneOfType([PropTypes.number, PropTypes.string])
};
