export const HOMELINE_SETUP_TTL_MS = 180_000;
export const HOMELINE_HEARTBEAT_STALE_MS = 20_000;

const TERMINAL = new Set(['ended', 'expired']);
const SIGNAL_BY_ROLE = {
  phone: new Set(['ready', 'offer', 'candidate', 'mute-state', 'media-retry', 'hangup', 'heartbeat', 'media-verified']),
  tv: new Set(['waiting', 'answer', 'candidate', 'mute-state', 'media-retry', 'hangup', 'heartbeat', 'media-verified']),
};
const SECRET_FIELDS = new Set(['credential', 'phoneCredential', 'tvCredential']);
function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_FIELDS.has(key))
    .map(([key, nested]) => [key, stripSecrets(nested)]));
}
function isPoweredOn(power) {
  if (!power) return null;
  const value = power.state ?? power.power ?? power.on ?? power;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  if (['on', 'playing', 'idle', 'home', 'ready'].includes(value.toLowerCase())) return true;
  if (['off', 'standby', 'unavailable'].includes(value.toLowerCase())) return false;
  return null;
}
function parseRestorableContent(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value, 'http://daylight.local');
    return { path: `${parsed.pathname}${parsed.hash || ''}`,
      query: Object.fromEntries(parsed.searchParams.entries()) };
  } catch { return null; }
}

const publicLease = lease => ({
  callId: lease.callId,
  attemptId: lease.attemptId,
  dispatchId: lease.dispatchId,
  deviceId: lease.deviceId,
  topic: lease.topic,
  state: lease.state,
  expiresAt: lease.expiresAt,
});

export class CallLeaseService {
  #devices; #wake; #logger; #clock; #scheduler; #identityIssuer;
  #byCall = new Map(); #byDevice = new Map(); #credentials = new Map(); #restoring = new Map();

  constructor({ deviceService, wakeAndLoadService, logger = console, clock, scheduler, identityIssuer } = {}) {
    if (!clock?.now || !scheduler?.after || !scheduler?.wait || !identityIssuer?.newCallId
      || !identityIssuer?.newDispatchId || !identityIssuer?.newTvPeerId || !identityIssuer?.newCredential) {
      throw new Error('CallLeaseService requires clock, scheduler, and identityIssuer');
    }
    this.#devices = deviceService;
    this.#wake = wakeAndLoadService;
    this.#logger = logger;
    this.#clock = clock;
    this.#scheduler = scheduler;
    this.#identityIssuer = identityIssuer;
  }

  async reserve({ deviceId, attemptId, phonePeerId, callerId }) {
    const device = this.#devices?.get?.(deviceId);
    if (!device) return { kind: 'not_found' };
    if (this.#restoring.has(deviceId)) {
      this.#logger.info?.('homeline.lease.conflict', { deviceId, attemptId, state: 'restoring', outcome: 'busy' });
      return { kind: 'busy' };
    }
    const active = this.#activeForDevice(deviceId);
    if (active) {
      this.#event('lease.conflict', active, { outcome: 'busy' });
      return { kind: 'busy', lease: publicLease(active) };
    }

    let priorState = { power: null, content: null, known: false };
    try {
      const state = await device.getState();
      priorState = { power: state?.power ?? null, content: state?.content ?? null, known: true };
    } catch (error) {
      this.#logger.warn?.('homeline.lease.prior-state-failed', { deviceId, attemptId, reason: error.message });
    }

    // The second active check makes reservation atomic across the awaited state read.
    if (this.#restoring.has(deviceId)) return { kind: 'busy' };
    const raced = this.#activeForDevice(deviceId);
    if (raced) return { kind: 'busy', lease: publicLease(raced) };

    const now = this.#clock.now();
    const callId = this.#identityIssuer.newCallId();
    const lease = {
      callId, attemptId, dispatchId: this.#identityIssuer.newDispatchId(), deviceId, callerId, phonePeerId,
      tvPeerId: null, topic: `homeline-call:${callId}`, state: 'reserved', priorState,
      createdAt: now, expiresAt: now + HOMELINE_SETUP_TTL_MS, hardRecoveryUsed: false,
      softRecoveryUsed: false, wakeUsed: false, hardExtensionUsed: false,
      callTurnedDeviceOn: false, participants: new Map(), timer: null,
      sequence: new Map(), revision: new Map(), phase: 'setup', restoration: null,
      heartbeatTimer: null, wasActive: false,
      signals: { phoneReady: false, tvWaiting: false, offerRevision: null,
        answerRevision: null, mediaVerified: new Set() },
    };
    this.#byCall.set(callId, lease);
    this.#byDevice.set(deviceId, callId);
    this.#armExpiry(lease);
    const phoneCredential = this.#mintCredential(lease, 'phone', phonePeerId);
    this.#event('lease.created', lease, { outcome: 'reserved' });
    return { kind: 'ok', body: { ...publicLease(lease), phonePeerId, phoneCredential } };
  }

  async wake(callId, callerId) {
    const lease = this.#owned(callId, callerId);
    if (!lease) return { kind: 'not_found' };
    if (lease.operation) return { kind: 'in_progress' };
    if (lease.wakeUsed) return { kind: 'wake_exhausted' };
    lease.wakeUsed = true;
    const operation = this.#executeWake(lease);
    lease.operation = operation;
    try { return await operation; }
    finally { if (lease.operation === operation) lease.operation = null; }
  }

  async #executeWake(lease) {
    const device = this.#devices.get(lease.deviceId);
    const before = isPoweredOn(lease.priorState.power);
    lease.state = 'waking';
    this.#event('wake.started', lease);
    const result = await this.#wake.execute(
      lease.deviceId,
      { open: `videocall/${lease.deviceId}` },
      { dispatchId: lease.dispatchId, deferredRetry: false, isCancelled: () => TERMINAL.has(lease.state),
        correlation: { callId: lease.callId, attemptId: lease.attemptId, callerId: lease.callerId,
          phonePeerId: lease.phonePeerId, tvPeerId: lease.tvPeerId, state: lease.state } },
    );
    if (before === false && result?.steps?.power?.ok === true) lease.callTurnedDeviceOn = true;
    if (TERMINAL.has(lease.state)) {
      return { kind: 'failed', body: { ...result, ok: false, cancelled: true,
        callId: lease.callId, attemptId: lease.attemptId } };
    }
    lease.state = result?.ok ? 'waiting_tv' : 'reserved';
    this.#event('wake.completed', lease, { outcome: result?.ok ? 'ok' : 'failed', reason: result?.error });
    return { kind: result?.ok ? 'ok' : 'failed', body: { ...result,
      callId: lease.callId, attemptId: lease.attemptId } };
  }

  joinActive({ deviceId, declaredDeviceId, isLocal }) {
    if (!isLocal || declaredDeviceId !== deviceId) return { kind: 'forbidden' };
    const lease = this.#activeForDevice(deviceId);
    if (!lease) return { kind: 'empty' };
    const tvPeerId = this.#identityIssuer.newTvPeerId();
    this.#revokeRole(lease, 'tv');
    lease.tvPeerId = tvPeerId;
    const tvCredential = this.#mintCredential(lease, 'tv', tvPeerId);
    this.#event('tv.joined', lease, { tvPeerId });
    return { kind: 'ok', body: { ...publicLease(lease), tvPeerId, tvCredential } };
  }

  resume(callId, callerId) {
    const lease = this.#owned(callId, callerId);
    if (!lease) return { kind: 'not_found' };
    this.#revokeRole(lease, 'phone');
    const phoneCredential = this.#mintCredential(lease, 'phone', lease.phonePeerId);
    this.#event('lease.resumed', lease);
    return { kind: 'ok', body: { ...publicLease(lease), phoneCredential, phonePeerId: lease.phonePeerId } };
  }

  async recover(callId, callerId, level, { confirmed = false } = {}) {
    const lease = this.#owned(callId, callerId);
    if (!lease) return { kind: 'not_found' };
    if (!['soft', 'hard'].includes(level)) return { kind: 'invalid' };
    if (lease.operation) return { kind: 'in_progress' };
    if (level === 'soft' && lease.softRecoveryUsed) return { kind: 'soft_exhausted' };
    if (level === 'hard' && confirmed !== true) return { kind: 'confirmation_required' };
    if (level === 'hard' && lease.hardRecoveryUsed) return { kind: 'exhausted' };
    if (level === 'soft') lease.softRecoveryUsed = true;
    const operation = this.#executeRecovery(lease, level);
    lease.operation = operation;
    try { return await operation; }
    finally { if (lease.operation === operation) lease.operation = null; }
  }

  async #executeRecovery(lease, level) {
    const device = this.#devices.get(lease.deviceId);
    lease.state = 'recovering';
    this.#event('recovery.started', lease, { recoveryRung: level });
    try {
      let method = 'reload';
      if (level === 'hard') {
        lease.hardRecoveryUsed = true;
        // Extend before the potentially long hardware operation. Otherwise a
        // hard recovery accepted near the setup deadline could expire midway
        // through its reboot/power-cycle despite owning the one extension.
        if (!lease.hardExtensionUsed) {
          lease.hardExtensionUsed = true;
          lease.expiresAt = Math.max(lease.expiresAt, this.#clock.now() + HOMELINE_SETUP_TTL_MS);
          for (const credential of this.#credentials.values()) {
            if (credential.callId === lease.callId && !credential.revoked) credential.expiresAt = lease.expiresAt;
          }
          this.#armExpiry(lease);
        }
        let reboot = await device.reboot();
        if (TERMINAL.has(lease.state)) throw new Error('CALL_ENDED');
        if (!reboot?.ok) {
          method = 'power-cycle';
          const off = await device.powerOff();
          if (!off?.ok) throw new Error(off?.error || 'Power off failed');
          await this.#scheduler.wait(10_000);
          if (TERMINAL.has(lease.state)) throw new Error('CALL_ENDED');
          const on = await device.powerOn();
          if (!on?.ok) throw new Error(on?.error || 'Power on failed');
          if (isPoweredOn(lease.priorState?.power) === false) lease.callTurnedDeviceOn = true;
          await this.#scheduler.wait(60_000);
        } else {
          method = 'reboot';
          if (isPoweredOn(lease.priorState?.power) === false) lease.callTurnedDeviceOn = true;
          await this.#scheduler.wait(15_000);
        }
        if (TERMINAL.has(lease.state)) throw new Error('CALL_ENDED');
      }
      const prepared = await device.prepareForContent({ skipCameraCheck: false });
      if (TERMINAL.has(lease.state)) throw new Error('CALL_ENDED');
      if (prepared?.ok !== true) throw new Error(prepared?.error || 'Preparation failed');
      const loaded = await device.loadContent(device.screenPath || '/screen/living-room', {
        open: `videocall/${lease.deviceId}`,
      });
      if (loaded?.ok !== true) throw new Error(loaded?.error || 'Reload failed');
      if (TERMINAL.has(lease.state)) throw new Error('CALL_ENDED');
      lease.state = 'waiting_tv';
      this.#event('recovery.completed', lease, { recoveryRung: level, outcome: 'ok', method });
      return { kind: 'ok', body: { ok: true, level, method,
        coldWake: level === 'hard' || prepared.coldRestart === true,
        cameraAvailable: prepared.cameraAvailable,
        callId: lease.callId, dispatchId: lease.dispatchId } };
    } catch (error) {
      if (TERMINAL.has(lease.state)) {
        return { kind: 'failed', body: { ok: false, cancelled: true, level,
          error: 'Call ended', callId: lease.callId } };
      }
      lease.state = 'recovery_prompt';
      this.#event('recovery.completed', lease, { recoveryRung: level, outcome: 'failed', reason: error.message });
      return { kind: 'failed', body: { ok: false, level, error: error.message, callId: lease.callId } };
    }
  }

  async end(callId, callerId, reason = 'ended') {
    const lease = this.#byCall.get(callId);
    if (!lease || (callerId && lease.callerId !== callerId)) return { kind: 'not_found' };
    if (TERMINAL.has(lease.state)) {
      if (lease.endPromise) await lease.endPromise;
      return { kind: 'ok', body: { ok: true, ...publicLease(lease), restoration: lease.restoration } };
    }
    lease.state = 'ended';
    lease.timer?.();
    lease.heartbeatTimer?.();
    this.#revokeLease(lease);
    this.#byDevice.delete(lease.deviceId);
    this.#restoring.set(lease.deviceId, lease);
    const pending = lease.operation;
    lease.endPromise = (async () => {
      if (pending) await pending.catch(() => {});
      lease.restoration = await this.#restoreOnce(lease);
      this.#event('lease.ended', lease, { reason, outcome: lease.restoration.outcome });
      return { kind: 'ok', body: { ok: true, ...publicLease(lease), restoration: lease.restoration } };
    })();
    return lease.endPromise;
  }

  authorize({ clientId, topic, credential, role, peerId }) {
    const record = this.#credentials.get(credential);
    if (!record || record.revoked) return { ok: false, code: 'INVALID_CREDENTIAL' };
    const lease = this.#byCall.get(record.callId);
    if (record.expiresAt <= this.#clock.now() && !lease?.wasActive) return { ok: false, code: 'INVALID_CREDENTIAL' };
    if (!lease || TERMINAL.has(lease.state) || lease.topic !== topic || record.role !== role || record.peerId !== peerId) {
      return { ok: false, code: 'LEASE_MISMATCH' };
    }
    if (record.clientId && record.clientId !== clientId) return { ok: false, code: 'CREDENTIAL_IN_USE' };
    record.clientId = clientId;
    for (const key of lease.sequence.keys()) if (key.startsWith(`${role}:`)) lease.sequence.delete(key);
    lease.participants.set(role, { clientId, peerId, lastSeenAt: this.#clock.now() });
    return { ok: true, callId: lease.callId, role, peerId };
  }

  canSubscribe(clientId, topic) {
    if (!String(topic).startsWith('homeline-call:')) return true;
    return [...this.#credentials.values()].some(record => !record.revoked && record.clientId === clientId
      && this.#byCall.get(record.callId)?.topic === topic);
  }

  validateSignal(clientId, message) {
    if (!String(message?.topic).startsWith('homeline-call:')) return { ok: true, message };
    const record = [...this.#credentials.values()].find(item => !item.revoked && item.clientId === clientId
      && item.callId === message.callId && item.role === message.role && item.peerId === message.peerId);
    const lease = record && this.#byCall.get(record.callId);
    // Rejection details deliberately exclude the payload: SDP and ICE candidates
    // are secrets, but the lease/revision/code are the evidence needed to
    // diagnose a stale reconnect or an out-of-phase peer.
    const reject = code => {
      if (lease) {
        this.#event('signaling.rejected', lease, {
          role: message.role,
          peerRevision: Number.isInteger(Number(message.revision)) ? Number(message.revision) : null,
          reason: code,
          outcome: 'rejected',
        });
      }
      return { ok: false, code };
    };
    if (!lease || lease.topic !== message.topic || TERMINAL.has(lease.state)
      || message.attemptId !== lease.attemptId) return reject('UNAUTHORIZED_SIGNAL');
    if (!SIGNAL_BY_ROLE[message.role]?.has(message.type)) return reject('UNEXPECTED_SIGNAL');
    const revision = Number(message.revision);
    const sequence = Number(message.sequence);
    if (!Number.isInteger(revision) || revision < 0 || !Number.isInteger(sequence) || sequence < 0) {
      return reject('INVALID_SIGNAL');
    }
    const key = `${message.role}:${revision}`;
    const last = lease.sequence.get(key) ?? -1;
    if (sequence <= last) return reject('STALE_SIGNAL');
    const currentRevision = lease.revision.get(message.role) ?? revision;
    if (revision < currentRevision) return reject('STALE_REVISION');
    const phaseError = this.#validatePhase(lease, message, revision);
    if (phaseError) return reject(phaseError);
    lease.revision.set(message.role, revision);
    lease.sequence.set(key, sequence);
    lease.participants.set(message.role, { clientId, peerId: message.peerId, lastSeenAt: this.#clock.now() });
    if (message.type === 'heartbeat') this.#refreshActiveState(lease);
    if (message.type === 'ready') lease.signals.phoneReady = true;
    if (message.type === 'waiting') lease.signals.tvWaiting = true;
    if (message.type === 'offer') {
      lease.phase = lease.wasActive ? 'reconnecting' : 'negotiating';
      lease.state = lease.phase;
      lease.signals.offerRevision = revision;
      lease.signals.answerRevision = null;
      lease.signals.mediaVerified = new Set();
    }
    if (message.type === 'answer') {
      lease.phase = 'verifying_media';
      lease.state = 'verifying_media';
      lease.signals.answerRevision = revision;
    }
    if (message.type === 'media-verified') {
      lease.signals.mediaVerified.add(message.role);
      if (lease.signals.mediaVerified.size === 2) {
        lease.phase = 'active'; lease.state = 'active'; lease.wasActive = true;
        lease.timer?.(); this.#armParticipantStale(lease);
      }
    }
    if (!['candidate', 'heartbeat'].includes(message.type)) {
      this.#event(`signaling.${message.type}`, lease, {
        role: message.role,
        peerRevision: revision,
        outcome: 'accepted',
      });
    }
    return { ok: true, message: stripSecrets(message) };
  }

  disconnect(clientId) {
    for (const record of this.#credentials.values()) if (record.clientId === clientId) record.clientId = null;
  }

  get(callId) { const lease = this.#byCall.get(callId); return lease ? publicLease(lease) : null; }
  hasActive(deviceId) { return !!this.#activeForDevice(deviceId); }

  #activeForDevice(deviceId) {
    const callId = this.#byDevice.get(deviceId);
    const lease = callId && this.#byCall.get(callId);
    if (!lease || TERMINAL.has(lease.state)) return null;
    if (!lease.wasActive && lease.expiresAt <= this.#clock.now()) { this.#expire(lease); return null; }
    return lease;
  }
  #owned(callId, callerId) {
    const lease = this.#byCall.get(callId);
    return lease && !TERMINAL.has(lease.state) && lease.callerId === callerId ? lease : null;
  }
  #mintCredential(lease, role, peerId) {
    const token = this.#identityIssuer.newCredential();
    this.#credentials.set(token, { callId: lease.callId, role, peerId, expiresAt: lease.expiresAt, revoked: false, clientId: null });
    return token;
  }
  #revokeRole(lease, role) {
    for (const [token, item] of this.#credentials) {
      if (item.callId === lease.callId && item.role === role) this.#credentials.delete(token);
    }
  }
  #revokeLease(lease) {
    for (const [token, item] of this.#credentials) {
      if (item.callId === lease.callId) this.#credentials.delete(token);
    }
  }
  #validatePhase(lease, message, revision) {
    const { type, role } = message;
    if (['heartbeat', 'hangup', 'mute-state', 'media-retry', 'ready', 'waiting'].includes(type)) return null;
    if (type === 'offer') {
      return role === 'phone' && lease.signals.tvWaiting ? null : 'UNEXPECTED_PHASE';
    }
    if (type === 'answer') {
      return role === 'tv' && lease.signals.offerRevision === revision ? null : 'UNEXPECTED_PHASE';
    }
    if (type === 'candidate') {
      return ['negotiating', 'verifying_media', 'reconnecting', 'active'].includes(lease.phase)
        ? null : 'UNEXPECTED_PHASE';
    }
    if (type === 'media-verified') {
      return ['verifying_media', 'reconnecting', 'active'].includes(lease.phase)
        && lease.signals.answerRevision === revision ? null : 'UNEXPECTED_PHASE';
    }
    return 'UNEXPECTED_PHASE';
  }
  #armExpiry(lease) {
    lease.timer?.();
    const delay = Math.max(0, lease.expiresAt - this.#clock.now());
    lease.timer = this.#scheduler.after(delay, () => this.#expire(lease));
  }
  #expire(lease) {
    if (TERMINAL.has(lease.state) || lease.wasActive) return;
    lease.state = 'expired'; this.#byDevice.delete(lease.deviceId); this.#revokeLease(lease);
    this.#restoring.set(lease.deviceId, lease);
    this.#event('lease.expired', lease, { outcome: 'expired' });
    const pending = lease.operation;
    void (pending ? pending.catch(() => {}) : Promise.resolve()).then(() => this.#restoreOnce(lease)).then(result => {
      lease.restoration = result;
      this.#event('device.restored', lease, { outcome: result.outcome, reason: result.reason });
    });
  }
  #refreshActiveState(lease) {
    const now = this.#clock.now();
    const phone = lease.participants.get('phone');
    const tv = lease.participants.get('tv');
    if (phone && tv && now - phone.lastSeenAt <= HOMELINE_HEARTBEAT_STALE_MS && now - tv.lastSeenAt <= HOMELINE_HEARTBEAT_STALE_MS) {
      lease.state = lease.phase === 'active' ? 'active' : lease.state;
    }
    if (lease.phase === 'active') this.#armParticipantStale(lease);
  }
  #armParticipantStale(lease) {
    lease.heartbeatTimer?.();
    const phoneSeenAt = lease.participants.get('phone')?.lastSeenAt ?? this.#clock.now();
    const tvSeenAt = lease.participants.get('tv')?.lastSeenAt ?? this.#clock.now();
    const staleAt = Math.min(phoneSeenAt, tvSeenAt) + HOMELINE_HEARTBEAT_STALE_MS;
    lease.heartbeatTimer = this.#scheduler.after(Math.max(0, staleAt - this.#clock.now()), () => {
      const now = this.#clock.now();
      const phone = lease.participants.get('phone');
      const tv = lease.participants.get('tv');
      if (phone && tv && now - phone.lastSeenAt < HOMELINE_HEARTBEAT_STALE_MS
        && now - tv.lastSeenAt < HOMELINE_HEARTBEAT_STALE_MS) {
        this.#armParticipantStale(lease); return;
      }
      lease.state = 'expired'; lease.phase = 'ended'; this.#byDevice.delete(lease.deviceId); this.#revokeLease(lease);
      this.#restoring.set(lease.deviceId, lease);
      this.#event('lease.participant-stale', lease, { outcome: 'expired' });
      void this.#restoreOnce(lease).then(result => {
        lease.restoration = result;
        this.#event('device.restored', lease, { outcome: result.outcome, reason: result.reason });
      });
    });
    lease.heartbeatTimer?.unref?.();
  }
  async #restore(lease) {
    const device = this.#devices.get(lease.deviceId);
    if (!device) return { outcome: 'partial', reason: 'device_missing' };
    try {
      if (lease.callTurnedDeviceOn && isPoweredOn(lease.priorState?.power) === false) {
        const off = await device.powerOff();
        return off?.ok !== true ? { outcome: 'partial', reason: 'power_off_failed' } : { outcome: 'restored', action: 'power_off' };
      }
      const priorUrl = lease.priorState?.content?.currentUrl || lease.priorState?.content?.url;
      const target = parseRestorableContent(priorUrl);
      const actions = [];
      if (target) {
        const loaded = await device.loadContent(target.path, target.query);
        if (loaded?.ok !== true) return { outcome: 'partial', reason: 'content_restore_failed' };
        actions.push('content');
      }
      if (lease.priorState?.content?.screenOn === false) {
        const screen = await device.setScreen?.(false);
        if (!screen || screen.ok === false) return { outcome: 'partial', reason: 'screen_restore_failed', actions };
        actions.push('screen_off');
      }
      if (actions.length) return { outcome: 'restored', action: actions.join('+') };
      return { outcome: 'left_on', reason: lease.priorState?.known ? 'no_restorable_content' : 'prior_state_unknown' };
    } catch (error) { return { outcome: 'partial', reason: error.message }; }
  }
  #restoreOnce(lease) {
    if (lease.restoration) return Promise.resolve(lease.restoration);
    if (lease.restorationPromise) return lease.restorationPromise;
    const promise = this.#restore(lease).then(result => {
      lease.restoration = result;
      return result;
    }).finally(() => {
      if (this.#restoring.get(lease.deviceId) === promise) this.#restoring.delete(lease.deviceId);
      if (lease.restorationPromise === promise) lease.restorationPromise = null;
    });
    lease.restorationPromise = promise;
    this.#restoring.set(lease.deviceId, promise);
    return promise;
  }
  #event(name, lease, extra = {}) {
    const previousState = lease.lastLoggedState ?? null;
    this.#logger.info?.(`homeline.${name}`, {
      callId: lease.callId, attemptId: lease.attemptId, dispatchId: lease.dispatchId,
      deviceId: lease.deviceId, callerId: lease.callerId, phonePeerId: lease.phonePeerId,
      tvPeerId: lease.tvPeerId, state: lease.state, previousState,
      peerRevision: Math.max(-1, ...lease.revision.values()),
      elapsedMs: this.#clock.now() - lease.createdAt, ...extra,
    });
    lease.lastLoggedState = lease.state;
  }
}

export default CallLeaseService;
