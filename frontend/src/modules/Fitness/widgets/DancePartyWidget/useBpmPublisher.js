import { useEffect, useRef } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'dance-bpm-publisher' });
  return _logger;
}

export const BPM_PUBLISH_MIN_INTERVAL_MS = 5000;

/**
 * Publish the party's effective BPM to the backend (POST /fitness/dance/bpm),
 * which mirrors it into the HA input_number that drives the physical strobe
 * lights. Storm guards, layered with the backend's own rate cap:
 * - only posts when the value actually changes
 * - at most one post per minIntervalMs; changes inside the window collapse
 *   into a single trailing post carrying the LATEST value
 */
export function useBpmPublisher({ bpm, enabled = true, minIntervalMs = BPM_PUBLISH_MIN_INTERVAL_MS } = {}) {
  const lastSentValueRef = useRef(null);
  const lastSentAtRef = useRef(-Infinity);
  const timerRef = useRef(null);
  const latestBpmRef = useRef(bpm);

  useEffect(() => {
    latestBpmRef.current = bpm;
    if (!enabled || !Number.isFinite(bpm) || bpm === lastSentValueRef.current) return;

    const post = () => {
      const value = latestBpmRef.current;
      if (!Number.isFinite(value) || value === lastSentValueRef.current) return;
      lastSentValueRef.current = value;
      lastSentAtRef.current = Date.now();
      logger().info('fitness.dance.bpm.publish', { bpm: value });
      DaylightAPI('api/v1/fitness/dance/bpm', { bpm: value }, 'POST')
        .catch((err) => {
          // Clear so the next change (or trailing tick) can retry this value.
          lastSentValueRef.current = null;
          logger().warn('fitness.dance.bpm.publish_failed', { bpm: value, message: err?.message ?? null });
        });
    };

    const elapsed = Date.now() - lastSentAtRef.current;
    if (elapsed >= minIntervalMs) {
      post();
    } else if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        post();
      }, minIntervalMs - elapsed);
    }
  }, [bpm, enabled, minIntervalMs]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
}

export default useBpmPublisher;
