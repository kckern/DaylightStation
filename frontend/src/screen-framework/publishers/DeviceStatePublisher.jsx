// frontend/src/screen-framework/publishers/DeviceStatePublisher.jsx
//
// DeviceStatePublisher — renderless device-state publisher for apps OUTSIDE
// the screen-framework (fitness garage kiosk, piano tablet). Screen-framework
// screens get this wiring from ScreenRenderer + `publishState: true`; other
// kiosk apps mount this once at their root with an explicit device identity,
// and pair it with `usePlayerSessionBinding(() => playerRef.current)` at each
// Player mount. The registry-backed source publishes idle when nothing is
// registered and live play/pause/position when a bound Player is active.
//
// deviceId must be explicit (URL param or served config) — never inferred
// from UA/hostname, or a laptop opening the same route would impersonate the
// kiosk in the fleet.
import React, { useMemo } from 'react';
import { SessionStatePublisher } from './SessionStatePublisher.jsx';
import { createRegistrySessionSource } from './registrySessionSource.js';
import { getPlayerSessionRegistry } from './playerSessionRegistry.js';
import getLogger from '../../lib/logging/Logger.js';

export function DeviceStatePublisher({ deviceId }) {
  const source = useMemo(() => {
    if (!deviceId) return null;
    try {
      return createRegistrySessionSource({
        registry: getPlayerSessionRegistry(),
        ownerId: deviceId,
      });
    } catch (err) {
      getLogger().child({ component: 'DeviceStatePublisher' }).warn(
        'source-create-failed',
        { deviceId, error: String(err?.message ?? err) },
      );
      return null;
    }
  }, [deviceId]);

  if (!deviceId || !source) return null;
  return <SessionStatePublisher deviceId={deviceId} source={source} />;
}

export default DeviceStatePublisher;
