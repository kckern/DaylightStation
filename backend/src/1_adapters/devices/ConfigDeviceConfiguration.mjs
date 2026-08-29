import { IDeviceConfiguration } from '#apps/devices/ports/IDeviceConfiguration.mjs';

export class ConfigDeviceConfiguration extends IDeviceConfiguration {
  #config;
  constructor({ configService }) { super(); this.#config = configService; }
  householdDevices(householdId) { return this.#config.getHouseholdDevices(householdId); }
  device(deviceId) { return this.#config?.getDeviceConfig ? this.#config.getDeviceConfig(deviceId) : null; }
  piano() { return this.#config?.getHouseholdAppConfig?.(null, 'piano') || {}; }
}
