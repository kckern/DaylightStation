import { useState, useEffect, useRef, useMemo } from 'react';
import Hls from 'hls.js';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './CameraFeed.scss';

export default function CameraFeed({ cameraId, mode = 'snapshot', interval = 3000, onError }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraFeed', cameraId }), [cameraId]);

  if (mode === 'live') {
    return <HlsPlayer cameraId={cameraId} logger={logger} onError={onError} />;
  }
  return <SnapshotPoller cameraId={cameraId} interval={interval} logger={logger} onError={onError} />;
}

function SnapshotPoller({ cameraId, interval, logger, onError }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    logger.info('snapshot.start', { interval });

    const poll = async () => {
      try {
        const url = `/api/v1/camera/${cameraId}/snap?t=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        setSrc(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
        setError(false);
      } catch (err) {
        logger.warn('snapshot.error', { error: err.message });
        setError(true);
        onError?.(err);
      }
    };

    poll();
    const timer = setInterval(poll, interval);

    return () => {
      active = false;
      clearInterval(timer);
      setSrc(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      logger.info('snapshot.stop');
    };
  }, [cameraId, interval, logger, onError]);

  return (
    <div className="camera-feed camera-feed--snapshot">
      {src && <img src={src} alt={`${cameraId} snapshot`} />}
      {error && !src && <div className="camera-feed__error">Camera unavailable</div>}
    </div>
  );
}

function HlsPlayer({ cameraId, logger, onError }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playlistUrl = `/api/v1/camera/${cameraId}/live/stream.m3u8`;
    logger.info('hls.start', { url: playlistUrl });

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl;
      video.play().catch(() => {});
      return () => {
        video.src = '';
        fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
        logger.info('hls.stop');
      };
    }

    if (!Hls.isSupported()) {
      logger.error('hls.unsupported');
      onError?.(new Error('HLS not supported in this browser'));
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 3,
    });

    hls.loadSource(playlistUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      logger.warn('hls.error', { type: data.type, details: data.details, fatal: data.fatal });
      if (data.fatal) onError?.(new Error(data.details));
    });

    return () => {
      hls.destroy();
      fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
      logger.info('hls.stop');
    };
  }, [cameraId, logger, onError]);

  return (
    <div className="camera-feed camera-feed--live">
      <video ref={videoRef} muted autoPlay playsInline />
    </div>
  );
}
