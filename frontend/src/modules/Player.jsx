import React, { useState, useRef, useEffect } from 'react';
import './Player.scss';
import moment from 'moment';
import Scriptures from './Scriptures';
import { DaylightAPI } from '../lib/api.mjs';
import 'dash-video-element';
import spinner from '../assets/icons/spinner.svg';

/*─────────────────────────────────────────────────────────────*/
/*  CUSTOM HOOKS                                              */
/*─────────────────────────────────────────────────────────────*/

/**
 * A reusable hook to track media progress and duration.
 * It returns { progress, duration, setProgress, setDuration } so that each player can update UI accordingly.
 */
function useMediaProgress() {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  return { progress, duration, setProgress, setDuration };
}

/**
 * A reusable hook to handle events common to both audio and video:
 * - time updates
 * - duration changes
 * - ended
 * - loadedmetadata (for setting initial currentTime, playbackRate, etc.)
 */
function useMediaEvents(playerRef, { start, playbackRate = 1, onEnded }) {
  const { setProgress, setDuration } = useMediaProgress(); // not used directly here

  // Because we only want the event listeners set up once, we use another approach:
  // We'll return a function to let the caller bind to the "progress" and "duration" states.
  // This is so we can keep all the addEventListener logic in a single place.
  useEffect(() => {
    if (!playerRef.current) return;

    // We will rely on the caller to reference these events from the actual parent code.
    const player = playerRef.current;
    const handleTimeUpdate = () => {
      // handled externally
    };
    const handleDurationChange = () => {
      // handled externally
    };
    const handleEnded = () => {
      onEnded && onEnded();
    };
    const handleLoadedMetadata = () => {
      if (typeof start === 'number') {
        player.currentTime = start;
      }
      player.playbackRate = playbackRate;
    };

    player.addEventListener('timeupdate', handleTimeUpdate);
    player.addEventListener('durationchange', handleDurationChange);
    player.addEventListener('ended', handleEnded);
    player.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      player.removeEventListener('timeupdate', handleTimeUpdate);
      player.removeEventListener('durationchange', handleDurationChange);
      player.removeEventListener('ended', handleEnded);
      player.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [playerRef, onEnded, playbackRate, start]);
}

/**
 * A reusable hook for keyboard controls common to both audio and video:
 * - ArrowLeft, ArrowRight for seeking
 * - Escape for clearing
 * - Enter/Space for toggling play/pause
 */
function useCommonKeyControls(playerRef, { onClear, onPauseToggle }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      const player = playerRef.current;
      if (!player) return;

      const increment = player.duration ? Math.max(5, Math.floor(player.duration / 50)) : 5;
      switch (event.key) {
        case 'ArrowRight':
          player.currentTime = Math.min(player.currentTime + increment, player.duration || 0);
          break;
        case 'ArrowLeft':
          player.currentTime = Math.max(player.currentTime - increment, 0);
          break;
        case 'Enter':
        case ' ':
        case 'Space':
        case 'Spacebar':
        case 'MediaPlayPause':
          event.preventDefault();
          onPauseToggle && onPauseToggle();
          break;
        case 'Escape':
          event.preventDefault();
          onClear && onClear();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [playerRef, onClear, onPauseToggle]);
}

/*─────────────────────────────────────────────────────────────*/
/*  UTILITY FUNCTIONS                                         */
/*─────────────────────────────────────────────────────────────*/

function getProgressPercent(progress, duration) {
  if (!duration || duration === 0) return { percent: 0 };
  const percent = ((progress / duration) * 100).toFixed(1);
  return { percent };
}

function formatTime(seconds) {
  return moment.utc(seconds * 1000).format(seconds >= 3600 ? 'HH:mm:ss' : 'mm:ss').replace(/^0(\d+)/, '$1');
}

/*─────────────────────────────────────────────────────────────*/
/*  PLAYER COMPONENT                                          */
/*─────────────────────────────────────────────────────────────*/

export default function Player({ queue, setQueue, advance, clear }) {
  // If "advance" wasn't passed, default to clearing or removing the first item
  advance = advance || clear || (() => {});
  clear = clear || advance || (() => setQueue([]));

  // Destructure the first item in the queue
  const [{ key, value }] = queue;
  // Fallback for advancing
  advance = advance || (() => setQueue(queue.slice(1)));

  // Scripture mode
  if (key === 'scripture') {
    return <Scriptures media={value} advance={advance} />;
  }

  // Otherwise, let's load media info
  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function fetchVideoInfo() {
      const plexId = value?.plexId || value;
      const infoResponse = await DaylightAPI(`media/plex/info/${plexId}/shuffle`);
      setMediaInfo(infoResponse);
      // Optionally check status:
      // const status = await DaylightStatusCheck(`media/plex/play/${plexId}`);
      setIsReady(true); // Could set conditionally based on status
    }
    fetchVideoInfo();
  }, [value]);

  const props = {
    media: mediaInfo,
    isReady,
    advance,
    clear,
    start: mediaInfo.start,
    playbackRate: mediaInfo.playbackRate || 2
  };

  return (
    <div className="player">
      {!isReady && <Loading media={mediaInfo} />}
      {isReady && mediaInfo.mediaType === 'video' && <VideoPlayer {...props} />}
      {isReady && mediaInfo.mediaType === 'audio' && <AudioPlayer {...props} />}
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  LOADING                                                   */
/*─────────────────────────────────────────────────────────────*/

function Loading({ media }) {
  const { title, artist, album, img, mediaType } = media || {};

  if (mediaType === 'audio') {
    return (
      <div className="audio-player" style={{ opacity: 0.5 }}>
        <div className="shader off" />
        <ProgressBar percent={0} />
        <p>{artist} - {album}</p>
        <p>Loading...</p>
        <div className="image-container">
          <img src={spinner} alt="Loading..." className="loading" />
          {img && <img src={img} alt={title} className="cover" />}
        </div>
        <h2>{title}</h2>
      </div>
    );
  }
  return null;
}

/*─────────────────────────────────────────────────────────────*/
/*  AUDIO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function AudioPlayer({ media, advance, start, playbackRate, clear }) {
  const audioRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  // The "shader" logic is specific to audio.
  const levels = ['full', 'high', 'medium', 'low', 'off', 'low', 'medium', 'high', 'full'];
  const [shaderIndex, setShaderIndex] = useState(levels.indexOf('off'));
  const shaderLevel = levels[shaderIndex];

  // Common events
  useMediaEvents(audioRef, {
    start,
    playbackRate,
    onEnded: advance,
  });

  // Common keyboard controls, plus audio‐specific arrowUp/arrowDown
  useEffect(() => {
    const handleKeyDown = (event) => {
      const audio = audioRef.current;
      if (!audio) return;

      const increment = audio.duration ? Math.max(5, Math.floor(audio.duration / 50)) : 5;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setShaderIndex((prev) => ((prev + 1) % levels.length));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setShaderIndex((prev) => ((prev - 1 + levels.length) % levels.length));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [levels.length]);

  // Use the common key controls for pause/play, left/right, escape
  useCommonKeyControls(audioRef, {
    onClear: clear,
    onPauseToggle: () => {
      const audio = audioRef.current;
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
    }
  });

  // Local progress/timeupdate
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setProgress(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
    };
  }, []);

  const handleProgressClick = (evt) => {
    if (!duration) return;
    const rect = evt.target.getBoundingClientRect();
    const clickX = evt.clientX - rect.left;
    audioRef.current.currentTime = (clickX / rect.width) * duration;
  };

  const { percent } = getProgressPercent(progress, duration);
  const { mediaUrl, title, artist, album, img } = media;

  return (
    <div className="audio-player">
      <div className={`shader ${shaderLevel}`} />
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <p>{artist} - {album}</p>
      <p>
        {formatTime(progress)} / {formatTime(duration)}
      </p>
      <div className="image-container">
        {img && <img src={img} alt={title} className="cover" />}
      </div>
      <h2>{title} {playbackRate > 1 ? `(${playbackRate}×)` : ''}</h2>
      <audio
        ref={audioRef}
        autoPlay
        src={mediaUrl}
        style={{ display: 'none' }}
      />
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  VIDEO PLAYER                                              */
/*─────────────────────────────────────────────────────────────*/

function VideoPlayer({ media, advance, clear }) {
  const videoContainerRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  // Because we're using dash-video-element, the actual <video> is inside a Shadow DOM.
  // We'll get the <video> element via querySelector('video').
  useEffect(() => {
    const dashEl = videoContainerRef.current;
    if (!dashEl) return;

    const videoEl = dashEl.shadowRoot?.querySelector('video');
    if (!videoEl) return;

    // Autoplay, no controls, double speed
    videoEl.autoplay = true;
    videoEl.controls = false;
    videoEl.playbackRate = 2;

    const handleTimeUpdate = () => {
      setProgress(videoEl.currentTime);
      setDuration(videoEl.duration);
    };
    const handleDurationChange = () => {
      setDuration(videoEl.duration);
    };
    const handleEnded = () => advance();
    const handleLoadedMetadata = () => {
      setDuration(videoEl.duration || 0);
    };

    videoEl.addEventListener('timeupdate', handleTimeUpdate);
    videoEl.addEventListener('durationchange', handleDurationChange);
    videoEl.addEventListener('ended', handleEnded);
    videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      videoEl.removeEventListener('timeupdate', handleTimeUpdate);
      videoEl.removeEventListener('durationchange', handleDurationChange);
      videoEl.removeEventListener('ended', handleEnded);
      videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [advance]);

  // Common key controls in the video
  useCommonKeyControls(videoContainerRef, {
    onClear: clear,
    onPauseToggle: () => {
      const videoEl = videoContainerRef.current?.shadowRoot?.querySelector('video');
      if (!videoEl) return;
      if (videoEl.paused) {
        videoEl.play();
      } else {
        videoEl.pause();
      }
    }
  });

  const seekTo = (event) => {
    const videoEl = videoContainerRef.current?.shadowRoot?.querySelector('video');
    if (!videoEl || !duration) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    videoEl.currentTime = (clickX / rect.width) * duration;
  };

  const { show, season, title, mediaUrl } = media;
  const { percent } = getProgressPercent(progress, duration);

  return (
    <div className="video-player">
      <h2>
        {show} - {season}: {title}
      </h2>
      <ProgressBar percent={percent} onClick={seekTo} />
      <dash-video
        ref={videoContainerRef}
        class="video-element"
        controls
        src={mediaUrl}
      />
    </div>
  );
}

/*─────────────────────────────────────────────────────────────*/
/*  PROGRESS BAR                                              */
/*─────────────────────────────────────────────────────────────*/

function ProgressBar({ percent = 0, onClick }) {
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
