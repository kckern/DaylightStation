import { useEffect, useRef } from 'react';
import { useScreenVolume } from '../lib/volume/ScreenVolumeContext.js';
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'portal-keys' });
  return _logger;
}

const DEFAULT_PORT = 8771;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Bridges the Portal panel's physical buttons into the SPA.
 *
 * The `net.kckern.portalkeys` APK runs an AccessibilityService that consumes
 * VOLUME_UP / VOLUME_DOWN / MUTE and re-emits them over a local WebSocket. This hook
 * turns the volume keys into ScreenVolumeContext step() calls.
 *
 * MUTE is deliberately NOT handled here. The camera button drives the backlight, and
 * that has to work when this WebView is dozing or wedged — precisely when the SPA
 * cannot be relied on. The APK owns that path; we only observe it for logging.
 *
 * Safe to mount on any screen: nothing listens on this port off the Portal, so the
 * socket simply never opens and the hook stays inert (backing off to a 30s retry).
 */
export function usePortalKeys({ enabled = true, port = DEFAULT_PORT } = {}) {
  const { step, stepSize } = useScreenVolume();

  // Keep the latest handlers in a ref so reconnection never re-subscribes stale
  // closures, and so a volume change doesn't tear down the socket.
  const handlersRef = useRef({ step, stepSize });
  handlersRef.current = { step, stepSize };

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined' || !('WebSocket' in window)) return undefined;

    let ws = null;
    let retryMs = RECONNECT_MIN_MS;
    let retryTimer = null;
    let closed = false;

    const url = `ws://localhost:${port}/`;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        scheduleRetry(err?.message);
        return;
      }

      ws.onopen = () => {
        retryMs = RECONNECT_MIN_MS;
        logger().info('portal-keys-connected', { url });
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type !== 'key') return;

        const { step: doStep, stepSize: size } = handlersRef.current;
        const delta = size || 0.05;

        logger().debug('key-received', {
          key: msg.key,
          action: msg.action,
          interactive: msg.interactive,
        });

        switch (msg.key) {
          case 'KEYCODE_VOLUME_UP':
            doStep(delta);
            break;
          case 'KEYCODE_VOLUME_DOWN':
            doStep(-delta);
            break;
          // MUTE arrives for observability only — the APK already acted on it.
          case 'KEYCODE_MUTE':
          case 'KEYCODE_VOLUME_MUTE':
            logger().info('screen-toggle-observed', { interactive: msg.interactive });
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        // onclose always follows; retry is scheduled there to avoid double-arming.
      };

      ws.onclose = () => {
        if (closed) return;
        logger().warn('portal-keys-disconnected', { retryMs });
        scheduleRetry();
      };
    };

    const scheduleRetry = (reason) => {
      if (closed) return;
      if (reason) logger().warn('portal-keys-connect-failed', { reason });
      retryTimer = setTimeout(connect, retryMs);
      // Back off toward 30s so non-Portal screens cost almost nothing.
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        try { ws.close(); } catch { /* already gone */ }
      }
    };
  }, [enabled, port]);
}

export default usePortalKeys;
