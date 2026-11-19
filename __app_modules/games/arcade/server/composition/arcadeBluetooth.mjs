import { createArcadeBluetoothRouter } from '../api/arcadeBluetooth.mjs';
import { AudioBridgeBluetoothAdapter } from '../adapters/devices/AudioBridgeBluetoothAdapter.mjs';
import { DaylightAndroidBluetoothAdapter } from '../adapters/devices/DaylightAndroidBluetoothAdapter.mjs';
import { ArcadeBluetoothService } from '../application/services/ArcadeBluetoothService.mjs';
import { createDaylightAndroidRestClient, DAYLIGHT_ANDROID_PROVIDER } from './kioskClients.mjs';

/**
 * Controller pairing reaches a device one of two ways.
 *
 * A device that names a `bluetooth_bridge.url` is reached there: the
 * audio-bridge app on its own port, with no token. That path is unchanged.
 *
 * A device whose `content_control.provider` is `daylight-android` serves the
 * same routes from the kiosk app itself, on its control port and behind the
 * control API token. It still opts in with a `bluetooth_bridge` block (which
 * also carries the pairing guide); a `url` in that block is ignored.
 *
 * `configService` and `httpClient` are needed only for the second kind.
 */
export function createArcadeBluetoothService({ devicesConfig = {}, fetchImpl, timeoutMs, configService = null, httpClient = null, logger }) {
  const devices = devicesConfig.devices || devicesConfig;
  const adapters = new Map();
  const controlPortAdapters = new Map();

  const controlPortAdapter = (deviceId, device) => {
    const bridge = device.bluetooth_bridge;
    if (!bridge || typeof bridge !== 'object') return null;
    if (bridge.url) logger?.warn?.('arcade.bluetooth.bridge_url_ignored', { deviceId });
    const restClient = createDaylightAndroidRestClient({
      deviceId, control: device.content_control, configService, httpClient, logger,
      // A refused pairing can quote the PIN; none of the device's words are logged.
      clientOptions: { logDeviceText: false },
    });
    if (!restClient) {
      logger?.warn?.('arcade.bluetooth.unconfigured', { deviceId, provider: DAYLIGHT_ANDROID_PROVIDER });
      return null;
    }
    return new DaylightAndroidBluetoothAdapter({ restClient, ...(timeoutMs ? { timeoutMs } : {}) });
  };

  return new ArcadeBluetoothService({
    deviceFor: (deviceId) => Object.hasOwn(devices, deviceId) ? devices[deviceId] : null,
    adapterFor: (baseUrl) => {
      if (!adapters.has(baseUrl)) adapters.set(baseUrl, new AudioBridgeBluetoothAdapter({ baseUrl, fetchImpl, timeoutMs }));
      return adapters.get(baseUrl);
    },
    adapterForDevice: (deviceId, device) => {
      if (device?.content_control?.provider !== DAYLIGHT_ANDROID_PROVIDER) return null;
      if (!controlPortAdapters.has(deviceId)) controlPortAdapters.set(deviceId, controlPortAdapter(deviceId, device));
      const adapter = controlPortAdapters.get(deviceId);
      return adapter ? { adapter } : { unavailable: true };
    },
    logger,
  });
}

export function createArcadeBluetoothRuntime(options) {
  return createArcadeBluetoothRouter({ service: createArcadeBluetoothService(options), logger: options.logger });
}
