import { FullyKioskRestClient } from '#adapters/devices/FullyKioskRestClient.mjs';
import { DaylightAndroidRestClient } from '#adapters/devices/DaylightAndroidRestClient.mjs';
import { DaylightAndroidArcadeKioskClient } from '../adapters/devices/DaylightAndroidArcadeKioskClient.mjs';

export const DAYLIGHT_ANDROID_PROVIDER = 'daylight-android';

/**
 * The control API client for one device on the Android kiosk app: its control
 * address from `content_control`, its token from the household auth file
 * (`{ <deviceId>: { token } }`, named by `auth_ref`). A token written into
 * devices.yml is ignored.
 *
 * @param {Object} [options.clientOptions] - extra DaylightAndroidRestClient config
 * @returns {DaylightAndroidRestClient|null} null when the device has no
 *   address to call or there is no http client
 */
export function createDaylightAndroidRestClient({ deviceId, control = {}, configService, httpClient, logger = console, clientOptions = {} }) {
  if (!control.host || !httpClient) return null;
  if (control.token) logger.warn?.('arcade.kiosk.inline_token_ignored', { deviceId });
  const token = control.auth_ref ? configService?.getHouseholdAuth?.(control.auth_ref)?.[deviceId]?.token : null;
  return new DaylightAndroidRestClient(
    { host: control.host, port: control.port, token: token || '', ...clientOptions },
    { httpClient, logger },
  );
}

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
    const restClient = createDaylightAndroidRestClient({ deviceId, control, configService, httpClient, logger });
    if (!restClient) {
      logger.warn?.('arcade.kiosk.unconfigured', { deviceId, provider: control.provider });
      return null;
    }
    return new DaylightAndroidArcadeKioskClient({ restClient });
  }

  const password = control.password
    || (control.auth_ref ? configService?.getHouseholdAuth?.(control.auth_ref)?.password : null);
  return new FullyKioskRestClient(
    { host: control.host, port: control.port, password: password || '' },
    { httpClient, logger },
  );
}
