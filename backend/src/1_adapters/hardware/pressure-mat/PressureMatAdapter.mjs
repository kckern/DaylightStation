const RELAY_SOURCE = 'pressure-mat-relay';
const DEFAULT_TOPIC = 'pressure-mat';
const VALID_TYPES = new Set(['reading', 'presence', 'hello']);
const VALID_PRESENCE_EVENTS = new Set(['pressed', 'released', 'stomped']);

/**
 * Adapter for Daylight pressure-mat ESP32 relays.
 *
 * The board owns signal processing. This adapter validates its wire format,
 * keeps a queryable latest-value snapshot, and forwards normalized messages to
 * browser subscribers. Device HTTP commands are sent only to configured hosts.
 */
export class PressureMatAdapter {
  #eventBus;
  #definitions;
  #fetch;
  #logger;
  #now;
  #latest = new Map();

  constructor({ eventBus, config = {}, fetchImpl = globalThis.fetch, logger = console, now = () => Date.now() } = {}) {
    if (!eventBus?.onClientMessage || !eventBus?.broadcast) {
      throw new Error('PressureMatAdapter requires eventBus with onClientMessage + broadcast');
    }
    this.#eventBus = eventBus;
    this.#definitions = config.pressure_mats || {};
    this.#fetch = fetchImpl;
    this.#logger = logger;
    this.#now = now;
  }

  start() {
    this.#eventBus.onClientMessage((clientId, message) => this.ingest(clientId, message));
    // Register command topics internally so WebSocketEventBus recognizes them
    // even while a device is reconnecting. The ESP subscribes externally.
    for (const id of Object.keys(this.#definitions)) {
      this.#eventBus.subscribe?.(this.#controlTopic(id), () => {});
    }
    this.#logger.info?.('pressure_mat.adapter.started', { deviceCount: Object.keys(this.#definitions).length });
    return this;
  }

  /** Subscribe to normalized presence events without exposing bus topics/config. */
  subscribePresence(listener) {
    if (typeof listener !== 'function') {
      throw new Error('PressureMatAdapter.subscribePresence requires listener');
    }
    const topics = new Set([
      DEFAULT_TOPIC,
      ...Object.values(this.#definitions).map((definition) => definition?.topic).filter(Boolean),
    ]);
    const unsubscribers = [...topics].map((topic) => this.#eventBus.subscribe(topic, (payload) => {
      if (payload?.source === RELAY_SOURCE && payload?.type === 'presence') listener(payload);
    }));
    return () => {
      for (const unsubscribe of unsubscribers) {
        try { unsubscribe?.(); } catch { /* noop */ }
      }
    };
  }

  ingest(clientId, message) {
    if (!message || message.source !== RELAY_SOURCE || !VALID_TYPES.has(message.type)) return false;
    const id = typeof message.id === 'string' && message.id.trim() ? message.id.trim() : null;
    if (!id) return this.#reject('missing_id', { clientId, type: message.type });

    const voltage = Number(message.voltage);
    const restVoltage = Number(message.rest_voltage);
    const deltaV = Number(message.delta_v);
    const gradientVps = Number(message.gradient_vps);
    const peakDeltaV = Number(message.peak_delta_v);
    const peakGradientVps = Number(message.peak_gradient_vps);
    const pressDurationMs = Number(message.press_duration_ms);
    if (message.type !== 'hello' &&
        (!Number.isFinite(voltage) || !Number.isFinite(deltaV) || !Number.isFinite(gradientVps))) {
      return this.#reject('bad_reading', { clientId, id, type: message.type });
    }
    if (message.type === 'presence' && !VALID_PRESENCE_EVENTS.has(message.event)) {
      return this.#reject('bad_event', { clientId, id, event: message.event });
    }

    const receivedAtMs = this.#now();
    const payload = {
      source: RELAY_SOURCE,
      protocolVersion: Math.max(1, Number(message.protocol_version) || 1),
      id,
      type: message.type,
      occupied: Boolean(message.occupied),
      steps: Math.max(0, Number(message.steps) || 0),
      stomps: Math.max(0, Number(message.stomps) || 0),
      deviceTs: Number(message.ts) || 0,
      receivedAt: new Date(receivedAtMs).toISOString(),
    };
    if (Number.isFinite(voltage)) payload.voltage = voltage;
    if (Number.isFinite(restVoltage)) payload.restVoltage = restVoltage;
    if (Number.isFinite(deltaV)) payload.deltaV = deltaV;
    if (Number.isFinite(gradientVps)) payload.gradientVps = gradientVps;
    if (Number.isFinite(peakDeltaV)) payload.peakDeltaV = Math.max(0, peakDeltaV);
    if (Number.isFinite(peakGradientVps)) payload.peakGradientVps = Math.max(0, peakGradientVps);
    if (Number.isFinite(pressDurationMs)) payload.pressDurationMs = Math.max(0, pressDurationMs);
    if (typeof message.classified_stomp === 'boolean') payload.classifiedStomp = message.classified_stomp;
    if (message.type === 'presence') payload.event = message.event;
    if (message.type === 'hello') {
      payload.uptimeS = Math.max(0, Number(message.uptime_s) || 0);
      payload.bootCount = Math.max(0, Number(message.boot_count) || 0);
      payload.lastReset = message.last_reset || 'UNKNOWN';
      payload.rssi = Number(message.rssi) || 0;
      payload.freeHeap = Math.max(0, Number(message.free_heap) || 0);
    }

    const previous = this.#latest.get(id) || {};
    this.#latest.set(id, { ...previous, ...payload, clientId, receivedAtMs });
    this.#eventBus.broadcast(this.#definition(id).topic || DEFAULT_TOPIC, payload);
    return true;
  }

  listStatus() {
    const ids = new Set([...Object.keys(this.#definitions), ...this.#latest.keys()]);
    return [...ids].sort().map((id) => this.getStatus(id));
  }

  getStatus(id) {
    const definition = this.#definition(id);
    const latest = this.#latest.get(id) || null;
    if (!definition.configured && !latest) return null;
    return {
      id,
      label: definition.label || id,
      configured: definition.configured,
      online: Boolean(latest && this.#now() - latest.receivedAtMs < 90_000),
      host: definition.host || null,
      topic: definition.topic || DEFAULT_TOPIC,
      latest: latest ? this.#publicSnapshot(latest) : null,
    };
  }

  async fetchDeviceStatus(id) {
    return this.#request(id, '/status');
  }

  async recalibrate(id) {
    return this.#sendCommand(id, { action: 'recalibrate' });
  }

  async setThreshold(id, { delta, gradient, stompDelta, stompGradient }) {
    if (!Number.isFinite(delta) || delta <= 0 || !Number.isFinite(gradient) || gradient <= 0) {
      throw new PressureMatAdapterError('delta and gradient must be positive numbers', 400, 'INVALID_THRESHOLD');
    }
    return this.#sendCommand(id, {
      action: 'threshold', delta, gradient,
      ...(Number.isFinite(stompDelta) && stompDelta > 0 ? { stompDelta } : {}),
      ...(Number.isFinite(stompGradient) && stompGradient > 0 ? { stompGradient } : {}),
    });
  }

  async reboot(id) {
    return this.#sendCommand(id, { action: 'reboot' });
  }

  #controlTopic(id) {
    return `pressure-mat-control:${id}`;
  }

  #sendCommand(id, command) {
    const definition = this.#definition(id);
    if (!definition.configured) throw new PressureMatAdapterError(`Unknown pressure mat: ${id}`, 404, 'NOT_FOUND');
    const delivered = Number(this.#eventBus.broadcast(this.#controlTopic(id), {
      source: 'pressure-mat-api', id, ...command,
    })) || 0;
    if (delivered < 1) {
      throw new PressureMatAdapterError(`Pressure mat is not connected: ${id}`, 503, 'DEVICE_OFFLINE');
    }
    return { ok: true, delivered, id, action: command.action };
  }

  #definition(id) {
    const raw = this.#definitions[id] || {};
    return {
      ...raw,
      configured: Object.hasOwn(this.#definitions, id),
      host: raw.device?.host || raw.host || null,
    };
  }

  #publicSnapshot(snapshot) {
    const { clientId: _clientId, receivedAtMs: _receivedAtMs, ...publicValue } = snapshot;
    return publicValue;
  }

  #reject(reason, fields) {
    this.#logger.warn?.(`pressure_mat.ingest.${reason}`, fields);
    return false;
  }

  async #request(id, path, init = {}) {
    const definition = this.#definition(id);
    if (!definition.configured) throw new PressureMatAdapterError(`Unknown pressure mat: ${id}`, 404, 'NOT_FOUND');
    if (!definition.host) throw new PressureMatAdapterError(`No HTTP host configured for pressure mat: ${id}`, 503, 'HOST_NOT_CONFIGURED');
    if (typeof this.#fetch !== 'function') throw new PressureMatAdapterError('HTTP client unavailable', 503, 'HTTP_UNAVAILABLE');

    const base = /^https?:\/\//i.test(definition.host) ? definition.host : `http://${definition.host}`;
    const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
    let response;
    try {
      response = await this.#fetch(url, { signal: AbortSignal.timeout(5_000), ...init });
    } catch (error) {
      this.#logger.warn?.('pressure_mat.http.failed', { id, path, error: error.message });
      throw new PressureMatAdapterError(`Pressure mat unavailable: ${id}`, 502, 'DEVICE_UNAVAILABLE');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new PressureMatAdapterError(body.error || `Pressure mat returned HTTP ${response.status}`, 502, 'DEVICE_ERROR');
    return body;
  }
}

export class PressureMatAdapterError extends Error {
  constructor(message, status = 500, code = 'PRESSURE_MAT_ERROR') {
    super(message);
    this.name = 'PressureMatAdapterError';
    this.status = status;
    this.code = code;
  }
}

export default PressureMatAdapter;
