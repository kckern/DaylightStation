import React, { useRef, useEffect, useState, useCallback } from 'react';
import './Player.scss';
import moment from 'moment';
import {Scriptures,Hymns, Talk} from './../ContentScroller/ContentScroller.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import 'dash-video-element';
import spinner from '../../assets/icons/spinner.svg';
import pause from '../../assets/icons/pause.svg';
import AppContainer from '../AppContainer/AppContainer.jsx';


/*─────────────────────────────────────────────────────────────*/
/*  HOOKS AND UTILITIES                                       */
/*─────────────────────────────────────────────────────────────*/

function guid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatTime(seconds) {
  return moment
    .utc(seconds * 1000)
    .format(seconds >= 3600 ? 'HH:mm:ss' : 'mm:ss')
    .replace(/^0(\d+)/, '$1');
}

function getProgressPercent(progress, duration) {
  if (!duration) return { percent: 0 };
  const percent = ((progress / duration) * 100).toFixed(1);
  return { percent };
}

function ProgressBar({ percent, onClick }) {
  return (
    <div
      className="progress-bar"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : {}}
    >
      <div className="progress" style={{ width: `${percent}%` }} />
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  useCommonMediaController                                  */
/*─────────────────────────────────────────────────────────────*/

function useCommonMediaController({
  start = 0,
  playbackRate = 1,
  onEnd = () => {},
  onClear = () => {},
  isAudio = false,
  isVideo = false,
  meta,
  type,
  onShaderLevelChange = () => {},
  shader,
  volume,
  cycleThroughClasses,
  playbackKeys,queuePosition 
}) {
  const media_key = meta.media_key || meta.key || meta.guid || meta.id  || meta.plex || meta.media_url;
  const containerRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastLoggedTimeRef = useRef(0);
  const lastUpdatedTimeRef = useRef(0);
  const [timeSinceLastProgressUpdate, setTimeSinceLastProgressUpdate] = useState(0);

  const getMediaEl = () => {
    const mediaEl = containerRef.current?.shadowRoot?.querySelector('video') || containerRef.current;
    if (!mediaEl) return null;
    return mediaEl;
  };

  const isDash = meta.media_type === 'dash_video';

  const handleProgressClick = (event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    mediaEl.currentTime = (clickX / rect.width) * duration;
  };


  const lastKeypressTimeRef = useRef(0);
  const delta = 350;


  useEffect(() => {
    const skipToNextTrack = () => {
      const mediaEl = getMediaEl();
      if (mediaEl) {
      const percent = getProgressPercent(mediaEl.currentTime, mediaEl.duration).percent;
      const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '')
      DaylightAPI(`media/log`, { title, type, media_key, seconds: mediaEl.currentTime, percent:100, title });
      DaylightAPI(`harvest/watchlist`);
      }
      onEnd(1);
    };
    const skipToPrevTrack = () => {
      const mediaEl = getMediaEl();
      if (mediaEl && mediaEl.currentTime > 5) {
      mediaEl.currentTime = 0;
      } else {
      onEnd(-1);
      }
    };
    const advanceInCurrentTrack = (seconds) => {
      const mediaEl = getMediaEl();
      if (mediaEl) {
      const increment = mediaEl.duration
        ? Math.max(5, Math.floor(mediaEl.duration / 50))
        : 5;
      mediaEl.currentTime = seconds > 0
        ? Math.min(mediaEl.currentTime + Math.max(seconds, increment), mediaEl.duration || 0)
        : Math.max(mediaEl.currentTime + Math.min(seconds, -increment), 0);
      }
    };
    const togglePlayPause = () => {
      const mediaEl = getMediaEl();
      if (mediaEl) mediaEl.paused ? mediaEl.play() : mediaEl.pause();
    };
    const startTrackOver = () => {
      const mediaEl = getMediaEl();
      if (mediaEl) mediaEl.currentTime = 0;
    };


    const handleRightArrow = (e) => {
      const isDoubleClick = Date.now() - lastKeypressTimeRef.current < delta;
      console.log({ isDoubleClick, lastKeypressTime: lastKeypressTimeRef.current });
      lastKeypressTimeRef.current = Date.now();
      if (isDoubleClick) return skipToNextTrack();
      return advanceInCurrentTrack(10);
    };

    const handleLeftArrow = (e) => {
      const isDoubleClick = Date.now() - lastKeypressTimeRef.current < delta;
      lastKeypressTimeRef.current = Date.now();
      if (isDoubleClick) return skipToPrevTrack();
      return advanceInCurrentTrack(-10);
    };

    const handleKeyDown = (event) => {
      if (event.repeat) return;
      const isPlaying = getMediaEl()?.paused === false;
      const isFirstTrackInQueue = queuePosition === 0;
      playbackKeys = playbackKeys || {};
      const keyMap = {
      Tab: skipToNextTrack,
      Backspace: skipToPrevTrack,
      ArrowRight: (e) => handleRightArrow(e),
      ArrowLeft: (e)=> handleLeftArrow(e),
      ArrowUp: () => cycleThroughClasses(1),
      ArrowDown: () => cycleThroughClasses(-1),
      Escape: onClear,
      Enter: togglePlayPause,
      ' ': togglePlayPause,
      Space: togglePlayPause,
      Spacebar: togglePlayPause,
      MediaPlayPause: togglePlayPause,
      ...(playbackKeys['prev'] || []).reduce((map, key) => ({ ...map, [key]: isFirstTrackInQueue ? startTrackOver : skipToPrevTrack }), {}),
      ...(playbackKeys['play'] || []).reduce((map, key) => ({ ...map, [key]: () => !isPlaying ? getMediaEl()?.play() : skipToNextTrack() }), {}),
      ...(playbackKeys['pause'] || []).reduce((map, key) => ({ ...map, [key]: togglePlayPause }), {}),
      ...(playbackKeys['rew'] || []).reduce((map, key) => ({ ...map, [key]: () => advanceInCurrentTrack(-10) }), {}),
      ...(playbackKeys['fwd'] || []).reduce((map, key) => ({ ...map, [key]: () => advanceInCurrentTrack(10) }), {}),
      };

      const action = keyMap[event.key];
      if (action) {
      event.preventDefault();
      action();
      } else {
     // alert(`Key "${event.key}" is not supported.`);
      }
    };


    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClear, onEnd, isAudio, isVideo, onShaderLevelChange, duration, cycleThroughClasses, playbackKeys]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = now - lastUpdatedTimeRef.current;
      setTimeSinceLastProgressUpdate(diff);
    }, 50);
    return () => clearInterval(interval);
  }, [meta.key, meta.title]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return;

    const logTime = async (type, media_key, percent, title) => {
      const now = Date.now();
      lastUpdatedTimeRef.current = now;
      const timeSinceLastLog = now - lastLoggedTimeRef.current;
      const seconds = mediaEl.currentTime || 0;
      if (timeSinceLastLog > 10000 && parseFloat(percent) > 0) {
        lastLoggedTimeRef.current = now;
        if(seconds > 10)  await DaylightAPI(`media/log`, { title, type, media_key, seconds, percent, title });
      }
    };

    const onTimeUpdate = () => {
      setSeconds(mediaEl.currentTime);
      const percent = getProgressPercent(mediaEl.currentTime, mediaEl.duration).percent;
      const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
      logTime(type, media_key, percent, title);
    };
    const onDurationChange = () => setDuration(mediaEl.duration);
    const onEnded = () => onEnd();
    const onLoadedMetadata = () => {
      const duration = mediaEl.duration || 0;
      if(volume < 1) volume = parseFloat(volume) * 100;
      if(volume === 1)  volume = 100;
      volume = parseFloat(volume || 100) / 100;

      const mapping = { "1": 1, "0.9": 0.8, "0.8": 0.6, "0.7": 0.4, "0.6": 0.3, "0.5": 0.2, "0.4": 0.15, "0.3": 0.1, "0.2": 0.05, "0.1": 0.02, "0.05": 0.01, "0.01": 0.005, };

      const adjustedVolume = ((volume) => {
        const mappingKeys = Object.keys(mapping).map(Number).sort((a, b) => b - a); // Sort in descending order
        for (let i = 0; i < mappingKeys.length; i++) {
          if (volume >= mappingKeys[i]) {
        return mapping[mappingKeys[i]];
          }
        }
        return 0; // If volume is less than the smallest key, return 0
      })(volume);

      console.log({ volume, adjustedVolume });

      const isVideo = ['video', 'dash_video'].includes(mediaEl.tagName.toLowerCase());
      const startTime = (duration > (12 * 60) || isVideo) ? start : 0;
      mediaEl.dataset.key = media_key;
      if (Number.isFinite(startTime)) mediaEl.currentTime = startTime;
      mediaEl.autoplay = true;
      mediaEl.volume = adjustedVolume; // Set the volume level
      if (isVideo) {
      mediaEl.controls = false;
      mediaEl.addEventListener('play', () => {
        mediaEl.playbackRate = playbackRate;
      }, { once: false });
      mediaEl.addEventListener('seeked', () => {
        mediaEl.playbackRate = playbackRate;
      }, { once: false });
      } else {
      mediaEl.playbackRate = playbackRate;
      }
    };

    mediaEl.addEventListener('timeupdate', onTimeUpdate);
    mediaEl.addEventListener('durationchange', onDurationChange);
    mediaEl.addEventListener('ended', onEnded);
    mediaEl.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      mediaEl.removeEventListener('timeupdate', onTimeUpdate);
      mediaEl.removeEventListener('durationchange', onDurationChange);
      mediaEl.removeEventListener('ended', onEnded);
      mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [onEnd, playbackRate, start, isVideo, meta.percent, meta.title, type, media_key]);




  return {
    containerRef,
    seconds,
    percent: getProgressPercent(seconds, duration).percent,
    duration,
    isPaused: !seconds ? false : getMediaEl()?.paused || false,
    isDash,
    shader,
    timeSinceLastProgressUpdate,
    handleProgressClick
  };
}



export async function flattenQueueItems(items, level = 1) {
  const flattened = [];

  for (const item of items) {
    if (item.queue) {
      const shuffle = !!item.shuffle;
      if (item.queue.playlist || item.queue.queue) {
        const queueKey = item.queue.playlist ?? item.queue.queue;
        const { items: nestedItems } = await DaylightAPI(`data/list/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.plex) {
        const { items: plexItems } = await DaylightAPI(`media/plex/list/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(plexItems, level + 1);
        flattened.push(...nestedFlattened);
      }
    } else if (item.play) {
      flattened.push(item);
    } else {
      flattened.push(item);
    }
  }

  return flattened.filter(item => item?.active !== false);
}


/*─────────────────────────────────────────────────────────────*/
/*  useQueueController                                        */
/*─────────────────────────────────────────────────────────────*/

function useQueueController({ play, queue, clear }) {
 
  const classes = ['regular', 'minimal', 'night', 'screensaver', 'dark'];
  const [shader, setShader] = useState(play?.shader || queue?.shader || classes[0]);
  const [volume] = useState(play?.volume || queue?.volume || 1);
  const [isContinuous] = useState(!!queue?.continuous || !!play?.continuous || false);
  const [playQueue, setQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  const [isShuffle, setIsShuffle] = useState(!!play?.shuffle || !!queue?.shuffle || false);

  const cycleThroughClasses = (upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setShader((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      return classes[newIndex];
    });
  };

  const isQueue = !!queue || (play && (play.playlist || play.queue)) || Array.isArray(play);


  useEffect(() => {
    async function initQueue() {
      let newQueue = [];
      if (Array.isArray(play)) {
        newQueue = play.map(item => ({ ...item, guid: guid() }));
      } else if (Array.isArray(queue)) {
        newQueue = queue.map(item => ({ ...item, guid: guid() }));
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        const queue_media_key = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
        if (queue_media_key) {

          const { items } = await DaylightAPI(`data/list/${queue_media_key}/playable${isShuffle ? ',shuffle' : ''}`);
          const flattened = await flattenQueueItems(items);
          newQueue = flattened.map(item => ({ ...item, ...item.play, guid: guid() }));
        } else if (queue?.plex) {
          const { items } = await DaylightAPI(`media/plex/list/${queue.plex}/playable${isShuffle ? ',shuffle' : ''}`);
          const flattened = await flattenQueueItems(items);
          newQueue = flattened.map(item => ({ ...item, ...item.play, guid: guid() }));
        }
      }
      setQueue(newQueue);
      setOriginalQueue(newQueue);
    }
    initQueue();
  }, [play, queue]);

  const advance = useCallback((step = 1) => {
    setQueue((prevQueue) => {
      if (prevQueue.length > 1) {
        if (step < 0) {
          const currentIndex = originalQueue.findIndex(item => item.guid === prevQueue[0]?.guid);
          const backtrackIndex = (currentIndex + step + originalQueue.length) % originalQueue.length;
          const backtrackItem = originalQueue[backtrackIndex];
          return [backtrackItem, ...prevQueue];
        } else {
          const currentIndex = isContinuous
            ? (prevQueue.length + step) % prevQueue.length
            : Math.min(Math.max(0, step), prevQueue.length - 1);
          if (isContinuous) {
            const rotatedQueue = [
              ...prevQueue.slice(currentIndex),
              ...prevQueue.slice(0, currentIndex),
            ];
            return rotatedQueue;
          }
          return prevQueue.slice(currentIndex);
        }
      }
      clear();
      return [];
    });
  }, [clear, isContinuous, originalQueue]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clear]);

  const queuePosition = originalQueue.findIndex(item => item.guid === playQueue[0]?.guid);
  return {
    classes,
    cycleThroughClasses,
    shader,
    setShader,
    isQueue,
    volume,
    isContinuous,
    playQueue,
    playbackRate: play?.playbackRate || queue?.playbackRate || 1,
    setQueue,
    advance,
    queuePosition
  };
}


/*─────────────────────────────────────────────────────────────*/
/*  MAIN PLAYER                                               */
/*─────────────────────────────────────────────────────────────*/

export default function Player(props) {
  console.log("Player props:", props);
  if (props.play?.overlay || props.queue?.overlay) {
    return <CompositePlayer {...props} />;
  }
  const { play, queue, clear, playbackrate, playbackKeys, playerType } = props || {};
  if(playbackrate && play) play['playbackRate'] = playbackrate; //Override playback rate if passed in via menu selection

  const {
    classes,
    cycleThroughClasses,
    shader,
    setShader,
    isQueue,
    volume,
    queuePosition,
    playbackRate,
    playQueue,
    advance
  } = useQueueController({ play, queue, clear });

  const playerProps = {
    advance: isQueue ? advance : clear,
    clear,
    shader,
    volume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackRate,
    playbackKeys,
    playerType,
    queuePosition,
  };

  const singlePlayerProps = (() => {
    if (isQueue && playQueue?.length > 0) {
      return { key: playQueue[0].guid, ...playQueue[0] };
    }
    if (play && !Array.isArray(play)) {
      return { ...play };
    }
    return null;
  })();
  if(singlePlayerProps?.key) delete singlePlayerProps.key;


  return singlePlayerProps ? (
    <SinglePlayer {...singlePlayerProps} {...playerProps} />
  ) : (
    <div className={`player ${shader} ${props.playerType || ''}`}>
      <LoadingOverlay />
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  Compound Player (Video Player with Audio Overlay)       */
/* Use cases: 
/* - workout video with audio playlist,
/* - ambient video with modular background music,
/* - sermon video with background hymns or talks
/* Required input variables:
/* - play or queue: object with media details
*/    

function CompositePlayer(props) {
  const { play, queue } = props;
  const isQueue = !!queue;

  const primaryProps = React.useMemo(() => {
    const baseProps = { ...props };
    const overlayKey = isQueue ? 'queue' : 'play';
    if (baseProps[overlayKey]) {
      baseProps[overlayKey] = { ...baseProps[overlayKey], overlay: undefined };
    }
    return baseProps;
  }, [props, isQueue]);

  const overlayProps = React.useMemo(() => ({ queue: { plex: isQueue ? queue.overlay : play.overlay, shuffle: 1 } }), [play, queue, isQueue]);
  const shader = primaryProps.primary?.shader || primaryProps.overlay?.shader || 'regular';
  return <div className={`player composite ${shader}`}>
    <Player playerType="overlay" {...overlayProps} />
    <Player playerType="primary" {...primaryProps} />
    </div>;

}

/*─────────────────────────────────────────────────────────────*/
/*  SINGLE PLAYER                                             */
/*─────────────────────────────────────────────────────────────*/
export function SinglePlayer(play) {
  const {
    plex,
    media,
    hymn,
    primary,
    scripture,
    talk,
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
    //configs
    shader,
    volume,
    playbackRate



  } = play || {};
  

  if (!!scripture)    return <Scriptures {...play} />;
  if (!!hymn)         return <Hymns {...play} />;
  if (!!primary)      return <Hymns {...{...play,hymn: primary, subfolder:"primary"}}/>;
  if (!!talk)         return <Talk {...play} />;

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);


  const fetchVideoInfo = useCallback(async () => {
    setIsReady(false);
    if (!!plex) {
      const infoResponse = await DaylightAPI(`media/plex/info/${plex}`);
      setMediaInfo({ ...infoResponse, playbackRate: playbackRate || rate || 1, media_key: infoResponse.plex });
      setIsReady(true);
    } else if (!!media) {
      const infoResponse = await DaylightAPI(`media/info/${media}`);
      console.log({ infoResponse });
      setMediaInfo({ ...infoResponse, playbackRate: playbackRate || rate || 1, media_key: infoResponse.media_key  || infoResponse.listkey });
      setIsReady(true);
    } else if (!!open) {
      setGoToApp(open);
    }
  }, [plex, media, rate, open]);

  useEffect(() => {
    fetchVideoInfo();
  }, [fetchVideoInfo]);

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;
  return (
    <div className={`player ${playerType || ''}`}>
      {!isReady && <div className={`shader on notReady ${shader}`}><LoadingOverlay /></div>}
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
            fetchVideoInfo
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


/*─────────────────────────────────────────────────────────────*/
/*  AUDIO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function AudioPlayer({ media, advance, clear, shader, setShader, volume, playbackRate, cycleThroughClasses, classes,playbackKeys,queuePosition, fetchVideoInfo }) {
  const { media_url, title, artist, albumArtist, album, image, type } = media || {};
  const {
    timeSinceLastProgressUpdate,
    seconds,
    duration,
    containerRef,
    isPaused,
    handleProgressClick
  } = useCommonMediaController({
    start: media.seconds,
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: true,
    isVideo: false,
    meta: media,
    type: ['track'].includes(type) ? 'plex' : 'media',
    shader,
    setShader,
    cycleThroughClasses,
    classes,
    volume,
    playbackKeys,queuePosition 
  });

  const { percent } = getProgressPercent(seconds, duration);
  const header = !!artist && !!album ? `${artist} - ${album}` : !!artist ? artist : !!album ? album : media_url;
  const shaderState = percent < 0.1 || seconds > duration - 2 ? 'on' : 'off';

  const footer = `${title}${albumArtist && albumArtist !== artist ? ` (${albumArtist})` : ''}`;
  return (
    <div className={`audio-player ${shader}`}>
      <div className={`shader ${shaderState}`} />
      {seconds > 2 && timeSinceLastProgressUpdate > 1000 && <LoadingOverlay isPaused={isPaused} fetchVideoInfo={fetchVideoInfo} />}
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <div className="audio-content">
        <div className="image-container">
          {image && (
            <>
              <img src={image} alt={title} className="cover" />
              <div className="image-backdrop" />
            </>
          )}
        </div>
        <div className="audio-info">
          <p className="audio-header">{header}</p>
          <p className="audio-timing">{formatTime(seconds)} / {formatTime(duration)}</p>
          <p className="audio-footer">{footer}</p>
        </div>
      </div>
      <audio ref={containerRef} src={media_url} autoPlay style={{ display: 'none' }} />
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  VIDEO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function VideoPlayer({ media, advance, clear, shader, volume, playbackRate,setShader, cycleThroughClasses, classes, playbackKeys,queuePosition, fetchVideoInfo  }) {
  const isPlex = ['dash_video'].includes(media.media_type);
  const {
    isDash,
    containerRef,
    seconds,
    isPaused,
    timeSinceLastProgressUpdate,
    duration,
    handleProgressClick,
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
    playbackRate,
    volume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,queuePosition 
  });

  const { show, season, title, media_url } = media;
  const { percent } = getProgressPercent(seconds, duration);
  const heading = !!show && !!season && !!title
    ? `${show} - ${season}: ${title}`
    : !!show && !!season
    ? `${show} - ${season}`
    : !!show
    ? show
    : title;

  return (
    <div className={`video-player ${shader}`}>
      <h2>
        {heading} {`(${playbackRate}×)`}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {(seconds === 0 || timeSinceLastProgressUpdate > 1000) && <LoadingOverlay seconds={seconds} isPaused={isPaused} fetchVideoInfo={fetchVideoInfo} />}
      {isDash ? (
        <dash-video
          ref={containerRef}
          class={`video-element ${(seconds || 0) > 0 && 'show'}`}
          controls
          src={media_url}
        />
      ) : (
        <video
          autoPlay
          ref={containerRef}
          className={`video-element show`}
          src={media_url}
        />
      )}
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  LOADING OVERLAY                                           */
/*─────────────────────────────────────────────────────────────*/

export function LoadingOverlay({ isPaused, fetchVideoInfo }) {
  const [visible, setVisible] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!isPaused) {
      const interval = setInterval(() => {
        setLoadingTime((prev) => prev + 1);
      }, 1000);

      if (loadingTime >= 10) {
        fetchVideoInfo?.();
        setLoadingTime(0); // Reset loading time after fetching
      }

      return () => clearInterval(interval);
    } else {
      setLoadingTime(0); // Reset loading time if paused
    }
  }, [isPaused, loadingTime, fetchVideoInfo]);

  const imgSrc = isPaused ? pause : spinner;

  return (
    <div
      className={`loading-overlay ${isPaused ? 'paused' : 'loading'}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
      }}
    >
      <img src={imgSrc} alt="" />
    </div>
  );
}