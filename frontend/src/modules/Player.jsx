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
  onShaderLevelChange = () => {}
}) {
  const media_key = meta.media_key || meta.key || meta.guid || meta.id || meta.media_url;
  const containerRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastLoggedTimeRef = useRef(0);
  const lastUpdatedTimeRef = useRef(0);
  const [timeSinceLastProgressUpdate, setTimeSinceLastProgressUpdate] = useState(0);

  const classes = Array.isArray(shaders) ? shaders : ['regular', 'minimal', 'night', 'screensaver', 'dark'];
  const [selectedClass, setSelectedClass] = useState(classes[0]);
  const cycleThroughClasses = (upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setSelectedClass((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      return classes[newIndex];
    }
    );
  };


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

  const longPressTimeout = useRef(null);
  const didLongPress = useRef(false);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const mediaEl = getMediaEl();
      if (!mediaEl) return;

      // Ignore repeated keydown events (browser auto-repeat when key is held)
      if (event.repeat) {
        return;
      }

      //advance on tab key
      if (event.key === 'Tab') {
        event.preventDefault();
        onEnd(1);
      }

      // For ArrowRight / ArrowLeft, start a 2s timer
      // If the timer completes, we call onEnd(±1) exactly once
      if (event.key === 'ArrowRight') {
        didLongPress.current = false;
        longPressTimeout.current = setTimeout(() => {
          onEnd(1);
          didLongPress.current = true;
        }, 1000);
      } else if (event.key === 'ArrowLeft') {
        didLongPress.current = false;
        longPressTimeout.current = setTimeout(() => {
          onEnd(-1);
          didLongPress.current = true;
        }, 1000);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        cycleThroughClasses(1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        cycleThroughClasses(-1);
      } else if (['Enter', ' ', 'Space', 'Spacebar', 'MediaPlayPause'].includes(event.key)) {
        event.preventDefault();
        if (mediaEl.paused) {
          mediaEl.play();
        } else {
          mediaEl.pause();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClear();
      }
    };

    const handleKeyUp = (event) => {
      const mediaEl = getMediaEl();
      if (!mediaEl) return;

      if (longPressTimeout.current) {
        clearTimeout(longPressTimeout.current);
        longPressTimeout.current = null;
      }

      // If no long-press happened, do the original skip logic
      if (
        (event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
        !didLongPress.current
      ) {
        const inc = mediaEl.duration
          ? Math.max(5, Math.floor(mediaEl.duration / 50))
          : 5;
        if (event.key === 'ArrowRight') {
          mediaEl.currentTime = Math.min(
            mediaEl.currentTime + inc,
            mediaEl.duration || 0
          );
        } else {
          mediaEl.currentTime = Math.max(mediaEl.currentTime - inc, 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onClear, onEnd, isAudio, isVideo, onShaderLevelChange, duration]);
  
    //make a 50ms loop that sets timeSinceLastProgressUpdate to the difference between now and timeOfLastProgressUpdate
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
      type = type || 'media';
      lastUpdatedTimeRef.current = now;
      const timeSinceLastLog = now - lastLoggedTimeRef.current;
      if (timeSinceLastLog > 10000 && parseFloat(percent) > 0) {
        lastLoggedTimeRef.current = now;
        await DaylightAPI(`media/log`, { title, type, media_key, percent, title });
      }
    };

    const onTimeUpdate = () => {
      setProgress(mediaEl.currentTime);
      const percent = getProgressPercent(mediaEl.currentTime, mediaEl.duration).percent; 
      logTime(type, media_key, percent, meta.title);
    };
    const onDurationChange = () => setDuration(mediaEl.duration);
    const onEnded = () => onEnd();
    const onLoadedMetadata = () => {
      const startTime = mediaEl.duration > 8000 ? mediaEl.duration ? (meta.progress / 100) * mediaEl.duration : 0 : 0;
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
  }, [onEnd, playbackRate, start, isVideo]);

  return {
    containerRef,
    progress,
    duration,
    playbackRate,
    isDash,
    selectedClass,
    timeSinceLastProgressUpdate,
    handleProgressClick
  };
}
function normalizeItem(item) {
  // Make sure item.play exists
  if (!item.play) {
    item.play = {};
  }
  // Move any top-level fields (other than 'queue' and 'play')
  // inside item.play so we have a single, consistent data structure
  for (const [key, value] of Object.entries(item)) {
    if (key !== 'play' && key !== 'queue') {
      item.play[key] = value;
    }
  }
  // Remove queue from the final object
  delete item.queue;
  return item;
}

export async function flattenQueueItems(items, level = 1) {
  console.log('flattenQueueItems START', { level, count: items.length });

  const flattened = [];

  for (const item of items) {
    // If there's a 'queue' key, we need to fetch and recurse
    if (item.queue) {
      // data/list references via 'playlist' or 'queue'
      if (item.queue.playlist || item.queue.queue) {
        const queueKey = item.queue.playlist ?? item.queue.queue;
        const { items: nestedItems } = await DaylightAPI(`data/list/${queueKey}`);
        // Recursively process those nested items
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      }
      // media/plex references via 'plex'
      else if (item.queue.plex) {
        const { items: plexItems } = await DaylightAPI(`media/plex/list/${item.queue.plex}`);
        // Recursively process those nested items
        const nestedFlattened = await flattenQueueItems(plexItems, level + 1);
        flattened.push(...nestedFlattened);
      } 
      // else: no recognized queue type, you could throw or handle differently
    }
    // If there's a 'play' key, it's already a playable item → keep it
    else if (item.play) {
      flattened.push(item);
    } 
    // Otherwise (no queue, no play): optional fallback
    else {
      // Decide if you want to push it or skip it.  
      // For safety, push as-is:
      flattened.push(item);
    }
  }

  return flattened.filter(item => item?.active !== false);
}


/*─────────────────────────────────────────────────────────────*/
/*  MAIN PLAYER                                               */
/*─────────────────────────────────────────────────────────────*/
export default function Player({ play, queue, clear }) {


  const isQueue = !!queue  || play && (play.playlist || play.queue) || Array.isArray(play);
  const [isContinuous, setIsContinuous] = useState(false);  
  const [playQueue, setQueue] = useState([]);
  useEffect(() => {
    async function initQueue() {
      // Case 1: Already an array of "play" items
      if (Array.isArray(play)) {
        setQueue(play.map(item => ({ ...item, guid: guid() })));
        return;
      }
      // Case 2: Already an array of "queue" items
      if (Array.isArray(queue)) {
        setQueue(queue.map(item => ({ ...item, guid: guid() })));
        return;
      }

      // Case 3: We might have an object with playlist/queue/plex references
      if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        // Example: data/list
        if (play?.playlist || play?.queue || queue?.playlist || queue?.queue) {
          const queue_media_key = play?.playlist || play?.queue || queue?.playlist || queue?.queue;
          const { items, continuous, volume } = await DaylightAPI(`data/list/${queue_media_key}`);
          setIsContinuous(continuous || false);

          // Flatten any nested queues inside the items
          const flattened = await flattenQueueItems(items);
          setQueue(flattened.map(item => ({ ...item,...item.play, guid: guid() })));
          return;
        }
        // Example: media/plex/list
        if (queue?.plex) {
          const { items, continuous, volume } = await DaylightAPI(`media/plex/list/${queue.plex}`);
          setIsContinuous(continuous || false);

          // Flatten any nested queues inside the items
          const flattened = await flattenQueueItems(items);
          setQueue(flattened.map(item => ({ ...item,...item.play, guid: guid() })));
          return;
        }
      }
      // Default/fallback
      setQueue([]);
    }

    initQueue();
  }, [play, queue]);

  const advance = useCallback((step = 1) => {
    setQueue((prevQueue) => {
      if (prevQueue.length > 1) {
        const currentIndex = isContinuous
          ? (prevQueue.length + step) % prevQueue.length
          : Math.min(Math.max(0, step), prevQueue.length - 1);

        if (isContinuous) {
          const rotatedQueue = [...prevQueue.slice(currentIndex), ...prevQueue.slice(0, currentIndex)];
          return rotatedQueue;
        }
        
        const newQueue =  prevQueue.slice(currentIndex);
       // console.log({newQueue})
        return newQueue;
      }
      clear();
      return [];
    });
  }, [clear, isContinuous]);

  //enable escape key to clear
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


  if(isQueue && playQueue?.length > 1) return <SinglePlayer key={playQueue[0].guid} {...playQueue[0]} advance={advance} clear={clear} />
  if (isQueue && playQueue?.length === 1) return <SinglePlayer key={playQueue[0].guid} {...playQueue[0]} advance={advance} clear={clear} />;
  if (play && !Array.isArray(play)) return <SinglePlayer {...play} advance={clear} clear={clear} />;
  return <div className={`shader on queuer`} >
    <LoadingOverlay />
    </div>

}


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
    clear
  } =  play || {};
  

  // Scripture or Hymn short-circuits
  if (!!scripture)    return <Scriptures {...play} />;
  if (!!hymn)         return <Hymns {...play} />;
  if(!!talk)         return <Talk {...play} />;

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);

  useEffect(() => {
    async function fetchVideoInfo() {
      if (!!plex) {
        //const plex = subPlay?.plex || plex;
        const infoResponse = await DaylightAPI(
          `media/plex/info/${plex}`
        );
        setMediaInfo({ ...infoResponse, playbackRate: rate || 1 });
        setIsReady(true);
      } else if (!!media) {
        const infoResponse = await DaylightAPI(  `media/info/${media}`);
        setMediaInfo({ ...infoResponse, playbackRate: rate || 1 });
        setIsReady(true);
      }
      else if(!!open) {
        setGoToApp(open);
      }
    }
    fetchVideoInfo();
  }, [plex, media, shuffle, rate]);

  if(goToApp) return <AppContainer open={goToApp} clear={clear} />;

  return (
    <div className="player">
      {!isReady && <div className="shader on notReady" ><LoadingOverlay /></div>}
      {isReady && mediaInfo.media_type === "dash_video" && (
        <VideoPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
      {isReady && mediaInfo.media_type === "video" && (
        <VideoPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
      {isReady && mediaInfo.media_type === "audio" && (
        <AudioPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  LOADING                                                   */
/*─────────────────────────────────────────────────────────────*/


/*─────────────────────────────────────────────────────────────*/
/*  AUDIO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function AudioPlayer({ media, advance, clear }) {


  const { media_url, title, artist, album, image, type } = media;

  const { selectedClass, timeSinceLastProgressUpdate, playbackRate, containerRef, progress, duration, handleProgressClick } = useCommonMediaController({
    start: media.progress,
    playbackRate: media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: true,
    isVideo: false,
    meta: media,
    type: ["track"].includes(type) ? "plex" : "media",
  });

  const { percent } = getProgressPercent(progress, duration);

  const header = !!artist &&  !!album ? `${artist} - ${album}` : !!artist ? artist : !!album ? album : media_url;

  const shaderState = progress < 0.1  || progress > duration - 2 ? 'on' : 'off';

  return (
    <div className={`audio-player ${selectedClass}`}>
    <div className={`shader ${shaderState}`} />
      {progress > 2 && timeSinceLastProgressUpdate > 1000 && <LoadingOverlay />}
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <p>
        {header}
      </p>
      <p>
        {formatTime(progress)} / {formatTime(duration)}
      </p>

      <div className="image-container">
        {image && <img src={image} alt={title} className="cover" />}
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
function VideoPlayer({ media, advance, clear }) {
  const isPlex = ["dash_video"].includes(media.media_type);
  const {
    isDash,
    selectedClass,
    containerRef,
    progress,
    timeSinceLastProgressUpdate,
    duration,
    handleProgressClick,
    playbackRate,
  } = useCommonMediaController({
    start: media.progress,
    playbackRate: media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta: media,
    selectedClass: media.selectedClass,
    type: isPlex ? "plex" : "media",
  });


  const { show, season, title, media_url } = media;
  const { percent } = getProgressPercent(progress, duration);

  const heading =
    !!show && !!season && !!title
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
        {playbackRate > 1 ? ` (${playbackRate}×)` : ""}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      {progress ===0 ||timeSinceLastProgressUpdate > 1000 && <LoadingOverlay />}
      {isDash ? (
        <dash-video
          ref={containerRef}
          class={`video-element ${(progress || 0) > 0 && "show"}`}
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