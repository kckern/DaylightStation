import React, { useRef, useEffect, useState } from 'react';
import './Player.scss';
import 'video.js/dist/video-js.css';

import videojs from 'video.js';

import Scriptures from './Scriptures';
import { DaylightAPI } from '../lib/api.mjs';

export default function Player({ queue, setQueue }) {
    const [{ key, value }] = queue;
    const advance = () => setQueue(queue.slice(1));
    if (key === 'scripture') return <Scriptures media={value} advance={advance} />;
    const [mediaInfo, setMediaInfo] = useState({});
    useEffect(() => {
        async function fetchVideoInfo() {
            const response = await DaylightAPI(`media/plex/info/${value}/shuffle`); //handle other media types
            setMediaInfo(response);
        }
        fetchVideoInfo();
    }, [value]);

    return (
        <div className="player" >
            {mediaInfo.mediaType === 'video' && <VideoPlayer media={mediaInfo} advance={advance} />}
            {mediaInfo.mediaType === 'audio' && <AudioPlayer media={mediaInfo} advance={advance} />}
            {!mediaInfo.mediaType && <div>Loading...</div>}
        </div>
    );
}

function AudioPlayer({ media: { mediaUrl, title, artist, album, img }, advance }) {
    const audioRef = useRef(null);
    const [player, setPlayer] = useState(null);

    return (
        <div className="audio-player">
            <p>{artist} - {album}</p>
        <div className="image-container">
            <img src={img} alt={title} />
        </div>
            <h2>{title}</h2>
            <audio
                ref={audioRef}
                autoPlay
                src={mediaUrl}
                onEnded={advance}
                style={{ width: '100%' }}
                controls={true}
            />
        </div>
    );
}


function VideoPlayer({ media:{mediaUrl,title, show, season}, advance }) {
    const videoRef = useRef(null);
    const [player, setPlayer] = useState(null);

    useEffect(() => {
        if (videoRef.current) {
            if (!player) {
                const vjsPlayer = videojs(videoRef.current, {
                    controls: true,
                    preload: 'auto',
                    fluid: false,
                    sources: [{ src: mediaUrl, type: 'application/dash+xml' }]
                });
                setPlayer(vjsPlayer);
            } else {
                player.src({ src: mediaUrl, type: 'application/dash+xml' });
            }
        }
        return () => player?.dispose();
    }, [mediaUrl]);
    return (
        <div className="video-player">
            <h2>{show} - {season}: {title}</h2>
            <video
                ref={videoRef}
                className="video-js vjs-big-play-centered"
                autoPlay
                onEnded={advance}
                controls={false}
            />
        </div>
    );
}