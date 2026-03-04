import { useEffect, useRef } from 'react';
import { useMediaClientId } from './useMediaClientId.js';
import { useDeviceIdentity } from './useDeviceIdentity.js';
import wsService from '../../services/WebSocketService.js';
import getLogger from '../../lib/logging/Logger.js';

export const BROADCAST_INTERVAL_MS = 5000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'usePlaybackBroadcast' });
  return _logger;
}

/**
 * Build a playback_state message from the current media element and item.
 * Returns null if the element is missing or paused (no broadcast needed).
 *
 * Exported for testing.
 */
export function buildBroadcastMessage(playerRef, currentItem, identity) {
  const el = playerRef.current?.getMediaElement?.();
  if (!el || el.paused) return null;

  return {
    topic: 'playback_state',
    clientId: identity.clientId,
    deviceId: identity.deviceId,
    displayName: identity.displayName,
    contentId: currentItem.contentId,
    title: currentItem.title,
    format: currentItem.format,
    position: Math.round(el.currentTime),
    duration: Math.round(el.duration) || 0,
    state: 'playing',
    thumbnail: currentItem.thumbnail || null,
  };
}

/**
 * Build a "stopped" message for when currentItem becomes null.
 * Exported for testing.
 */
export function buildStopMessage(identity) {
  return {
    topic: 'playback_state',
    clientId: identity.clientId,
    deviceId: identity.deviceId,
    displayName: identity.displayName,
    contentId: null,
    title: null,
    format: null,
    position: 0,
    duration: 0,
    state: 'stopped',
    thumbnail: null,
  };
}

/**
 * Broadcasts playback state to backend every 5s while playing.
 * @param {React.RefObject} playerRef - Player imperative handle with getMediaElement()
 * @param {object|null} currentItem - { contentId, title, format, thumbnail } or null when idle
 */
export function usePlaybackBroadcast(playerRef, currentItem) {
  const { clientId, displayName } = useMediaClientId();
  const { deviceId } = useDeviceIdentity();
  const lastStateRef = useRef(null);

  useEffect(() => {
    const identity = { clientId, deviceId, displayName };

    if (!currentItem) {
      // Send stop broadcast if we were previously playing
      if (lastStateRef.current === 'playing' || lastStateRef.current === 'paused') {
        logger().info('playback-broadcast.stop-sent', { previousState: lastStateRef.current });
        wsService.send(buildStopMessage(identity));
        lastStateRef.current = 'stopped';
      }
      return;
    }

    logger().info('playback-broadcast.setup', { contentId: currentItem.contentId, clientId });

    function broadcast() {
      const msg = buildBroadcastMessage(playerRef, currentItem, identity);
      if (!msg) return;

      wsService.send(msg);
      lastStateRef.current = 'playing';
      logger().debug('broadcast', { contentId: msg.contentId, position: msg.position });
    }

    const interval = setInterval(broadcast, BROADCAST_INTERVAL_MS);

    return () => {
      logger().debug('playback-broadcast.cleanup', { contentId: currentItem.contentId });
      clearInterval(interval);
    };
  }, [currentItem, clientId, deviceId, displayName, playerRef]);

  return null;
}

export default usePlaybackBroadcast;
