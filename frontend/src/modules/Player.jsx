import React, { useRef, useEffect, useState, useCallback } from 'react';
import './Player.scss';
import moment from 'moment';
import Scriptures from './Scriptures';
import Hymn from './Hymns.jsx';
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

  const handleProgressClick = (event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = isVideo
      ? containerRef.current.shadowRoot?.querySelector('video')
      : containerRef.current;
    if (!mediaEl) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    mediaEl.currentTime = (clickX / rect.width) * duration;
  };

  



  useEffect(() => {

 
    
    const handleKeyDown = (event) => {
      const mediaEl = isVideo
        ? containerRef.current?.shadowRoot?.querySelector('video')
        : containerRef.current;
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
    const mediaEl = isVideo
      ? containerRef.current?.shadowRoot?.querySelector('video')
      : containerRef.current;
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
      const startTime = (meta.progress / 100) * mediaEl.duration;
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
    handleProgressClick
  };
}

/*─────────────────────────────────────────────────────────────*/
/*  MAIN PLAYER                                               */
/*─────────────────────────────────────────────────────────────*/
export default function Player({ play, clear }) {
  const [queue, setQueue] = useState(
    Array.isArray(play) ? play.map((item) => ({ ...item, guid: guid() })) : []
  );

  const advance = useCallback(() => {
    queue.length > 1 ? setQueue(queue.slice(1)) : clear();
  }, [queue, clear]);

  if (!Array.isArray(play)) return <SinglePlayer {...play} advance={clear} clear={clear} />;
  if (!queue.length) return null;

  return <SinglePlayer key={queue[0].guid} {...queue[0]} advance={advance} clear={clear} />;
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
  } = play;
  console.log({play});
  // Scripture or Hymn short-circuits
  if (!!scripture)    return <Scriptures {...play} />;
  if (!!hymn)         return <Hymn {...play} />;

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
        const infoResponse = await DaylightAPI(
          `media/info/${media}${shuffle ? "/shuffle" : ""}`
        );
        setMediaInfo({ ...infoResponse, playbackRate: rate || 1 });
        setIsReady(true);
      }
      // TODO: Handle advanced queue logic if needed
    }
    fetchVideoInfo();
  }, [plex, media, shuffle, rate]);

  return (
    <div className="player">
      {!isReady && <Loading media={mediaInfo} />}
      {isReady && mediaInfo.mediaType === "video" && (
        <VideoPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
      {isReady && mediaInfo.mediaType === "audio" && (
        <AudioPlayer media={mediaInfo} advance={advance} clear={clear} />
      )}
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  LOADING                                                   */
/*─────────────────────────────────────────────────────────────*/

function Loading({ media }) {
  const { title, artist, album, img, mediaType } = media || {};
  if (mediaType !== 'audio') return null;
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

  const { mediaUrl, title, artist, album, img } = media;
  const { percent } = getProgressPercent(progress, duration);

  return (
    <div className="audio-player">
      <div className={`shader ${levels[shaderIndex]}`} />
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <p>
        {artist} - {album}
      </p>
      <p>
        {formatTime(progress)} / {formatTime(duration)}
      </p>
      <div className="image-container">
        {img && <img src={img} alt={title} className="cover" />}
      </div>
      <h2>
        {title} {playbackRate > 1 ? `(${playbackRate}×)` : ''}
      </h2>
      <audio ref={containerRef} src={mediaUrl} autoPlay style={{ display: 'none' }} />
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  VIDEO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function VideoPlayer({ media, advance, clear }) {
  const { playbackRate, containerRef, progress, duration, handleProgressClick } = useCommonMediaController({
    start: media.progress,
    playbackRate: media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta:media
  });

  const { show, season, title, mediaUrl } = media;
  const { percent } = getProgressPercent(progress, duration);

  return (
    <div className="video-player">
      <h2>
        {show} - {season}: {title} {playbackRate > 1 ? `(${playbackRate}×)` : ''}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <dash-video ref={containerRef} class={`video-element ${(progress || 0) > 0 && "show"}`} controls src={mediaUrl} />
    </div>
  );
}