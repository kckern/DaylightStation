import React, { useRef, useEffect, useState, useCallback } from 'react';
import './Player.scss';
import moment from 'moment';
import {Scriptures,Hymns} from './ContentScroller.jsx';
import { DaylightAPI } from '../lib/api.mjs';
import 'dash-video-element';
import spinner from '../assets/icons/spinner.svg';

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
  onShaderLevelChange = () => {}
}) {
  const containerRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastLoggedTimeRef = useRef(0);


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
    
    const handleKeyDown = (event) => {
      const mediaEl = getMediaEl();
      if (!mediaEl) return;
      const inc = mediaEl.duration ? Math.max(5, Math.floor(mediaEl.duration / 50)) : 5;
      if (event.key === 'ArrowRight') {
        mediaEl.currentTime = Math.min(mediaEl.currentTime + inc, mediaEl.duration || 0);
      } else if (event.key === 'ArrowLeft') {
        mediaEl.currentTime = Math.max(mediaEl.currentTime - inc, 0);
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
      } else if (isAudio && event.key === 'ArrowUp') {
        event.preventDefault();
        onShaderLevelChange(1);
      } else if (isAudio && event.key === 'ArrowDown') {
        event.preventDefault();
        onShaderLevelChange(-1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClear, isAudio, isVideo, onShaderLevelChange, duration]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return;

    const logTime = async (type, id, percent, title) => {
      const now = Date.now();
      const timeSinceLastLog = now - lastLoggedTimeRef.current;
      if (timeSinceLastLog > 10000 && parseFloat(percent) > 0) {
        lastLoggedTimeRef.current = now;
        await DaylightAPI(`media/log`, { title, type, id, percent, title });
      }
    };

    const onTimeUpdate = () => {
      setProgress(mediaEl.currentTime);
      const percent = getProgressPercent(mediaEl.currentTime, mediaEl.duration).percent;
      logTime('plex', meta.key, percent, meta.title);
    };
    const onDurationChange = () => setDuration(mediaEl.duration);
    const onEnded = () => onEnd();
    const onLoadedMetadata = () => {
      const startTime = mediaEl.duration ? (meta.progress / 100) * mediaEl.duration : 0;
      mediaEl.dataset.key = meta.key;
      mediaEl.currentTime = startTime;
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
    handleProgressClick
  };
}

/*─────────────────────────────────────────────────────────────*/
/*  MAIN PLAYER                                               */
/*─────────────────────────────────────────────────────────────*/
export default function Player({ play, queue, clear }) {

  const [playQueue, setQueue] = useState(() => {
    if (Array.isArray(queue)) return queue.map((item) => ({ ...item, guid: guid() }));
    if (Array.isArray(play)) return play.map((item) => ({ ...item, guid: guid() }));
    if (queue && typeof queue === 'object') {
      (async () => {
        //CASE 1: queue is an object with a playlist key
        if(queue.playlist) {
          const {items} = await DaylightAPI(`data/list/${queue.playlist}`);
          setQueue(items.map((item) => ({ ...item.play, guid: guid() })));
        }
        //CASE 2: queue is an object with a plex key
      })();
      return [];
    } 
    if(Array.isArray(queue)) {
      //CASE 3: queue is an array of objects, no fetch needed
      return queue.map((item) => ({ ...item, guid: guid() }));
    }
    return [];
  });


  const advance = useCallback(() => {
    setQueue((prevQueue) => (prevQueue.length > 1 ? prevQueue.slice(1) : (clear(), [])));
  }, [clear]);

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

  if (play && !Array.isArray(play)) return <SinglePlayer {...play} advance={clear} clear={clear} />;
  if (!playQueue?.length) return <div>Loading Queue....</div>
  return <SinglePlayer key={playQueue[0].guid} {...playQueue[0]} advance={advance} clear={clear} />;
}


export function SinglePlayer(play) {
  const {
    plex,
    media,
    hymn,
    scripture,
    shuffle,
    rate,
    advance,
    clear
  } =  play || {};


  // Scripture or Hymn short-circuits
  if (!!scripture)    return <Scriptures {...play} />;
  if (!!hymn)         return <Hymns {...play} />;

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function fetchVideoInfo() {
      if (!!plex) {
        const infoResponse = await DaylightAPI(
          `media/plex/info/${plex}${shuffle ? "/shuffle" : ""}`
        );
        setMediaInfo({ ...infoResponse, playbackRate: rate || 1 });
        setIsReady(true);
      } else if (!!media) {
        const infoResponse = await DaylightAPI(  `media/info/${media}`);
        console.log("infoResponse", infoResponse);
        setMediaInfo({ ...infoResponse, playbackRate: rate || 1 });
        setIsReady(true);
      }
    }
    fetchVideoInfo();
  }, [plex, media, shuffle, rate]);

  return (
    <div className="player">
      {!isReady && <Loading media={mediaInfo} />}
      {isReady && mediaInfo.media_type === "dash_video" && (
        <VideoPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
      {isReady && mediaInfo.media_type === "video" && (
        <VideoPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
      {isReady && mediaInfo.media_type === "audio" && (
        <AudioPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
      {isReady && !["dash_video", "video", "audio"].includes(mediaInfo.media_type) && (
        <div className="unsupported-media">
          <p>Unsupported media type</p>
        </div>
      )}
      
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  LOADING                                                   */
/*─────────────────────────────────────────────────────────────*/

function Loading({ media }) {
  const { title, artist, album, img, media_type } = media || {};
  if (media_type !== 'audio') return null;
  return (
    <div className="audio-player" style={{ opacity: 0.5 }}>
      <div className="shader off" />
      <ProgressBar percent={0} />
      <p>
        {artist} - {album}
      </p>
      <p>Loading...</p>
      <div className="image-container">
        <img src={spinner} alt="Loading..." className="loading" />
        {img && <img src={img} alt={title} className="cover" />}
      </div>
      <h2>{title}</h2>
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  AUDIO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function AudioPlayer({ media, advance, clear }) {
  const [shaderIndex, setShaderIndex] = useState(4);
  const levels = ['full', 'high', 'medium', 'low', 'off', 'low', 'medium', 'high', 'full'];
  const onShaderLevelChange = (step) => {
    setShaderIndex((prev) => (prev + step + levels.length) % levels.length);
  };

  const { playbackRate, containerRef, progress, duration, handleProgressClick } = useCommonMediaController({
    start: media.progress,
    playbackRate: media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: true,
    isVideo: false,
    meta: media,
    onShaderLevelChange
  });

  const { media_url, title, artist, album, image } = media;
  const { percent } = getProgressPercent(progress, duration);

  const header = !!artist &&  !!album ? `${artist} - ${album}` : !!artist ? artist : !!album ? album : media_url;

  return (
    <div className="audio-player">
      <div className={`shader ${levels[shaderIndex]}`} />
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
  const {
    isDash,
    containerRef,
    progress,
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
  });

  const { show, season, title, media_url } = media;
  const { percent } = getProgressPercent(progress, duration);

  return (
    <div className="video-player">
      <h2>
        {isDash ? "Dash" : "No Dash"} {show} - {season}: {title}
        {playbackRate > 1 ? ` (${playbackRate}×)` : ""}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
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