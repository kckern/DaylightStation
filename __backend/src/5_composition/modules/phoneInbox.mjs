/**
 * Shared PhoneInboxService singleton. The device factory's phone-inbox content
 * adapter queues commands into it and the device API's long-poll and ack routes read
 * and answer from it; both must be the same instance. Mirrors volumeBoost.mjs.
 *
 * @module 5_composition/modules/phoneInbox
 */
import { PhoneInboxService } from '#apps/devices/services/PhoneInboxService.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';

/** @type {PhoneInboxService | null} */
let instance = null;

/** @param {{logger?:Object}} [opts] used only on first construction. */
export function getPhoneInboxService({ logger } = {}) {
  if (!instance) instance = new PhoneInboxService({ scheduler: new NodeApplicationScheduler(), ...(logger ? { logger } : {}) });
  return instance;
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  instance = null;
}
