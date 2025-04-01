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
            const response = await DaylightAPI(`media/plex/info/${value}`); //handle other media types
            setMediaInfo(response);
        }
        fetchVideoInfo();
    }, [value]);

    return (
        <div className="player" >
            {mediaInfo.mediaType === 'video' && <VideoPlayer media={mediaInfo.mediaUrl} advance={advance} />}
            {mediaInfo.mediaType === 'audio' && <AudioPlayer media={mediaInfo.mediaUrl} advance={advance} />}
            <pre>{JSON.stringify(mediaInfo, null, 2)}</pre>
        </div>
    );
}

function AudioPlayer({ media, advance }) {
    const audioRef = useRef(null);
    const [player, setPlayer] = useState(null);

    return (<audio
                ref={audioRef}
                autoPlay
                src={media}
                onEnded={advance}
                style={{ width: '100%' }}
                controls={true}
            />
    );
}


function VideoPlayer({ media, advance }) {
    const videoRef = useRef(null);
    const [player, setPlayer] = useState(null);

    useEffect(() => {
        if (videoRef.current) {
            if (!player) {
                const vjsPlayer = videojs(videoRef.current, {
                    controls: true,
                    autoplay: false,
                    preload: 'auto',
                    fluid: true,
                    sources: [{ src: media, type: 'application/dash+xml' }]
                });
                setPlayer(vjsPlayer);
            } else {
                player.src({ src: media, type: 'application/dash+xml' });
            }
        }
        return () => player?.dispose();
    }, [media]);
    return (
        <div className="video-player">
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