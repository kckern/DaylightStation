function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class RemoteSessionAdapter {
  constructor({ deviceId, httpClient, getSnapshot }) {
    this._deviceId = deviceId;
    this._http = httpClient;
    this._getSnapshot = getSnapshot;
    this._pendingAcks = new Map();
  }

  getSnapshot() { return this._getSnapshot(); }

  _commandId() { return uuid(); }

  async _post(path, body) {
    const commandId = this._commandId();
    const payload = { ...body, commandId };
    const ackPromise = this._registerAck(commandId);
    const httpPromise = this._http(path, payload, 'POST');
    const [httpRes] = await Promise.all([httpPromise, ackPromise.catch(() => null)]);
    return { http: httpRes, commandId };
  }

  async _put(path, body) {
    const commandId = this._commandId();
    const payload = { ...body, commandId };
    const ackPromise = this._registerAck(commandId);
    const httpPromise = this._http(path, payload, 'PUT');
    const [httpRes] = await Promise.all([httpPromise, ackPromise.catch(() => null)]);
    return { http: httpRes, commandId };
  }

  _registerAck(commandId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingAcks.delete(commandId);
        reject(new Error(`ack-timeout:${commandId}`));
      }, 5000);
      this._pendingAcks.set(commandId, { resolve, reject, timeout });
    });
  }

  _resolveAck({ commandId, ok, error }) {
    const pending = this._pendingAcks.get(commandId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this._pendingAcks.delete(commandId);
    if (ok) pending.resolve({ ok });
    else pending.reject(new Error(error ?? 'ack-error'));
  }

  transport = {
    play: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'play' }),
    pause: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'pause' }),
    stop: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'stop' }),
    seekAbs: (seconds) => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'seekAbs', value: seconds }),
    seekRel: (delta) => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'seekRel', value: delta }),
    skipNext: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'skipNext' }),
    skipPrev: () => this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'skipPrev' }),
  };

  queue = {
    playNow: (input, opts = {}) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/play-now`,
      { contentId: input.contentId, clearRest: !!opts.clearRest }
    ),
    playNext: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/play-next`,
      { contentId: input.contentId }
    ),
    addUpNext: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/add-up-next`,
      { contentId: input.contentId }
    ),
    add: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/add`,
      { contentId: input.contentId }
    ),
    reorder: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/reorder`,
      input
    ),
    remove: (queueItemId) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/remove`,
      { queueItemId }
    ),
    jump: (queueItemId) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/jump`,
      { queueItemId }
    ),
    clear: () => this._post(`api/v1/device/${this._deviceId}/session/queue/clear`, {}),
  };

  config = {
    setShuffle: (enabled) => this._put(`api/v1/device/${this._deviceId}/session/shuffle`, { enabled: !!enabled }),
    setRepeat: (mode) => this._put(`api/v1/device/${this._deviceId}/session/repeat`, { mode }),
    setShader: (shader) => this._put(`api/v1/device/${this._deviceId}/session/shader`, { shader: shader ?? null }),
    setVolume: (level) => this._put(
      `api/v1/device/${this._deviceId}/session/volume`,
      { level: Math.max(0, Math.min(100, Math.round(Number(level) || 0))) }
    ),
  };

  lifecycle = {
    reset: () => { /* no-op */ },
    adoptSnapshot: () => { /* P6 concern */ },
  };

  portability = {
    snapshotForHandoff: () => null,
    receiveClaim: () => { /* P6 concern */ },
  };
}

export default RemoteSessionAdapter;
