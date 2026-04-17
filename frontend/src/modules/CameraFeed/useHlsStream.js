// frontend/src/modules/CameraFeed/useHlsStream.js
import { useState, useEffect } from 'react';
import Hls from 'hls.js';

/**
 * Attach an HLS live stream to a video element.
 *
 * @param {string} cameraId
 * @param {React.RefObject<HTMLVideoElement>} videoRef
 * @param {object} logger - child logger instance
 * @returns {{ ready: boolean, videoSize: {w:number, h:number} }}
 */
export default function useHlsStream(cameraId, videoRef, logger) {
  const [ready, setReady] = useState(false);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraId) return;
    setReady(false);

    const playlistUrl = `/api/v1/camera/${cameraId}/live/stream.m3u8`;
    logger?.info?.('hls.start', { url: playlistUrl });

    const onPlaying = () => {
      setReady(true);
      logger?.info?.('hls.playing');
    };

    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoSize({ w: video.videoWidth, h: video.videoHeight });
      }
    };

    // Native HLS (Safari)
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playlistUrl;
        video.play().catch(() => {});
        video.addEventListener('playing', onPlaying, { once: true });
        video.addEventListener('loadedmetadata', onMeta, { once: true });
        return () => {
          video.removeEventListener('playing', onPlaying);
          video.removeEventListener('loadedmetadata', onMeta);
          video.src = '';
          fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
        };
      }
      logger?.error?.('hls.unsupported');
      return;
    }

    // hls.js
    const hls = new Hls({
      enableWorker: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 3,
    });

    hls.loadSource(playlistUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (event, data) => {
      logger?.warn?.('hls.error', { type: data.type, details: data.details, fatal: data.fatal });
    });

    video.addEventListener('playing', onPlaying, { once: true });
    video.addEventListener('loadedmetadata', onMeta, { once: true });

    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('loadedmetadata', onMeta);
      hls.destroy();
      fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
      logger?.info?.('hls.stop');
    };
  }, [cameraId, videoRef, logger]);

  return { ready, videoSize };
}
