// frontend/src/modules/CameraFeed/useSnapshotFetch.js
import { daylightApiResponse } from '../../../../frontend/src/lib/api.mjs';
import { useState, useEffect, useCallback } from 'react';

const EMPTY_SIZE = { w: 0, h: 0 };

/**
 * Fetch a single camera snapshot. Returns a blob URL and natural dimensions.
 * The blob URL is revoked on unmount or when cameraId changes.
 *
 * @param {string} cameraId
 * @param {object} logger - child logger instance
 * @returns {{ src: string|null, loading: boolean, error: boolean, naturalSize: {w:number, h:number}, onImgLoad: function }}
 */
export default function useSnapshotFetch(cameraId, logger) {
  const [snapshot, setSnapshot] = useState(null);
  const [size, setSize] = useState(null);

  useEffect(() => {
    if (!cameraId) return;
    const controller = new AbortController();
    let url;
    setSnapshot(null);

    const t0 = performance.now();
    daylightApiResponse(`/api/v1/camera/${encodeURIComponent(cameraId)}/snap?t=${Date.now()}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setSnapshot({ cameraId, src: url, error: false });
        const durationMs = Math.round(performance.now() - t0);
        logger?.info?.('snapshot.fetched', { durationMs, sizeBytes: blob.size });
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setSnapshot({ cameraId, src: null, error: true });
        logger?.warn?.('snapshot.error', { error: err.message });
      });

    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [cameraId, logger]);

  const onImgLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (naturalWidth && naturalHeight) {
      setSize({ cameraId, naturalSize: { w: naturalWidth, h: naturalHeight } });
    }
  }, [cameraId]);

  const naturalSize = size && size.cameraId === cameraId ? size.naturalSize : EMPTY_SIZE;
  const current = snapshot?.cameraId === cameraId ? snapshot : null;
  return { src: current?.src || null, loading: Boolean(cameraId && !current), error: current?.error || false, naturalSize, onImgLoad };
}
