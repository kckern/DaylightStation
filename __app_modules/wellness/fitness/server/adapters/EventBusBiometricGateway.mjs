import { randomUUID } from 'node:crypto';

const TOPICS = Object.freeze({
  unlockRequest: 'fitness.unlock.request', unlockResult: 'fitness.unlock.result',
  enrollRequest: 'fitness.enroll.request', enrollProgress: 'fitness.enroll.progress', enrollResult: 'fitness.enroll.result',
  deleteRequest: 'fitness.fingerprint.delete.request', deleteResult: 'fitness.fingerprint.delete.result',
});

export class EventBusBiometricGateway {
  #eventBus; #logger; #idFn; #setTimer; #clearTimer; #pending = new Map(); #timeouts;
  constructor({ eventBus, logger = console, idFn = randomUUID, setTimer = setTimeout, clearTimer = clearTimeout,
    unlockTimeoutMs = 15000, enrollTimeoutMs = 60000, deleteTimeoutMs = 15000 }) {
    if (!eventBus?.broadcast || !eventBus?.onClientMessage) throw new Error('EventBusBiometricGateway requires eventBus');
    this.#eventBus = eventBus; this.#logger = logger; this.#idFn = idFn; this.#setTimer = setTimer; this.#clearTimer = clearTimer;
    this.#timeouts = { unlockTimeoutMs, enrollTimeoutMs, deleteTimeoutMs };
    eventBus.onClientMessage((_clientId, message) => this.#handle(message));
  }
  #request(topic, payload, timeoutMs, timeoutResult, onProgress) {
    const requestId = this.#idFn();
    return new Promise((resolve) => {
      const timer = this.#setTimer(() => this.#settle(requestId, timeoutResult), timeoutMs);
      this.#pending.set(requestId, { resolve, timer, onProgress });
      this.#eventBus.broadcast(topic, { requestId, ...payload });
    });
  }
  #settle(requestId, result) {
    const pending = this.#pending.get(requestId); if (!pending) return;
    this.#pending.delete(requestId); this.#clearTimer(pending.timer); pending.resolve(result);
  }
  #handle(message) {
    const requestId = message?.requestId; if (typeof requestId !== 'string') return;
    if (message.topic === TOPICS.unlockResult) {
      this.#settle(requestId, { matched: !!message.matched, userId: message.userId });
    } else if (message.topic === TOPICS.enrollProgress) {
      const pending = this.#pending.get(requestId);
      pending?.onProgress?.({ stage: message.stage, stagesTotal: message.stagesTotal });
    } else if (message.topic === TOPICS.enrollResult) {
      this.#settle(requestId, message.success ? { success: true, uuid: message.uuid }
        : { success: false, error: message.error || 'enroll-failed', ...(message.matchedUuid ? { matchedUuid: message.matchedUuid } : {}) });
    } else if (message.topic === TOPICS.deleteResult) {
      this.#settle(requestId, message.success ? { success: true } : { success: false, error: message.error || 'delete-failed' });
    }
  }
  requestUnlock(lockName, candidateUuids, { timeoutMs } = {}) {
    return this.#request(TOPICS.unlockRequest, { lockName, candidateUuids },
      Number.isFinite(timeoutMs) ? timeoutMs : this.#timeouts.unlockTimeoutMs, { matched: false, reason: 'timeout' });
  }
  requestEnroll({ finger, username, clientToken }) {
    return this.#request(TOPICS.enrollRequest, { finger, username }, this.#timeouts.enrollTimeoutMs,
      { success: false, error: 'timeout' }, ({ stage, stagesTotal }) => {
        this.#eventBus.broadcast(TOPICS.enrollProgress, { clientToken, stage, stagesTotal });
      });
  }
  requestDelete({ uuid }) {
    return this.#request(TOPICS.deleteRequest, { uuid }, this.#timeouts.deleteTimeoutMs, { success: false, error: 'timeout' });
  }
}
export default EventBusBiometricGateway;
