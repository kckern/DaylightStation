import { useEffect, useCallback } from 'react';
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
 * exit path restores the lights), and accent() on demand (e.g. track change).
 */
export function useDanceLighting({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    logger().info('fitness.dance.lighting.start_request', {});
    post('start');
    return () => { logger().info('fitness.dance.lighting.stop_request', {}); post('stop'); };
  }, [enabled]);

  const accent = useCallback(() => { if (enabled) post('accent'); }, [enabled]);
  return { accent };
}

export default useDanceLighting;
