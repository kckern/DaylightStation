import { IPushDeviceRegistry } from '#apps/notification/ports/IPushDeviceRegistry.mjs';

/**
 * The phones connected to this process. In memory on purpose: a connection
 * does not survive a restart, so neither does its record.
 */
export class InMemoryPushDeviceRegistry extends IPushDeviceRegistry {
  #byUser = new Map();

  recordHello({ username, deviceId, connectionId, atMs }) {
    this.#byUser.set(username, { deviceId, connectionId, lastSeenMs: atMs });
  }

  forget(connectionId) {
    for (const [username, phone] of this.#byUser) {
      if (phone.connectionId === connectionId) this.#byUser.delete(username);
    }
  }

  currentFor(username) {
    const phone = this.#byUser.get(username);
    return phone ? { ...phone } : null;
  }
}
