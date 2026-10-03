import { validateHandoffParams } from '#shared-contracts/media/handoff.mjs';

const nonEmpty = (value) => typeof value === 'string' && value.length > 0;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class DeviceSessionApiService {
  #sessions; #logger;
  constructor({ sessionControl = null, logger = console } = {}) { this.#sessions = sessionControl; this.#logger = logger; }
  configured() { return !!this.#sessions; }
  snapshot(deviceId) { return this.#sessions.getSnapshot(deviceId); }
  transport(deviceId, { action, value, commandId, origin }) {
    this.#logger.info?.('device.router.session.transport', { deviceId, action, commandId, originKind: origin?.kind ?? null });
    if (typeof this.#sessions.transport === 'function') {
      return this.#sessions.transport(deviceId, { action, value, commandId, origin });
    }
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'transport', commandId,
      params: { action, ...(value !== undefined ? { value } : {}) }, ...(origin ? { origin } : {}) });
  }
  queue(deviceId, commandId, params, origin) {
    this.#logger.info?.('device.router.session.queue', { deviceId, op: params.op, commandId, originKind: origin?.kind ?? null });
    if (typeof this.#sessions.queue === 'function') return this.#sessions.queue(deviceId, commandId, params, origin);
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'queue', commandId, params, ...(origin ? { origin } : {}) });
  }
  config(deviceId, { setting, value, commandId, origin }) {
    const field = setting === 'shuffle' ? 'enabled'
      : setting === 'repeat' ? 'mode'
        : setting === 'volume' ? 'level' : setting;
    this.#logger.info?.(`device.router.session.${setting}`, { deviceId, [field]: value, commandId });
    if (typeof this.#sessions.config === 'function') {
      return this.#sessions.config(deviceId, { setting, value, commandId, origin });
    }
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'config', commandId,
      params: { setting, value }, ...(origin ? { origin } : {}) });
  }
  /** Screen session actions: sleep timer, resume-sleep, put-back, countdown (tech doc §6.2.6). */
  session(deviceId, { action, params = {}, commandId, origin }) {
    this.#logger.info?.('device.router.session.action', { deviceId, action, commandId, originKind: origin?.kind ?? null });
    if (typeof this.#sessions.session === 'function') {
      return this.#sessions.session(deviceId, { action, params, commandId, origin });
    }
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'session', commandId,
      params: { action, ...params }, ...(origin ? { origin } : {}) });
  }
  claim(deviceId, commandId, origin) {
    this.#logger.info?.('device.router.session.claim', { deviceId, commandId });
    return this.#sessions.claim(deviceId, { commandId, ...(origin ? { origin } : {}) });
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
    if (typeof this.#sessions.handoff === 'function') {
      return this.#sessions.handoff(deviceId, { commandId, params });
    }
    return this.#sessions.sendCommand({ targetDevice: deviceId, command: 'handoff', commandId, params });
  }
}
