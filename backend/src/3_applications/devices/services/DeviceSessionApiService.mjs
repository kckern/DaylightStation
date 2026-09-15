import { validateHandoffParams } from '#shared-contracts/media/handoff.mjs';

const nonEmpty = (value) => typeof value === 'string' && value.length > 0;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class DeviceSessionApiService {
  #sessions; #logger;
  constructor({ sessionControl = null, logger = console } = {}) { this.#sessions = sessionControl; this.#logger = logger; }
  configured() { return !!this.#sessions; }
  snapshot(deviceId) { return this.#sessions.getSnapshot(deviceId); }
  transport(deviceId, { action, value, commandId }) {
    this.#logger.info?.('device.router.session.transport', { deviceId, action, commandId });
    if (typeof this.#sessions.transport === 'function') {
      return this.#sessions.transport(deviceId, { action, value, commandId });
    }
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'transport', commandId,
      params: { action, ...(value !== undefined ? { value } : {}) } });
  }
  queue(deviceId, commandId, params) {
    this.#logger.info?.('device.router.session.queue', { deviceId, op: params.op, commandId });
    if (typeof this.#sessions.queue === 'function') return this.#sessions.queue(deviceId, commandId, params);
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'queue', commandId, params });
  }
  config(deviceId, { setting, value, commandId }) {
    const field = setting === 'shuffle' ? 'enabled'
      : setting === 'repeat' ? 'mode'
        : setting === 'volume' ? 'level' : setting;
    this.#logger.info?.(`device.router.session.${setting}`, { deviceId, [field]: value, commandId });
    if (typeof this.#sessions.config === 'function') {
      return this.#sessions.config(deviceId, { setting, value, commandId });
    }
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'config', commandId,
      params: { setting, value } });
  }
  claim(deviceId, commandId) {
    this.#logger.info?.('device.router.session.claim', { deviceId, commandId });
    return this.#sessions.claim(deviceId, { commandId });
  }
  handoff(deviceId, request) {
    const { commandId, params } = request ?? {};
    if (!isRecord(request) || Object.keys(request).some((key) => key !== 'commandId' && key !== 'params')) {
      return Promise.resolve({ ok: false, commandId, code: 'INVALID_ENVELOPE', error: 'handoff request must contain only commandId and params' });
    }
    if (!nonEmpty(commandId)) return Promise.resolve({ ok: false, code: 'INVALID_ENVELOPE', error: 'commandId required (non-empty string)' });
    if (!isRecord(params)) return Promise.resolve({ ok: false, commandId, code: 'INVALID_ENVELOPE', error: 'params required (object)' });
    const validation = validateHandoffParams(params);
    if (!validation.valid) return Promise.resolve({ ok: false, commandId, code: 'INVALID_ENVELOPE', error: validation.errors[0] || 'Invalid handoff params' });
    this.#logger.info?.('device.router.session.handoff', { deviceId, commandId, op: params.op });
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'handoff', commandId, params });
  }
}
