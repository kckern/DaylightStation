import { useEffect, useCallback, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'dance-lighting' });
  return _logger;
}

const post = (action) =>
  DaylightAPI(`api/v1/fitness/dance/${action}`, {}, 'POST')
    .catch((err) => logger().warn('fitness.dance.lighting.post_failed', { action, message: err?.message ?? null }));

/**
 * Drives the backend dance lighting: start on mount, stop on unmount (so any
 * exit path restores the lights), accent() on demand (e.g. track change), and
 * a user-facing on/off toggle (lightsOn + toggleLights) for the bar button.
 */
export function useDanceLighting({ enabled = true } = {}) {
  const [lightsOn, setLightsOn] = useState(enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    setLightsOn(true);
    logger().info('fitness.dance.lighting.start_request', {});
    post('start');
    // Unmount always stops — even if the user toggled off, a second stop is harmless.
    return () => { logger().info('fitness.dance.lighting.stop_request', {}); post('stop'); };
  }, [enabled]);

  const accent = useCallback(() => { if (lightsOn) post('accent'); }, [lightsOn]);

  const toggleLights = useCallback(() => {
    setLightsOn((prev) => {
      const next = !prev;
      logger().info('fitness.dance.lighting.toggle', { lightsOn: next });
      post(next ? 'start' : 'stop');
      return next;
    });
  }, []);

  return { accent, lightsOn, toggleLights };
}

export default useDanceLighting;
