import React, { useRef, useEffect, useState, useCallback } from 'react';
import './Player.scss';
import moment from 'moment';
import {Scriptures,Hymns, Talk} from './ContentScroller.jsx';
import { DaylightAPI } from '../lib/api.mjs';
import 'dash-video-element';
import spinner from '../assets/icons/spinner.svg';
import AppContainer from './AppContainer.jsx';


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
  shaders,
  type,
  onShaderLevelChange = () => {},
  selectedClass,
  setSelectedClass,
  cycleThroughClasses,
  playbackKeys,queuePosition 
}) {
  const media_key = meta.media_key || meta.key || meta.guid || meta.id || meta.media_url;
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




  useEffect(() => {
    const skipToNextTrack = () => onEnd(1);
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

    const handleKeyDown = (event) => {
      if (event.repeat) return;
      const isPlaying = getMediaEl()?.paused === false;
      const isFirstTrackInQueue = queuePosition === 0;
      const keyMap = {
      Tab: skipToNextTrack,
      Backspace: skipToPrevTrack,
      ArrowRight: () => advanceInCurrentTrack(10),
      ArrowLeft: () => advanceInCurrentTrack(-10),
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
      logTime(type, media_key, percent, meta.title);
    };
    const onDurationChange = () => setDuration(mediaEl.duration);
    const onEnded = () => onEnd();
    const onLoadedMetadata = () => {
      const duration = mediaEl.duration || 0;
      const startTime = duration > (12 * 60) ? start : 0;
      //console.log({duration, start, startTime, media_key, type});
      mediaEl.dataset.key = media_key;
      if (Number.isFinite(startTime)) mediaEl.currentTime = startTime;
      mediaEl.autoplay = true;
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
    playbackRate,
    isDash,
    selectedClass,
    timeSinceLastProgressUpdate,
    handleProgressClick
  };
}



export async function flattenQueueItems(items, level = 1) {
  const flattened = [];

  for (const item of items) {
    if (item.queue) {
      if (item.queue.playlist || item.queue.queue) {
        const queueKey = item.queue.playlist ?? item.queue.queue;
        const { items: nestedItems } = await DaylightAPI(`data/list/${queueKey}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.plex) {
        const { items: plexItems } = await DaylightAPI(`media/plex/list/${item.queue.plex}`);
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
  const [selectedClass, setSelectedClass] = useState(classes[0]);
  const [isContinuous, setIsContinuous] = useState(false);
  const [playQueue, setQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);

  const cycleThroughClasses = (upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setSelectedClass((prevClass) => {
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
        if (play?.playlist || play?.queue || queue?.playlist || queue?.queue) {
          const queue_media_key = play?.playlist || play?.queue || queue?.playlist || queue?.queue;
          const { items, continuous } = await DaylightAPI(`data/list/${queue_media_key}`);
          setIsContinuous(continuous || false);
          const flattened = await flattenQueueItems(items);
          newQueue = flattened.map(item => ({ ...item, ...item.play, guid: guid() }));
        } else if (queue?.plex) {
          const { items, continuous } = await DaylightAPI(`media/plex/list/${queue.plex}`);
          setIsContinuous(continuous || false);
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
    selectedClass,
    setSelectedClass,
    isQueue,
    isContinuous,
    playQueue,
    setQueue,
    advance,
    queuePosition
  };
}


/*─────────────────────────────────────────────────────────────*/
/*  MAIN PLAYER                                               */
/*─────────────────────────────────────────────────────────────*/

export default function Player({ play, queue, clear, playbackKeys }) {

  const {
    classes,
    cycleThroughClasses,
    selectedClass,
    setSelectedClass,
    isQueue,
    isContinuous,
    queuePosition,
    playQueue,
    advance
  } = useQueueController({ play, queue, clear });


  if (isQueue && playQueue?.length > 1) {
    return (
      <SinglePlayer
        key={playQueue[0].guid}
        {...playQueue[0]}
        advance={advance}
        clear={clear}
        selectedClass={selectedClass}
        setSelectedClass={setSelectedClass}
        cycleThroughClasses={cycleThroughClasses}
        classes={classes}
        playbackKeys={playbackKeys}
        queuePosition={queuePosition}
      />
    );
  }
  if (isQueue && playQueue?.length === 1) {
    return (
      <SinglePlayer
        key={playQueue[0].guid}
        {...playQueue[0]}
        advance={advance}
        clear={clear}
        selectedClass={selectedClass}
        setSelectedClass={setSelectedClass}
        cycleThroughClasses={cycleThroughClasses}
        classes={classes}
        playbackKeys={playbackKeys}
        queuePosition={queuePosition}
      />
    );
  }
  if (play && !Array.isArray(play)) {
    return (
      <SinglePlayer
        {...play}
        advance={clear}
        clear={clear}
        selectedClass={selectedClass}
        setSelectedClass={setSelectedClass}
        cycleThroughClasses={cycleThroughClasses}
        classes={classes}
        playbackKeys={playbackKeys}
        queuePosition={queuePosition}
      />
    );
  }
  return (
    <div className={`shader on queuer`}>
      <LoadingOverlay />
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  SINGLE PLAYER                                             */
/*─────────────────────────────────────────────────────────────*/

export function SinglePlayer(play) {
  const {
    plex,
    media,
    hymn,
    scripture,
    talk,
    shuffle,
    rate,
    advance,
    open,
    clear,
    selectedClass,
    setSelectedClass,
    cycleThroughClasses,
    classes,
    playbackKeys,
    queuePosition
  } = play || {};

  if (!!scripture)    return <Scriptures {...play} />;
  if (!!hymn)         return <Hymns {...play} />;
  if (!!talk)         return <Talk {...play} />;

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);


  useEffect(() => {
    async function fetchVideoInfo() {
      if (!!plex) {
        const infoResponse = await DaylightAPI(`media/plex/info/${plex}`);
        setMediaInfo({ ...infoResponse, playbackRate: rate || 1 });
        setIsReady(true);
      } else if (!!media) {
        const infoResponse = await DaylightAPI(`media/info/${media}`);
        setMediaInfo({ ...infoResponse, playbackRate: rate || 1 });
        setIsReady(true);
      } else if (!!open) {
        setGoToApp(open);
      }
    }
    fetchVideoInfo();
  }, [plex, media, shuffle, rate, open]);

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;

  return (
    <div className="player">
      {!isReady && <div className="shader on notReady"><LoadingOverlay /></div>}
      {isReady && mediaInfo.media_type === 'dash_video' && (
        <VideoPlayer
          media={mediaInfo}
          advance={advance}
          clear={clear}
          selectedClass={selectedClass}
          setSelectedClass={setSelectedClass}
          cycleThroughClasses={cycleThroughClasses}
          classes={classes}
          playbackKeys={playbackKeys}
          queuePosition={queuePosition}
        />
      )}
      {isReady && mediaInfo.media_type === 'video' && (
        <VideoPlayer
          media={mediaInfo}
          advance={advance}
          clear={clear}
          selectedClass={selectedClass}
          setSelectedClass={setSelectedClass}
          cycleThroughClasses={cycleThroughClasses}
          classes={classes}
          playbackKeys={playbackKeys}
          queuePosition={queuePosition}
        />
      )}
      {isReady && mediaInfo.media_type === 'audio' && (
        <AudioPlayer
          media={mediaInfo}
          advance={advance}
          clear={clear}
          selectedClass={selectedClass}
          setSelectedClass={setSelectedClass}
          cycleThroughClasses={cycleThroughClasses}
          classes={classes}
          playbackKeys={playbackKeys}
          queuePosition={queuePosition}
        />
      )}
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  AUDIO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function AudioPlayer({ media, advance, clear, selectedClass, setSelectedClass, cycleThroughClasses, classes,playbackKeys,queuePosition }) {
  const { media_url, title, artist, album, image, type } = media;
  const {
    timeSinceLastProgressUpdate,
    playbackRate,
    containerRef,
    seconds,
    duration,
    handleProgressClick
  } = useCommonMediaController({
    start: media.seconds,
    playbackRate: media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: true,
    isVideo: false,
    meta: media,
    type: ['track'].includes(type) ? 'plex' : 'media',
    selectedClass,
    setSelectedClass,
    cycleThroughClasses,
    classes,
    playbackKeys,queuePosition 
  });

  const { percent } = getProgressPercent(seconds, duration);
  const header = !!artist && !!album ? `${artist} - ${album}` : !!artist ? artist : !!album ? album : media_url;
  const shaderState = percent < 0.1 || seconds > duration - 2 ? 'on' : 'off';

  return (
    <div className={`audio-player ${selectedClass}`}>
      <div className={`shader ${shaderState}`} />
      {seconds > 2 && timeSinceLastProgressUpdate > 1000 && <LoadingOverlay />}
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <p>{header}</p>
      <p>{formatTime(seconds)} / {formatTime(duration)}</p>
      <div className="image-container">
        {image && (
          <>
            <img src={image} alt={title} className="cover" />
            <div className="image-backdrop" />
          </>
        )}
      </div>
      <h2>
        {title} {playbackRate > 1 ? `(${playbackRate}×)` : ''}
      </h2>
      <audio ref={containerRef} src={media_url} autoPlay style={{ display: 'none' }} />
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  VIDEO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function VideoPlayer({ media, advance, clear, selectedClass, setSelectedClass, cycleThroughClasses, classes, playbackKeys,queuePosition  }) {
  const isPlex = ['dash_video'].includes(media.media_type);
  const {
    isDash,
    containerRef,
    seconds,
    timeSinceLastProgressUpdate,
    duration,
    handleProgressClick,
    playbackRate
  } = useCommonMediaController({
    start: media.seconds,
    playbackRate: media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta: media,
    type: isPlex ? 'plex' : 'media',
    selectedClass,
    setSelectedClass,
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
    <div className={`video-player ${selectedClass}`}>
      <h2>
        {heading}
        {playbackRate > 1 ? ` (${playbackRate}×)` : ''}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {seconds === 0 || timeSinceLastProgressUpdate > 1000 && <LoadingOverlay />}
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

export function LoadingOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div
      className="loading-overlay"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
      }}
    >
      <img src={spinner} alt="" />
    </div>
  );
}