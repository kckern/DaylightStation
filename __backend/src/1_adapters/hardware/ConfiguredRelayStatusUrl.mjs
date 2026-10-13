/** Infrastructure projection of a configured relay's browser status endpoint. */
export class ConfiguredRelayStatusUrl {
  constructor({ configService, deviceId = 'kitchen-relay' } = {}) {
    this.configService = configService;
    this.deviceId = deviceId;
  }

  resolve() {
    const device = this.configService?.getDeviceConfig?.(this.deviceId);
    const host = device?.host || device?.mdns;
    return host
      ? `http://${host}${device.port && device.port !== 80 ? `:${device.port}` : ''}${device.endpoints?.status || '/status'}`
      : null;
  }
}

export default ConfiguredRelayStatusUrl;
