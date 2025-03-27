
import React, { useRef, useEffect, useState } from 'react';
import './Player.scss';
import 'video.js/dist/video-js.css';

import videojs from 'video.js';
// If you need DASH support, also import the DASH plugin:
// import 'videojs-contrib-dash';

import Scriptures from './Scriptures';
import { DaylightPlexPath } from '../lib/api.mjs';

export default function Player({ queue, setQueue }) {
  const [{ key, value }] = queue;
  const advance = () => setQueue(queue.slice(1));
  if (key === 'scripture') return <Scriptures media={value} advance={advance} />;

    const url = DaylightPlexPath(value);
    const videoRef = useRef(null);
    const [player, setPlayer] = useState(null);
    useEffect(() => {
        const videoElement = videoRef.current;
        if (videoElement) {
            if (!player) {
                const vjsPlayer = videojs(videoElement, {
                    controls: true,
                    autoplay: false,
                    preload: 'auto',
                    fluid: true,
                    sources: [{ src: url, type: 'application/dash+xml' }]
                });
                setPlayer(vjsPlayer);
            } else {
                player.src({ src: url, type: 'application/dash+xml' });
            }
        }
        return () => player?.dispose();
    }, [player, url]);

return ( <div className="player" style={{ width: '100%', height: '100%' }}>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          autoPlay
          onEnded={advance}
          controls={false}
        />
    </div> );
}