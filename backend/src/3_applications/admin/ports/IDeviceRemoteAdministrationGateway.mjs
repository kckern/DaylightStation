/**
 * Transport-neutral boundary for administering a registered remote device.
 *
 * The application layer deals in semantic operations. Vendor commands,
 * credentials, addresses, and response formats remain behind this port.
 */
export class IDeviceRemoteAdministrationGateway {
  async readStatus(_deviceId) { throw new Error('Not implemented'); }
  async captureScreenshot(_deviceId) { throw new Error('Not implemented'); }
  async readSettings(_deviceId) { throw new Error('Not implemented'); }
  async executeAction(_deviceId, _action, _params) { throw new Error('Not implemented'); }
  async writeSetting(_deviceId, _key, _value) { throw new Error('Not implemented'); }
}

export default IDeviceRemoteAdministrationGateway;
