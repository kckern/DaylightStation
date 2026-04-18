/**
 * ISessionControl Port — Session command relay + snapshot access.
 *
 * Abstraction for the HTTP→WebSocket command bridge used by the
 * media-foundation session endpoints. An ISessionControl is the surface
 * applications use to:
 *
 *   - relay a structured command envelope to a screen (`sendCommand`)
 *     and await the matching `device-ack` reply,
 *   - read the most recent known `SessionSnapshot` for a device
 *     (`getSnapshot`),
 *   - wait for a future `device-state` broadcast that satisfies a predicate
 *     (`waitForStateChange`) — used by the `claim` flow to confirm a
 *     publisher transition before returning to the HTTP caller.
 *
 * The concrete implementation is `SessionControlService`, which composes
 * `IEventBus` + `DeviceLivenessService`. Routers, use-cases, and agents
 * depend only on this port.
 *
 * @module applications/devices/ports
 */

/**
 * @typedef {Object} SendCommandResult
 * @property {boolean} ok
 * @property {string}  [commandId]
 * @property {string}  [appliedAt]
 * @property {string}  [error]
 * @property {string}  [code]
 * @property {Object}  [lastKnown]
 */

/**
 * @typedef {Object} SnapshotEntry
 * @property {Object}  snapshot
 * @property {string}  lastSeenAt
 * @property {boolean} online
 */

/**
 * Check if object implements ISessionControl.
 * @param {any} obj
 * @returns {boolean}
 */
export function isSessionControl(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.sendCommand === 'function' &&
    typeof obj.getSnapshot === 'function' &&
    typeof obj.waitForStateChange === 'function'
  );
}

/**
 * Assert that object implements ISessionControl.
 * @param {any} obj
 * @param {string} [context]
 * @throws {Error} if object doesn't implement interface
 */
export function assertSessionControl(obj, context = 'SessionControl') {
  if (!isSessionControl(obj)) {
    throw new Error(`${context} must implement ISessionControl interface`);
  }
}

/**
 * Create a no-op session control (for deployments without this capability).
 * Every method resolves/rejects with an explicit "not configured" signal so
 * callers can distinguish "missing service" from "device offline".
 * @returns {Object}
 */
export function createNoOpSessionControl() {
  return {
    sendCommand: async () => ({ ok: false, error: 'SessionControl not configured' }),
    getSnapshot: () => null,
    waitForStateChange: () => Promise.reject(new Error('SessionControl not configured')),
  };
}

export default {
  isSessionControl,
  assertSessionControl,
  createNoOpSessionControl,
};
