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

  const fetchVideoInfoCallback = useCallback(async () => {
    setIsReady(false);
    const info = await fetchMediaInfo({ 
      plex, 
      media, 
      shuffle, 
      maxVideoBitrate: play.maxVideoBitrate 
    });
    
    if (info) {
      setMediaInfo({ ...info, continuous });
      setIsReady(true);
    } else if (!!open) {
      setGoToApp(open);
    }
  }, [plex, media, rate, open, shuffle, continuous, play.maxVideoBitrate]);

  useEffect(() => {
    fetchVideoInfoCallback();
  }, [fetchVideoInfoCallback]);

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;
  
  return (
    <div className={`player ${playerType || ''}`}>
      {!isReady && (
        <div className={`shader on notReady ${shader}`}>
          <LoadingOverlay />
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
  stallConfig: PropTypes.object
};
