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
            const response = await DaylightAPI(`media/plex/info/${value}/shuffle`); //handle other media types
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
        <div className="player" >
            {mediaInfo.mediaType === 'video' && <VideoPlayer {...props} />}
            {mediaInfo.mediaType === 'audio' && <AudioPlayer {...props} />}
            {!mediaInfo.mediaType && <div>Loading...</div>}
        </div>
    );
}

function AudioPlayer({ media: { mediaUrl, title, artist, album, img }, advance, start, playbackRate }) {
    const audioRef = useRef(null);
    const [player, setPlayer] = useState(null);

    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const percent = duration > 0 ? ((progress / duration) * 100).toFixed(1) : "0.0";

    useEffect(() => {
        if (audioRef.current) {
            const audioElement = audioRef.current;

            const handleTimeUpdate = () => {
                setProgress(audioElement.currentTime);
            };

            const handleDurationChange = () => {
                setDuration(audioElement.duration);
            };

            const handleEnded = () => {
                advance();
            };

            audioElement.addEventListener('timeupdate', handleTimeUpdate);
            audioElement.addEventListener('durationchange', handleDurationChange);
            audioElement.addEventListener('ended', handleEnded);

            // Add keyboard shortcuts for seeking
            const handleKeyDown = (event) => {
                const increment = Math.max( 5, Math.floor(audioElement.duration / 50));
                if (event.key === 'ArrowRight') {
                    audioElement.currentTime = Math.min(audioElement.currentTime + increment, audioElement.duration);
                } else if (event.key === 'ArrowLeft') {
                    audioElement.currentTime = Math.max(audioElement.currentTime - increment, 0);
                }
            };

            window.addEventListener('keydown', handleKeyDown);

            setPlayer(audioElement);

            return () => {
                audioElement.removeEventListener('timeupdate', handleTimeUpdate);
                audioElement.removeEventListener('durationchange', handleDurationChange);
                audioElement.removeEventListener('ended', handleEnded);
                window.removeEventListener('keydown', handleKeyDown);
            };
        }
    }, [audioRef, advance]);

    const handleProgressClick = (event) => {
        if (audioRef.current && duration > 0) {
            const rect = event.target.getBoundingClientRect();
            const clickX = event.clientX - rect.left;
            const newTime = (clickX / rect.width) * duration;
            audioRef.current.currentTime = newTime;
        }
    };

    useEffect(() => {
        if (audioRef.current) {
            const audioElement = audioRef.current;

            const handleLoadedMetadata = () => {
                if (start) {
                    audioElement.currentTime = start;
                }
                if (playbackRate) {
                    audioElement.playbackRate = playbackRate;
                }
            };

            audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);

            return () => {
                audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
            };
        }
    }, [start, playbackRate]);

    return (
        <div className="audio-player">
            <div className="progress-bar" onClick={handleProgressClick} style={{ cursor: 'pointer' }}>
                <div className="progress" style={{ width: `${percent}%` }}></div>
            </div>
            <p>{artist} - {album}</p>
            <p>
                {moment.utc(progress * 1000).format(progress >= 3600 ? 'HH:mm:ss' : 'mm:ss')}
                {' / '} 
                {moment.utc(duration * 1000).format(duration >= 3600 ? 'HH:mm:ss' : 'mm:ss')}
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
                controls={true}
            />
        </div>
    );
}


function VideoPlayer({ media: { mediaUrl, title, show, season }, advance }) {
    const videoRef = useRef(null);
    const [player, setPlayer] = useState(null);

    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const percent = duration > 0 ? ((progress / duration) * 100).toFixed(1) : "0.0";

    useEffect(() => {
        if (videoRef.current) {
            if (!player) {
                const vjsPlayer = videojs(videoRef.current, {
                    controls: true,
                    preload: 'auto',
                    fluid: false,
                    sources: [{ src: mediaUrl, type: 'application/dash+xml' }]
                });

                // Add custom keyboard shortcuts for seeking
                vjsPlayer.ready(() => {
                    vjsPlayer.hotkeys({
                        volumeStep: 0.1,
                        seekStep: 5,
                        enableModifiersForNumbers: false,
                    });
                    vjsPlayer.on('durationchange', () => {
                        setDuration(vjsPlayer.duration());
                    }
                    );
                    vjsPlayer.playbackRate(2);
                    vjsPlayer.on('timeupdate', () => {
                        if (!vjsPlayer.paused()) {
                            setTimeout(() => {
                                setProgress(vjsPlayer.currentTime());
                            }, 50);
                        }
                    });
                    vjsPlayer.on('ended', () => {
                        advance();
                    });
                    vjsPlayer.on('error', () => {
                        console.error('Video error:', vjsPlayer.error());
                    });
                });

                setPlayer(vjsPlayer);
                //focus on the video player
                vjsPlayer.on('ready', () => {
                    vjsPlayer.el().focus();
                });

            } else {
                player.src({ src: mediaUrl, type: 'application/dash+xml' });
            }
        }
        return () => player?.dispose();
    }, [mediaUrl]);

    return (
        <div className="video-player">
            <h2>{show} - {season}: {title}</h2>
            <div className="progress-bar">
                <div className="progress" style={{ width: `${percent}%` }}></div>
            </div>
            <video
                ref={videoRef}
                className="video-js vjs-big-play-centered"
                autoPlay
                onEnded={advance}
                controls={true}
            />
        </div>
    );
}