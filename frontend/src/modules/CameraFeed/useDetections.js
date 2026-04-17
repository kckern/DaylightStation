// frontend/src/modules/CameraFeed/useDetections.js
import { useState, useEffect } from 'react';

/**
 * Poll camera detection state (motion, person, vehicle, animal).
 * @param {string} cameraId
 * @param {object} logger - child logger instance
 * @param {number} [intervalMs=2000]
 * @returns {{ type: string, active: boolean }[]}
 */
export default function useDetections(cameraId, logger, intervalMs = 2000) {
  const [detections, setDetections] = useState([]);

  useEffect(() => {
    if (!cameraId) return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/camera/${cameraId}/state`);
        if (!res.ok) {
          logger?.debug?.('detection.poll.httpError', { status: res.status });
          return;
        }
        const data = await res.json();
        if (active) setDetections(data.detections || []);
      } catch (err) {
        logger?.debug?.('detection.poll.error', { error: err.message });
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => { active = false; clearInterval(timer); };
  }, [cameraId, logger, intervalMs]);

  return detections;
}
