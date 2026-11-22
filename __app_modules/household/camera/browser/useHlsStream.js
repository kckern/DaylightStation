// frontend/src/modules/CameraFeed/useHlsStream.js
import { useState, useEffect } from 'react';
import Hls from 'hls.js';

const EMPTY_SIZE = { w: 0, h: 0 };

/**
 * Attach an HLS live stream to a video element.
 *
 * @param {string} cameraId
 * @param {React.RefObject<HTMLVideoElement>} videoRef
 * @param {object} logger - child logger instance
 * @returns {{ ready: boolean, videoSize: {w:number, h:number} }}
 */
export default function useHlsStream(cameraId, videoRef, logger) {
  const [playingCamera, setPlayingCamera] = useState(null);
  const [dimensions, setDimensions] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    setPlayingCamera(null);
    setDimensions(null);
    if (!video || !cameraId) return;

    const streamPath = `/api/v1/camera/${encodeURIComponent(cameraId)}/live`;
    const playlistUrl = `${streamPath}/stream.m3u8`;
    logger?.info?.('hls.start', { url: playlistUrl });

    const onPlaying = () => {
      setPlayingCamera(cameraId);
      logger?.info?.('hls.playing');
    };

    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) {
        setDimensions({ cameraId, size: { w: video.videoWidth, h: video.videoHeight } });
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
          video.removeAttribute('src');
          video.load();
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
      logger?.info?.('hls.stop');
    };
  }, [cameraId, videoRef, logger]);

  return { ready: Boolean(cameraId && cameraId === playingCamera),
    videoSize: dimensions && cameraId === dimensions.cameraId ? dimensions.size : EMPTY_SIZE };
}
