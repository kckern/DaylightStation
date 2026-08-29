import { buildCommandEnvelope, buildDeviceStateBroadcast, validateCommandEnvelope } from '#shared-contracts/media/envelopes.mjs';
import { COMMAND_HANDLER_PRESENCE_TOPIC_PREFIX, DEVICE_ACK_TOPIC, DEVICE_STATE_TOPIC, SCREEN_COMMAND_TOPIC, parseDeviceTopic } from '#shared-contracts/media/topics.mjs';
import { ERROR_CODES } from '#shared-contracts/media/errors.mjs';

const HOMELINE_TOPIC = (deviceId) => `homeline:${deviceId}`;

export class EventBusDeviceTransportGateway {
  #eventBus; #broadcastEvent; #setTimer; #clearTimer;
  constructor({ eventBus, broadcastEvent = null, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.#eventBus = eventBus; this.#broadcastEvent = broadcastEvent; this.#setTimer = setTimer; this.#clearTimer = clearTimer;
  }
  buildCommand(command) { return buildCommandEnvelope(command); }
  validateCommand(command) { return validateCommandEnvelope(command); }

  sendCommand(deviceId, command, { timeoutMs = 5000 } = {}) {
    const commandId = command.commandId;
    return new Promise((resolve) => {
      let unsubscribe = null; let timer = null; let settled = false;
      const cleanup = () => { if (settled) return; settled = true; if (timer != null) this.#clearTimer(timer); try { unsubscribe?.(); } catch {} };
      const finish = (payload) => {
        if (settled || payload?.commandId !== commandId) return;
        cleanup();
        resolve({ ok: payload.ok === true, commandId,
          ...(payload.appliedAt !== undefined ? { appliedAt: payload.appliedAt } : {}),
          ...(payload.error !== undefined ? { error: payload.error } : {}),
          ...(payload.code !== undefined ? { code: payload.code } : {}) });
      };
      if (typeof this.#eventBus?.subscribePattern !== 'function') {
        resolve({ ok: false, code: 'BUS_MISCONFIGURED', error: 'eventBus lacks subscribePattern' }); return;
      }
      unsubscribe = this.#eventBus.subscribePattern((topic) => topic === DEVICE_ACK_TOPIC(deviceId), finish);
      timer = this.#setTimer(() => { cleanup(); resolve({ ok: false, code: ERROR_CODES.DEVICE_REFUSED, error: 'Timeout waiting for ack', commandId }); }, timeoutMs);
      try {
        const publish = this.#eventBus.broadcast?.bind(this.#eventBus) ?? this.#eventBus.publish?.bind(this.#eventBus);
        if (!publish) throw new Error('eventBus has no broadcast/publish method');
        publish(SCREEN_COMMAND_TOPIC(deviceId), command);
      } catch (error) { cleanup(); resolve({ ok: false, code: 'BUS_PUBLISH_ERROR', error: error.message || 'publish failed' }); }
    });
  }

  waitForStateChange(deviceId, predicate, timeoutMs) {
    if (!deviceId || typeof deviceId !== 'string') return Promise.reject(new Error('deviceId required'));
    if (typeof predicate !== 'function') return Promise.reject(new Error('predicate must be a function'));
    return this.#waitForTopic(DEVICE_STATE_TOPIC(deviceId), (payload) => {
      const snapshot = payload?.snapshot; return snapshot && predicate(snapshot) ? snapshot : undefined;
    }, timeoutMs, `waitForStateChange timed out after ${timeoutMs}ms for ${deviceId}`, 'STATE_WAIT_TIMEOUT');
  }

  #waitForTopic(topic, project, timeoutMs, message, code) {
    return new Promise((resolve, reject) => {
      let unsubscribe = null; let timer = null;
      const cleanup = () => { if (timer) this.#clearTimer(timer); try { unsubscribe?.(); } catch {} };
      if (typeof this.#eventBus?.subscribePattern !== 'function') { reject(new Error('eventBus lacks subscribePattern')); return; }
      unsubscribe = this.#eventBus.subscribePattern((candidate) => candidate === topic, (payload) => {
        let result; try { result = project(payload); } catch { return; }
        if (result === undefined) return; cleanup(); resolve(result);
      });
      timer = this.#setTimer(() => { cleanup(); const error = new Error(message); error.code = code; reject(error); }, timeoutMs);
    });
  }

  subscribeDeviceStates(listener) {
    if (typeof this.#eventBus?.subscribePattern !== 'function') return null;
    return this.#eventBus.subscribePattern((topic) => parseDeviceTopic(topic)?.kind === 'device-state',
      (payload, topic) => listener({ deviceId: payload?.deviceId, snapshot: payload?.snapshot, reason: payload?.reason, ts: payload?.ts, topic }));
  }
  publishDeviceState({ deviceId, snapshot, reason, ts }) {
    const publish = this.#eventBus.broadcast?.bind(this.#eventBus) ?? this.#eventBus.publish?.bind(this.#eventBus);
    return publish?.(DEVICE_STATE_TOPIC(deviceId), buildDeviceStateBroadcast({ deviceId, snapshot, reason, ts }));
  }
  subscribeHandlerActivity(listener) {
    return this.#eventBus.onClientMessage((_clientId, message) => {
      const topic = message?.topic; if (typeof topic !== 'string') return;
      if (topic.startsWith(COMMAND_HANDLER_PRESENCE_TOPIC_PREFIX)) {
        const deviceId = message.deviceId || topic.slice(COMMAND_HANDLER_PRESENCE_TOPIC_PREFIX.length);
        if (deviceId) listener({ kind: 'presence', deviceId, online: message.online !== false });
      } else if (topic === 'device-ack' && message.deviceId) listener({ kind: 'ack', deviceId: message.deviceId, commandId: message.commandId });
    });
  }
  subscribeScreenPresence(listener) {
    return this.#eventBus.onClientMessage((clientId, message) => {
      if (message?.type !== 'screen.presence' || !message.deviceId) return;
      listener({
        clientId,
        deviceId: message.deviceId,
        active: message.active === true,
        playing: message.playing === true,
      });
    });
  }
  subscribeScreenDisconnections(listener) {
    return this.#eventBus.onClientDisconnection((clientId) => listener(clientId));
  }
  screenSubscriberCount(deviceId) { return this.#eventBus?.getTopicSubscriberCount?.(HOMELINE_TOPIC(deviceId)) ?? 0; }
  async deliverQueue({ deviceId, commandId, params, awaitAck = false, timeoutMs = 4000 }) {
    const envelope = this.buildCommand({ targetDevice: deviceId, command: 'queue', commandId, params });
    const emit = this.#broadcastEvent ?? ((payload) => this.#eventBus.broadcast(payload.topic, payload));
    if (!awaitAck) { emit({ topic: HOMELINE_TOPIC(deviceId), ...envelope }); return { ok: true }; }
    const startedAt = Date.now();
    if (typeof this.#eventBus?.waitForMessage !== 'function') {
      const error = new Error('eventBus lacks waitForMessage'); error.code = 'BUS_MISCONFIGURED'; throw error;
    }
    // Wake-and-load historically correlates the raw inbound device-ack frame,
    // which is not necessarily republished on the per-device acknowledgement
    // topic used by SessionControl. Keep that wire distinction inside the adapter.
    const ack = this.#eventBus.waitForMessage((message) => message?.topic === 'device-ack'
      && message.deviceId === deviceId && message.commandId === commandId, timeoutMs);
    emit({ topic: HOMELINE_TOPIC(deviceId), ...envelope }); await ack;
    return { ok: true, ackMs: Date.now() - startedAt };
  }
  publishProgress({ deviceId, ...progress }) {
    const emit = this.#broadcastEvent ?? ((payload) => this.#eventBus.broadcast(payload.topic, payload));
    emit({ topic: HOMELINE_TOPIC(deviceId), type: 'wake-progress', ...progress });
  }
  watchPlayback({ expectedContentIds, timeoutMs, onConfirmed, onTimeout }) {
    let settled = false; let timer;
    const unsubscribe = this.#eventBus?.subscribe?.('playback.log', (payload) => {
      if (settled || !payload?.contentId) return;
      const incoming = payload.contentId;
      if (!expectedContentIds.some((expected) => incoming === expected || incoming.startsWith(`${expected}:`) || expected.startsWith(`${incoming}:`))) return;
      settled = true; this.#clearTimer(timer); unsubscribe?.(); onConfirmed?.(incoming);
    });
    if (!unsubscribe) return () => {};
    timer = this.#setTimer(() => { if (settled) return; settled = true; unsubscribe?.(); onTimeout?.(); }, timeoutMs); timer?.unref?.();
    return () => { settled = true; this.#clearTimer(timer); unsubscribe?.(); };
  }
}
export default EventBusDeviceTransportGateway;
