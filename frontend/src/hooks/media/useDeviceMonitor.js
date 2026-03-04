// frontend/src/hooks/media/useDeviceMonitor.js
import { useState, useEffect, useRef } from 'react';
import wsService from '../../services/WebSocketService.js';
import getLogger from '../../lib/logging/Logger.js';

export const EXPIRY_MS = 30000;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useDeviceMonitor' });
  return _logger;
}

/**
 * WebSocket filter predicate: matches any message whose topic starts with 'playback:'.
 * Exported for testing.
 */
export function playbackPredicate(msg) {
  return msg.topic?.startsWith('playback:');
}

/**
 * Given a playback message, extract the device/client identifier.
 * Exported for testing.
 */
export function extractId(msg) {
  return msg.deviceId || msg.clientId || null;
}

/**
 * Purge stale entries from a timestamps Map and return the set of expired IDs.
 * Exported for testing.
 *
 * @param {Map<string,number>} timestamps - Map of id -> last-seen timestamp
 * @param {number} now - current time (Date.now())
 * @param {number} expiryMs - expiry threshold in milliseconds
 * @returns {string[]} ids that were expired and removed
 */
export function purgeStale(timestamps, now, expiryMs) {
  const expired = [];
  timestamps.forEach((ts, id) => {
    if (now - ts > expiryMs) {
      timestamps.delete(id);
      expired.push(id);
    }
  });
  return expired;
}

/**
 * Fetches registered devices from GET /api/v1/device on mount.
 * Subscribes to WebSocket with predicate matching 'playback:*' topics.
 * Maintains a Map of live playback states that expire after 30s.
 *
 * @returns {{ devices: Array, playbackStates: Map<string,object>, isLoading: boolean }}
 */
export function useDeviceMonitor() {
  const [devices, setDevices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackStates, setPlaybackStates] = useState(new Map());
  const timestampsRef = useRef(new Map());

  // Fetch registered devices
  useEffect(() => {
    fetch('/api/v1/device')
      .then(r => r.json())
      .then(data => {
        setDevices(data.devices || []);
        setIsLoading(false);
        logger().info('devices-loaded', { count: data.devices?.length });
      })
      .catch(err => {
        logger().error('devices-fetch-failed', { error: err.message });
        setIsLoading(false);
      });
  }, []);

  // Subscribe to playback state broadcasts
  useEffect(() => {
    const unsubscribe = wsService.subscribe(
      playbackPredicate,
      (msg) => {
        const id = extractId(msg);
        if (!id) return;

        timestampsRef.current.set(id, Date.now());
        setPlaybackStates(prev => {
          const next = new Map(prev);
          next.set(id, msg);
          const isNew = !prev.has(id);
          if (isNew) logger().info('device-monitor.device-online', { id, displayName: msg.displayName, contentId: msg.contentId });
          return next;
        });
      }
    );
    logger().info('device-monitor.subscribed');

    // Expire stale entries every 10s
    const cleanup = setInterval(() => {
      const now = Date.now();
      const expired = purgeStale(timestampsRef.current, now, EXPIRY_MS);
      if (expired.length > 0) {
        logger().info('device-monitor.devices-expired', { count: expired.length, ids: expired });
        setPlaybackStates(prev => {
          const next = new Map(prev);
          expired.forEach(id => next.delete(id));
          return next;
        });
      }
    }, 10000);

    return () => {
      logger().debug('device-monitor.cleanup');
      unsubscribe();
      clearInterval(cleanup);
    };
  }, []);

  return { devices, playbackStates, isLoading };
}

export default useDeviceMonitor;
