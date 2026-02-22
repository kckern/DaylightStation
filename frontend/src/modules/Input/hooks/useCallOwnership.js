import { useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useCallOwnership' });
  return _logger;
}

const CHANNEL_NAME = 'homeline-call-owner';

/**
 * Coordinates call ownership across browser tabs.
 * Only the tab that claims ownership should send power-off on close.
 *
 * @param {string|null} deviceId - The device currently being called, or null if idle
 * @returns {{ isOwner: function(): boolean }}
 */
export default function useCallOwnership(deviceId) {
  const channelRef = useRef(null);
  const isOwnerRef = useRef(false);
  const tabId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  useEffect(() => {
    if (!window.BroadcastChannel) {
      // Fallback: assume owner if BroadcastChannel not available
      isOwnerRef.current = !!deviceId;
      return;
    }

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    if (deviceId) {
      // Claim ownership
      channel.postMessage({ type: 'claim', tabId: tabId.current, deviceId });
      isOwnerRef.current = true;
      logger().info('call-ownership-claimed', { tabId: tabId.current, deviceId });
    } else {
      isOwnerRef.current = false;
    }

    channel.onmessage = (event) => {
      const { type, tabId: claimantId, deviceId: claimantDevice } = event.data;
      if (type === 'claim' && claimantId !== tabId.current && claimantDevice === deviceId) {
        // Another tab claimed ownership for the same device — yield
        isOwnerRef.current = false;
        logger().info('call-ownership-yielded', { to: claimantId, deviceId });
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [deviceId]);

  const isOwner = useCallback(() => isOwnerRef.current, []);

  return { isOwner };
}
