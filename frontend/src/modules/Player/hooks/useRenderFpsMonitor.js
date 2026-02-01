import { useCallback, useEffect, useRef, useState } from 'react';
import { getLogger } from '../../../lib/logging/Logger.js';

/**
 * useRenderFpsMonitor - Monitors actual render frame rate using requestAnimationFrame
 *
 * Uses requestAnimationFrame to measure the browser's actual rendering frame rate,
 * enabling diagnosis of blur overlay performance issues by comparing render FPS
 * against decoder FPS.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether to run monitoring (default: true)
 * @param {function} options.onFpsUpdate - Optional callback invoked with current FPS value
 * @param {number} options.telemetryIntervalMs - How often to emit telemetry (default: 5000ms)
 * @param {Object} options.mediaContext - Optional context for telemetry (title, show, etc.)
 * @returns {number|null} Current render FPS (null if not yet measured or disabled)
 */
export function useRenderFpsMonitor({
  enabled = true,
  onFpsUpdate,
  telemetryIntervalMs = 5000,
  mediaContext = {}
} = {}) {
  const [currentFps, setCurrentFps] = useState(null);

  // Refs for tracking frame timestamps
  const frameTimestampsRef = useRef([]);
  const rafIdRef = useRef(null);
  const lastTelemetryRef = useRef(0);
  const enabledRef = useRef(enabled);
  const onFpsUpdateRef = useRef(onFpsUpdate);
  const mediaContextRef = useRef(mediaContext);

  // Keep refs in sync with props
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onFpsUpdateRef.current = onFpsUpdate;
  }, [onFpsUpdate]);

  useEffect(() => {
    mediaContextRef.current = mediaContext;
  }, [mediaContext]);

  /**
   * Calculate FPS from timestamps within the last 1-second window
   */
  const calculateFps = useCallback((timestamps) => {
    if (timestamps.length < 2) return null;

    const now = timestamps[timestamps.length - 1];
    const windowStart = now - 1000; // 1-second window

    // Filter to timestamps within the window
    const windowTimestamps = timestamps.filter(ts => ts >= windowStart);

    if (windowTimestamps.length < 2) return null;

    // FPS = (frame count - 1) / time span
    // We subtract 1 because N timestamps represent N-1 frame intervals
    const frameCount = windowTimestamps.length - 1;
    const timeSpanMs = windowTimestamps[windowTimestamps.length - 1] - windowTimestamps[0];

    if (timeSpanMs <= 0) return null;

    return Math.round((frameCount / timeSpanMs) * 1000);
  }, []);

  /**
   * Emit telemetry with current render FPS
   */
  const emitTelemetry = useCallback((fps) => {
    const logger = getLogger();
    const context = mediaContextRef.current || {};

    logger.info('playback.render_fps', {
      renderFps: fps,
      title: context.title,
      grandparentTitle: context.grandparentTitle,
      parentTitle: context.parentTitle,
      mediaKey: context.mediaKey,
      shader: context.shader,
      timestamp: Date.now()
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Clean up if disabled
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      frameTimestampsRef.current = [];
      setCurrentFps(null);
      return;
    }

    let destroyed = false;
    frameTimestampsRef.current = [];
    lastTelemetryRef.current = performance.now();

    const frameCallback = (timestamp) => {
      if (destroyed || !enabledRef.current) return;

      const timestamps = frameTimestampsRef.current;
      timestamps.push(timestamp);

      // Keep only timestamps from the last 2 seconds to limit memory usage
      const cutoff = timestamp - 2000;
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }

      // Calculate current FPS
      const fps = calculateFps(timestamps);

      if (fps !== null) {
        setCurrentFps(fps);

        // Invoke callback if provided
        if (typeof onFpsUpdateRef.current === 'function') {
          onFpsUpdateRef.current(fps);
        }

        // Emit telemetry at configured interval
        if (timestamp - lastTelemetryRef.current >= telemetryIntervalMs) {
          lastTelemetryRef.current = timestamp;
          emitTelemetry(fps);
        }
      }

      // Schedule next frame
      rafIdRef.current = requestAnimationFrame(frameCallback);
    };

    // Start the animation frame loop
    rafIdRef.current = requestAnimationFrame(frameCallback);

    return () => {
      destroyed = true;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      frameTimestampsRef.current = [];
    };
  }, [enabled, telemetryIntervalMs, calculateFps, emitTelemetry]);

  return currentFps;
}

export default useRenderFpsMonitor;
