// backend/src/3_applications/fitness/unlockService.mjs

import { isBiometricGateway } from './ports/IBiometricGateway.mjs';

/** Process-level fingerprint unlock service over a semantic biometric gateway. */

let singleton = null;

/**
 * Construct the unlock service. Idempotent: the first gateway wins.
 * App bootstrap performs the one real init; downstream consumers (e.g. Task 2.4's
 * HTTP router) should use {@link getUnlockService} rather than calling init with
 * their own deps, to avoid silently relying on discarded config.
 *
 * @param {object} deps
 * @param {object} deps.biometricGateway
 * @returns {{ requestUnlock: (lockName: string, candidateUuids: Array) => Promise<object> }}
 */
export function initUnlockService({ biometricGateway } = {}) {
  if (singleton) return singleton;
  if (!isBiometricGateway(biometricGateway)) {
    throw new Error('initUnlockService: biometricGateway is required');
  }

  singleton = {
    /**
     * Request a fingerprint unlock and await the garage box's verdict.
     * Used by the FingerprintManager admin-auth gate (routed through the garage
     * reader arbiter as a preempting `manage` kind).
     * @param {string} lockName
     * @param {Array<{uuid: string, username: string}>|Array<string>} candidateUuids
     * @param {{ timeoutMs?: number }} [opts] - per-call timeout override; omit for the default 15s.
     * @returns {Promise<{matched: boolean, userId?: string, reason?: string}>}
     */
    requestUnlock(lockName, candidateUuids, opts = {}) {
      return biometricGateway.requestUnlock(lockName, candidateUuids, opts);
    },
  };
  return singleton;
}

/**
 * @returns {object|null} the initialized service, or null if not yet wired
 */
export function getUnlockService() {
  return singleton;
}

/** Test seam: drop the singleton so each test wires a fresh fake bus. */
export function _resetUnlockServiceForTests() {
  singleton = null;
}
