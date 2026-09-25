import { useEffect, useRef } from 'react';
import { useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'screen-exit' });
  return _logger;
}

const DEFAULT_IDLE_SECONDS = 20;
const DEFAULT_GRACE_MS = 1500;

/**
 * ScreenExit - hands the device back to its own app when the screen has
 * nothing left to show.
 *
 * For a device whose home is not a screen (the piano tablet lives in /piano):
 * content is dispatched to its screen, and once that content is gone the
 * screen navigates to `exit.to` instead of sitting on an empty layout.
 *
 *   exit:
 *     to: /piano?device=yellow-room-tablet
 *     idleSeconds: 20   # leave if nothing has opened this long after load
 *
 * Leaves when a fullscreen overlay (the player) closes and stays closed for a
 * short grace period (a queue advancing between items must not trigger it), or
 * when no overlay has opened within `idleSeconds` of mounting. Renders nothing.
 */
export function ScreenExit({ config, graceMs = DEFAULT_GRACE_MS, navigate = (url) => window.location.assign(url) }) {
  const { hasOverlay } = useScreenOverlay();
  const to = config?.to || null;
  const idleSeconds = Number.isFinite(config?.idleSeconds) ? config.idleSeconds : DEFAULT_IDLE_SECONDS;
  const sawOverlay = useRef(false);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (to) logger().info('screen-exit.armed', { to, idleSeconds });
  }, [to, idleSeconds]);

  useEffect(() => {
    if (!to) return undefined;
    if (hasOverlay) {
      sawOverlay.current = true;
      return undefined;
    }
    const reason = sawOverlay.current ? 'overlay-closed' : 'idle';
    const delayMs = sawOverlay.current ? graceMs : idleSeconds * 1000;
    const timer = setTimeout(() => {
      logger().info('screen-exit.navigate', { to, reason });
      navigateRef.current(to);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [to, hasOverlay, idleSeconds, graceMs]);

  return null;
}

export default ScreenExit;
