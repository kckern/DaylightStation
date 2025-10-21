import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Scriptures, Hymns, Talk, Poetry } from '../../ContentScroller/ContentScroller.jsx';
import AppContainer from '../../AppContainer/AppContainer.jsx';
import { fetchMediaInfo } from '../lib/api.js';
import { AudioPlayer } from './AudioPlayer.jsx';
import { VideoPlayer } from './VideoPlayer.jsx';
import { LoadingOverlay } from './LoadingOverlay.jsx';

/**
 * Single player component that handles different media types
 * Routes to appropriate player based on media type
 */
export function SinglePlayer(play) {
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
    showQuality,
  } = play || {};
  
  // Prepare common props for content scroller components
  const contentProps = {
    ...play,
    playbackKeys,
    ignoreKeys,
    queuePosition
  };

  if (!!scripture) return <Scriptures {...contentProps} />;
  if (!!hymn) return <Hymns {...contentProps} />;
  if (!!primary) return <Hymns {...{ ...contentProps, hymn: primary, subfolder: "primary" }} />;
  if (!!talk) return <Talk {...contentProps} />;
  if (!!poem) return <Poetry {...contentProps} />;

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);

  // LocalStorage helpers (per-device, per-plexId)
  const bitrateKey = useCallback((plexId) => `dashMaxBitrate:${plexId}`, []);
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
    // Respect override; else use stored; else use prop-level maxVideoBitrate if provided
    const override = opts?.maxVideoBitrateOverride;
    const stored = plexId ? readStoredBitrate(plexId) : null;
    const effectiveMax = (override !== undefined) ? override : (stored != null ? stored : play.maxVideoBitrate);

    const info = await fetchMediaInfo({ 
      plex, 
      media, 
      shuffle, 
      maxVideoBitrate: effectiveMax 
    });
    
    if (info) {
      // Attach current max to mediaInfo so the hook can seed its ref
      const withCap = { ...info, continuous, maxVideoBitrate: effectiveMax ?? null };
      setMediaInfo(withCap);
      setIsReady(true);
      // Persist override if provided
      if (override !== undefined && plexId) {
        writeStoredBitrate(plexId, override);
      }
    } else if (!!open) {
      setGoToApp(open);
    }
  }, [plex, media, rate, open, shuffle, continuous, play.maxVideoBitrate, mediaInfo?.media_key, play?.media_key, play?.plex, readStoredBitrate, writeStoredBitrate]);

  useEffect(() => {
    fetchVideoInfoCallback();
  }, [fetchVideoInfoCallback]);

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;
  
  // Calculate plexId from available sources - plex prop is passed directly from Player
  const initialPlexId = plex || media || mediaInfo?.media_key || mediaInfo?.key || mediaInfo?.plex || null;
  
  return (
    <div className={`player ${playerType || ''}`}>
      {!isReady && (
        <div className={`shader on notReady ${shader}`}>
          <LoadingOverlay plexId={initialPlexId} />
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
            onProgress,
            onMediaRef,
            showQuality,
            stallConfig: play?.stallConfig
          }
        )
      )}
      {isReady && !['dash_video', 'video', 'audio'].includes(mediaInfo.media_type) && (
        <pre>
          {JSON.stringify(mediaInfo, null, 2)}
        </pre>
      )}
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
  playbackKeys: PropTypes.arrayOf(PropTypes.string),
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
  showQuality: PropTypes.bool,
  stallConfig: PropTypes.object
};
