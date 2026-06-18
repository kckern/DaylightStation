// backend/src/3_applications/fitness/manageService.mjs
import { createManageBroker } from './manageBroker.mjs';

export const ENROLL_REQUEST_TOPIC = 'fitness.enroll.request';
export const ENROLL_PROGRESS_TOPIC = 'fitness.enroll.progress';
export const ENROLL_RESULT_TOPIC = 'fitness.enroll.result';
export const DELETE_RESULT_TOPIC = 'fitness.fingerprint.delete.result';

let singleton = null;

/**
 * Wire the enroll/delete broker to the live WebSocket eventbus. Outbound requests
 * go via broadcast (the garage client subscribes to the request topics); inbound
 * `fitness.enroll.progress|result` and `fitness.fingerprint.delete.result` client
 * messages are routed back to the broker. Enroll progress is rebroadcast to the
 * browser tagged with the caller's `clientToken` so the manager UI can show stages.
 * Idempotent singleton (first init wins), mirroring unlockService.
 *
 * @param {object} deps
 * @param {object} deps.eventBus - needs broadcast() + onClientMessage()
 * @param {object} [deps.logger]
 */
export function initManageService({ eventBus, logger } = {}) {
  if (singleton) return singleton;
  if (!eventBus || typeof eventBus.broadcast !== 'function' || typeof eventBus.onClientMessage !== 'function') {
    throw new Error('initManageService: eventBus with broadcast() and onClientMessage() is required');
  }
  const log = logger || console;

  const broker = createManageBroker({
    publish: (topic, payload) => eventBus.broadcast(topic, payload),
  });

  eventBus.onClientMessage((_clientId, message) => {
    if (!message || typeof message.requestId !== 'string') return;
    switch (message.topic) {
      case ENROLL_PROGRESS_TOPIC:
        broker.handleEnrollProgress({ requestId: message.requestId, stage: message.stage, stagesTotal: message.stagesTotal });
        break;
      case ENROLL_RESULT_TOPIC:
        log.debug?.('fitness.fingerprint.enroll.result', { requestId: message.requestId, success: !!message.success });
        broker.resolveEnrollResult({ requestId: message.requestId, success: !!message.success, uuid: message.uuid, error: message.error });
        break;
      case DELETE_RESULT_TOPIC:
        log.debug?.('fitness.fingerprint.delete.result', { requestId: message.requestId, success: !!message.success });
        broker.resolveDeleteResult({ requestId: message.requestId, success: !!message.success, error: message.error });
        break;
      default:
        break;
    }
  });

  singleton = {
    requestEnroll({ finger, username, clientToken }) {
      return broker.requestEnroll({
        finger,
        username,
        onProgress: ({ stage, stagesTotal }) =>
          eventBus.broadcast(ENROLL_PROGRESS_TOPIC, { clientToken, stage, stagesTotal }),
      });
    },
    requestDelete({ uuid }) {
      return broker.requestDelete({ uuid });
    },
  };
  return singleton;
}

export function getManageService() {
  return singleton;
}

export function _resetManageServiceForTests() {
  singleton = null;
}
