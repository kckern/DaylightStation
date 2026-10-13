// frontend/src/modules/CameraFeed/useSnapshotFetch.js
import { useState, useEffect, useCallback } from 'react';

/**
 * Fetch a single camera snapshot. Returns a blob URL and natural dimensions.
 * The blob URL is revoked on unmount or when cameraId changes.
 *
 * @param {string} cameraId
 * @param {object} logger - child logger instance
 * @returns {{ src: string|null, loading: boolean, error: boolean, naturalSize: {w:number, h:number}, onImgLoad: function }}
 */
export default function useSnapshotFetch(cameraId, logger) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!cameraId) return;
    let active = true;
    setLoading(true);
    setError(false);

    const t0 = performance.now();
    fetch(`/api/v1/camera/${cameraId}/snap?t=${Date.now()}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (!active) return;
        const url = URL.createObjectURL(blob);
        setSrc(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
        setLoading(false);
        const durationMs = Math.round(performance.now() - t0);
        logger?.info?.('snapshot.fetched', { durationMs, sizeBytes: blob.size });
      })
      .catch(err => {
        if (!active) return;
        setError(true);
        setLoading(false);
        logger?.warn?.('snapshot.error', { error: err.message });
      });

    return () => {
      active = false;
      setSrc(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [cameraId, logger]);

  const onImgLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      setNaturalSize({ w: naturalWidth, h: naturalHeight });
    }
  }, []);

  return { src, loading, error, naturalSize, onImgLoad };
}
