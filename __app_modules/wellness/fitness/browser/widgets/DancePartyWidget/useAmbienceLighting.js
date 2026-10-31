import { useEffect, useCallback, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ambience-lighting' });
  return _logger;
}

const post = (ambienceId, action) =>
  DaylightAPI(`api/v1/fitness/ambience/${encodeURIComponent(ambienceId)}/${action}`, {}, 'POST')
    .catch((err) => logger().warn('fitness.ambience.post_failed', { ambienceId, action, message: err?.message ?? null }));

/**
 * Drives an ambience's Home Assistant script (lights + heat): start on mount,
 * stop on unmount so every exit path hands the garage back, and an on/off
 * toggle for the now-playing bar's lights button.
 */
export function useAmbienceLighting({ ambienceId = null } = {}) {
  const enabled = ambienceId != null;
  const [lightsOn, setLightsOn] = useState(enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    setLightsOn(true);
    logger().info('fitness.ambience.start_request', { ambienceId });
    post(ambienceId, 'start');
    return () => { logger().info('fitness.ambience.stop_request', { ambienceId }); post(ambienceId, 'stop'); };
  }, [enabled, ambienceId]);

  const toggleLights = useCallback(() => {
    setLightsOn((prev) => {
      const next = !prev;
      logger().info('fitness.ambience.toggle', { ambienceId, lightsOn: next });
      post(ambienceId, next ? 'start' : 'stop');
      return next;
    });
  }, [ambienceId]);

  return { lightsOn, toggleLights };
}

export default useAmbienceLighting;
