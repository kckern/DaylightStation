import { useEffect } from 'react';
import { wsService } from '../../services/WebSocketService.js';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'screen-presence-publisher' });
  return _logger;
}

const HEARTBEAT_MS = 5000;

/**
 * Publishes screen content-presence to the backend over WS.
 *   - On every active↔inactive transition (and on mount): one message.
 *   - While active: a heartbeat every 5s (so the backend TTL never expires a
 *     genuinely-active screen).
 *   - While inactive: silent — silence + backend TTL keep the boolean false.
 *
 * @param {Object} opts
 * @param {string} opts.deviceId - from wsConfig.guardrails.device; no-op when falsy
 * @param {boolean} opts.active  - isContentActive(currentContent, hasOverlay)
 */
export function useScreenPresencePublisher({ deviceId, active, playing = false }) {
  useEffect(() => {
    if (!deviceId) return undefined;

    const send = () => {
      try {
        wsService.send({
          type: 'screen.presence',
          deviceId,
          active: !!active,
          playing: !!playing,
          ts: new Date().toISOString(),
        });
      } catch (err) {
        logger().warn('publish-failed', { deviceId, active, playing, error: String(err?.message ?? err) });
      }
    };

    // Transition/mount emit.
    send();
    logger().info('mounted', { deviceId, active: !!active, playing: !!playing });

    if (!active) return () => { logger().info('unmounted', { deviceId }); };
    const timer = setInterval(send, HEARTBEAT_MS);
    return () => { clearInterval(timer); logger().info('unmounted', { deviceId }); };
  }, [deviceId, active, playing]);
}

export default useScreenPresencePublisher;
