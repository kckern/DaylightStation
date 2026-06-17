// backend/src/3_applications/fitness/unlockBroker.mjs

import { randomUUID } from 'node:crypto';

/**
 * Request/response correlator for fingerprint unlocks (transport-agnostic).
 *
 * The backend HTTP endpoint calls `requestUnlock(...)`, which publishes a
 * `fitness.unlock.request` event (via the injected `publish` callback) carrying
 * a generated `requestId` and returns a Promise. Later, the garage box's reply
 * — delivered by the WS eventbus — calls `resolveResult(...)` with that same
 * `requestId` to settle the matching pending promise.
 *
 * This module deliberately does NOT import the eventbus or `ws`: it only takes a
 * `publish` callback and exposes `resolveResult`. That separation is what makes
 * it unit-testable without a live socket. Timers and the id generator are
 * injectable so timeouts can be driven deterministically in tests.
 *
 * @param {object} deps
 * @param {(topic: string, payload: object) => void} deps.publish - emits the unlock request
 * @param {number} deps.timeoutMs - ms to wait before resolving as a timeout
 * @param {(cb: Function, ms: number) => *} [deps.setTimeoutFn] - defaults to global setTimeout
 * @param {(handle: *) => void} [deps.clearTimeoutFn] - defaults to global clearTimeout
 * @param {() => string} [deps.idFn] - request id generator, defaults to crypto.randomUUID
 * @returns {{ requestUnlock: Function, resolveResult: Function }}
 */
export function createUnlockBroker({
  publish,
  timeoutMs,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  idFn = randomUUID,
} = {}) {
  /** requestId -> { resolve, timer } */
  const pending = new Map();

  function settle(requestId, result) {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    clearTimeoutFn(entry.timer);
    entry.resolve(result);
  }

  function requestUnlock({ lockName, candidateUuids }) {
    const requestId = idFn();
    return new Promise((resolve) => {
      const timer = setTimeoutFn(() => {
        settle(requestId, { matched: false, reason: 'timeout' });
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      publish('fitness.unlock.request', { requestId, lockName, candidateUuids });
    });
  }

  function resolveResult({ requestId, matched, userId }) {
    settle(requestId, { matched, userId });
  }

  return { requestUnlock, resolveResult };
}
