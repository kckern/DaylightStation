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
        if (!res.ok) {
          logger.debug('detection.poll.httpError', { status: res.status });
          return;
        }
        const data = await res.json();
        if (active) setDetections(data.detections || []);
      } catch (err) {
        logger.debug('detection.poll.error', { error: err.message });
      }
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

    let consecutiveFailures = 0;
    let pollCount = 0;

    const poll = async () => {
      const t0 = performance.now();
      pollCount++;
      const isFirst = pollCount === 1;
      try {
        const url = `/api/v1/camera/${cameraId}/snap?t=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const durationMs = Math.round(performance.now() - t0);
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        setSrc(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
        setLoading(false);
        setError(false);
        if (isFirst) {
          logger.info('snapshot.firstLoad', { durationMs, sizeBytes: blob.size });
        } else {
          logger.debug('snapshot.poll', { durationMs, sizeBytes: blob.size, pollCount });
        }
        if (consecutiveFailures > 0) {
          logger.info('snapshot.recovered', { afterFailures: consecutiveFailures });
        }
        consecutiveFailures = 0;
      } catch (err) {
        const durationMs = Math.round(performance.now() - t0);
        consecutiveFailures++;
        logger.warn('snapshot.error', { error: err.message, durationMs, consecutiveFailures, pollCount });
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
      {loading && !src && (
        <div className="camera-feed__skeleton">
          <span className="camera-feed__skeleton-text">Loading camera...</span>
        </div>
      )}
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
  const [hlsLoading, setHlsLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setHlsLoading(true);

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

    const hlsStartTime = performance.now();

    hls.loadSource(playlistUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      const durationMs = Math.round(performance.now() - hlsStartTime);
      logger.info('hls.manifestParsed', { durationMs, levels: data.levels?.length });
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
      logger.debug('hls.fragLoaded', { sn: data.frag.sn, durationMs: Math.round(data.stats.loading.end - data.stats.loading.start), sizeBytes: data.stats.total });
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      logger.warn('hls.error', { type: data.type, details: data.details, fatal: data.fatal, url: data.url });
      if (data.fatal) onError?.(new Error(data.details));
    });

    // Video element lifecycle
    const onPlaying = () => {
      setHlsLoading(false);
      const durationMs = Math.round(performance.now() - hlsStartTime);
      logger.info('hls.playing', { durationMs, currentTime: video.currentTime });
    };
    const onWaiting = () => logger.debug('hls.buffering', { currentTime: video.currentTime });
    const onStalled = () => logger.warn('hls.stalled', { currentTime: video.currentTime, readyState: video.readyState });

    video.addEventListener('playing', onPlaying, { once: true });
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);

    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      hls.destroy();
      fetch(`/api/v1/camera/${cameraId}/live`, { method: 'DELETE' }).catch(() => {});
      logger.info('hls.stop');
    };
  }, [cameraId, logger, onError]);

  const activeDetections = detections.filter(d => d.active);

  return (
    <div className="camera-feed camera-feed--live" onClick={onClickImage}>
      {hlsLoading && (
        <div className="camera-feed__skeleton">
          <span className="camera-feed__skeleton-text">Starting live stream...</span>
        </div>
      )}
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
