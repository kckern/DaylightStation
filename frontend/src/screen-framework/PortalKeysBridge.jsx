import { usePortalKeys } from './usePortalKeys.js';
import { usePortalHidKeyboard } from './usePortalHidKeyboard.js';

/**
 * Renderless bridge from the Portal panel's physical buttons to the screen's
 * software master volume.
 *
 * Must be mounted INSIDE ScreenVolumeProvider — it consumes ScreenVolumeContext.
 *
 * Opt-in per screen (`portalKeys.enabled: true`) rather than always-on: only one
 * device runs the portal-keys APK, and leaving it enabled everywhere would have every
 * other kiosk retrying a WebSocket to a port nothing listens on.
 */
export function PortalKeysBridge({ config }) {
  const enabled = config?.enabled === true;
  usePortalKeys({
    enabled,
    port: config?.port,
  });
  usePortalHidKeyboard({
    enabled: enabled && config?.hidEnabled !== false,
    port: config?.hidPort,
  });
  return null;
}

export default PortalKeysBridge;
