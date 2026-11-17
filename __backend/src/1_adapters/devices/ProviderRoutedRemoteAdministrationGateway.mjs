import { IDeviceRemoteAdministrationGateway } from '#apps/admin/ports/IDeviceRemoteAdministrationGateway.mjs';

/**
 * Remote administration for a fleet that mixes kiosk providers.
 *
 * Each call goes to the gateway registered for the device's
 * `content_control.provider`. Everything else goes to `fallback`: a device on
 * the fallback's own provider, a device with another provider or none, an
 * unknown device and a malformed id. The fallback gateway already validates
 * all of those, so its errors and codes stay exactly as they were before a
 * second provider existed.
 */
export class ProviderRoutedRemoteAdministrationGateway extends IDeviceRemoteAdministrationGateway {
  #readDevices;
  #gateways;
  #fallback;

  /**
   * @param {Object} deps
   * @param {Function} deps.readDevices - () => devices map from devices.yml
   * @param {Object<string, IDeviceRemoteAdministrationGateway>} [deps.gateways] - by provider name
   * @param {IDeviceRemoteAdministrationGateway} deps.fallback
   */
  constructor({ readDevices, gateways = {}, fallback } = {}) {
    super();
    if (typeof readDevices !== 'function') throw new Error('ProviderRoutedRemoteAdministrationGateway requires readDevices');
    if (!fallback) throw new Error('ProviderRoutedRemoteAdministrationGateway requires fallback');
    this.#readDevices = readDevices;
    this.#gateways = new Map(Object.entries(gateways));
    this.#fallback = fallback;
  }

  readStatus(deviceId) { return this.#for(deviceId).readStatus(deviceId); }
  captureScreenshot(deviceId) { return this.#for(deviceId).captureScreenshot(deviceId); }
  readSettings(deviceId) { return this.#for(deviceId).readSettings(deviceId); }
  executeAction(deviceId, action, params) { return this.#for(deviceId).executeAction(deviceId, action, params); }
  writeSetting(deviceId, key, value) { return this.#for(deviceId).writeSetting(deviceId, key, value); }

  #for(deviceId) {
    if (typeof deviceId !== 'string') return this.#fallback;
    const devices = this.#readDevices();
    const source = devices && Object.hasOwn(devices, deviceId) ? devices[deviceId] : null;
    return this.#gateways.get(source?.content_control?.provider) ?? this.#fallback;
  }
}

export default ProviderRoutedRemoteAdministrationGateway;
