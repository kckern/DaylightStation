/** A device Bluetooth port reports observed state and accepts bounded lifecycle commands. */
export class IDeviceBluetooth {
  async state() { throw new Error('state must be implemented'); }
  async command(_action, _body) { throw new Error('command must be implemented'); }
}
