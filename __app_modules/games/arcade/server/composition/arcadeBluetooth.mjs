import { createArcadeBluetoothRouter } from '../api/arcadeBluetooth.mjs';
import { AudioBridgeBluetoothAdapter } from '../adapters/devices/AudioBridgeBluetoothAdapter.mjs';
import { ArcadeBluetoothService } from '../application/services/ArcadeBluetoothService.mjs';
export function createArcadeBluetoothService({ devicesConfig = {}, fetchImpl, timeoutMs, logger }) {
  const devices = devicesConfig.devices || devicesConfig;
  const adapters = new Map();
  return new ArcadeBluetoothService({
    deviceFor: (deviceId) => Object.hasOwn(devices, deviceId) ? devices[deviceId] : null,
    adapterFor: (baseUrl) => {
      if (!adapters.has(baseUrl)) adapters.set(baseUrl, new AudioBridgeBluetoothAdapter({ baseUrl, fetchImpl, timeoutMs }));
      return adapters.get(baseUrl);
    }, logger,
  });
}

export function createArcadeBluetoothRuntime(options) {
  return createArcadeBluetoothRouter({ service: createArcadeBluetoothService(options), logger: options.logger });
}
