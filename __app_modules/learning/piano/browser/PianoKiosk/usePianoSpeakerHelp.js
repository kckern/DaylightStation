import { useCallback, useState } from 'react';
import { useWebSocketSubscription } from '../../../../../frontend/src/hooks/useWebSocket.js';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import { KIOSK_DEVICE_ID } from './kioskDeviceIdentity.js';

/**
 * The backend's speaker self-healing ladder (PianoBridgeSupervisorService) runs
 * silently; it broadcasts `piano.speaker` so this kiosk can say so only once a
 * person is needed. `recovering` deliberately shows nothing.
 */
export const PIANO_SPEAKER_TOPIC = 'piano.speaker';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-speaker-help' });
  return _logger;
}

export function usePianoSpeakerHelp(deviceId = KIOSK_DEVICE_ID) {
  const [needsHelp, setNeedsHelp] = useState(false);
  const handle = useCallback((msg) => {
    if (!deviceId || msg?.deviceId !== deviceId) return;
    const next = msg.state === 'needs-help';
    setNeedsHelp((was) => {
      if (was !== next) logger().info(next ? 'piano.speaker-banner.shown' : 'piano.speaker-banner.cleared', { rung: msg.rung ?? null });
      return next;
    });
  }, [deviceId]);
  useWebSocketSubscription(PIANO_SPEAKER_TOPIC, handle, [handle]);
  return needsHelp;
}

export default usePianoSpeakerHelp;
