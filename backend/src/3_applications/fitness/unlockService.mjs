// backend/src/3_applications/fitness/unlockService.mjs

import { createUnlockBroker } from './unlockBroker.mjs';

/**
 * Live wiring for the fingerprint unlock flow.
 *
 * Bridges the transport-agnostic {@link createUnlockBroker} to the running
 * WebSocket eventbus:
 *
 *  - Outbound: the broker's `publish('fitness.unlock.request', ...)` is bound to
 *    `eventBus.broadcast(...)`. The bus topic-filters by client subscription, so
 *    the garage `daylight-fitness` client must `bus_command subscribe` to
 *    `fitness.unlock.request` (it does — see `_extensions/fitness/src/server.mjs`)
 *    to receive the request. This reuses the existing subscription mechanism
 *    rather than inventing new routing.
 *
 *  - Inbound: the garage replies with a `fitness.unlock.result` message
 *    (`{ topic, requestId, matched, userId }`). We register an
 *    `eventBus.onClientMessage` handler that recognizes that topic and forwards
 *    it to `broker.resolveResult(...)`, settling the pending promise.
 *
 * This module is a process-level singleton: the first `initUnlockService` call
 * constructs the broker and registers the inbound handler; later calls return
 * the same instance. The FingerprintManager admin-auth gate imports `requestUnlock`.
 *
 * @module 3_applications/fitness/unlockService
 */

export const UNLOCK_REQUEST_TOPIC = 'fitness.unlock.request';
export const UNLOCK_RESULT_TOPIC = 'fitness.unlock.result';

const DEFAULT_TIMEOUT_MS = 15000;

let singleton = null;

/**
 * Construct the unlock service against a live eventbus and register the inbound
 * result handler. Idempotent: returns the existing instance on repeat calls
 * AND ignores the new args (eventBus/timeoutMs/logger) — the first init wins.
 * App bootstrap performs the one real init; downstream consumers (e.g. Task 2.4's
 * HTTP router) should use {@link getUnlockService} rather than calling init with
 * their own deps, to avoid silently relying on discarded config.
 *
 * @param {object} deps
 * @param {object} deps.eventBus - WebSocketEventBus (needs `broadcast` + `onClientMessage`)
 * @param {number} [deps.timeoutMs] - request timeout in ms
 * @param {object} [deps.logger] - optional structured logger
 * @returns {{ requestUnlock: (lockName: string, candidateUuids: Array) => Promise<object> }}
 */
export function initUnlockService({ eventBus, timeoutMs = DEFAULT_TIMEOUT_MS, logger } = {}) {
  if (singleton) return singleton;
  // Both methods are mandatory: broadcast carries the request out, onClientMessage
  // carries the result back. Validating only one would let init "succeed" while every
  // reply silently vanished and every request timed out after timeoutMs with no signal.
  if (!eventBus || typeof eventBus.broadcast !== 'function' || typeof eventBus.onClientMessage !== 'function') {
    throw new Error('initUnlockService: eventBus with broadcast() and onClientMessage() methods is required');
  }

  const log = logger || console;

  const broker = createUnlockBroker({
    timeoutMs,
    publish: (topic, payload) => {
      // The garage client filters by subscription; broadcast handles framing.
      eventBus.broadcast(topic, payload);
      log.debug?.('fitness.unlock.request.published', {
        requestId: payload?.requestId,
        lockName: payload?.lockName,
        candidates: payload?.candidateUuids?.length ?? 0,
      });
    },
  });

  // Inbound: route `fitness.unlock.result` messages from the garage box back to
  // the broker. onClientMessage fires for every client message that isn't a
  // built-in bus_command/identify; we narrow to our result topic.
  eventBus.onClientMessage((_clientId, message) => {
    if (!message || message.topic !== UNLOCK_RESULT_TOPIC) return;
    if (typeof message.requestId !== 'string') {
      log.warn?.('fitness.unlock.result.invalid', { reason: 'missing-requestId' });
      return;
    }
    log.debug?.('fitness.unlock.result.received', {
      requestId: message.requestId,
      matched: !!message.matched,
    });
    broker.resolveResult({
      requestId: message.requestId,
      matched: !!message.matched,
      userId: message.userId,
    });
  });

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
      return broker.requestUnlock({ lockName, candidateUuids, timeoutMs: opts?.timeoutMs });
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
