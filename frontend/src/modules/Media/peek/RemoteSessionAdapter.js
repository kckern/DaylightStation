import mediaLog from '../logging/mediaLog.js';

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

  _logCommand(action, value) {
    mediaLog.peekCommand({
      deviceId: this._deviceId,
      action,
      ...(value !== undefined ? { value } : {}),
    });
  }

  async _post(path, body, action = body.action ?? null) {
    const commandId = this._commandId();
    const payload = { ...body, commandId };
    const ackPromise = this._registerAck(commandId, action);
    const httpPromise = this._http(path, payload, 'POST');
    const [httpRes] = await Promise.all([httpPromise, ackPromise.catch(() => null)]);
    return { http: httpRes, commandId };
  }

  async _put(path, body, action = null) {
    const commandId = this._commandId();
    const payload = { ...body, commandId };
    const ackPromise = this._registerAck(commandId, action);
    const httpPromise = this._http(path, payload, 'PUT');
    const [httpRes] = await Promise.all([httpPromise, ackPromise.catch(() => null)]);
    return { http: httpRes, commandId };
  }

  _registerAck(commandId, action = null) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingAcks.delete(commandId);
        reject(new Error(`ack-timeout:${commandId}`));
      }, 5000);
      this._pendingAcks.set(commandId, { resolve, reject, timeout, action, startedAt: Date.now() });
    });
  }

  _resolveAck({ commandId, ok, error }) {
    const pending = this._pendingAcks.get(commandId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this._pendingAcks.delete(commandId);
    mediaLog.peekCommandAck({
      deviceId: this._deviceId,
      action: pending.action,
      ok: !!ok,
      elapsedMs: Date.now() - pending.startedAt,
    });
    if (ok) pending.resolve({ ok });
    else pending.reject(new Error(error ?? 'ack-error'));
  }

  transport = {
    play: () => {
      this._logCommand('play');
      return this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'play' });
    },
    pause: () => {
      this._logCommand('pause');
      return this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'pause' });
    },
    stop: () => {
      this._logCommand('stop');
      return this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'stop' });
    },
    seekAbs: (seconds) => {
      this._logCommand('seekAbs', seconds);
      return this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'seekAbs', value: seconds });
    },
    seekRel: (delta) => {
      this._logCommand('seekRel', delta);
      return this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'seekRel', value: delta });
    },
    skipNext: () => {
      this._logCommand('skipNext');
      return this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'skipNext' });
    },
    skipPrev: () => {
      this._logCommand('skipPrev');
      return this._post(`api/v1/device/${this._deviceId}/session/transport`, { action: 'skipPrev' });
    },
  };

  queue = {
    playNow: (input, opts = {}) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/play-now`,
      { contentId: input.contentId, clearRest: !!opts.clearRest },
      'queue.playNow'
    ),
    playNext: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/play-next`,
      { contentId: input.contentId },
      'queue.playNext'
    ),
    addUpNext: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/add-up-next`,
      { contentId: input.contentId },
      'queue.addUpNext'
    ),
    add: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/add`,
      { contentId: input.contentId },
      'queue.add'
    ),
    reorder: (input) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/reorder`,
      input,
      'queue.reorder'
    ),
    remove: (queueItemId) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/remove`,
      { queueItemId },
      'queue.remove'
    ),
    jump: (queueItemId) => this._post(
      `api/v1/device/${this._deviceId}/session/queue/jump`,
      { queueItemId },
      'queue.jump'
    ),
    clear: () => this._post(`api/v1/device/${this._deviceId}/session/queue/clear`, {}, 'queue.clear'),
  };

  config = {
    setShuffle: (enabled) => {
      this._logCommand('setShuffle', !!enabled);
      return this._put(`api/v1/device/${this._deviceId}/session/shuffle`, { enabled: !!enabled }, 'setShuffle');
    },
    setRepeat: (mode) => {
      this._logCommand('setRepeat', mode);
      return this._put(`api/v1/device/${this._deviceId}/session/repeat`, { mode }, 'setRepeat');
    },
    setShader: (shader) => {
      this._logCommand('setShader', shader ?? null);
      return this._put(`api/v1/device/${this._deviceId}/session/shader`, { shader: shader ?? null }, 'setShader');
    },
    setVolume: (level) => {
      const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
      this._logCommand('setVolume', clamped);
      return this._put(`api/v1/device/${this._deviceId}/session/volume`, { level: clamped }, 'setVolume');
    },
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
