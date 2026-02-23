// frontend/src/modules/Input/hooks/useWakeProgress.js

import { useState, useEffect, useCallback, useRef } from 'react';
import wsService from '../../../services/WebSocketService.js';

/**
 * Tracks wake-and-load progress for a device via WebSocket events.
 *
 * @param {string|null} deviceId - Active device being woken, or null when idle
 * @returns {{ progress: Object|null, reset: Function }}
 *
 * progress shape:
 *   { power: 'running'|'done'|'failed', verify: null|'running'|..., ... , failReason: string|null }
 */
export function useWakeProgress(deviceId) {
  const [progress, setProgress] = useState(null);
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;

  useEffect(() => {
    if (!deviceId) {
      setProgress(null);
      return;
    }

    // Initialize with all steps pending
    setProgress({ power: null, verify: null, prepare: null, load: null, failReason: null });

    const topic = `homeline:${deviceId}`;
    const unsub = wsService.subscribe(
      (data) => data.topic === topic && data.type === 'wake-progress',
      (message) => {
        if (deviceIdRef.current !== deviceId) return; // stale
        setProgress(prev => {
          if (!prev) return prev;
          const next = { ...prev, [message.step]: message.status };
          if (message.status === 'failed') {
            next.failReason = message.error || message.reason || 'Unknown error';
          }
          return next;
        });
      }
    );

    return unsub;
  }, [deviceId]);

  const reset = useCallback(() => setProgress(null), []);

  return { progress, reset };
}
