/**
 * Shared PhoneInboxService singleton. The device factory's phone-inbox content
 * adapter queues commands into it and the device API's long-poll and ack routes read
 * and answer from it; both must be the same instance. Mirrors volumeBoost.mjs.
 *
 * @module 5_composition/modules/phoneInbox
 */
import { PhoneInboxService } from '#apps/devices/services/PhoneInboxService.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';

/** @type {PhoneInboxService | null} */
let instance = null;

/** @param {{logger?:Object}} [opts] used only on first construction. */
export function getPhoneInboxService({ logger } = {}) {
  if (!instance) instance = new PhoneInboxService({ scheduler: new NodeApplicationScheduler(), ...(logger ? { logger } : {}) });
  return instance;
}

/**
 * The inbox's token check: true when the presented token is the device's own, else a
 * reason ("no_token_configured" when the household holds none for it). Compared in
 * constant time over digests, so neither the length nor the content leaks. Never logs
 * either token.
 * @param {{tokenFor:(deviceId:string)=>string}} deps
 */
export function createDeviceTokenCheck({ tokenFor }) {
  const digest = (v) => createHash('sha256').update(String(v)).digest();
  return (deviceId, presented) => {
    const expected = tokenFor(deviceId);
    if (!expected) return 'no_token_configured';
    if (typeof presented !== 'string' || !presented) return 'no_token';
    return timingSafeEqual(digest(expected), digest(presented)) ? true : 'wrong_token';
  };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  instance = null;
}
