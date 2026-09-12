/**
 * Puts a countdown surface in front of a device, and takes it away again.
 *
 * Arming is durable device state: on a kiosk it renders over everything that
 * screen shows, not only over games. So the contract is deliberately small and
 * symmetric — there is exactly one way to put it up and one way to take it
 * down, and `disarm` must be safe to call on a device that has none.
 */
export class IPlayOverlay {
  /** @param {string} _deviceId @param {string} _url */
  async arm(_deviceId, _url) { throw new Error('IPlayOverlay.arm must be implemented'); }
  /** Idempotent: clearing an already-clear device is not an error. */
  async disarm(_deviceId) { throw new Error('IPlayOverlay.disarm must be implemented'); }
}
