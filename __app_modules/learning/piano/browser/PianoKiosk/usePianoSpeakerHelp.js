import { useCallback, useEffect, useRef, useState } from 'react';
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

const QUIET = { needsHelp: false, told: false };

/**
 * @returns {{needsHelp: boolean, told: boolean}} `told` is true only when a push
 *   actually reached a person, so the banner never claims one did when it did not.
 */
export function usePianoSpeakerHelp(deviceId = KIOSK_DEVICE_ID) {
  const [help, setHelp] = useState(QUIET);
  const handle = useCallback((msg) => {
    if (!deviceId || msg?.deviceId !== deviceId) return;
    const next = msg.state === 'needs-help' ? { needsHelp: true, told: msg.told === true } : QUIET;
    setHelp((was) => (was.needsHelp === next.needsHelp && was.told === next.told ? was : next));
  }, [deviceId]);
  useWebSocketSubscription(PIANO_SPEAKER_TOPIC, handle, [handle]);

  // Logged from an effect, not the state updater: updaters may run twice.
  const shown = useRef(false);
  useEffect(() => {
    if (help.needsHelp === shown.current) return;
    shown.current = help.needsHelp;
    logger().info(help.needsHelp ? 'piano.speaker-banner.shown' : 'piano.speaker-banner.cleared', { told: help.told });
  }, [help]);
  return help;
}

export default usePianoSpeakerHelp;
