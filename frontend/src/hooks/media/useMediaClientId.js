import { useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaClientId' });
  return _logger;
}

const STORAGE_KEY = 'daylight_media_client_id';
const NAME_KEY = 'daylight_media_client_name';

function generateHexId() {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0');
}

function parseUserAgent(ua) {
  const browser = /Edg/.test(ua) ? 'Edge'
    : /Chrome/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari'
    : /Firefox/.test(ua) ? 'Firefox'
    : 'Browser';

  const os = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';

  return `${browser} on ${os}`;
}

export function useMediaClientId() {
  return useMemo(() => {
    let clientId = localStorage.getItem(STORAGE_KEY);
    const isNewClient = !clientId;
    if (!clientId) {
      clientId = generateHexId();
      localStorage.setItem(STORAGE_KEY, clientId);
    }

    let displayName = localStorage.getItem(NAME_KEY);
    if (!displayName) {
      displayName = parseUserAgent(navigator.userAgent);
      localStorage.setItem(NAME_KEY, displayName);
    }

    logger().info(isNewClient ? 'media-client-id.generated' : 'media-client-id.loaded', { clientId, displayName });
    return { clientId, displayName };
  }, []);
}

// Exported for testing
export { generateHexId, parseUserAgent, STORAGE_KEY, NAME_KEY };

export default useMediaClientId;
