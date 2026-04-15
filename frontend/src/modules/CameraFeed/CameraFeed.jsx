import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { getChildLogger } from '../../lib/logging/singleton.js';
import CameraViewport from './CameraViewport.jsx';
import './CameraFeed.scss';

export default function CameraFeed({ cameraId, mode = 'snapshot', interval = 3000, onError }) {
  const logger = useMemo(() => getChildLogger({ component: 'CameraFeed', cameraId }), [cameraId]);
  const [viewportOpen, setViewportOpen] = useState(false);
  const [detections, setDetections] = useState([]);

  // Poll detection state
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/camera/${cameraId}/state`);
        if (!res.ok) return;
        const data = await res.json();
        if (active) setDetections(data.detections || []);
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [cameraId]);

  if (mode === 'live') {
    return (
      <>
        <HlsPlayer cameraId={cameraId} logger={logger} onError={onError} detections={detections} onClickImage={() => setViewportOpen(true)} />
        {viewportOpen && (
          <CameraViewport cameraId={cameraId} mode="live" detections={detections} onClose={() => setViewportOpen(false)} />
        )}
      </>
    );
  }
  return (
    <>
      <SnapshotPoller cameraId={cameraId} interval={interval} logger={logger} onError={onError} detections={detections} onClickImage={() => setViewportOpen(true)} />
      {viewportOpen && (
        <CameraViewport cameraId={cameraId} mode="snapshot" detections={detections} onClose={() => setViewportOpen(false)} />
      )}
    </>
  );
}

function SnapshotPoller({ cameraId, interval, logger, onError, detections, onClickImage }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
        setLoading(false);
        setError(false);
      } catch (err) {
        logger.warn('snapshot.error', { error: err.message });
        setError(true);
        setLoading(false);
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

  const onImgLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      setAspectRatio(`${naturalWidth} / ${naturalHeight}`);
    }
  }, []);

  const activeDetections = detections.filter(d => d.active);

  return (
    <div
      className={`camera-feed camera-feed--snapshot ${loading ? 'camera-feed--loading' : ''}`}
      style={aspectRatio ? { aspectRatio } : undefined}
      onClick={src ? onClickImage : undefined}
    >
      {loading && !src && <div className="camera-feed__skeleton" />}
      {src && <img src={src} alt={`${cameraId} snapshot`} onLoad={onImgLoad} draggable={false} />}
      {error && !src && !loading && <div className="camera-feed__error">Camera unavailable</div>}
      {activeDetections.length > 0 && (
        <div className="camera-feed__badges">
          {activeDetections.map(d => (
            <span key={d.type} className={`camera-feed__badge camera-feed__badge--${d.type}`}>{d.type}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function HlsPlayer({ cameraId, logger, onError, detections, onClickImage }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playlistUrl = `/api/v1/camera/${cameraId}/live/stream.m3u8`;
    logger.info('hls.start', { url: playlistUrl });

    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = playlistUrl;
        video.play().catch(() => {});
        return () => {
          video.src = '';
          fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
          logger.info('hls.stop');
        };
      }
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

  const activeDetections = detections.filter(d => d.active);

  return (
    <div className="camera-feed camera-feed--live" onClick={onClickImage}>
      <video ref={videoRef} muted autoPlay playsInline />
      {activeDetections.length > 0 && (
        <div className="camera-feed__badges">
          {activeDetections.map(d => (
            <span key={d.type} className={`camera-feed__badge camera-feed__badge--${d.type}`}>{d.type}</span>
          ))}
        </div>
      )}
    </div>
  );
}
