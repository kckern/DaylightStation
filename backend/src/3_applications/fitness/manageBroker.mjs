// backend/src/3_applications/fitness/manageBroker.mjs
import { randomUUID } from 'node:crypto';

/**
 * Request/response correlator for fingerprint ENROLL and DELETE over an injected
 * `publish` callback (transport-agnostic, like unlockBroker). Enroll additionally
 * forwards streamed progress to a per-request `onProgress` callback. Timers and
 * the id generator are injectable for deterministic tests.
 *
 * @param {object} deps
 * @param {(topic: string, payload: object) => void} deps.publish
 * @param {number} [deps.enrollTimeoutMs] - default 60000
 * @param {number} [deps.deleteTimeoutMs] - default 15000
 * @param {Function} [deps.setTimeoutFn]
 * @param {Function} [deps.clearTimeoutFn]
 * @param {() => string} [deps.idFn]
 */
export function createManageBroker({
  publish,
  enrollTimeoutMs = 60000,
  deleteTimeoutMs = 15000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  idFn = randomUUID,
} = {}) {
  /** requestId -> { resolve, timer, onProgress? } */
  const pending = new Map();

  function settle(requestId, result) {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    clearTimeoutFn(entry.timer);
    entry.resolve(result);
  }

  function requestEnroll({ finger, username, onProgress } = {}) {
    const requestId = idFn();
    return new Promise((resolve) => {
      const timer = setTimeoutFn(() => settle(requestId, { success: false, error: 'timeout' }), enrollTimeoutMs);
      pending.set(requestId, { resolve, timer, onProgress });
      publish('fitness.enroll.request', { requestId, finger, username });
    });
  }

  function handleEnrollProgress({ requestId, stage, stagesTotal } = {}) {
    pending.get(requestId)?.onProgress?.({ stage, stagesTotal });
  }

  function resolveEnrollResult({ requestId, success, uuid, error, matchedUuid } = {}) {
    const result = success
      ? { success: true, uuid }
      : { success: false, error: error || 'enroll-failed', ...(matchedUuid ? { matchedUuid } : {}) };
    settle(requestId, result);
  }

  function requestDelete({ uuid } = {}) {
    const requestId = idFn();
    return new Promise((resolve) => {
      const timer = setTimeoutFn(() => settle(requestId, { success: false, error: 'timeout' }), deleteTimeoutMs);
      pending.set(requestId, { resolve, timer });
      publish('fitness.fingerprint.delete.request', { requestId, uuid });
    });
  }

  function resolveDeleteResult({ requestId, success, error } = {}) {
    settle(requestId, success ? { success: true } : { success: false, error: error || 'delete-failed' });
  }

  return { requestEnroll, handleEnrollProgress, resolveEnrollResult, requestDelete, resolveDeleteResult };
}
