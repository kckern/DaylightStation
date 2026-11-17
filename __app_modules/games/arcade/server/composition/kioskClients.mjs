import { FullyKioskRestClient } from '#adapters/devices/FullyKioskRestClient.mjs';
import { DaylightAndroidRestClient } from '#adapters/devices/DaylightAndroidRestClient.mjs';
import { DaylightAndroidArcadeKioskClient } from '../adapters/devices/DaylightAndroidArcadeKioskClient.mjs';

export const DAYLIGHT_ANDROID_PROVIDER = 'daylight-android';

/**
 * The kiosk client for one arcade device, chosen by `content_control.provider`.
 *
 * `daylight-android` gets the Android kiosk app's client, with the per-device
 * token from the household auth file (`{ <deviceId>: { token } }`). Everything
 * else gets Fully's REST client, built exactly as the arcade built it before
 * a second provider existed.
 *
 * @returns {{command: Function}|null} null when a daylight-android device has
 *   no address to call
 */
export function createArcadeKioskClient({ deviceId, control = {}, configService, httpClient, logger = console }) {
  if (control.provider === DAYLIGHT_ANDROID_PROVIDER) {
    if (!control.host) {
      logger.warn?.('arcade.kiosk.unconfigured', { deviceId, provider: control.provider });
      return null;
    }
    const token = control.token
      || (control.auth_ref ? configService?.getHouseholdAuth?.(control.auth_ref)?.[deviceId]?.token : null);
    return new DaylightAndroidArcadeKioskClient({
      restClient: new DaylightAndroidRestClient(
        { host: control.host, port: control.port, token: token || '' },
        { httpClient, logger },
      ),
    });
  }

  const password = control.password
    || (control.auth_ref ? configService?.getHouseholdAuth?.(control.auth_ref)?.password : null);
  return new FullyKioskRestClient(
    { host: control.host, port: control.port, password: password || '' },
    { httpClient, logger },
  );
}
