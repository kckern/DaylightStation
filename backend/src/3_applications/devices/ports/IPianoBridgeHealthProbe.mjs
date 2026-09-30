/**
 * Reads the piano-bridge APK's health from OUTSIDE the tablet.
 *
 * `readHealth()` never throws. An unreachable bridge is a normal answer
 * (`reachable: false`), because that is exactly the state the supervisor exists
 * to notice.
 *
 * @typedef {Object} PianoBridgeHealth
 * @property {boolean} reachable - the control plane answered
 * @property {string|null} ble - e.g. 'CONNECTED'
 * @property {boolean|null} outVerified - the piano echoed our probe recently;
 *   null when the loopback endpoint could not be read
 * @property {string|null} error - why it was unreachable
 */
export class IPianoBridgeHealthProbe {
  /** @returns {Promise<PianoBridgeHealth>} */
  async readHealth() { throw new Error('IPianoBridgeHealthProbe.readHealth must be implemented'); }
}
