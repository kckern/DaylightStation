import { useEffect, useRef } from 'react';
import { wsService } from '../../services/WebSocketService.js';
import { buildDeviceStateBroadcast } from '@shared-contracts/media/envelopes.mjs';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'SessionStatePublisher' });
  return _logger;
}

const CHANGE_DEBOUNCE_MS = 500;
const HEARTBEAT_INTERVAL_MS = 5000;

/**
 * useSessionStatePublisher - broadcasts SessionSnapshot changes over WebSocket.
 *
 * Publishes `buildDeviceStateBroadcast(...)` messages on three triggers:
 *   - `reason: 'initial'`   — once on mount (if a snapshot is available)
 *   - `reason: 'change'`    — debounced 500ms after each `onChange` fires
 *   - `reason: 'heartbeat'` — every 5s while the player is NOT idle
 *
 * The heartbeat timer is toggled by `onStateTransition(state)`: any non-idle
 * state starts it, `idle` stops it.
 *
 * @param {object}   opts
 * @param {string}   opts.deviceId     - Required; hook is a no-op when falsy.
 * @param {function} opts.getSnapshot  - Returns the current SessionSnapshot or null.
 * @param {function} opts.subscribe    - Registers `{ onChange, onStateTransition }`;
 *                                        returns an unsubscribe function.
 */
export function useSessionStatePublisher({ deviceId, getSnapshot, subscribe } = {}) {
  // Stable refs so the effect doesn't re-run when callbacks change shape.
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(() => {
    if (!deviceId) return undefined;

    let unsubscribe = null;
    let debounceTimer = null;
    let heartbeatTimer = null;

    const publish = (reason) => {
      const snapshot = getSnapshotRef.current?.();
      if (!snapshot) {
        logger().debug('publish-skipped-no-snapshot', { deviceId, reason });
        return;
      }
      try {
        const msg = buildDeviceStateBroadcast({
          deviceId,
          snapshot,
          reason,
          ts: new Date().toISOString(),
        });
        wsService.send(msg);
        logger().debug('published', { deviceId, reason, state: snapshot.state });
      } catch (err) {
        logger().warn('publish-failed', { deviceId, reason, error: String(err?.message ?? err) });
      }
    };

    const clearDebounce = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };

    const clearHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const handleChange = () => {
      clearDebounce();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        publish('change');
      }, CHANGE_DEBOUNCE_MS);
    };

    const handleStateTransition = (state) => {
      if (state === 'idle') {
        clearHeartbeat();
        return;
      }
      // Restart heartbeat on any non-idle state transition so the interval is
      // predictable regardless of how many times we transition.
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        publish('heartbeat');
      }, HEARTBEAT_INTERVAL_MS);
    };

    // Register subscriptions (if a subscribe fn was provided).
    if (typeof subscribeRef.current === 'function') {
      try {
        unsubscribe = subscribeRef.current({
          onChange: handleChange,
          onStateTransition: handleStateTransition,
        });
      } catch (err) {
        logger().warn('subscribe-failed', { deviceId, error: String(err?.message ?? err) });
      }
    }

    // Initial publish (sync so tests can observe it before advancing timers).
    publish('initial');

    logger().info('mounted', { deviceId });

    return () => {
      clearDebounce();
      clearHeartbeat();
      if (typeof unsubscribe === 'function') {
        try { unsubscribe(); } catch (err) {
          logger().warn('unsubscribe-failed', { deviceId, error: String(err?.message ?? err) });
        }
      }
      logger().info('unmounted', { deviceId });
    };
  }, [deviceId]);
}

export default useSessionStatePublisher;
