/** Lease-backed guard used by legacy device power endpoints. */

import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({
  source: 'backend',
  app: 'homeline-call-state'
});

let leaseAuthority = null;

export function setCallLeaseAuthority(authority) {
  leaseAuthority = authority || null;
}

export function hasActiveCall(deviceId) {
  return leaseAuthority?.hasActive?.(deviceId) === true;
}

export function forceEndCall(deviceId) {
  if (leaseAuthority?.hasActive?.(deviceId)) {
    logger.warn('call-state.force-end-blocked', { deviceId, reason: 'lease_authority_required' });
    return false;
  }
  logger.info('call-state.force-noop', { deviceId, reason: 'no_active_lease' });
  return true;
}
