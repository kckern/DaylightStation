import { useEffect } from 'react';

/**
 * Tell `lib/deviceIdentity.js` which fleet device this screen is.
 *
 * `getDeviceId()` reads `window.__DAYLIGHT_DEVICE_ID` first and signs every
 * request with `fleet:<name>` when it is set; until 2026-09-08 nothing set it,
 * so every screen in the house identified itself as an anonymous
 * `browser:<token>`. The one request that cares — a TV joining a Home Line
 * lease — was refused on every attempt because of that.
 *
 * The name comes from the screen's own served config
 * (`websocket.guardrails.device`), never from a route param: a route can name
 * any device, the config names this one.
 *
 * @param {string|undefined} deviceId fleet name from the screen config
 */
export function useFleetDeviceIdentity(deviceId) {
  useEffect(() => {
    if (typeof window === 'undefined' || !deviceId) return undefined;
    window.__DAYLIGHT_DEVICE_ID = deviceId;
    return () => {
      if (window.__DAYLIGHT_DEVICE_ID === deviceId) delete window.__DAYLIGHT_DEVICE_ID;
    };
  }, [deviceId]);
}

export default useFleetDeviceIdentity;
