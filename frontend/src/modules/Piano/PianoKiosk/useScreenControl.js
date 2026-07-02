import { useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import * as fkb from '../../../lib/fkb.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-screen-control' });
  return _logger;
}

/**
 * Map a failed turnOffScreen() result to a short operator-facing message.
 * Shared by both call sites so the wording stays consistent.
 *
 * @param {{lever?: string}} [res]
 * @returns {string}
 */
export function screenOffFailureMessage(res) {
  return res?.lever === 'none'
    ? 'No screen control available'
    : "Couldn't reach the screen";
}

/**
 * useScreenControl — single source of truth for the manual "turn off the screen"
 * burn-in kill switch, shared by the connect gate and the settings sheet.
 *
 * `turnOffScreen()` prefers the FKB JS bridge (`fully.turnScreenOff()`) because
 * it is instant and needs neither the network nor a configured `deviceId`. When
 * the bridge is absent (returns false), it falls back to the backend screen-off
 * path (`/api/v1/device/:deviceId/screen/off`) — the same route the automatic
 * screensaver uses — resolving the deviceId from `config.screensaver.deviceId`.
 * If neither lever is available it returns a status the caller can surface.
 *
 * @returns {{ turnOffScreen: () => Promise<{ok: boolean, lever: string, error?: string}> }}
 */
export function useScreenControl() {
  const { config } = usePianoKioskConfig();
  const deviceId = config?.screensaver?.deviceId ?? null;

  const turnOffScreen = useCallback(async () => {
    // 1) FKB JS bridge — instant, no network, no deviceId required.
    if (fkb.screenOff()) {
      logger().info('piano.screen-control.off', { lever: 'fkb' });
      return { ok: true, lever: 'fkb' };
    }

    // 2) Backend fallback — only works when a deviceId is configured.
    if (deviceId) {
      logger().info('piano.screen-control.fallback', { lever: 'api', deviceId });
      try {
        const res = await DaylightAPI(`api/v1/device/${deviceId}/screen/off`);
        if (res?.ok === false) {
          logger().warn('piano.screen-control.rejected', { deviceId, error: res.error });
          return { ok: false, lever: 'api', error: res.error || 'rejected' };
        }
        logger().info('piano.screen-control.off', { lever: 'api', deviceId });
        return { ok: true, lever: 'api' };
      } catch (err) {
        logger().warn('piano.screen-control.failed', { deviceId, error: err.message });
        return { ok: false, lever: 'api', error: err.message };
      }
    }

    // 3) No lever available — bridge absent AND no deviceId configured.
    logger().warn('piano.screen-control.no-path', {});
    return { ok: false, lever: 'none', error: 'no screen-control path' };
  }, [deviceId]);

  return { turnOffScreen };
}

export default useScreenControl;
