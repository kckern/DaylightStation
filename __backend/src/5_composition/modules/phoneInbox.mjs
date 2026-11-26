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
 * constant time over digests, so neither the length nor the content leaks. On a miss
 * the auth file is read again from disk (at most once a minute per device), so a
 * rotated token works without a restart. Never logs either token.
 * @param {{tokenFor:(deviceId:string, opts?:{fresh?:boolean})=>string, now?:()=>number, logger?:Object}} deps
 */
export function createDeviceTokenCheck({ tokenFor, now = () => Date.now(), logger = null }) {
  const digest = (v) => createHash('sha256').update(String(v)).digest();
  const lastFresh = new Map();
  const matches = (expected, presented) => !!expected && timingSafeEqual(digest(expected), digest(presented));
  return (deviceId, presented) => {
    if (typeof presented !== 'string' || !presented) return 'no_token';
    let expected = tokenFor(deviceId);
    if (matches(expected, presented)) return true;
    const at = now();
    if (at - (lastFresh.get(deviceId) ?? -Infinity) >= 60_000) {
      lastFresh.set(deviceId, at);
      expected = tokenFor(deviceId, { fresh: true });
      logger?.info?.('phone-inbox.token.reloaded', { deviceId, configured: !!expected });
      if (matches(expected, presented)) return true;
    }
    return expected ? 'wrong_token' : 'no_token_configured';
  };
}

/** Test-only: reset the module singleton. */
export function _resetForTests() {
  instance = null;
}
