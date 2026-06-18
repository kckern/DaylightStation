import { useEffect, useRef } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'player-frame-capture' });
  return _logger;
}

/**
 * Capture the active fitness player <video> element to JPEG at an interval and
 * upload as role:'player' screenshots — the realtime feed for the session
 * time-lapse PiP (mirrors how the webcam is captured). Same-origin video, so the
 * canvas is not tainted.
 *
 * @param {object} opts
 * @param {string|null} opts.sessionId
 * @param {number} [opts.intervalMs=1000]
 * @param {boolean} [opts.enabled=true]
 */
export default function usePlayerFrameCapture({ sessionId, intervalMs = 1000, enabled = true }) {
  const inFlight = useRef(false);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!enabled || !sessionId) return undefined;
    indexRef.current = 0;
    const canvas = document.createElement('canvas');

    const tick = async () => {
      if (inFlight.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const video = typeof window !== 'undefined' ? window.__fitnessVideoElement : null;
      if (!video || !video.videoWidth || !video.videoHeight || video.readyState < 2) return;
      try {
        inFlight.current = true;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob-failed'))), 'image/jpeg', 0.85));
        const imageBase64 = await blobToDataUrl(blob);
        const timestamp = Date.now();
        await DaylightAPI('api/v1/fitness/save_screenshot', {
          sessionId,
          imageBase64,
          mimeType: 'image/jpeg',
          index: indexRef.current,
          timestamp,
          role: 'player'
        });
        indexRef.current += 1;
        logger().debug('player_frame.uploaded', { index: indexRef.current, w: canvas.width, h: canvas.height });
      } catch (err) {
        // Tainted-canvas (cross-origin) or upload failure — rate-limited so a
        // persistent failure doesn't flood the session log.
        logger().sampled('player_frame.error', { error: err?.message }, { maxPerMinute: 6, aggregate: true });
      } finally {
        inFlight.current = false;
      }
    };

    const period = Math.max(500, intervalMs);
    const timer = setInterval(tick, period);
    logger().info('player_frame.capture_started', { sessionId, intervalMs: period });
    return () => {
      clearInterval(timer);
      logger().info('player_frame.capture_stopped', { sessionId, frames: indexRef.current });
    };
  }, [sessionId, intervalMs, enabled]);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(blob);
  });
}
