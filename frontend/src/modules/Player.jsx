import React, { useRef, useEffect, useState } from 'react';
import './Player.scss';
import 'video.js/dist/video-js.css';
import moment from 'moment';
import videojs from 'video.js';
import 'videojs-hotkeys';
import Scriptures from './Scriptures';
import { DaylightAPI } from '../lib/api.mjs';

export default function Player({ queue, setQueue, advance }) {
  const [{ key, value }] = queue;
  advance = advance || (() => setQueue(queue.slice(1)));
  if (key === 'scripture') return <Scriptures media={value} advance={advance} />;

  const [mediaInfo, setMediaInfo] = useState({});

  useEffect(() => {
    async function fetchVideoInfo() {
      const response = await DaylightAPI(`media/plex/info/${value}/shuffle`);
      setMediaInfo(response);
    }
    fetchVideoInfo();
  }, [value]);

  const props = {
    media: mediaInfo,
    advance: advance,
    start: mediaInfo.start,
    playbackRate: mediaInfo.playbackRate || 2
  };

  return (
    <div className="player">
      {mediaInfo.mediaType === 'video' && <VideoPlayer {...props} />}
      {mediaInfo.mediaType === 'audio' && <AudioPlayer {...props} />}
      {!mediaInfo.mediaType && <div>Loading...</div>}
    </div>
  );
}

function AudioPlayer({ media: { mediaUrl, title, artist, album, img }, advance, start, playbackRate }) {
  const audioRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const { percent } = getProgressPercent(progress, duration);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const handleTimeUpdate = () => setProgress(audioElement.currentTime);
    const handleDurationChange = () => setDuration(audioElement.duration);
    const handleEnded = () => advance();

    audioElement.addEventListener('timeupdate', handleTimeUpdate);
    audioElement.addEventListener('durationchange', handleDurationChange);
    audioElement.addEventListener('ended', handleEnded);

    const handleKeyDown = (event) => {
      const increment = Math.max(5, Math.floor(audioElement.duration / 50));
      if (event.key === 'ArrowRight') {
        audioElement.currentTime = Math.min(audioElement.currentTime + increment, audioElement.duration);
      } else if (event.key === 'ArrowLeft') {
        audioElement.currentTime = Math.max(audioElement.currentTime - increment, 0);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        audioElement.paused ? audioElement.play() : audioElement.pause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      audioElement.removeEventListener('timeupdate', handleTimeUpdate);
      audioElement.removeEventListener('durationchange', handleDurationChange);
      audioElement.removeEventListener('ended', handleEnded);
    };
  }, [advance]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const handleLoadedMetadata = () => {
      if (start) audioElement.currentTime = start;
      if (playbackRate) audioElement.playbackRate = playbackRate;
    };
    audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [start, playbackRate]);

  const handleProgressClick = (event) => {
    const audioElement = audioRef.current;
    if (!audioElement || !duration) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    audioElement.currentTime = (clickX / rect.width) * duration;
  };

  return (
    <div className="audio-player">
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <p>{artist} - {album}</p>
      <p>
        {formatTime(progress)} / {formatTime(duration)}
      </p>
      <div className="image-container">
        <img src={img} alt={title} />
      </div>
      <h2>{title} {playbackRate > 1 ? `(${playbackRate}×)` : ''}</h2>
      <audio
        ref={audioRef}
        autoPlay
        src={mediaUrl}
        onEnded={advance}
        style={{ display: 'none' }}
        controls
      />
    </div>
  );
}

function VideoPlayer({ media: { mediaUrl, title, show, season }, advance }) {
  const videoRef = useRef(null);
  const [player, setPlayer] = useState(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const { percent } = getProgressPercent(progress, duration);

  useEffect(() => {
    if (!videoRef.current) return;
    if (!player) {
      const vjsPlayer = videojs(videoRef.current, {
        controls: true,
        preload: 'auto',
        fluid: false,
        sources: [{ src: mediaUrl, type: 'application/dash+xml' }]
      });

      vjsPlayer.ready(() => {
        if(!vjsPlayer) return false;
        vjsPlayer.hotkeys({
          volumeStep: 0.1,
          seekStep: 5,
          playPauseKey: (event) => {
            if (['Enter', 'Space'].includes(event.key)) {
              return true;
            }
            return false;
          },
        });
        vjsPlayer.on('durationchange', () => setDuration(vjsPlayer.duration()));
        vjsPlayer.playbackRate(2);
        vjsPlayer.on('timeupdate', () => {
          if (!vjsPlayer.paused()) {
            setTimeout(() => setProgress(vjsPlayer.currentTime()), 50);
          }
        });
        vjsPlayer.on('ended', () => advance());
        vjsPlayer.on('error', () => console.error('Video error:', vjsPlayer.error()));
      });

      setPlayer(vjsPlayer);
      vjsPlayer.on('ready', () => vjsPlayer.el().focus());
    } else {
      player.src({ src: mediaUrl, type: 'application/dash+xml' });
    }
    return () => player?.dispose();
  }, [mediaUrl, player, advance]);

  return (
    <div className="video-player">
      <h2>{show} - {season}: {title}</h2>
      <ProgressBar percent={percent} />
      <video
        ref={videoRef}
        className="video-js vjs-big-play-centered"
        autoPlay
        onEnded={advance}
        controls
      />
    </div>
  );
}

function ProgressBar({ percent, onClick }) {
  return (
    <div
      className="progress-bar"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : {}}
    >
      <div className="progress" style={{ width: `${percent}%` }}></div>
    </div>
  );
}

function getProgressPercent(progress, duration) {
  if (!duration || duration === 0) return { percent: '0.0' };
  const percent = ((progress / duration) * 100).toFixed(1);
  return { percent };
}

function formatTime(seconds) {
  return moment.utc(seconds * 1000).format(seconds >= 3600 ? 'HH:mm:ss' : 'mm:ss');
}